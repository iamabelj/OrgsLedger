// ============================================================
// OrgsLedger API — Processing Worker (Enhanced)
// Processes translation jobs from processing queue
// Features: DLQ integration, metrics, timeout handling
// Calls translation service and manages job lifecycle
// ============================================================

import { Worker, Job } from 'bullmq';
import { createBullMQConnection } from '../infrastructure/redisClient';
import { logger } from '../logger';
import { ProcessingWorker as IProcessingWorkerService } from '../services/workers/processingWorker.service';
import { sendToDeadLetterQueue } from '../queues/dlq.queue';
import { pipelineMetrics } from '../services/pipeline/metrics';

// ── Configuration ─────────────────────────────────────────────

const PROCESSING_TIMEOUT_MS = parseInt(process.env.PROCESSING_TIMEOUT_MS || '20000', 10);
const MAX_RETRIES = parseInt(process.env.PROCESSING_MAX_RETRIES || '3', 10);

// ProcessingJobData interface definition
export interface ProcessingJobData {
  meetingId: string;
  speakerId: string;
  originalText: string;
  sourceLanguage: string;
  targetLanguages: string[];
  isFinal: boolean;
  organizationId?: string;
  chunkIndex?: number;
}

// ── Timeout wrapper ───────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${ms}ms`));
    }, ms);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}


class ProcessingWorker {
  private worker: Worker<ProcessingJobData> | null = null;
  private processingService: IProcessingWorkerService | null = null;
  private isRunning = false;
  private processedCount = 0;
  private failedCount = 0;

  /**
   * Initialize processing worker
   */
  async initialize(processingService: IProcessingWorkerService): Promise<void> {
    try {
      this.processingService = processingService;
      const redis = createBullMQConnection();

      this.worker = new Worker<ProcessingJobData>(
        'translation-processing',
        async (job: Job<ProcessingJobData>) => {
          return this.processTranslation(job);
        },
        {
          connection: redis as any,
          concurrency: parseInt(process.env.PROCESSING_WORKER_CONCURRENCY || '10', 10),
          maxStalledCount: 2,
          stalledInterval: 5000,
          lockDuration: 30000, // Longer lock for processing
          lockRenewTime: 10000,
        }
      );

      // Setup event handlers
      this.worker.on('ready', () => {
        logger.info('Processing worker ready');
        this.isRunning = true;
      });

      this.worker.on('error', (err: Error) => {
        logger.error('Processing worker error', err);
      });

      this.worker.on('failed', async (job: Job<ProcessingJobData> | undefined, err: Error) => {
        this.failedCount++;
        
        if (job) {
          const isLastAttempt = job.attemptsMade >= (job.opts.attempts || MAX_RETRIES);
          
          logger.warn(`Processing job ${job.id} failed`, {
            jobId: job.id,
            meetingId: job.data.meetingId,
            speakerId: job.data.speakerId,
            error: err.message,
            attempt: job.attemptsMade,
            maxAttempts: job.opts.attempts,
            isLastAttempt,
          });

          // Send to DLQ if max retries exceeded
          if (isLastAttempt) {
            await sendToDeadLetterQueue(
              'translation-processing',
              job.id || 'unknown',
              job.data,
              err.message,
              job.attemptsMade,
              job.opts.attempts || MAX_RETRIES
            );

            // Record metrics
            pipelineMetrics.recordError('processing', job.data.meetingId, err.message);
          }
        }
      });

      this.worker.on('completed', (job: Job<ProcessingJobData>) => {
        this.processedCount++;
        logger.debug(`Processing job ${job.id} completed`, {
          jobId: job.id,
          meetingId: job.data.meetingId,
          speakerId: job.data.speakerId,
        });
      });

      logger.info('Processing worker initialized', {
        concurrency: this.worker.opts.concurrency,
        timeout: PROCESSING_TIMEOUT_MS,
      });
    } catch (err) {
      logger.error('Failed to initialize processing worker', err);
      throw err;
    }
  }

