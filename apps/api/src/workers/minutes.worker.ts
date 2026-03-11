// ============================================================
// OrgsLedger API — Minutes Worker (Stage 5 - Scaled)
// Production-grade meeting minutes generation with BullMQ
// Subscribes to SHARDED minutes-generation queues
// Supports 50k+ concurrent meetings via horizontal scaling
//
// Scaling features:
//   - Subscribes to ALL 8 minutes shards
//   - CPU-based dynamic concurrency (CPU_CORES * 1)
//   - Worker identity for distributed tracing
//
// This worker:
// 1. Checks for existing minutes (idempotency)
// 2. Retrieves transcripts from Redis
// 3. Uses minutes-ai.service.ts for LLM summarization
// 4. Stores structured minutes in PostgreSQL
// 5. Broadcasts completion events
//
// Environment Variables:
//   MINUTES_AI_MODEL=gpt-4o-mini
//   MINUTES_MAX_TOKENS=10000
//   REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
//
// ============================================================

import { Worker, Job } from 'bullmq';
import { createBullMQConnection } from '../infrastructure/redisClient';
import { logger } from '../logger';
import {
  queueManager,
  initializeQueueManager,
  SHARDED_QUEUE_TYPES,
  MinutesJobData,
  submitBroadcast,
  moveToDeadLetter,
} from '../queues/queue-manager';
import { getMeetingTranscripts } from './transcript.worker';
import db from '../db';
import {
  generateMeetingMinutes,
  StructuredMinutes,
  TranscriptEntry,
} from '../services/minutes-ai.service';
import { storeMinutesGenerationMs } from '../monitoring/meeting-metrics';
import { guardOpenAIRequest } from '../monitoring/ai-rate-limit.guard';
import {
  WORKER_ID,
  WORKER_CONCURRENCY,
  logWorkerIdentity,
} from '../scaling/worker-identity';
import {
  getMinutesIdempotencyKey,
  checkAndMarkProcessed,
} from './idempotency';

// ── Types ───────────────────────────────────────────────────

export interface MeetingMinutes {
  meetingId: string;
  organizationId: string;
  generatedAt: string;
  summary: string;
  keyTopics: string[];
  decisions: string[];
  actionItems: Array<{
    task: string;
    owner?: string;
    deadline?: string;
  }>;
  participants: string[];
  wordCount: number;
  chunksProcessed: number;
}

interface MinutesJobResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  minutes?: MeetingMinutes;
}

// ── Worker Configuration ────────────────────────────────────

const WORKER_CONFIG = {
  maxAttempts: 3,
  backoffType: 'exponential' as const,
  backoffDelay: 5000, // 5 seconds base delay
  lockDuration: 600000, // 10 minutes for long AI processing
  stalledInterval: 60000, // 1 minute stall check
  maxStalledCount: 2,
};

// ── Worker Class ────────────────────────────────────────────

class MinutesWorker {
  private workers: Worker<MinutesJobData>[] = [];
  private isRunning = false;
  private processedCount = 0;
  private skippedCount = 0;
  private failedCount = 0;

  async initialize(): Promise<void> {
    try {
      // Initialize queue manager first
      await initializeQueueManager();
      
      const connection = createBullMQConnection();
      const concurrency = WORKER_CONCURRENCY.minutes();

      // Get all sharded queues for minutes processing
      const queues = queueManager.getAllMinutesQueues();

      logWorkerIdentity('MINUTES_WORKER');
      logger.info('[MINUTES_WORKER] Starting workers for all shards', {
        workerId: WORKER_ID,
        shardCount: queues.length,
        concurrencyPerShard: concurrency,
        totalConcurrency: concurrency * queues.length,
      });

      // Create a worker for EACH shard queue
      for (const queue of queues) {
        const worker = new Worker<MinutesJobData>(
          queue.name,
          async (job: Job<MinutesJobData>) => {
            return this.processMinutesJob(job);
          },
          {
            connection: connection as any,
            concurrency,
            maxStalledCount: WORKER_CONFIG.maxStalledCount,
            stalledInterval: WORKER_CONFIG.stalledInterval,
            lockDuration: WORKER_CONFIG.lockDuration,
          }
        );

        this.setupWorkerEventHandlers(worker, queue.name);
        this.workers.push(worker);
      }

      this.isRunning = true;
      logger.info('[MINUTES_WORKER] All shard workers initialized', {
        workerId: WORKER_ID,
        workerCount: this.workers.length,
        concurrency,
      });
    } catch (err) {
      logger.error('[MINUTES_WORKER] Failed to initialize', err);
      throw err;
    }
  }

