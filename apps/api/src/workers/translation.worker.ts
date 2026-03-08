// ============================================================
// OrgsLedger API — Translation Worker (Enhanced)
// Processes transcripts from queue, performs translation
// Features: timeout, circuit breaker, DLQ, metrics, fallback
// Horizontally scalable: multiple instances can run simultaneously
// ============================================================

import { Worker, Job } from 'bullmq';
import { createBullMQConnection } from '../infrastructure/redisClient';
import { logger } from '../logger';
import { multilingualTranslationPipeline } from '../services/multilingualTranslation.service';
import { broadcastQueueManager, BroadcastJobData } from '../queues/broadcast.queue';
import { TranscriptJobData } from '../queues/transcript.queue';
import { sendToDeadLetterQueue } from '../queues/dlq.queue';
import { pipelineMetrics } from '../services/pipeline/metrics';

// ── Configuration ─────────────────────────────────────────────

const TRANSLATION_TIMEOUT_MS = parseInt(process.env.TRANSLATION_TIMEOUT_MS || '15000', 10);
const CIRCUIT_BREAKER_THRESHOLD = parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD || '10', 10);
const CIRCUIT_BREAKER_RESET_MS = parseInt(process.env.CIRCUIT_BREAKER_RESET_MS || '30000', 10);
const MAX_RETRIES = parseInt(process.env.TRANSLATION_MAX_RETRIES || '3', 10);

// ── Circuit Breaker State ─────────────────────────────────────

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
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

class TranslationWorker {
  private worker: Worker<TranscriptJobData> | null = null;
  private isRunning = false;
  private processedCount = 0;
  private failedCount = 0;

  // Circuit breaker per meeting to prevent cascading failures
  private circuitBreakers = new Map<string, CircuitBreakerState>();

  /**
   * Initialize translation worker
   */
  async initialize(): Promise<void> {
    try {
      const redis = createBullMQConnection();

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

      this.worker.on('failed', async (job: Job<TranscriptJobData> | undefined, err: Error) => {
        this.failedCount++;
        if (job) {
          const isLastAttempt = job.attemptsMade >= (job.opts.attempts || MAX_RETRIES);
          
          logger.error(`Translation worker job ${job.id} failed`, {
            jobId: job.id,
            meetingId: job.data.meetingId,
            error: err.message,
            attempt: job.attemptsMade,
            maxAttempts: job.opts.attempts,
            isLastAttempt,
          });

          // Send to DLQ if max retries exceeded
          if (isLastAttempt) {
            await sendToDeadLetterQueue(
              'transcript-processing',
              job.id || 'unknown',
              job.data,
              err.message,
              job.attemptsMade,
              job.opts.attempts || MAX_RETRIES
            );

            // Update circuit breaker
            this.recordFailure(job.data.meetingId);

            // Record metrics
            pipelineMetrics.recordError('translation', job.data.meetingId, err.message);
          }
        } else {
          logger.error('Translation worker job failed', { error: err.message });
        }
      });

      this.worker.on('completed', (job: Job<TranscriptJobData>) => {
        this.processedCount++;
        logger.debug(`Translation worker job ${job.id} completed`, {
          jobId: job.id,
          meetingId: job.data.meetingId,
        });
      });

      logger.info('Translation worker initialized', {
        concurrency: this.worker.opts.concurrency,
        timeout: TRANSLATION_TIMEOUT_MS,
        circuitBreakerThreshold: CIRCUIT_BREAKER_THRESHOLD,
      });
    } catch (err) {
      logger.error('Failed to initialize translation worker', err);
      throw err;
    }
  }

