// ============================================================
// OrgsLedger API — Transcript Worker (Scaled)
// Processes transcript events from SHARDED queues
// Supports 50k+ meetings via horizontal scaling
// ============================================================
//
// Scaling features:
//   - Subscribes to ALL 32 transcript shards
//   - CPU-based dynamic concurrency (CPU_CORES * 4)
//   - Sliding window transcript storage (max 300 entries)
//   - Worker identity for distributed tracing
//   - DLQ support for failed jobs
//
// ============================================================

import { Worker, Job, Queue } from 'bullmq';
import { createBullMQConnection } from '../infrastructure/redisClient';
import { logger } from '../logger';
import {
  queueManager,
  initializeQueueManager,
  SHARDED_QUEUE_TYPES,
  TranscriptEventData,
  submitTranslation,
  submitBroadcast,
  moveToDeadLetter,
} from '../queues/queue-manager';
import { config } from '../config';
import db from '../db';
import { incrementTranscriptsGenerated } from '../monitoring/meeting-metrics';
import { 
  WORKER_ID, 
  WORKER_CONCURRENCY, 
  logWorkerIdentity 
} from '../scaling/worker-identity';
import {
  getTranscriptIdempotencyKey,
  checkAndMarkProcessed,
} from './idempotency';

// ── Configuration ───────────────────────────────────────────

const TRANSCRIPT_CONFIG = {
  /** Maximum transcript entries per meeting (sliding window) */
  maxTranscripts: parseInt(process.env.TRANSCRIPT_MAX_ENTRIES || '300', 10),
  
  /** TTL for transcript data in Redis (24 hours) */
  transcriptTtlSeconds: 86400,
  
  /** Worker lock duration (for long processing) */
  lockDuration: 60000,
  
  /** Stalled job detection interval */
  stalledInterval: 30000,
  
  /** Maximum times a job can stall before moving to DLQ */
  maxStalledCount: 3,
};

// ── Redis Key for Transcript Storage ────────────────────────

const TRANSCRIPT_KEY_PREFIX = 'meeting:transcript:';

function transcriptKey(meetingId: string): string {
  return `${TRANSCRIPT_KEY_PREFIX}${meetingId}`;
}

// ── Worker Class ────────────────────────────────────────────

class TranscriptWorker {
  private workers: Worker<TranscriptEventData>[] = [];
  private isRunning = false;
  private processedCount = 0;
  private failedCount = 0;
  private redis: any = null;

  async initialize(): Promise<void> {
    try {
      // Initialize queue manager first
      await initializeQueueManager();
      
      const connection = createBullMQConnection();
      this.redis = connection;
      
      // Calculate CPU-based concurrency
      const concurrency = WORKER_CONCURRENCY.transcript();
      
      // Get all sharded queues for transcript processing
      const queues = queueManager.getAllTranscriptQueues();
      
      logWorkerIdentity('TRANSCRIPT_WORKER');
      logger.info('[TRANSCRIPT_WORKER] Starting workers for all shards', {
        workerId: WORKER_ID,
        shardCount: queues.length,
        concurrencyPerShard: concurrency,
        totalConcurrency: concurrency * queues.length,
      });

      // Create a worker for EACH shard queue
      for (const queue of queues) {
        const worker = new Worker<TranscriptEventData>(
          queue.name,
          async (job: Job<TranscriptEventData>) => {
            return this.processTranscriptEvent(job);
          },
          {
            connection: connection as any,
            concurrency,
            maxStalledCount: TRANSCRIPT_CONFIG.maxStalledCount,
            stalledInterval: TRANSCRIPT_CONFIG.stalledInterval,
            lockDuration: TRANSCRIPT_CONFIG.lockDuration,
          }
        );

        worker.on('ready', () => {
          logger.debug('[TRANSCRIPT_WORKER] Shard ready', { 
            queue: queue.name,
            workerId: WORKER_ID,
          });
        });

        worker.on('error', (err: Error) => {
          logger.error('[TRANSCRIPT_WORKER] Worker error', {
            queue: queue.name,
            error: err.message,
            workerId: WORKER_ID,
          });
        });

        worker.on('failed', async (job, err: Error) => {
          this.failedCount++;
          const maxAttempts = job?.opts?.attempts || 3;
          const attemptsMade = job?.attemptsMade || 0;
          
          logger.warn('[TRANSCRIPT_WORKER] Job failed', {
            jobId: job?.id,
            meetingId: job?.data?.meetingId,
            queue: queue.name,
            attemptsMade,
            maxAttempts,
            error: err.message,
            workerId: WORKER_ID,
          });

          // Move to DLQ after max attempts exhausted
          if (job && attemptsMade >= maxAttempts) {
            try {
              await moveToDeadLetter(
                SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS,
                job,
                err.message
              );
            } catch (dlqErr) {
              logger.error('[TRANSCRIPT_WORKER] Failed to move job to DLQ', {
                jobId: job.id,
                error: dlqErr,
              });
            }
          }
        });

        worker.on('completed', (job) => {
          this.processedCount++;
          logger.debug('[TRANSCRIPT_WORKER] Job completed', {
            jobId: job.id,
            meetingId: job.data.meetingId,
            queue: queue.name,
          });
        });

        this.workers.push(worker);
      }

      this.isRunning = true;
      logger.info('[TRANSCRIPT_WORKER] All shard workers initialized', {
        workerId: WORKER_ID,
        workerCount: this.workers.length,
        concurrency,
      });
    } catch (err) {
      logger.error('[TRANSCRIPT_WORKER] Failed to initialize', err);
      throw err;
    }
  }

