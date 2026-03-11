// ============================================================
// OrgsLedger API — Broadcast Worker (Stage 4 - Scaled)
// Production-grade real-time caption broadcast worker
// Subscribes to SHARDED broadcast-events queues
// Supports 50k+ concurrent meetings via horizontal scaling
//
// Scaling features:
//   - Subscribes to ALL 16 broadcast shards
//   - CPU-based dynamic concurrency (CPU_CORES * 6)
//   - Worker identity for distributed tracing
//
// Socket.IO Events Emitted:
//   - meeting:caption (translated captions)
//   - meeting:transcript (original transcripts)
//   - meeting:minutes (meeting minutes)
//
// Environment Variables:
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
  BroadcastEventData,
  moveToDeadLetter,
} from '../queues/queue-manager';
import { publishEvent, EVENT_CHANNELS } from '../modules/meeting/services/event-bus.service';
import { incrementBroadcastEvents } from '../monitoring/meeting-metrics';
import {
  WORKER_ID,
  WORKER_CONCURRENCY,
  logWorkerIdentity,
} from '../scaling/worker-identity';
import {
  getBroadcastIdempotencyKey,
  checkAndMarkProcessed,
  hashObject,
} from './idempotency';

// ── Types ───────────────────────────────────────────────────

/**
 * Caption payload structure sent to Socket.IO clients.
 */
export interface CaptionPayload {
  meetingId: string;
  speakerId: string;
  originalText: string;
  translatedText: string;
  language: string;
  sourceLanguage?: string;
  timestamp: number;
  speaker?: string;
}

/**
 * Broadcast result for tracking.
 */
interface BroadcastResult {
  success: boolean;
  eventType: string;
  meetingId: string;
  retryCount: number;
  durationMs: number;
}

// ── Retry Configuration ─────────────────────────────────────

const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 1000,
  backoffMultiplier: 2,
};

// ── Payload Validation ──────────────────────────────────────

/**
 * Validate broadcast event payload.
 */
function validatePayload(data: unknown): asserts data is BroadcastEventData {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid payload: expected an object');
  }
  
  const payload = data as Record<string, unknown>;
  
  if (typeof payload.meetingId !== 'string' || !payload.meetingId) {
    throw new Error('Invalid payload: meetingId must be a non-empty string');
  }
  if (typeof payload.eventType !== 'string' || !payload.eventType) {
    throw new Error('Invalid payload: eventType must be a non-empty string');
  }
  if (!payload.data || typeof payload.data !== 'object') {
    throw new Error('Invalid payload: data must be an object');
  }
}

// ── Worker Class ────────────────────────────────────────────

class BroadcastWorker {
  private workers: Worker<BroadcastEventData>[] = [];
  private isRunning = false;
  private processedCount = 0;
  private failedCount = 0;
  private broadcastCount = 0;
  private disconnectCount = 0;

  /**
   * Initialize all broadcast shard workers.
   */
  async initialize(): Promise<void> {
    try {
      // Initialize queue manager first
      await initializeQueueManager();
      
      const connection = createBullMQConnection();
      const concurrency = WORKER_CONCURRENCY.broadcast();

      // Get all sharded queues for broadcast processing
      const queues = queueManager.getAllBroadcastQueues();

      logWorkerIdentity('BROADCAST_WORKER');
      logger.info('[BROADCAST_WORKER] Starting workers for all shards', {
        workerId: WORKER_ID,
        shardCount: queues.length,
        concurrencyPerShard: concurrency,
        totalConcurrency: concurrency * queues.length,
      });

      // Create a worker for EACH shard queue
      for (const queue of queues) {
        const worker = new Worker<BroadcastEventData>(
          queue.name,
          async (job: Job<BroadcastEventData>) => {
            return this.processBroadcastEvent(job);
          },
          {
            connection: connection as any,
            concurrency,
            maxStalledCount: 1,
            stalledInterval: 5000,
            lockDuration: 10000, // Broadcasting should be fast
          }
        );

        this.setupWorkerEventHandlers(worker, queue.name);
        this.workers.push(worker);
      }

      this.isRunning = true;
      logger.info('[BROADCAST_WORKER] All shard workers initialized', {
        workerId: WORKER_ID,
        workerCount: this.workers.length,
        concurrency,
      });
    } catch (err) {
      logger.error('[BROADCAST_WORKER] Failed to initialize', { error: err });
      throw err;
    }
  }

