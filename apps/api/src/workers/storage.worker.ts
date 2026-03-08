// ============================================================
// OrgsLedger API — Storage Worker
// Persists transcript segments to PostgreSQL database
// Part of AI processing path - does not block real-time captions
// Handles batching for efficient database writes
// ============================================================

import { Worker, Job } from 'bullmq';
import { createBullMQConnection } from '../infrastructure/redisClient';
import { logger } from '../logger';
import { TranscriptEventData } from '../queues/transcriptEvents.queue';
import { db } from '../db';

// ── Configuration ─────────────────────────────────────────────

const BATCH_SIZE = parseInt(process.env.STORAGE_BATCH_SIZE || '50', 10);
const BATCH_TIMEOUT_MS = parseInt(process.env.STORAGE_BATCH_TIMEOUT_MS || '1000', 10);
const WORKER_CONCURRENCY = parseInt(process.env.STORAGE_WORKER_CONCURRENCY || '5', 10);

// ── Storage Buffer for Batching ───────────────────────────────

interface StorageBuffer {
  items: TranscriptEventData[];
  timer: NodeJS.Timeout | null;
  lastFlush: number;
}

const meetingBuffers = new Map<string, StorageBuffer>();

// ── Worker Class ──────────────────────────────────────────────

class StorageWorkerManager {
  private worker: Worker<TranscriptEventData> | null = null;
  private isRunning = false;
  private processedCount = 0;
  private failedCount = 0;
  private batchedCount = 0;

  /**
   * Initialize storage worker
   */
  async initialize(): Promise<void> {
    try {
      const redis = createBullMQConnection();

      this.worker = new Worker<TranscriptEventData>(
        'transcript-events',
        async (job: Job<TranscriptEventData>) => {
          return this.processTranscript(job);
        },
        {
          connection: redis as any,
          concurrency: WORKER_CONCURRENCY,
          // Storage worker processes specific job type
          name: 'storage-worker',
          maxStalledCount: 3,
          stalledInterval: 30000,
        }
      );

      this.worker.on('ready', () => {
        logger.info('[STORAGE_WORKER] Ready');
        this.isRunning = true;
      });

      this.worker.on('error', (err: Error) => {
        logger.error('[STORAGE_WORKER] Error', err);
      });

      this.worker.on('failed', (job, err) => {
        this.failedCount++;
        logger.warn('[STORAGE_WORKER] Job failed', {
          jobId: job?.id,
          meetingId: job?.data.meetingId,
          error: err.message,
        });
      });

      this.worker.on('completed', (job) => {
        this.processedCount++;
        logger.debug('[STORAGE_WORKER] Job completed', {
          jobId: job.id,
          meetingId: job.data.meetingId,
        });
      });

      // Periodic flush of all buffers
      setInterval(() => this.flushAllBuffers(), BATCH_TIMEOUT_MS);

      logger.info('[STORAGE_WORKER] Initialized', {
        concurrency: WORKER_CONCURRENCY,
        batchSize: BATCH_SIZE,
        batchTimeoutMs: BATCH_TIMEOUT_MS,
      });
    } catch (err) {
      logger.error('[STORAGE_WORKER] Failed to initialize', err);
      throw err;
    }
  }

  /**
   * Process a single transcript - buffers for batch insert
   */
  private async processTranscript(job: Job<TranscriptEventData>): Promise<void> {
    const data = job.data;

    // Only store final transcripts
    if (!data.isFinal) {
      logger.debug('[STORAGE_WORKER] Skipping interim transcript');
      return;
    }

    // Add to buffer
    let buffer = meetingBuffers.get(data.meetingId);
    if (!buffer) {
      buffer = {
        items: [],
        timer: null,
        lastFlush: Date.now(),
      };
      meetingBuffers.set(data.meetingId, buffer);
    }

    buffer.items.push(data);

    // Flush if buffer is full
    if (buffer.items.length >= BATCH_SIZE) {
      await this.flushBuffer(data.meetingId);
    } else if (!buffer.timer) {
      // Set timer for timeout-based flush
      buffer.timer = setTimeout(() => {
        this.flushBuffer(data.meetingId).catch((err) => {
          logger.error('[STORAGE_WORKER] Flush failed', err);
        });
      }, BATCH_TIMEOUT_MS);
    }
  }