  /**
   * Process a transcript event
   */
  private async processTranscriptEvent(
    job: Job<TranscriptEventData>
  ): Promise<{ success: boolean; skipped?: boolean }> {
    const { meetingId, speaker, speakerId, text, timestamp, isFinal, confidence, language } = job.data;

    try {
      // 0. Idempotency check — skip duplicates
      const idempotencyKey = getTranscriptIdempotencyKey(
        meetingId,
        speakerId,
        timestamp,
        text
      );
      
      const isDuplicate = await checkAndMarkProcessed(idempotencyKey, 'TRANSCRIPT_WORKER');
      if (isDuplicate) {
        logger.debug('[TRANSCRIPT_WORKER] Duplicate event skipped', {
          jobId: job.id,
          meetingId,
          timestamp,
        });
        return { success: true, skipped: true };
      }

      // 1. Store transcript in Redis with sliding window (max 300 entries)
      await this.storeTranscript(job.data);

      // 2. Broadcast to connected clients via sharded queue
      await submitBroadcast({
        meetingId,
        eventType: 'transcript',
        data: {
          speaker,
          speakerId,
          text,
          timestamp,
          isFinal,
          confidence,
          language,
        },
      });

      // 3. Queue translation job if configured (via sharded queue)
      const targetLanguages = config.translation?.targetLanguages || [];
      if (targetLanguages.length > 0 && isFinal) {
        await submitTranslation({
          meetingId,
          speaker: speaker || '',
          speakerId,
          text,
          timestamp: timestamp,
          sourceLanguage: language || 'en',
          targetLanguages,
        });
      }

      // 4. Increment meeting pipeline metrics (non-blocking)
      incrementTranscriptsGenerated(meetingId).catch(() => {});

      return { success: true };
    } catch (err: any) {
      logger.error('[TRANSCRIPT_WORKER] Processing failed', {
        meetingId,
        error: err.message,
        workerId: WORKER_ID,
      });
      throw err;
    }
  }

  /**
   * Store transcript in Redis with sliding window.
   * Uses LPUSH + LTRIM to maintain only the last N entries.
   * This prevents Redis memory explosion at scale.
   */
  private async storeTranscript(data: TranscriptEventData): Promise<void> {
    if (!this.redis) return;

    const key = transcriptKey(data.meetingId);
    const entry = JSON.stringify({
      speaker: data.speaker,
      speakerId: data.speakerId,
      text: data.text,
      timestamp: data.timestamp,
      confidence: data.confidence,
      language: data.language,
    });

    try {
      // Use pipeline for atomic sliding window operation
      const pipeline = this.redis.pipeline();
      
      // LPUSH: Add new entry at the head (newest first)
      pipeline.lpush(key, entry);
      
      // LTRIM: Keep only the last N entries (sliding window)
      pipeline.ltrim(key, 0, TRANSCRIPT_CONFIG.maxTranscripts - 1);
      
      // EXPIRE: Set TTL to prevent orphaned keys
      pipeline.expire(key, TRANSCRIPT_CONFIG.transcriptTtlSeconds);
      
      await pipeline.exec();
    } catch (err: any) {
      logger.warn('[TRANSCRIPT_WORKER] Failed to store transcript', {
        meetingId: data.meetingId,
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
      failed: this.failedCount,
      workerId: WORKER_ID,
      workerCount: this.workers.length,
    };
  }

  /**
   * Gracefully stop all shard workers
   */
  async stop(): Promise<void> {
    logger.info('[TRANSCRIPT_WORKER] Stopping all workers...', {
      workerId: WORKER_ID,
      workerCount: this.workers.length,
    });
    
    // Close all workers in parallel
    await Promise.all(this.workers.map(worker => worker.close()));
    this.workers = [];
    this.isRunning = false;
    
    logger.info('[TRANSCRIPT_WORKER] Stopped', { workerId: WORKER_ID });
  }
}

// ── Singleton Instance ──────────────────────────────────────

let transcriptWorker: TranscriptWorker | null = null;

export async function startTranscriptWorker(): Promise<void> {
  if (!transcriptWorker) {
    transcriptWorker = new TranscriptWorker();
  }
  await transcriptWorker.initialize();
}

export async function stopTranscriptWorker(): Promise<void> {
  if (transcriptWorker) {
    await transcriptWorker.stop();
    transcriptWorker = null;
  }
}

export function getTranscriptWorker(): TranscriptWorker | null {
  return transcriptWorker;
}

// ── Utility Functions ───────────────────────────────────────

/**
 * Get all transcripts for a meeting from Redis.
 * Returns in chronological order (oldest first).
 * 
 * Note: Transcripts are stored with LPUSH (newest first),
 * so we reverse the order for chronological retrieval.
 */
export async function getMeetingTranscripts(
  meetingId: string
): Promise<Array<{
  speaker: string;
  speakerId?: string;
  text: string;
  timestamp: string;
  confidence?: number;
  language?: string;
}>> {
  const redis = createBullMQConnection();
  const key = transcriptKey(meetingId);

  try {
    const entries = await redis.lrange(key, 0, -1);
    // Reverse to get chronological order (oldest first)
    return entries
      .map((entry: string) => JSON.parse(entry))
      .reverse();
  } catch (err: any) {
    logger.error('[TRANSCRIPT_WORKER] Failed to get transcripts', {
      meetingId,
      error: err.message,
    });
    return [];
  }
}