  /**
   * Set up worker event handlers for a shard.
   */
  private setupWorkerEventHandlers(worker: Worker<BroadcastEventData>, queueName: string): void {
    worker.on('ready', () => {
      logger.debug('[BROADCAST_WORKER] Shard ready', {
        queue: queueName,
        workerId: WORKER_ID,
      });
    });

    worker.on('error', (err: Error) => {
      logger.error('[BROADCAST_WORKER] Worker error', {
        queue: queueName,
        error: err.message,
        workerId: WORKER_ID,
      });
    });

    worker.on('failed', async (job, err: Error) => {
      this.failedCount++;
      const maxAttempts = job?.opts?.attempts || 3;
      const attemptsMade = job?.attemptsMade || 0;
      
      logger.warn('[BROADCAST_WORKER] Job failed', {
        jobId: job?.id,
        meetingId: job?.data?.meetingId,
        eventType: job?.data?.eventType,
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
            SHARDED_QUEUE_TYPES.BROADCAST_EVENTS,
            job,
            err.message
          );
        } catch (dlqErr) {
          logger.error('[BROADCAST_WORKER] Failed to move job to DLQ', {
            jobId: job.id,
            error: dlqErr,
          });
        }
      }
    });

    worker.on('completed', (job, result) => {
      this.processedCount++;
      const res = result as BroadcastResult | undefined;
      logger.debug('[BROADCAST_WORKER] Job completed', {
        jobId: job.id,
        meetingId: job.data.meetingId,
        eventType: job.data.eventType,
        queue: queueName,
        durationMs: res?.durationMs,
      });
    });

