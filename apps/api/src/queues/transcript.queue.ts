// ============================================================
// OrgsLedger API — Transcript Processing Queue
// Receives transcript segments from Deepgram for async processing
// ============================================================

import { Queue, QueueOptions } from 'bullmq';
import { getRedisClient } from '../infrastructure/redisClient';
import { logger } from '../logger';

export interface TranscriptJobData {
  meetingId: string;
  speakerId: string;
  speakerName: string;
  originalText: string;
  language: string;
  confidence: number;
  timestamp: Date;
  isFinal: boolean;
}

class TranscriptQueueManager {
  private queue: Queue<TranscriptJobData> | null = null;
  private initialized = false;

  /**
   * Initialize transcript queue
   */
  async initialize(): Promise<Queue<TranscriptJobData>> {
    if (this.queue) {
      return this.queue;
    }

    try {
      const redis = await getRedisClient();

      const queueOptions: QueueOptions = {
        connection: redis as any,
        defaultJobOptions: {
          removeOnComplete: {
            age: 3600, // Remove completed jobs after 1 hour
          },
          removeOnFail: {
            age: 86400, // Keep failed jobs for 24 hours for inspection
          },
          attempts: 3, // Retry up to 3 times
          backoff: {
            type: 'exponential',
            delay: 2000, // Start with 2s backoff
          },
        },
      };

      this.queue = new Queue<TranscriptJobData>('transcript-processing', queueOptions);

      // Setup event handlers
      this.queue.on('error', (err: Error) => {
        logger.error('Transcript queue error', err);
      });

      // Verify queue is ready
      await this.queue.waitUntilReady();
      this.initialized = true;

      logger.info('Transcript queue initialized', {
        name: this.queue.name,
      });

      return this.queue;
    } catch (err) {
      logger.error('Failed to initialize transcript queue', err);
      throw err;
    }
  }

  /**
   * Add transcript job to queue
   */
  async add(data: TranscriptJobData): Promise<void> {
    try {
      if (!this.queue) {
        await this.initialize();
      }

      if (!this.queue) {
        throw new Error('Transcript queue failed to initialize');
      }

      const jobId = `${data.meetingId}:${data.speakerId}:${Date.now()}`;
      await this.queue.add(jobId, data, {
        jobId, // Use predictable ID for deduplication
      });

      logger.debug('Transcript job enqueued', {
        jobId,
        meetingId: data.meetingId,
        speakerId: data.speakerId,
        textLength: data.originalText.length,
      });
    } catch (err) {
      logger.error('Failed to enqueue transcript job', err);
      throw err;
    }
  }

  /**
   * Get queue status
   */
  async getStatus(): Promise<{
    size: number;
    activeCount: number;
    waitingCount: number;
    failedCount: number;
    delayedCount: number;
  }> {
    try {
      if (!this.queue) {
        return {
          size: 0,
          activeCount: 0,
          waitingCount: 0,
          failedCount: 0,
          delayedCount: 0,
        };
      }

      const [size, activeCount, waitingCount, failedCount, delayedCount] = await Promise.all([
        this.queue.count(),
        this.queue.getActiveCount(),
        this.queue.getWaitingCount(),
        this.queue.getFailedCount(),
        this.queue.getDelayedCount(),
      ]);

      return {
        size,
        activeCount,
        waitingCount,
        failedCount,
        delayedCount,
      };
    } catch (err) {
      logger.error('Failed to get transcript queue status', err);
      return {
        size: 0,
        activeCount: 0,
        waitingCount: 0,
        failedCount: 0,
        delayedCount: 0,
      };
    }
  }

  /**
   * Clear all jobs (use with caution)
   */
  async clear(): Promise<void> {
    try {
      if (!this.queue) {
        return;
      }

      await this.queue.clean(0, 100000, 'completed');
      logger.info('Transcript queue cleared');
    } catch (err) {
      logger.error('Failed to clear transcript queue', err);
    }
  }

  /**
   * Close queue connection
   */
  async close(): Promise<void> {
    try {
      if (this.queue) {
        await this.queue.close();
        this.queue = null;
        this.initialized = false;
        logger.info('Transcript queue closed');
      }
    } catch (err) {
      logger.error('Error closing transcript queue', err);
    }
  }

  /**
   * Get queue instance
   */
  getQueue(): Queue<TranscriptJobData> | null {
    return this.queue;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Export singleton instance
export const transcriptQueueManager = new TranscriptQueueManager();

/**
 * Helper to ensure queue is initialized
 */
export async function ensureTranscriptQueue(): Promise<Queue<TranscriptJobData>> {
  const queue = transcriptQueueManager.getQueue();
  if (queue) {
    return queue;
  }
  return transcriptQueueManager.initialize();
}
