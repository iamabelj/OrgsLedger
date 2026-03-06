// ============================================================
// OrgsLedger API — Minutes Worker
// Processes AI minutes generation jobs from queue
// Calls minutes service and manages job lifecycle
// ============================================================

import { Worker, Job } from 'bullmq';
import { getRedisClient } from '../infrastructure/redisClient';
import { logger } from '../logger';
import { MinutesWorkerService } from '../services/workers/minutesWorker.service';
import { MinutesJobData } from '../queues/minutes.queue';

class MinutesWorker {
  private worker: Worker<MinutesJobData> | null = null;
  private minutesService: MinutesWorkerService | null = null;
  private isRunning = false;
  private processedCount = 0;
  private failedCount = 0;

  /**
   * Initialize minutes worker
   */
  async initialize(minutesService: MinutesWorkerService): Promise<void> {
    try {
      this.minutesService = minutesService;
      const redis = await getRedisClient();

      this.worker = new Worker<MinutesJobData>(
        'meeting-minutes',
        async (job: Job<MinutesJobData>) => {
          return this.processMinutesJob(job);
        },
        {
          connection: redis as any,
          concurrency: parseInt(process.env.MINUTES_WORKER_CONCURRENCY || '2', 10),
          maxStalledCount: 2,
          stalledInterval: 5000,
          lockDuration: 300000, // 5 min lock for minutes (slower API calls)
          lockRenewTime: 60000,
        }
      );

      // Setup event handlers
      this.worker.on('ready', () => {
        logger.info('Minutes worker ready');
        this.isRunning = true;
      });

      this.worker.on('error', (err: Error) => {
        logger.error('Minutes worker error', err);
      });

      this.worker.on('failed', (job: Job<MinutesJobData> | undefined, err: Error) => {
        this.failedCount++;
        logger.warn(`Minutes job ${job?.id} failed after max retries`, {
          jobId: job?.id,
          meetingId: job?.data.meetingId,
          organizationId: job?.data.organizationId,
          error: err.message,
          attempt: job?.attemptsMade,
        });
      });

      this.worker.on('completed', (job: Job<MinutesJobData>) => {
        this.processedCount++;
        logger.debug(`Minutes job ${job.id} completed`, {
          jobId: job.id,
          meetingId: job.data.meetingId,
          organizationId: job.data.organizationId,
        });
      });

      logger.info('Minutes worker initialized', {
        concurrency: this.worker.opts.concurrency,
      });
    } catch (err) {
      logger.error('Failed to initialize minutes worker', err);
      throw err;
    }
  }

  /**
   * Process a single minutes job
   */
  private async processMinutesJob(
    job: Job<MinutesJobData>
  ): Promise<{ success: boolean; error?: string }> {
    const startTime = Date.now();
    const { meetingId, organizationId } = job.data;

    try {
      if (!this.minutesService) {
        throw new Error('Minutes service not initialized');
      }

      logger.debug('Processing minutes job', {
        jobId: job.id,
        meetingId,
        organizationId,
      });

      const result = await this.minutesService.processMinutes(meetingId, organizationId);

      const processingTime = Date.now() - startTime;
      logger.info('Minutes job processed', {
        jobId: job.id,
        meetingId,
        organizationId,
        processingTimeMs: processingTime,
        success: result.success,
      });

      if (processingTime > 60000) {
        logger.warn('Slow minutes processing', {
          jobId: job.id,
          meetingId,
          processingTimeMs: processingTime,
          threshold: 60000,
        });
      }

      return result;
    } catch (err) {
      logger.error(`Minutes job ${job.id} error`, {
        jobId: job.id,
        meetingId,
        organizationId,
        error: err instanceof Error ? err.message : String(err),
        attempt: job.attemptsMade,
        maxAttempts: job.opts.attempts,
      });

      throw err;
    }
  }

  /**
   * Stop the worker
   */
  async stop(): Promise<void> {
    try {
      if (this.worker) {
        await this.worker.close();
        this.isRunning = false;
        logger.info('Minutes worker stopped');
      }
    } catch (err) {
      logger.error('Error stopping minutes worker', err);
    }
  }

  /**
   * Pause the worker (stop accepting new jobs but finish current ones)
   */
  async pause(): Promise<void> {
    try {
      if (this.worker) {
        await (this.worker as any).pause();
        logger.info('Minutes worker paused');
      }
    } catch (err) {
      logger.error('Error pausing minutes worker', err);
    }
  }

  /**
   * Resume the worker (start accepting new jobs again)
   */
  async resume(): Promise<void> {
    try {
      if (this.worker) {
        await (this.worker as any).resume();
        logger.info('Minutes worker resumed');
      }
    } catch (err) {
      logger.error('Error resuming minutes worker', err);
    }
  }

  /**
   * Get worker health status
   */
  async getStatus(): Promise<{
    running: boolean;
    processed: number;
    failed: number;
  }> {
    return {
      running: this.isRunning,
      processed: this.processedCount,
      failed: this.failedCount,
    };
  }

  /**
   * Check if worker is healthy
   */
  isHealthy(): boolean {
    return this.isRunning && this.worker !== null;
  }
}

// Singleton instance
const minutesWorkerInstance = new MinutesWorker();

/**
 * Start the minutes worker
 */
export async function startMinutesWorker(minutesService: MinutesWorkerService): Promise<void> {
  await minutesWorkerInstance.initialize(minutesService);
}

/**
 * Stop the minutes worker
 */
export async function stopMinutesWorker(): Promise<void> {
  await minutesWorkerInstance.stop();
}

/**
 * Get minutes worker instance
 */
export function getMinutesWorker() {
  return minutesWorkerInstance;
}
