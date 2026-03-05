// ============================================================
// OrgsLedger API — Email Queue
// Job queue for transactional and bulk email sending
// Handles notifications, reminders, and alerts
// ============================================================

import { Queue, QueueOptions } from 'bullmq';
import { getRedisClient } from '../infrastructure/redisClient';
import { logger } from '../logger';

export interface EmailJobData {
  recipientEmail: string;
  recipientName?: string;
  emailType: 'meeting_started' | 'meeting_ended' | 'minutes_ready' | 'reminder' | 'alert' | 'subscription' | 'transactional';
  subject: string;
  htmlBody: string;
  textBody?: string;
  organizationId?: string;
  meetingId?: string;
  retries?: number;
}

class EmailQueueManager {
  private queue: Queue<EmailJobData> | null = null;
  private initialized = false;

  async initialize(): Promise<Queue<EmailJobData>> {
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
          attempts: parseInt(process.env.EMAIL_JOB_RETRIES || '3', 10),
          backoff: {
            type: 'exponential',
            delay: 2000, // 2s backoff
          },
        },
      };

      this.queue = new Queue<EmailJobData>('email', queueOptions);
      this.initialized = true;

      logger.info('Email queue initialized', {
        queue: 'email',
      });

      return this.queue;
    } catch (err) {
      logger.error('Failed to initialize email queue', err);
      throw err;
    }
  }

  getQueue(): Queue<EmailJobData> | null {
    return this.queue;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

const emailQueueManager = new EmailQueueManager();

export async function initializeEmailQueue(): Promise<Queue<EmailJobData>> {
  return emailQueueManager.initialize();
}

export async function submitEmailJob(data: EmailJobData): Promise<string> {
  const queue = emailQueueManager.getQueue();
  if (!queue) {
    throw new Error('Email queue not initialized. Call initializeEmailQueue() first.');
  }

  try {
    const job = await queue.add(
      'send-email',
      data,
      {
        jobId: `email:${data.organizationId || 'system'}:${data.recipientEmail}:${Date.now()}`,
        priority: data.emailType === 'transactional' ? 1 : 5, // transactional=high priority
      }
    );

    logger.debug('Email job submitted to queue', {
      jobId: job.id,
      emailType: data.emailType,
      recipient: data.recipientEmail,
    });

    return job.id || '';
  } catch (err) {
    logger.error('Failed to submit email job to queue', {
      emailType: data.emailType,
      recipient: data.recipientEmail,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export function getEmailQueueManager() {
  return emailQueueManager;
}
