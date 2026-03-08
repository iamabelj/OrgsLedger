// ============================================================
// OrgsLedger API — Transcript Events Queue (Fan-Out Source)
// Primary queue receiving all transcript segments from Deepgram
// Fans out to: Broadcast, Translation, Storage, Summary workers
// Optimized for 50K+ concurrent meetings, <50ms queue latency
// ============================================================

import { Queue, QueueEvents, QueueOptions } from 'bullmq';
import { getRedisClient } from '../infrastructure/redisClient';
import { logger } from '../logger';

// ── Job Data Types ────────────────────────────────────────────

export interface TranscriptEventData {
  // Core identification
  meetingId: string;
  organizationId: string;
  speakerId: string;
  speakerName: string;

  // Transcript content
  text: string;
  language: string;
  confidence: number;

  // Timing
  timestamp: string;
  startTime: number; // ms offset from meeting start
  endTime: number;

  // State
  isFinal: boolean;
  segmentIndex: number;

  // Routing hints (pre-computed for fast fan-out)
  targetLanguages: string[];
  requiresTranslation: boolean;
  requiresSummary: boolean;
}

// ── Queue Configuration ───────────────────────────────────────

const QUEUE_NAME = 'transcript-events';
const REALTIME_PRIORITY = 1; // Highest priority for real-time path
const AI_PRIORITY = 5; // Lower priority for AI processing

// ── Queue Manager ─────────────────────────────────────────────

class TranscriptEventsQueueManager {
  private queue: Queue<TranscriptEventData> | null = null;
  private queueEvents: QueueEvents | null = null;
  private initialized = false;

  /**
   * Initialize transcript events queue with real-time optimizations
   */
  async initialize(): Promise<Queue<TranscriptEventData>> {
    if (this.queue) {
      return this.queue;
    }

    try {
      const redis = await getRedisClient();

      const queueOptions: QueueOptions = {
        connection: redis as any,
        defaultJobOptions: {
          // Real-time: remove completed jobs immediately
          removeOnComplete: true,
          removeOnFail: {
            age: 3600, // Keep failed for 1 hour for debugging
            count: 1000, // Max 1000 failed jobs
          },
          // Fast retry for real-time path
          attempts: 2,
          backoff: {
            type: 'fixed',
            delay: 100, // 100ms fixed backoff (not exponential for real-time)
          },
        },
      };

      this.queue = new Queue<TranscriptEventData>(QUEUE_NAME, queueOptions);

      // Queue events for monitoring fan-out
      this.queueEvents = new QueueEvents(QUEUE_NAME, {
        connection: redis as any,
      });

      this.queue.on('error', (err: Error) => {
        logger.error('[TRANSCRIPT_EVENTS] Queue error', err);
      });

      await this.queue.waitUntilReady();
      this.initialized = true;

      logger.info('[TRANSCRIPT_EVENTS] Queue initialized', {
        name: QUEUE_NAME,
        optimizations: 'real-time-fan-out',
      });

      return this.queue;
    } catch (err) {
      logger.error('[TRANSCRIPT_EVENTS] Failed to initialize', err);
      throw err;
    }
  }

  /**
   * Submit transcript event for fan-out processing.
   * This is the ENTRY POINT for all transcripts from Deepgram.
   */
  async submit(data: TranscriptEventData): Promise<string> {
    const startTime = Date.now();

    try {
      if (!this.queue) {
        await this.initialize();
      }

      if (!this.queue) {
        throw new Error('Transcript events queue not initialized');
      }

      // Generate unique job ID for tracing
      const jobId = `te:${data.meetingId}:${data.segmentIndex}:${Date.now()}`;

      // Real-time events get highest priority
      const priority = data.isFinal ? REALTIME_PRIORITY : REALTIME_PRIORITY + 1;

      const job = await this.queue.add('transcript', data, {
        jobId,
        priority,
        // Delay only for non-final (interim) transcripts to batch them
        delay: data.isFinal ? 0 : 50, // 50ms delay for interim to allow batching
      });

      const queueLatency = Date.now() - startTime;

      logger.debug('[TRANSCRIPT_EVENTS] Event submitted', {
        jobId: job.id,
        meetingId: data.meetingId,
        queueLatencyMs: queueLatency,
        isFinal: data.isFinal,
        textLength: data.text.length,
      });

      // Warn if queue latency exceeds target
      if (queueLatency > 20) {
        logger.warn('[TRANSCRIPT_EVENTS] Queue latency exceeded 20ms', {
          latencyMs: queueLatency,
          meetingId: data.meetingId,
        });
      }

      return job.id || jobId;
    } catch (err) {
      logger.error('[TRANSCRIPT_EVENTS] Failed to submit', err);
      throw err;
    }
  }

  /**
   * Bulk submit for high-throughput scenarios
   */
  async submitBulk(events: TranscriptEventData[]): Promise<string[]> {
    if (!this.queue) {
      await this.initialize();
    }

    if (!this.queue) {
      throw new Error('Transcript events queue not initialized');
    }

    const jobs = events.map((data, idx) => ({
      name: 'transcript',
      data,
      opts: {
        jobId: `te:${data.meetingId}:${data.segmentIndex}:${Date.now()}:${idx}`,
        priority: data.isFinal ? REALTIME_PRIORITY : REALTIME_PRIORITY + 1,
      },
    }));

    const results = await this.queue.addBulk(jobs);

    logger.debug('[TRANSCRIPT_EVENTS] Bulk submitted', {
      count: events.length,
    });

    return results.map((r) => r.id || 'unknown');
  }

  /**
   * Get queue for direct access (workers)
   */
  getQueue(): Queue<TranscriptEventData> | null {
    return this.queue;
  }

  /**
   * Get queue events for monitoring
   */
  getQueueEvents(): QueueEvents | null {
    return this.queueEvents;
  }

  /**
   * Check initialization status
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get queue status metrics
   */
  async getStatus(): Promise<{
    size: number;
    activeCount: number;
    waitingCount: number;
    failedCount: number;
    delayedCount: number;
    throughput: number;
  }> {
    if (!this.queue) {
      return { size: 0, activeCount: 0, waitingCount: 0, failedCount: 0, delayedCount: 0, throughput: 0 };
    }

    const [size, activeCount, waitingCount, failedCount, delayedCount] = await Promise.all([
      this.queue.count(),
      this.queue.getActiveCount(),
      this.queue.getWaitingCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);

    // Estimate throughput (jobs per second)
    const throughput = activeCount * 10; // Rough estimate

    return { size, activeCount, waitingCount, failedCount, delayedCount, throughput };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.queueEvents) {
      await this.queueEvents.close();
    }
    if (this.queue) {
      await this.queue.close();
    }
    logger.info('[TRANSCRIPT_EVENTS] Queue shut down');
  }
}

// ── Singleton Export ──────────────────────────────────────────

export const transcriptEventsQueue = new TranscriptEventsQueueManager();

export async function initializeTranscriptEventsQueue(): Promise<Queue<TranscriptEventData>> {
  return transcriptEventsQueue.initialize();
}

export function getTranscriptEventsQueue(): TranscriptEventsQueueManager {
  return transcriptEventsQueue;
}
