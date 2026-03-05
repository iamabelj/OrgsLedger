// ============================================================
// OrgsLedger API — Minutes Queue
// Job queue for AI minutes generation tasks
// Handles async processing of meeting transcripts into minutes
// ============================================================

import { Queue, QueueOptions } from 'bullmq';
import { getRedisClient } from '../infrastructure/redisClient';
import { logger } from '../logger';

export interface MinutesJobData {
  meetingId: string;
  organizationId: string;
}

class MinutesQueueManager {
  private queue: Queue<MinutesJobData> | null = null;
  private initialized = false;

  /**
   * Initialize minutes queue
   */
  async initialize(): Promise<Queue<MinutesJobData>> {
    if (this.queue) {
      return this.queue;
    }

    try {
      const redis = await getRedisClient();

      const queueOptions: QueueOptions = {
        connection: redis,
        defaultJobOptions: {
          removeOnComplete: {
            age: 86400, // Keep completed jobs for 24 hours
          },
          attempts: parseInt(process.env.MINUTES_JOB_RETRIES || '2', 10),
          backoff: {
            type: 'exponential',
            delay: 5000, // 5s backoff for minutes (slower than translation due to API calls)
          },
        },
      };

      this.queue = new Queue<MinutesJobData>('meeting-minutes', queueOptions);

      this.initialized = true;

      logger.info('Minutes queue initialized', {
        queue: 'meeting-minutes',
      });

      return this.queue;
    } catch (err) {
      logger.error('Failed to initialize minutes queue', err);
      throw err;
    }
  }

  /**
   * Get queue instance
   */
  getQueue(): Queue<MinutesJobData> | null {
    return this.queue;
  }

  /**
   * Check if queue is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Singleton instance
const minutesQueueManager = new MinutesQueueManager();

/**
 * Initialize and return the minutes queue
 */
export async function initializeMinutesQueue(): Promise<Queue<MinutesJobData>> {
  return minutesQueueManager.initialize();
}

/**
 * Submit a minutes generation job to the queue
 */
export async function submitMinutesJob(data: MinutesJobData): Promise<string> {
  const queue = minutesQueueManager.getQueue();
  if (!queue) {
    throw new Error('Minutes queue not initialized. Call initializeMinutesQueue() first.');
  }

  try {
    const job = await queue.add(
      'generate-minutes',
      data,
      {
        jobId: `minutes:${data.meetingId}`, // Unique job ID per meeting
        priority: 5, // Medium priority (lower number = higher priority)
      }
    );

    logger.debug('Minutes job submitted to queue', {
      jobId: job.id,
      meetingId: data.meetingId,
      organizationId: data.organizationId,
    });

    return job.id || '';
  } catch (err) {
    logger.error('Failed to submit minutes job to queue', {
      meetingId: data.meetingId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Get minutes queue manager
 */
export function getMinutesQueueManager() {
  return minutesQueueManager;
}
