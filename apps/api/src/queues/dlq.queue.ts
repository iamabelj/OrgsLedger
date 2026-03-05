// ============================================================
// OrgsLedger API — Dead Letter Queue
// Holds failed jobs that exceeded max retries
// Provides recovery and replay mechanism
// ============================================================

import { Queue, QueueOptions } from 'bullmq';
import { getRedisClient } from '../infrastructure/redisClient';
import { logger } from '../logger';

export interface DeadLetterJobData {
  originalQueue: string;
  jobId: string;
  data: any;
  lastError: string;
  failedAt: string;
  attempts: number;
  maxAttempts: number;
}

class DeadLetterQueueManager {
  private queue: Queue<DeadLetterJobData> | null = null;
  private initialized = false;

  async initialize(): Promise<Queue<DeadLetterJobData>> {
    if (this.queue) {
      return this.queue;
    }

    try {
      const redis = await getRedisClient();

      const queueOptions: QueueOptions = {
        connection: redis,
        defaultJobOptions: {
          removeOnComplete: {
            age: 604800, // Keep for 7 days
          },
        },
      };

      this.queue = new Queue<DeadLetterJobData>('dlq-dead-letters', queueOptions);
      this.initialized = true;

      logger.info('Dead Letter Queue initialized');

      return this.queue;
    } catch (err) {
      logger.error('Failed to initialize dead letter queue', err);
      throw err;
    }
  }

  getQueue(): Queue<DeadLetterJobData> | null {
    return this.queue;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

const dlqManager = new DeadLetterQueueManager();

export async function initializeDeadLetterQueue(): Promise<Queue<DeadLetterJobData>> {
  return dlqManager.initialize();
}

/**
 * Send a failed job to the dead letter queue
 */
export async function sendToDeadLetterQueue(
  originalQueue: string,
  jobId: string,
  jobData: any,
  lastError: string,
  attempts: number,
  maxAttempts: number
): Promise<void> {
  const queue = dlqManager.getQueue();
  if (!queue) {
    logger.warn('DLQ not initialized, job lost', { jobId, originalQueue });
    return;
  }

  try {
    await queue.add(
      'dead-letter',
      {
        originalQueue,
        jobId,
        data: jobData,
        lastError,
        failedAt: new Date().toISOString(),
        attempts,
        maxAttempts,
      },
      {
        jobId: `dlq:${originalQueue}:${jobId}:${Date.now()}`,
      }
    );

    logger.error('[DLQ] Job moved to dead letter queue', {
      jobId,
      originalQueue,
      lastError,
    });
  } catch (err) {
    logger.error('[DLQ] Failed to move job to DLQ', {
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Get dead letter jobs for a specific queue
 */
export async function getDeadLetterJobs(originalQueue?: string): Promise<DeadLetterJobData[]> {
  const queue = dlqManager.getQueue();
  if (!queue) {
    return [];
  }

  try {
    const allJobs = await queue.getWaiting();
    // Convert Job objects to data
    const jobsData: DeadLetterJobData[] = [];

    for (const job of allJobs) {
      const data = job.data as DeadLetterJobData;
      if (!originalQueue || data.originalQueue === originalQueue) {
        jobsData.push(data);
      }
    }

    return jobsData;
  } catch (err) {
    logger.error('[DLQ] Failed to retrieve dead letter jobs', err);
    return [];
  }
}

/**
 * Replay a dead letter job back to its original queue
 */
export async function replayDeadLetterJob(dlqJobId: string, targetQueue: Queue<any>): Promise<boolean> {
  const queue = dlqManager.getQueue();
  if (!queue) {
    return false;
  }

  try {
    const job = await queue.getJob(dlqJobId);
    if (!job) {
      logger.warn('[DLQ] Job not found for replay', { jobId: dlqJobId });
      return false;
    }

    const data = job.data as DeadLetterJobData;

    // Add back to original queue
    await targetQueue.add(
      'replay',
      data.data,
      {
        jobId: `replay:${data.jobId}:${Date.now()}`,
        attempts: 3, // Reset attempts
      }
    );

    // Remove from DLQ
    await job.remove();

    logger.info('[DLQ] Job replayed successfully', {
      originalJobId: data.jobId,
      originalQueue: data.originalQueue,
    });

    return true;
  } catch (err) {
    logger.error('[DLQ] Failed to replay job', {
      jobId: dlqJobId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export function getDeadLetterQueueManager() {
  return dlqManager;
}
