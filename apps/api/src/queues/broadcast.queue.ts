// ============================================================
// OrgsLedger API — Broadcast Queue
// Decouple translation results from Socket.IO broadcasting
// ============================================================

import { Queue, QueueOptions } from 'bullmq';
import { getRedisClient } from '../infrastructure/redisClient';
import { logger } from '../logger';

export interface BroadcastJobData {
  meetingId: string;
  speakerId: string;
  speakerName: string;
  originalText: string;
  sourceLanguage: string;
  translations: Record<string, string>;
  timestamp: string;
  isFinal: boolean;
}

class BroadcastQueueManager {
  private queue: Queue<BroadcastJobData> | null = null;
  private initialized = false;

  /**
   * Initialize broadcast queue
   */
  async initialize(): Promise<Queue<BroadcastJobData>> {
    if (this.queue) {
      return this.queue;
    }

    try {
      const redis = await getRedisClient();

      const queueOptions: QueueOptions = {
        connection: redis,
        defaultJobOptions: {
          removeOnComplete: true, // Remove immediately after successful broadcast
          attempts: 5, // More retries for broadcast (important for real-time)
          backoff: {
            type: 'exponential',
            delay: 1000, // Start with 1s backoff
          },
        },
      };

      this.queue = new Queue<BroadcastJobData>('broadcast-events', queueOptions);

      // Setup event handlers
      this.queue.on('error', (err: Error) => {
        logger.error('Broadcast queue error', err);
      });

      // Verify queue is ready
      await this.queue.waitUntilReady();
      this.initialized = true;

      logger.info('Broadcast queue initialized', {
        name: this.queue.name,
      });

      return this.queue;
    } catch (err) {
      logger.error('Failed to initialize broadcast queue', err);
      throw err;
    }
  }

  /**
   * Add broadcast job to queue
   */
  async add(data: BroadcastJobData): Promise<void> {
    try {
      if (!this.queue) {
        await this.initialize();
      }

      if (!this.queue) {
        throw new Error('Broadcast queue failed to initialize');
      }

      const jobId = `${data.meetingId}:${data.speakerId}:${Date.now()}`;
      const priority = data.isFinal ? 10 : 5; // Final transcripts get higher priority

      await this.queue.add(jobId, data, {
        jobId,
        priority, // Priority queue: final transcripts broadcast first
      });

      logger.debug('Broadcast job enqueued', {
        jobId,
        meetingId: data.meetingId,
        speakerId: data.speakerId,
        isFinal: data.isFinal,
        priority,
      });
    } catch (err) {
      logger.error('Failed to enqueue broadcast job', err);
      throw err;
    }
  }

  /**
   * Bulk add broadcast jobs
   */
  async addBulk(dataArray: BroadcastJobData[]): Promise<void> {
    try {
      if (!this.queue) {
        await this.initialize();
      }

      if (!this.queue) {
        throw new Error('Broadcast queue failed to initialize');
      }

      const jobs = dataArray.map((data, idx) => ({
        name: `${data.meetingId}:${data.speakerId}:${Date.now()}:${idx}`,
        data,
        opts: {
          priority: data.isFinal ? 10 : 5,
        },
      }));

      await this.queue.addBulk(jobs);

      logger.debug('Broadcast jobs bulk-enqueued', {
        count: dataArray.length,
      });
    } catch (err) {
      logger.error('Failed to bulk enqueue broadcast jobs', err);
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
      logger.error('Failed to get broadcast queue status', err);
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
   * Clear all jobs
   */
  async clear(): Promise<void> {
    try {
      if (!this.queue) {
        return;
      }

      await this.queue.clean(0, 100000, 'completed');
      logger.info('Broadcast queue cleared');
    } catch (err) {
      logger.error('Failed to clear broadcast queue', err);
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
        logger.info('Broadcast queue closed');
      }
    } catch (err) {
      logger.error('Error closing broadcast queue', err);
    }
  }

  /**
   * Get queue instance
   */
  getQueue(): Queue<BroadcastJobData> | null {
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
export const broadcastQueueManager = new BroadcastQueueManager();

/**
 * Helper to ensure queue is initialized
 */
export async function ensureBroadcastQueue(): Promise<Queue<BroadcastJobData>> {
  const queue = broadcastQueueManager.getQueue();
  if (queue) {
    return queue;
  }
  return broadcastQueueManager.initialize();
}

/**
 * Convenience function to add a broadcast job
 */
export async function broadcastToQueue(data: BroadcastJobData): Promise<void> {
  await broadcastQueueManager.add(data);
}