  /**
   * Process a single transcript job with timeout, circuit breaker, and fallback
   */
  private async processTranscript(job: Job<TranscriptJobData>): Promise<void> {
    const startTime = Date.now();
    const { meetingId, speakerId, speakerName, originalText, language, timestamp, isFinal } =
      job.data;

    try {
      // Check circuit breaker
      if (this.isCircuitOpen(meetingId)) {
        logger.warn(`Circuit breaker OPEN for meeting ${meetingId}, using fallback`);
        await this.broadcastFallback(job.data, 'circuit_breaker_open');
        return;
      }

      pipelineMetrics.recordTranslation(meetingId, 'started');

      // Step 1: Translate with timeout
      const translationResult = await withTimeout(
        multilingualTranslationPipeline.translateToParticipants(
          originalText,
          language,
          meetingId
        ),
        TRANSLATION_TIMEOUT_MS,
        'Translation'
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

      // Record success metrics
      const processingTime = Date.now() - startTime;
      pipelineMetrics.recordTranslationLatency(meetingId, processingTime, false);
      pipelineMetrics.recordTranslation(meetingId, 'completed');

      // Reset circuit breaker on success
      this.recordSuccess(meetingId);

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
      const processingTime = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isTimeout = errorMessage.includes('timed out');
      const isLastAttempt = job.attemptsMade >= (job.opts.attempts || MAX_RETRIES) - 1;

      logger.error(`Translation job ${job.id} error`, {
        jobId: job.id,
        meetingId,
        speakerId,
        error: errorMessage,
        isTimeout,
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts,
        processingTimeMs: processingTime,
      });

      // Update circuit breaker
      this.recordFailure(meetingId);

      // On last attempt, use fallback to ensure message delivery
      if (isLastAttempt) {
        logger.warn(`Translation job ${job.id} using fallback on last attempt`);
        await this.broadcastFallback(job.data, errorMessage);
        // Don't throw - we handled it with fallback
        return;
      }

      throw err; // Re-throw to trigger BullMQ retry logic
    }
  }

  /**
   * Fallback: broadcast original text without translation
   */
  private async broadcastFallback(
    data: TranscriptJobData,
    reason: string
  ): Promise<void> {
    try {
      const broadcastData: BroadcastJobData = {
        meetingId: data.meetingId,
        speakerId: data.speakerId,
        speakerName: data.speakerName,
        originalText: data.originalText,
        sourceLanguage: data.language,
        translations: { [data.language]: data.originalText }, // Original only
        timestamp: data.timestamp instanceof Date ? data.timestamp.toISOString() : String(data.timestamp),
        isFinal: data.isFinal,
      };

      await broadcastQueueManager.add(broadcastData);

      logger.warn('Translation fallback: broadcast original text', {
        meetingId: data.meetingId,
        speakerId: data.speakerId,
        reason,
      });
    } catch (fallbackErr) {
      logger.error('Translation fallback also failed', fallbackErr);
    }
  }

  // ── Circuit Breaker Methods ─────────────────────────────────

  private isCircuitOpen(meetingId: string): boolean {
    const state = this.circuitBreakers.get(meetingId);
    if (!state) return false;

    if (!state.isOpen) return false;

    // Check if reset timeout has passed
    if (Date.now() - state.lastFailure > CIRCUIT_BREAKER_RESET_MS) {
      state.isOpen = false;
      state.failures = 0;
      return false;
    }

    return true;
  }

  private recordFailure(meetingId: string): void {
    let state = this.circuitBreakers.get(meetingId);
    if (!state) {
      state = { failures: 0, lastFailure: 0, isOpen: false };
      this.circuitBreakers.set(meetingId, state);
    }

    state.failures++;
    state.lastFailure = Date.now();

    if (state.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      state.isOpen = true;
      logger.warn(`Circuit breaker OPENED for meeting ${meetingId}`, {
        failures: state.failures,
        threshold: CIRCUIT_BREAKER_THRESHOLD,
      });
    }
  }

  private recordSuccess(meetingId: string): void {
    const state = this.circuitBreakers.get(meetingId);
    if (state) {
      state.failures = Math.max(0, state.failures - 1); // Gradual recovery
      if (state.failures === 0) {
        state.isOpen = false;
      }
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
    circuitBreakersOpen: number;
  }> {
    const openBreakers = Array.from(this.circuitBreakers.values()).filter(
      (s) => s.isOpen
    ).length;

    return {
      running: this.isRunning,
      processed: this.processedCount,
      failed: this.failedCount,
      paused: this.worker?.isPaused() || false,
      circuitBreakersOpen: openBreakers,
    };
  }

  /**
   * Clear stale circuit breakers (cleanup)
   */
  cleanupCircuitBreakers(): void {
    const now = Date.now();
    for (const [meetingId, state] of this.circuitBreakers.entries()) {
      if (now - state.lastFailure > CIRCUIT_BREAKER_RESET_MS * 2) {
        this.circuitBreakers.delete(meetingId);
      }
    }
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
