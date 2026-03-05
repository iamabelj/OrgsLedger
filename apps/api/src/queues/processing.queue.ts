// ============================================================
// OrgsLedger API — Processing Queue
// Job queue for translation processing tasks
// Handles interim and final translation workflow
// ============================================================

import { Queue, QueueOptions } from 'bullmq';
import { getRedisClient } from '../infrastructure/redisClient';
import { logger } from '../logger';

export interface ProcessingJobData {
  meetingId: string;
  speakerId: string;
  originalText: string;
  sourceLanguage: string;
  targetLanguages: string[];
  isFinal: boolean;
  organizationId?: string; // Optional: needed for wallet deduction
  chunkIndex?: number;
}

class ProcessingQueueManager {
  private queue: Queue<ProcessingJobData> | null = null;
  private initialized = false;

  /**
   * Initialize processing queue
   */
  async initialize(): Promise<Queue<ProcessingJobData>> {
    if (this.queue) {
      return this.queue;
    }

    try {
      const redis = await getRedisClient();

      const queueOptions: QueueOptions = {
        connection: redis,
        defaultJobOptions: {
          removeOnComplete: {
            age: 3600, // Keep completed jobs for 1 hour
          },
          attempts: parseInt(process.env.PROCESSING_JOB_RETRIES || '3', 10),
          backoff: {
            type: 'exponential',
            delay: 2000, // 2s backoff for processing (slower than broadcast)
          },
        },
      };

      this.queue = new Queue<ProcessingJobData>('translation-processing', queueOptions);

      // Setup event handlers
      this.queue.on('error', (err: Error) => {
        logger.error('Processing queue error', err);
      });

      // Verify queue is ready
      await this.queue.waitUntilReady();
      this.initialized = true;

      logger.info('Processing queue initialized', {
        name: this.queue.name,
      });

      return this.queue;
    } catch (err) {
      logger.error('Failed to initialize processing queue', err);
      throw err;
    }
  }

  /**
   * Add processing job to queue
   */
  async add(data: ProcessingJobData): Promise<string> {
    try {
      if (!this.queue) {
        await this.initialize();
      }

      if (!this.queue) {
        throw new Error('Processing queue failed to initialize');
      }

      const jobId = `${data.meetingId}:${data.speakerId}:${Date.now()}`;
      const priority = data.isFinal ? 10 : 5; // Final translations get higher priority

      const job = await this.queue.add(jobId, data, {
        jobId,
        priority,
      });

      logger.debug('Processing job enqueued', {
        jobId: job.id,
        meetingId: data.meetingId,
        speakerId: data.speakerId,
        isFinal: data.isFinal,
        priority,
        textLength: data.originalText.length,
      });

      return job.id || jobId;
    } catch (err) {
      logger.error('Failed to enqueue processing job', err);
      throw err;
    }
  }

  /**
   * Bulk add processing jobs
   */
  async addBulk(dataArray: ProcessingJobData[]): Promise<string[]> {
    try {
      if (!this.queue) {
        await this.initialize();
      }

      if (!this.queue) {
        throw new Error('Processing queue failed to initialize');
      }

      const jobs = dataArray.map((data, idx: number) => ({
        name: `${data.meetingId}:${data.speakerId}:${Date.now()}:${idx}`,
        data,
        opts: {
          priority: data.isFinal ? 10 : 5,
        },
      }));

      const jobResults = await this.queue.addBulk(jobs);

      logger.debug('Processing jobs bulk-enqueued', {
        count: dataArray.length,
        jobIds: jobResults.map((j: any) => j.id).slice(0, 5), // Log first 5
      });

      return jobResults.map((j: any) => j.id || 'unknown');
    } catch (err) {
      logger.error('Failed to bulk enqueue processing jobs', err);
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
      logger.error('Failed to get processing queue status', err);
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
      logger.info('Processing queue cleared');
    } catch (err) {
      logger.error('Failed to clear processing queue', err);
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
        logger.info('Processing queue closed');
      }
    } catch (err) {
      logger.error('Error closing processing queue', err);
    }
  }

  /**
   * Get queue instance
   */
  getQueue(): Queue<ProcessingJobData> | null {
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
export const processingQueueManager = new ProcessingQueueManager();

/**
 * Helper to ensure queue is initialized
 */
export async function ensureProcessingQueue(): Promise<Queue<ProcessingJobData>> {
  const queue = processingQueueManager.getQueue();
  if (queue) {
    return queue;
  }
  return processingQueueManager.initialize();
}

/**
 * Convenience function to add a processing job
 */
export async function submitProcessingJob(data: ProcessingJobData): Promise<string> {
  return processingQueueManager.add(data);
}