  /**
   * Process translation job with timeout
   */
  private async processTranslation(
    job: Job<ProcessingJobData>
  ): Promise<{ finalTranslations?: Record<string, string>; error?: string }> {
    const startTime = Date.now();
    const {
      meetingId,
      speakerId,
      originalText,
      sourceLanguage,
      targetLanguages,
      isFinal,
      organizationId,
      chunkIndex,
    } = job.data;

    try {
      if (!this.processingService) {
        throw new Error('Processing service not initialized');
      }

      logger.debug('Processing translation', {
        jobId: job.id,
        meetingId,
        speakerId,
        sourceLanguage,
        targetLanguages,
        isFinal,
        organizationId,
        chunkIndex,
        textLength: originalText.length,
      });

      // Call processing service with timeout
      const result = await withTimeout(
        this.processingService.processTranslation(
          meetingId,
          speakerId,
          originalText,
          sourceLanguage,
          targetLanguages,
          isFinal,
          organizationId
        ),
        PROCESSING_TIMEOUT_MS,
        'Processing'
      );

      const processingTime = Date.now() - startTime;

      // Record metrics
      pipelineMetrics.recordTranscriptLatency(meetingId, processingTime);

      logger.debug('Translation processed', {
        jobId: job.id,
        meetingId,
        speakerId,
        processingTimeMs: processingTime,
        hasFinalTranslations: !!result.finalTranslations,
      });

      // Track processing duration
      if (processingTime > 5000) {
        logger.warn('Slow translation processing', {
          jobId: job.id,
          meetingId,
          processingTimeMs: processingTime,
          textLength: originalText.length,
          threshold: 5000,
        });
      }

      return result;
    } catch (err) {
      logger.error(`Processing job ${job.id} error`, {
        jobId: job.id,
        meetingId,
        speakerId,
        error: err instanceof Error ? err.message : String(err),
        attempt: job.attemptsMade,
        maxAttempts: job.opts.attempts,
      });

      throw err; // Re-throw to trigger BullMQ retry logic
    }
  }

  /**
   * Get worker status
   */
  async getStatus(): Promise<{
    running: boolean;
    processed: number;
    failed: number;
    paused: boolean;
  }> {
    return {
      running: this.isRunning,
      processed: this.processedCount,
      failed: this.failedCount,
      paused: this.worker?.isPaused() || false,
    };
  }

  /**
   * Pause worker
   */
  async pause(): Promise<void> {
    try {
      if (this.worker) {
        await this.worker.pause();
        logger.info('Processing worker paused');
      }
    } catch (err) {
      logger.error('Failed to pause processing worker', err);
    }
  }

  /**
   * Resume worker
   */
  async resume(): Promise<void> {
    try {
      if (this.worker) {
        await this.worker.resume();
        logger.info('Processing worker resumed');
      }
    } catch (err) {
      logger.error('Failed to resume processing worker', err);
    }
  }

  /**
   * Close worker gracefully
   */
  async close(): Promise<void> {
    try {
      if (this.worker) {
        await this.worker.close();
        this.worker = null;
        this.isRunning = false;
        logger.info('Processing worker closed');
      }
    } catch (err) {
      logger.error('Error closing processing worker', err);
    }
  }

  /**
   * Check if worker is healthy
   */
  isHealthy(): boolean {
    return this.isRunning && this.worker !== null && this.processingService !== null;
  }
}

// Export singleton instance
export const processingWorker = new ProcessingWorker();

/**
 * Initialize and start processing worker
 */
export async function startProcessingWorker(
  processingService: IProcessingWorkerService
): Promise<void> {
  await processingWorker.initialize(processingService);
}

/**
 * Gracefully shutdown processing worker
 */
export async function stopProcessingWorker(): Promise<void> {
  await processingWorker.close();
}