  /**
   * Set up worker event handlers for a shard.
   */
  private setupWorkerEventHandlers(worker: Worker<MinutesJobData>, queueName: string): void {
    worker.on('ready', () => {
      logger.debug('[MINUTES_WORKER] Shard ready', {
        queue: queueName,
        workerId: WORKER_ID,
      });
    });

    worker.on('error', (err: Error) => {
      logger.error('[MINUTES_WORKER] Worker error', {
        queue: queueName,
        error: err.message,
        workerId: WORKER_ID,
      });
    });

    worker.on('failed', async (job, err: Error) => {
      this.failedCount++;
      const maxAttempts = job?.opts?.attempts || 3;
      const attemptsMade = job?.attemptsMade || 0;
      
      logger.warn('[MINUTES_WORKER] Job failed', {
        jobId: job?.id,
        meetingId: job?.data?.meetingId,
        queue: queueName,
        attemptsMade,
        maxAttempts,
        error: err.message,
        workerId: WORKER_ID,
      });

      // Move to DLQ after max attempts exhausted
      if (job && attemptsMade >= maxAttempts) {
        try {
          await moveToDeadLetter(
            SHARDED_QUEUE_TYPES.MINUTES_GENERATION,
            job,
            err.message
          );
        } catch (dlqErr) {
          logger.error('[MINUTES_WORKER] Failed to move job to DLQ', {
            jobId: job.id,
            error: dlqErr,
          });
        }
      }
    });

    worker.on('completed', (job, result: MinutesJobResult) => {
      if (result.skipped) {
        this.skippedCount++;
        logger.info('[MINUTES_WORKER] Job skipped (idempotency)', {
          jobId: job.id,
          meetingId: job.data.meetingId,
          queue: queueName,
          reason: result.reason,
        });
      } else {
        this.processedCount++;
        logger.info('[MINUTES_WORKER] Minutes generated', {
          jobId: job.id,
          meetingId: job.data.meetingId,
          queue: queueName,
          wordCount: result.minutes?.wordCount,
          chunksProcessed: result.minutes?.chunksProcessed,
        });
      }
    });

    worker.on('stalled', (jobId) => {
      logger.warn('[MINUTES_WORKER] Job stalled', {
        jobId,
        queue: queueName,
        workerId: WORKER_ID,
      });
    });
  }

