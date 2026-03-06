// ============================================================
// OrgsLedger API — Email Worker
// Processes email jobs from queue
// Integrates with sendgrid / SMTP service
// ============================================================

import { Worker, Job } from 'bullmq';
import { getRedisClient } from '../infrastructure/redisClient';
import { logger } from '../logger';
import { EmailJobData } from '../queues/email.queue';
import { sendEmail } from '../services/email.service';

class EmailWorker {
  private worker: Worker<EmailJobData> | null = null;
  private isRunning = false;
  private processedCount = 0;
  private failedCount = 0;

  async initialize(): Promise<void> {
    try {
      const redis = await getRedisClient();

      this.worker = new Worker<EmailJobData>(
        'email',
        async (job: Job<EmailJobData>) => {
          return this.processEmailJob(job);
        },
        {
          connection: redis as any,
          concurrency: parseInt(process.env.EMAIL_WORKER_CONCURRENCY || '5', 10),
          maxStalledCount: 2,
          stalledInterval: 5000,
          lockDuration: 60000, // SMTP timeout: 60s
          lockRenewTime: 15000,
        }
      );

      this.worker.on('ready', () => {
        logger.info('Email worker ready');
        this.isRunning = true;
      });

      this.worker.on('error', (err: Error) => {
        logger.error('Email worker error', err);
      });

      this.worker.on('failed', (job: Job<EmailJobData> | undefined, err: Error) => {
        this.failedCount++;
        logger.warn(`Email job ${job?.id} failed`, {
          jobId: job?.id,
          emailType: job?.data.emailType,
          recipient: job?.data.recipientEmail,
          error: err.message,
          attempt: job?.attemptsMade,
        });
      });

      this.worker.on('completed', (job: Job<EmailJobData>) => {
        this.processedCount++;
        logger.debug(`Email job ${job.id} completed`, {
          jobId: job.id,
          emailType: job.data.emailType,
          recipient: job.data.recipientEmail,
        });
      });

      logger.info('Email worker initialized', {
        concurrency: this.worker.opts.concurrency,
      });
    } catch (err) {
      logger.error('Failed to initialize email worker', err);
      throw err;
    }
  }

  private async processEmailJob(job: Job<EmailJobData>): Promise<{ success: boolean }> {
    const { recipientEmail, subject, htmlBody, textBody, emailType } = job.data;

    try {
      logger.debug('Processing email job', {
        jobId: job.id,
        emailType,
        recipient: recipientEmail,
      });

      // Call email service
      await sendEmail({
        to: recipientEmail,
        subject,
        html: htmlBody,
        text: textBody,
      });

      logger.info('Email sent successfully', {
        jobId: job.id,
        emailType,
        recipient: recipientEmail,
      });

      return { success: true };
    } catch (err) {
      logger.error(`Email job ${job.id} error`, {
        jobId: job.id,
        emailType,
        recipient: recipientEmail,
        error: err instanceof Error ? err.message : String(err),
        attempt: job.attemptsMade,
      });

      throw err; // Let BullMQ handle retry
    }
  }

  async stop(): Promise<void> {
    try {
      if (this.worker) {
        await this.worker.close();
        this.isRunning = false;
        logger.info('Email worker stopped');
      }
    } catch (err) {
      logger.error('Error stopping email worker', err);
    }
  }

  async pause(): Promise<void> {
    try {
      if (this.worker) {
        await (this.worker as any).pause();
        logger.info('Email worker paused');
      }
    } catch (err) {
      logger.error('Error pausing email worker', err);
    }
  }

  async resume(): Promise<void> {
    try {
      if (this.worker) {
        await (this.worker as any).resume();
        logger.info('Email worker resumed');
      }
    } catch (err) {
      logger.error('Error resuming email worker', err);
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

const emailWorkerInstance = new EmailWorker();

export async function startEmailWorker(): Promise<void> {
  await emailWorkerInstance.initialize();
}

export async function stopEmailWorker(): Promise<void> {
  await emailWorkerInstance.stop();
}

export function getEmailWorker() {
  return emailWorkerInstance;
}
