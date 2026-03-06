// ============================================================
// OrgsLedger API — Translation Worker
// Processes transcripts from queue, performs translation
// Horizontally scalable: multiple instances can run simultaneously
// ============================================================

import { Worker, Job } from 'bullmq';
import { getRedisClient } from '../infrastructure/redisClient';
import { logger } from '../logger';
import { multilingualTranslationPipeline } from '../services/multilingualTranslation.service';
import { broadcastQueueManager, BroadcastJobData } from '../queues/broadcast.queue';
import { TranscriptJobData } from '../queues/transcript.queue';

class TranslationWorker {
  private worker: Worker<TranscriptJobData> | null = null;
  private isRunning = false;

  /**
   * Initialize translation worker
   */
  async initialize(): Promise<void> {
    try {
      const redis = await getRedisClient();

      this.worker = new Worker<TranscriptJobData>(
        'transcript-processing',
        async (job: Job<TranscriptJobData>) => {
          return this.processTranscript(job);
        },
        {
          connection: redis as any,
          concurrency: parseInt(process.env.TRANSLATION_WORKER_CONCURRENCY || '10', 10),
          maxStalledCount: 3,
          stalledInterval: 5000, // Check for stalled jobs every 5s
          lockDuration: 30000, // Hold lock for 30s
          lockRenewTime: 15000, // Renew lock every 15s
        }
      );

      // Setup event handlers
      this.worker.on('ready', () => {
        logger.info('Translation worker ready');
        this.isRunning = true;
      });

      this.worker.on('error', (err: Error) => {
        logger.error('Translation worker error', err);
      });

      this.worker.on('failed', (job: Job<TranscriptJobData> | undefined, err: Error) => {
        if (job) {
          logger.error(`Translation worker job ${job.id} failed`, {
            jobId: job.id,
            error: err.message,
          });
        } else {
          logger.error('Translation worker job failed', { error: err.message });
        }
      });

      this.worker.on('completed', (job: Job<TranscriptJobData>) => {
        logger.debug(`Translation worker job ${job.id} completed`, {
          jobId: job.id,
          meetingId: job.data.meetingId,
        });
      });

      logger.info('Translation worker initialized', {
        concurrency: this.worker.opts.concurrency,
      });
    } catch (err) {
      logger.error('Failed to initialize translation worker', err);
      throw err;
    }
  }

  /**
   * Process a single transcript job
   */
  private async processTranscript(job: Job<TranscriptJobData>): Promise<void> {
    const startTime = Date.now();
    const { meetingId, speakerId, speakerName, originalText, language, timestamp, isFinal } =
      job.data;

    try {
      // Step 1: Translate to all participant languages
      const translationResult = await multilingualTranslationPipeline.translateToParticipants(
        originalText,
        language,
        meetingId
      );

      // Step 2: Build broadcast job data
      const broadcastData: BroadcastJobData = {
        meetingId,
        speakerId,
        speakerName,
        originalText,
        sourceLanguage: language,
        translations: translationResult.translations,
        timestamp: timestamp instanceof Date ? timestamp.toISOString() : String(timestamp),
        isFinal,
      };

      // Step 3: Enqueue to broadcast queue
      await broadcastQueueManager.add(broadcastData);

      const processingTime = Date.now() - startTime;
      logger.info('Transcript translation completed', {
        jobId: job.id,
        meetingId,
        speakerId,
        textLength: originalText.length,
        targetLanguages: Object.keys(translationResult.translations).length,
        processingTimeMs: processingTime,
        isFinal,
      });
    } catch (err) {
      logger.error(`Translation job ${job.id} error`, {
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
      processed: 0,
      failed: 0,
      paused: this.worker?.isPaused() || false,
    };
  }

  /**
   * Pause worker (stop processing new jobs)
   */
  async pause(): Promise<void> {
    try {
      if (this.worker) {
        await this.worker.pause();
        logger.info('Translation worker paused');
      }
    } catch (err) {
      logger.error('Failed to pause translation worker', err);
    }
  }

  /**
   * Resume worker
   */
  async resume(): Promise<void> {
    try {
      if (this.worker) {
        await this.worker.resume();
        logger.info('Translation worker resumed');
      }
    } catch (err) {
      logger.error('Failed to resume translation worker', err);
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
        logger.info('Translation worker closed');
      }
    } catch (err) {
      logger.error('Error closing translation worker', err);
    }
  }

  /**
   * Check if worker is running
   */
  isHealthy(): boolean {
    return this.isRunning && this.worker !== null;
  }
}

// Export singleton instance
export const translationWorker = new TranslationWorker();

/**
 * Initialize and start translation worker
 */
export async function startTranslationWorker(): Promise<void> {
  await translationWorker.initialize();
}

/**
 * Gracefully shutdown translation worker
 */
export async function stopTranslationWorker(): Promise<void> {
  await translationWorker.close();
}
