// ============================================================
// OrgsLedger API — Translation Queue
// Handles AI translation jobs (GPT-4o-mini / Google Translate)
// Part of AI processing path (NOT blocking real-time captions)
// Optimized for throughput, not latency
// ============================================================

import { Queue, QueueOptions } from 'bullmq';
import { getRedisClient } from '../infrastructure/redisClient';
import { logger } from '../logger';

// ── Job Data Types ────────────────────────────────────────────

export interface TranslationJobData {
  // Source identification
  meetingId: string;
  organizationId: string;
  speakerId: string;
  speakerName: string;

  // Content
  originalText: string;
  sourceLanguage: string;
  targetLanguages: string[];

  // Context
  timestamp: string;
  segmentIndex: number;
  isFinal: boolean;

  // Processing hints
  priority: 'realtime' | 'async' | 'batch';
  cacheKey?: string; // Pre-computed cache key for L1/L2 lookup
}

export interface TranslationResult {
  meetingId: string;
  speakerId: string;
  originalText: string;
  sourceLanguage: string;
  translations: Record<string, string>;
  timestamp: string;
  isFinal: boolean;
  fromCache: boolean;
  latencyMs: number;
}

// ── Queue Configuration ───────────────────────────────────────

const QUEUE_NAME = 'translation-queue';

// ── Queue Manager ─────────────────────────────────────────────

class TranslationQueueManager {
  private queue: Queue<TranslationJobData> | null = null;
  private initialized = false;

  /**
   * Initialize translation queue
   */
  async initialize(): Promise<Queue<TranslationJobData>> {
    if (this.queue) {
      return this.queue;
    }

    try {
      const redis = await getRedisClient();

      const queueOptions: QueueOptions = {
        connection: redis as any,
        defaultJobOptions: {
          removeOnComplete: {
            age: 1800, // Keep completed for 30 min
            count: 5000, // Max 5000 completed jobs
          },
          removeOnFail: {
            age: 7200, // Keep failed for 2 hours
          },
          attempts: parseInt(process.env.TRANSLATION_MAX_RETRIES || '3', 10),
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        },
      };

      this.queue = new Queue<TranslationJobData>(QUEUE_NAME, queueOptions);

      this.queue.on('error', (err: Error) => {
        logger.error('[TRANSLATION_QUEUE] Queue error', err);
      });

      await this.queue.waitUntilReady();
      this.initialized = true;

      logger.info('[TRANSLATION_QUEUE] Queue initialized', {
        name: QUEUE_NAME,
      });

      return this.queue;
    } catch (err) {
      logger.error('[TRANSLATION_QUEUE] Failed to initialize', err);
      throw err;
    }
  }

  /**
   * Submit translation job
   */
  async submit(data: TranslationJobData): Promise<string> {
    if (!this.queue) {
      await this.initialize();
    }

    if (!this.queue) {
      throw new Error('Translation queue not initialized');
    }

    const jobId = `tr:${data.meetingId}:${data.segmentIndex}:${Date.now()}`;

    // Priority mapping - AI path uses lower priority than real-time
    const priorityMap = { realtime: 3, async: 5, batch: 10 };
    const priority = priorityMap[data.priority] || 5;

    const job = await this.queue.add('translate', data, {
      jobId,
      priority,
    });

    logger.debug('[TRANSLATION_QUEUE] Job submitted', {
      jobId: job.id,
      meetingId: data.meetingId,
      targetLanguages: data.targetLanguages.length,
      priority: data.priority,
    });

    return job.id || jobId;
  }

  /**
   * Bulk submit for batch processing
   */
  async submitBulk(jobs: TranslationJobData[]): Promise<string[]> {
    if (!this.queue) {
      await this.initialize();
    }

    if (!this.queue) {
      throw new Error('Translation queue not initialized');
    }

    const bulkJobs = jobs.map((data, idx) => ({
      name: 'translate',
      data,
      opts: {
        jobId: `tr:${data.meetingId}:${data.segmentIndex}:${Date.now()}:${idx}`,
        priority: data.priority === 'batch' ? 10 : 5,
      },
    }));

    const results = await this.queue.addBulk(bulkJobs);

    logger.debug('[TRANSLATION_QUEUE] Bulk submitted', {
      count: jobs.length,
    });

    return results.map((r) => r.id || 'unknown');
  }

  /**
   * Get queue for direct access
   */
  getQueue(): Queue<TranslationJobData> | null {
    return this.queue;
  }

  /**
   * Check initialization status
   */
  isInitialized(): boolean {
    return this.initialized;
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
    if (!this.queue) {
      return { size: 0, activeCount: 0, waitingCount: 0, failedCount: 0, delayedCount: 0 };
    }

    const [size, activeCount, waitingCount, failedCount, delayedCount] = await Promise.all([
      this.queue.count(),
      this.queue.getActiveCount(),
      this.queue.getWaitingCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);

    return { size, activeCount, waitingCount, failedCount, delayedCount };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
    }
    logger.info('[TRANSLATION_QUEUE] Queue shut down');
  }
}

// ── Singleton Export ──────────────────────────────────────────

export const translationQueue = new TranslationQueueManager();

export async function initializeTranslationQueue(): Promise<Queue<TranslationJobData>> {
  return translationQueue.initialize();
}

export function getTranslationQueue(): TranslationQueueManager {
  return translationQueue;
}