  /**
   * Process a minutes generation job with idempotency check
   */
  private async processMinutesJob(
    job: Job<MinutesJobData>
  ): Promise<MinutesJobResult> {
    const { meetingId, organizationId } = job.data;
    const startTime = Date.now();

    logger.info('[MINUTES_WORKER] Processing job', {
      jobId: job.id,
      meetingId,
      organizationId,
      attempt: job.attemptsMade + 1,
    });

    try {
      // ── Step 0: Redis Idempotency Check (fast path) ───────
      const idempotencyKey = getMinutesIdempotencyKey(meetingId);
      const isDuplicate = await checkAndMarkProcessed(idempotencyKey, 'MINUTES_WORKER');
      if (isDuplicate) {
        logger.debug('[MINUTES_WORKER] Duplicate event skipped (Redis)', {
          jobId: job.id,
          meetingId,
        });
        return {
          success: true,
          skipped: true,
          reason: 'Duplicate event (Redis)',
        };
      }

      // ── Step 1: Database Idempotency Check ────────────────
      const existingMinutes = await this.checkExistingMinutes(meetingId);
      
      if (existingMinutes) {
        logger.info('[MINUTES_WORKER] Minutes already exist, skipping', {
          meetingId,
          existingId: existingMinutes.id,
          generatedAt: existingMinutes.generated_at,
        });
        
        return {
          success: true,
          skipped: true,
          reason: 'Minutes already generated',
        };
      }

      // ── Step 2: Get Transcripts ───────────────────────────
      const transcripts = await getMeetingTranscripts(meetingId);

      if (transcripts.length === 0) {
        logger.warn('[MINUTES_WORKER] No transcripts found', { meetingId });
        throw new Error('No transcripts available for minutes generation');
      }

      logger.info('[MINUTES_WORKER] Transcripts retrieved', {
        meetingId,
        count: transcripts.length,
      });

      // ── Step 2.5: Check AI Rate Limit ─────────────────────
      // Estimate tokens: ~4 chars per token, transcripts + output
      const totalChars = transcripts.reduce((sum, t) => sum + (t.text?.length || 0), 0);
      const estimatedTokens = Math.ceil(totalChars / 4) + 2000; // Add 2000 for output
      
      const rateLimitGuard = await guardOpenAIRequest(estimatedTokens);
      if (!rateLimitGuard.proceed) {
        // If rate limited, delay the job for reprocessing
        logger.warn('[MINUTES_WORKER] OpenAI rate limited, delaying job', {
          meetingId,
          delayMs: rateLimitGuard.delayMs,
          reason: rateLimitGuard.skipReason,
        });
        
        // Throw a special error that will trigger job retry with delay
        const error = new Error(`Rate limited: ${rateLimitGuard.skipReason}`);
        (error as any).delayMs = rateLimitGuard.delayMs;
        (error as any).rateLimited = true;
        throw error;
      }

      // ── Step 3: Generate Minutes with AI Service ──────────
      const result = await generateMeetingMinutes({
        meetingId,
        transcripts: transcripts as TranscriptEntry[],
      });

      // ── Step 4: Build Minutes Object ──────────────────────
      const minutes: MeetingMinutes = {
        meetingId,
        organizationId,
        generatedAt: result.generatedAt,
        summary: result.minutes.summary,
        keyTopics: result.minutes.keyTopics,
        decisions: result.minutes.decisions,
        actionItems: result.minutes.actionItems,
        participants: result.minutes.participants,
        wordCount: result.wordCount,
        chunksProcessed: result.chunksProcessed,
      };

      // ── Step 5: Store in Database ─────────────────────────
      await this.storeMinutes(minutes);

      // ── Step 6: Broadcast Completion ──────────────────────
      await this.broadcastCompletion(minutes);

      const duration = Date.now() - startTime;

      // ── Step 7: Record pipeline metrics (non-blocking) ────
      storeMinutesGenerationMs(meetingId, duration).catch(() => {});
      
      logger.info('[MINUTES_WORKER] Job completed', {
        meetingId,
        duration,
        wordCount: minutes.wordCount,
        chunksProcessed: minutes.chunksProcessed,
        topicsCount: minutes.keyTopics.length,
        decisionsCount: minutes.decisions.length,
        actionItemsCount: minutes.actionItems.length,
      });

      return { success: true, minutes };
    } catch (err: any) {
      logger.error('[MINUTES_WORKER] Processing failed', {
        meetingId,
        error: err.message,
        stack: err.stack,
      });
      throw err;
    }
  }

  /**
   * Check if minutes already exist for this meeting (idempotency)
   */
  private async checkExistingMinutes(
    meetingId: string
  ): Promise<{ id: string; generated_at: string } | null> {
    try {
      const existing = await db('meeting_minutes')
        .where('meeting_id', meetingId)
        .select('id', 'generated_at')
        .first();
      
      return existing || null;
    } catch (err: any) {
      // Table might not exist yet
      if (err.message?.includes('does not exist') || err.message?.includes('no such table')) {
        logger.warn('[MINUTES_WORKER] meeting_minutes table not found');
        return null;
      }
      throw err;
    }
  }