  /**
   * Flush buffer for a specific meeting
   */
  private async flushBuffer(meetingId: string): Promise<void> {
    const buffer = meetingBuffers.get(meetingId);
    if (!buffer || buffer.items.length === 0) {
      return;
    }

    // Clear timer
    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }

    // Extract items
    const items = [...buffer.items];
    buffer.items = [];
    buffer.lastFlush = Date.now();

    try {
      // Batch insert to database using Knex
      const records = items.map((item) => ({
        meeting_id: item.meetingId,
        organization_id: item.organizationId,
        speaker_id: item.speakerId,
        speaker_name: item.speakerName,
        original_text: item.text,
        source_lang: item.language,
        translations: JSON.stringify({}), // Translations added by translation worker
        spoken_at: new Date(item.timestamp).getTime(),
        confidence: item.confidence,
        is_final: item.isFinal,
        segment_index: item.segmentIndex,
      }));

      // Use Knex batch insert with onConflict ignore
      await db('meeting_transcripts')
        .insert(records)
        .onConflict(['meeting_id', 'segment_index'])
        .ignore();

      this.batchedCount += items.length;

      logger.debug('[STORAGE_WORKER] Batch persisted', {
        meetingId,
        count: items.length,
        totalBatched: this.batchedCount,
      });
    } catch (err) {
      logger.error('[STORAGE_WORKER] Batch insert failed', {
        meetingId,
        count: items.length,
        error: err instanceof Error ? err.message : String(err),
      });

      // Re-add items to buffer for retry
      buffer.items.unshift(...items);
      throw err;
    }
  }

  /**
   * Flush all meeting buffers (periodic cleanup)
   */
  private async flushAllBuffers(): Promise<void> {
    const now = Date.now();
    const staleThreshold = BATCH_TIMEOUT_MS * 2;

    for (const [meetingId, buffer] of meetingBuffers.entries()) {
      if (buffer.items.length > 0 && now - buffer.lastFlush > staleThreshold) {
        await this.flushBuffer(meetingId).catch((err) => {
          logger.error('[STORAGE_WORKER] Periodic flush failed', {
            meetingId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      // Clean up empty buffers
      if (buffer.items.length === 0 && now - buffer.lastFlush > 60000) {
        meetingBuffers.delete(meetingId);
      }
    }
  }

  /**
   * Force flush for a specific meeting (e.g., on meeting end)
   */
  async forceMeetingFlush(meetingId: string): Promise<void> {
    await this.flushBuffer(meetingId);
    meetingBuffers.delete(meetingId);
    logger.info('[STORAGE_WORKER] Meeting buffer force-flushed', { meetingId });
  }

  /**
   * Get worker status
   */
  getStatus(): {
    running: boolean;
    processed: number;
    failed: number;
    batched: number;
    activeBuffers: number;
  } {
    return {
      running: this.isRunning,
      processed: this.processedCount,
      failed: this.failedCount,
      batched: this.batchedCount,
      activeBuffers: meetingBuffers.size,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    // Flush all buffers
    for (const meetingId of meetingBuffers.keys()) {
      await this.flushBuffer(meetingId).catch(() => {});
    }

    if (this.worker) {
      await this.worker.close();
    }

    logger.info('[STORAGE_WORKER] Shut down', {
      processed: this.processedCount,
      batched: this.batchedCount,
    });
  }
}

// ── Singleton Export ──────────────────────────────────────────

export const storageWorker = new StorageWorkerManager();

export async function startStorageWorker(): Promise<void> {
  return storageWorker.initialize();
}

export function getStorageWorker(): StorageWorkerManager {
  return storageWorker;
}
