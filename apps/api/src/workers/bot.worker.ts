// ============================================================
// OrgsLedger API — Bot Worker
// Manages transcription bot lifecycle
// Handles start, stop, reconnect, and health check operations
// ============================================================

import { Worker, Job } from 'bullmq';
import { getRedisClient } from '../infrastructure/redisClient';
import { logger } from '../logger';
import { BotJobData } from '../queues/bot.queue';
import { getBotManager } from '../services/bot';

class BotWorker {
  private worker: Worker<BotJobData> | null = null;
  private isRunning = false;
  private processedCount = 0;
  private failedCount = 0;

  async initialize(): Promise<void> {
    try {
      const redis = await getRedisClient();

      this.worker = new Worker<BotJobData>(
        'bot-lifecycle',
        async (job: Job<BotJobData>) => {
          return this.processBotJob(job);
        },
        {
          connection: redis as any,
          concurrency: parseInt(process.env.BOT_WORKER_CONCURRENCY || '3', 10),
          maxStalledCount: 2,
          stalledInterval: 5000,
          lockDuration: 120000, // 2 min lock for bot operations
          lockRenewTime: 30000,
        }
      );

      this.worker.on('ready', () => {
        logger.info('Bot worker ready');
        this.isRunning = true;
      });

      this.worker.on('error', (err: Error) => {
        logger.error('Bot worker error', err);
      });

      this.worker.on('failed', (job: Job<BotJobData> | undefined, err: Error) => {
        this.failedCount++;
        logger.warn(`Bot job ${job?.id} failed`, {
          jobId: job?.id,
          meetingId: job?.data.meetingId,
          action: job?.data.action,
          error: err.message,
        });
      });

      this.worker.on('completed', (job: Job<BotJobData>) => {
        this.processedCount++;
        logger.debug(`Bot job completed`, {
          jobId: job.id,
          meetingId: job.data.meetingId,
          action: job.data.action,
        });
      });

      logger.info('Bot worker initialized');
    } catch (err) {
      logger.error('Failed to initialize bot worker', err);
      throw err;
    }
  }

  private async processBotJob(job: Job<BotJobData>): Promise<{ success: boolean }> {
    const { meetingId, action } = job.data;
    const botManager = getBotManager();

    try {
      logger.debug('Processing bot job', {
        jobId: job.id,
        meetingId,
        action,
      });

      switch (action) {
        case 'start':
          await botManager.startMeetingBot(meetingId);
          break;
        case 'stop':
          await botManager.stopMeetingBot(meetingId);
          break;
        case 'reconnect':
          await botManager.stopMeetingBot(meetingId);
          await new Promise(r => setTimeout(r, 2000)); // Wait before restart
          await botManager.startMeetingBot(meetingId);
          break;
        case 'check_health':
          const statusList = botManager.getStatus();
          const status = statusList.find(s => s.meetingId === meetingId);
          if (!status || status.activeSessions === 0) {
            logger.warn('[BOT_WORKER] Bot not running, attempting reconnect', { meetingId });
            await botManager.startMeetingBot(meetingId);
          }
          break;
        default:
          throw new Error(`Unknown bot action: ${action}`);
      }

      return { success: true };
    } catch (err) {
      logger.error(`Bot job ${job.id} failed`, {
        jobId: job.id,
        meetingId,
        action,
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
        logger.info('Bot worker stopped');
      }
    } catch (err) {
      logger.error('Error stopping bot worker', err);
    }
  }

  async pause(): Promise<void> {
    try {
      if (this.worker) {
        await (this.worker as any).pause();
      }
    } catch (err) {
      logger.error('Error pausing bot worker', err);
    }
  }

  async resume(): Promise<void> {
    try {
      if (this.worker) {
        await (this.worker as any).resume();
      }
    } catch (err) {
      logger.error('Error resuming bot worker', err);
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

const botWorkerInstance = new BotWorker();

export async function startBotWorker(): Promise<void> {
  await botWorkerInstance.initialize();
}

export async function stopBotWorker(): Promise<void> {
  await botWorkerInstance.stop();
}

export function getBotWorker() {
  return botWorkerInstance;
}