  /**
   * Store minutes in database with conflict handling
   */
  private async storeMinutes(minutes: MeetingMinutes): Promise<void> {
    try {
      // Use upsert pattern for additional safety
      // Note: Using actual DB schema columns:
      // summary, decisions, action_items, transcript, motions, contributions,
      // ai_credits_used, status, generated_at
      await db('meeting_minutes')
        .insert({
          meeting_id: minutes.meetingId,
          organization_id: minutes.organizationId,
          summary: minutes.summary,
          decisions: JSON.stringify(minutes.decisions),
          action_items: JSON.stringify(minutes.actionItems),
          transcript: JSON.stringify([]), // Raw transcripts stored separately in Redis
          motions: JSON.stringify([]), // No motions in Stage 5
          contributions: JSON.stringify(
            minutes.participants.map(p => ({ speaker: p }))
          ),
          ai_credits_used: 1,
          status: 'completed',
          generated_at: minutes.generatedAt,
        })
        .onConflict('meeting_id')
        .ignore(); // Ignore if already exists (idempotency)

      logger.info('[MINUTES_WORKER] Minutes stored', {
        meetingId: minutes.meetingId,
      });
    } catch (err: any) {
      // Handle unique constraint violation (race condition)
      if (err.code === '23505' || err.message?.includes('UNIQUE constraint')) {
        logger.info('[MINUTES_WORKER] Minutes already exist (concurrent write)', {
          meetingId: minutes.meetingId,
        });
        return; // Not an error, just idempotency at work
      }
      
      // If table doesn't exist, log but don't fail
      if (err.message?.includes('does not exist') || err.message?.includes('no such table')) {
        logger.warn('[MINUTES_WORKER] meeting_minutes table not found', {
          meetingId: minutes.meetingId,
        });
        return;
      }
      throw err;
    }
  }

  /**
   * Broadcast minutes completion event
   */
  private async broadcastCompletion(minutes: MeetingMinutes): Promise<void> {
    try {
      await submitBroadcast({
        meetingId: minutes.meetingId,
        eventType: 'minutes',
        data: {
          status: 'completed',
          summary: minutes.summary,
          topicsCount: minutes.keyTopics.length,
          decisionsCount: minutes.decisions.length,
          actionItemsCount: minutes.actionItems.length,
          wordCount: minutes.wordCount,
          generatedAt: minutes.generatedAt,
        },
      });
    } catch (err: any) {
      // Non-fatal error - minutes are still stored
      logger.warn('[MINUTES_WORKER] Failed to broadcast completion', {
        meetingId: minutes.meetingId,
        error: err.message,
      });
    }
  }

  /**
   * Get worker stats
   */
  getStats() {
    return {
      running: this.isRunning,
      processed: this.processedCount,
      skipped: this.skippedCount,
      failed: this.failedCount,
      workerId: WORKER_ID,
      workerCount: this.workers.length,
    };
  }

  /**
   * Gracefully stop all shard workers
   */
  async stop(): Promise<void> {
    logger.info('[MINUTES_WORKER] Stopping all shard workers...', {
      workerId: WORKER_ID,
      workerCount: this.workers.length,
    });

    // Close all shard workers in parallel
    await Promise.all(
      this.workers.map(worker => worker.close())
    );
    this.workers = [];
    this.isRunning = false;
    
    logger.info('[MINUTES_WORKER] All workers stopped', {
      workerId: WORKER_ID,
      processedTotal: this.processedCount,
      skippedTotal: this.skippedCount,
      failedTotal: this.failedCount,
    });
  }
}

// ── Singleton Instance ──────────────────────────────────────

let minutesWorker: MinutesWorker | null = null;

export async function startMinutesWorker(): Promise<void> {
  if (!minutesWorker) {
    minutesWorker = new MinutesWorker();
  }
  await minutesWorker.initialize();
}

export async function stopMinutesWorker(): Promise<void> {
  if (minutesWorker) {
    await minutesWorker.stop();
    minutesWorker = null;
  }
}

export function getMinutesWorker(): MinutesWorker | null {
  return minutesWorker;
}
