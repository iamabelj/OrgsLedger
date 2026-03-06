// ============================================================
// OrgsLedger API — Notification Worker
// Processes push notifications from queue
// Integrates with Firebase Cloud Messaging
// ============================================================

import { Worker, Job } from 'bullmq';
import { getRedisClient } from '../infrastructure/redisClient';
import { logger } from '../logger';
import { NotificationJobData } from '../queues/notification.queue';
import { sendPushToOrg } from '../services/push.service';

class NotificationWorker {
  private worker: Worker<NotificationJobData> | null = null;
  private isRunning = false;
  private processedCount = 0;
  private failedCount = 0;

  async initialize(): Promise<void> {
    try {
      const redis = await getRedisClient();

      this.worker = new Worker<NotificationJobData>(
        'notifications',
        async (job: Job<NotificationJobData>) => {
          return this.processNotificationJob(job);
        },
        {
          connection: redis as any,
          concurrency: parseInt(process.env.NOTIFICATION_WORKER_CONCURRENCY || '10', 10),
          maxStalledCount: 1,
          stalledInterval: 5000,
          lockDuration: 30000,
          lockRenewTime: 5000,
        }
      );

      this.worker.on('ready', () => {
        logger.info('Notification worker ready');
        this.isRunning = true;
      });

      this.worker.on('error', (err: Error) => {
        logger.error('Notification worker error', err);
      });

      this.worker.on('failed', (job: Job<NotificationJobData> | undefined, err: Error) => {
        this.failedCount++;
        logger.warn(`Notification job ${job?.id} failed`, {
          jobId: job?.id,
          organizationId: job?.data.organizationId,
          error: err.message,
        });
      });

      this.worker.on('completed', (job: Job<NotificationJobData>) => {
        this.processedCount++;
      });

      logger.info('Notification worker initialized', {
        concurrency: this.worker.opts.concurrency,
      });
    } catch (err) {
      logger.error('Failed to initialize notification worker', err);
      throw err;
    }
  }

  private async processNotificationJob(
    job: Job<NotificationJobData>
  ): Promise<{ success: boolean }> {
    const { organizationId, title, body, data } = job.data;

    try {
      // Send FCM notification
      await sendPushToOrg(organizationId, {
        title,
        body,
        data: data ? Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)])
        ) : {},
      });

      logger.debug('Notification sent', {
        jobId: job.id,
        organizationId,
      });

      return { success: true };
    } catch (err) {
      logger.error(`Notification job ${job.id} error`, {
        jobId: job.id,
        organizationId,
        error: err instanceof Error ? err.message : String(err),
      });

      throw err;
    }
  }

  async stop(): Promise<void> {
    try {
      if (this.worker) {
        await this.worker.close();
        this.isRunning = false;
        logger.info('Notification worker stopped');
      }
    } catch (err) {
      logger.error('Error stopping notification worker', err);
    }
  }

  async pause(): Promise<void> {
    try {
      if (this.worker) {
        await (this.worker as any).pause();
      }
    } catch (err) {
      logger.error('Error pausing notification worker', err);
    }
  }

  async resume(): Promise<void> {
    try {
      if (this.worker) {
        await (this.worker as any).resume();
      }
    } catch (err) {
      logger.error('Error resuming notification worker', err);
    }
  }

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

  isHealthy(): boolean {
    return this.isRunning && this.worker !== null;
  }
}

const notificationWorkerInstance = new NotificationWorker();

export async function startNotificationWorker(): Promise<void> {
  await notificationWorkerInstance.initialize();
}

export async function stopNotificationWorker(): Promise<void> {
  await notificationWorkerInstance.stop();
}

export function getNotificationWorker() {
  return notificationWorkerInstance;
}
