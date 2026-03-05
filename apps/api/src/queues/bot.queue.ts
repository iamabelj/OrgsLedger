// ============================================================
// OrgsLedger API — Bot Lifecycle Queue
// Tracks transcription bot lifecycle events
// Ensures bots are properly managed and recoverable
// ============================================================

import { Queue, QueueOptions } from 'bullmq';
import { getRedisClient } from '../infrastructure/redisClient';
import { logger } from '../logger';

export interface BotJobData {
  meetingId: string;
  organizationId: string;
  action: 'start' | 'stop' | 'reconnect' | 'check_health';
}

class BotQueueManager {
  private queue: Queue<BotJobData> | null = null;
  private initialized = false;

  async initialize(): Promise<Queue<BotJobData>> {
    if (this.queue) {
      return this.queue;
    }

    try {
      const redis = await getRedisClient();

      const queueOptions: QueueOptions = {
        connection: redis,
        defaultJobOptions: {
          removeOnComplete: {
            age: 86400,
          },
          attempts: parseInt(process.env.BOT_JOB_RETRIES || '3', 10),
          backoff: {
            type: 'exponential',
            delay: 3000, // 3s backoff for bot operations
          },
        },
      };

      this.queue = new Queue<BotJobData>('bot-lifecycle', queueOptions);
      this.initialized = true;

      logger.info('Bot queue initialized');

      return this.queue;
    } catch (err) {
      logger.error('Failed to initialize bot queue', err);
      throw err;
    }
  }

  getQueue(): Queue<BotJobData> | null {
    return this.queue;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

const botQueueManager = new BotQueueManager();

export async function initializeBotQueue(): Promise<Queue<BotJobData>> {
  return botQueueManager.initialize();
}

export async function submitBotJob(data: BotJobData): Promise<string> {
  const queue = botQueueManager.getQueue();
  if (!queue) {
    throw new Error('Bot queue not initialized');
  }

  try {
    const job = await queue.add(
      'bot-operation',
      data,
      {
        jobId: `bot:${data.meetingId}:${data.action}:${Date.now()}`,
      }
    );

    logger.debug('Bot job submitted', {
      jobId: job.id,
      meetingId: data.meetingId,
      action: data.action,
    });

    return job.id || '';
  } catch (err) {
    logger.error('Failed to submit bot job', {
      meetingId: data.meetingId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export function getBotQueueManager() {
  return botQueueManager;
}
