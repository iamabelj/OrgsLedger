// ============================================================
// OrgsLedger API — Notification Queue  
// Job queue for push notifications
// Handles real-time badges, alerts, and in-app messages
// ============================================================

import { Queue, QueueOptions } from 'bullmq';
import { getRedisClient } from '../infrastructure/redisClient';
import { logger } from '../logger';

export interface NotificationJobData {
  organizationId: string;
  userId?: string; // If set, send to specific user. Otherwise broadcast to org.
  title: string;
  body: string;
  data?: Record<string, string | number>;
  priority?: 'high' | 'normal' | 'low';
}

class NotificationQueueManager {
  private queue: Queue<NotificationJobData> | null = null;
  private initialized = false;

  async initialize(): Promise<Queue<NotificationJobData>> {
    if (this.queue) {
      return this.queue;
    }

    try {
      const redis = await getRedisClient();

      const queueOptions: QueueOptions = {
        connection: redis as any,
        defaultJobOptions: {
          removeOnComplete: {
            age: 43200, // Keep for 12 hours
          },
          attempts: parseInt(process.env.NOTIFICATION_JOB_RETRIES || '2', 10),
          backoff: {
            type: 'exponential',
            delay: 1000, // 1s backoff
          },
        },
      };

      this.queue = new Queue<NotificationJobData>('notifications', queueOptions);
      this.initialized = true;

      logger.info('Notification queue initialized', {
        queue: 'notifications',
      });

      return this.queue;
    } catch (err) {
      logger.error('Failed to initialize notification queue', err);
      throw err;
    }
  }

  getQueue(): Queue<NotificationJobData> | null {
    return this.queue;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

const notificationQueueManager = new NotificationQueueManager();

export async function initializeNotificationQueue(): Promise<Queue<NotificationJobData>> {
  return notificationQueueManager.initialize();
}

export async function submitNotificationJob(data: NotificationJobData): Promise<string> {
  const queue = notificationQueueManager.getQueue();
  if (!queue) {
    throw new Error('Notification queue not initialized');
  }

  try {
    const job = await queue.add(
      'send-notification',
      data,
      {
        jobId: `notif:${data.organizationId}:${data.userId || 'broadcast'}:${Date.now()}`,
        priority: data.priority === 'high' ? 1 : (data.priority === 'low' ? 10 : 5),
      }
    );

    logger.debug('Notification job submitted', {
      jobId: job.id,
      organizationId: data.organizationId,
      userId: data.userId,
    });

    return job.id || '';
  } catch (err) {
    logger.error('Failed to submit notification job', {
      organizationId: data.organizationId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export function getNotificationQueueManager() {
  return notificationQueueManager;
}