    worker.on('stalled', (jobId) => {
      logger.warn('[BROADCAST_WORKER] Job stalled', {
        jobId,
        queue: queueName,
        workerId: WORKER_ID,
      });
    });
  }

  /**
   * Process a broadcast event with retry logic.
   */
  private async processBroadcastEvent(
    job: Job<BroadcastEventData>
  ): Promise<BroadcastResult> {
    const startTime = Date.now();
    let retryCount = 0;
    let lastError: Error | null = null;

    try {
      // Step 1: Validate payload
      validatePayload(job.data);

      const { meetingId, eventType, data } = job.data;

      // Step 1.5: Idempotency check — skip duplicate broadcasts
      const dataHash = hashObject(data);
      const idempotencyKey = getBroadcastIdempotencyKey(meetingId, eventType, dataHash);
      
      const isDuplicate = await checkAndMarkProcessed(idempotencyKey, 'BROADCAST_WORKER');
      if (isDuplicate) {
        logger.debug('[BROADCAST_WORKER] Duplicate broadcast skipped', {
          jobId: job.id,
          meetingId,
          eventType,
        });
        return {
          success: true,
          eventType,
          meetingId,
          retryCount: 0,
          durationMs: Date.now() - startTime,
        };
      }

      logger.debug('[BROADCAST_WORKER] Processing broadcast event', {
        jobId: job.id,
        meetingId,
        eventType,
        dataKeys: Object.keys(data),
      });

      // Step 2: Determine Socket.IO event name
      const eventName = this.mapEventType(eventType);

      // Step 3: Retry loop for broadcast
      while (retryCount < RETRY_CONFIG.maxRetries) {
        try {
          await this.broadcastToClients(meetingId, eventName, data);

          this.broadcastCount++;

          // Increment meeting pipeline metrics (non-blocking)
          incrementBroadcastEvents(meetingId).catch(() => {});
          
          logger.info('[BROADCAST_WORKER] Broadcast successful', {
            jobId: job.id,
            meetingId,
            eventType,
            eventName,
            retryCount,
            durationMs: Date.now() - startTime,
          });

          return {
            success: true,
            eventType,
            meetingId,
            retryCount,
            durationMs: Date.now() - startTime,
          };
        } catch (err: any) {
          lastError = err;
          retryCount++;

          // Check if it's a disconnect error
          if (this.isDisconnectError(err)) {
            this.disconnectCount++;
            logger.warn('[BROADCAST_WORKER] WebSocket disconnect detected', {
              jobId: job.id,
              meetingId,
              retryCount,
              error: err.message,
            });
          }

          // Calculate backoff delay
          const delay = Math.min(
            RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, retryCount - 1),
            RETRY_CONFIG.maxDelayMs
          );

          if (retryCount < RETRY_CONFIG.maxRetries) {
            logger.debug('[BROADCAST_WORKER] Retrying broadcast', {
              jobId: job.id,
              retryCount,
              delayMs: delay,
            });
            await this.sleep(delay);
          }
        }
      }

      // All retries exhausted
      throw lastError || new Error('Broadcast failed after max retries');
    } catch (err: any) {
      logger.error('[BROADCAST_WORKER] Broadcast failed permanently', {
        jobId: job.id,
        meetingId: job.data?.meetingId,
        eventType: job.data?.eventType,
        retryCount,
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Map internal event type to Socket.IO event name.
   * For Stage 4, translations are broadcast as 'meeting:caption'.
   */
  private mapEventType(eventType: string): string {
    const eventMap: Record<string, string> = {
      'transcript': 'meeting:transcript',
      'translation': 'meeting:caption',    // Stage 4: Caption event
      'minutes': 'meeting:minutes',
      'caption': 'meeting:caption',
    };

    return eventMap[eventType] || `meeting:${eventType}`;
  }

  /**
   * Broadcast event to Socket.IO clients via Redis PubSub.
   */
  private async broadcastToClients(
    meetingId: string,
    eventName: string,
    data: Record<string, any>
  ): Promise<void> {
    // Construct caption payload for 'meeting:caption' events
    const payload = {
      type: eventName,
      timestamp: new Date().toISOString(),
      data: {
        meetingId,
        ...data,
      },
    };

    // Detailed logging for caption events
    if (eventName === 'meeting:caption') {
      logger.debug('[BROADCAST_WORKER] Broadcasting caption', {
        meetingId,
        speakerId: data.speakerId,
        language: data.language || data.targetLanguage,
        textPreview: (data.translatedText || data.originalText || '').substring(0, 50),
      });
    }

    // Publish to Redis PubSub channel
    // The WebSocket gateway (socket.ts) subscribes and broadcasts to room
    await publishEvent(EVENT_CHANNELS.MEETING_EVENTS, payload);
  }

  /**
   * Check if error is a WebSocket disconnect error.
   */
  private isDisconnectError(err: Error): boolean {
    const disconnectPatterns = [
      'disconnected',
      'socket hang up',
      'connection reset',
      'ECONNRESET',
      'EPIPE',
      'client disconnected',
      'not connected',
    ];

    return disconnectPatterns.some(pattern =>
      err.message.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * Sleep utility for retry backoff.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get worker statistics.
   */
  getStats(): {
    running: boolean;
    processed: number;
    failed: number;
    broadcasts: number;
    disconnects: number;
    workerId: string;
    workerCount: number;
  } {
    return {
      running: this.isRunning,
      processed: this.processedCount,
      failed: this.failedCount,
      broadcasts: this.broadcastCount,
      disconnects: this.disconnectCount,
      workerId: WORKER_ID,
      workerCount: this.workers.length,
    };
  }

  /**
   * Gracefully stop all shard workers.
   */
  async stop(): Promise<void> {
    logger.info('[BROADCAST_WORKER] Stopping all shard workers...', {
      workerId: WORKER_ID,
      workerCount: this.workers.length,
      processedTotal: this.processedCount,
      failedTotal: this.failedCount,
      broadcastsTotal: this.broadcastCount,
    });

    // Close all shard workers in parallel
    await Promise.all(
      this.workers.map(worker => worker.close())
    );
    this.workers = [];
    this.isRunning = false;
    
    logger.info('[BROADCAST_WORKER] All workers stopped', {
      workerId: WORKER_ID,
    });
  }
}

// ── Singleton Instance ──────────────────────────────────────

let broadcastWorker: BroadcastWorker | null = null;

export async function startBroadcastWorker(): Promise<void> {
  if (!broadcastWorker) {
    broadcastWorker = new BroadcastWorker();
  }
  await broadcastWorker.initialize();
}

export async function stopBroadcastWorker(): Promise<void> {
  if (broadcastWorker) {
    await broadcastWorker.stop();
    broadcastWorker = null;
  }
}

export function getBroadcastWorker(): BroadcastWorker | null {
  return broadcastWorker;
}

// ── Test Helper (for development) ───────────────────────────

/**
 * Submit a test caption broadcast for development/debugging.
 */
export async function submitTestCaption(
  meetingId: string,
  speakerId: string,
  text: string,
  language: string = 'es'
): Promise<Job<BroadcastEventData>> {
  // Use queue-manager for sharded queue submission
  const { submitBroadcast, initializeQueueManager } = await import('../queues/queue-manager');
  await initializeQueueManager();
  
  return submitBroadcast({
    meetingId,
    eventType: 'translation',
    data: {
      meetingId,
      speakerId,
      originalText: text,
      translatedText: `[${language.toUpperCase()}] ${text}`,
      language,
      timestamp: Date.now(),
    },
  });
}
