// ============================================================
// OrgsLedger API — Summary Events Queue
// Handles incremental summarization during meetings
// Produces rolling summaries for real-time context
// Part of AI processing path (NOT real-time UX path)
// ============================================================

import { Queue, QueueOptions } from 'bullmq';
import { getRedisClient } from '../infrastructure/redisClient';
import { logger } from '../logger';

// ── Job Data Types ────────────────────────────────────────────

export interface SummaryEventData {
  meetingId: string;
  organizationId: string;

  // Transcript segment to incorporate
  text: string;
  speakerId: string;
  speakerName: string;
  timestamp: string;
  segmentIndex: number;

  // Summary context
  currentSummaryVersion: number;
  totalSegments: number;

  // Processing hints
  priority: 'high' | 'normal' | 'low';
  forceUpdate: boolean; // Force summary regeneration
}

export interface IncrementalSummary {
  meetingId: string;
  version: number;
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  lastSegmentIndex: number;
  updatedAt: string;
}

// ── Queue Configuration ───────────────────────────────────────

const QUEUE_NAME = 'summary-events';

// Summary updates are batched - not every segment triggers update
const SUMMARY_UPDATE_INTERVAL_SEGMENTS = 10; // Update every 10 segments
const SUMMARY_UPDATE_INTERVAL_MS = 30000; // Or every 30 seconds

// ── Queue Manager ─────────────────────────────────────────────

class SummaryEventsQueueManager {
  private queue: Queue<SummaryEventData> | null = null;
  private initialized = false;

  /**
   * Initialize summary events queue
   */
  async initialize(): Promise<Queue<SummaryEventData>> {
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
          },
          removeOnFail: {
            age: 7200, // Keep failed for 2 hours
          },
          // Summary jobs can retry more - not real-time critical
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000, // 5s backoff (AI processing path)
          },
        },
      };

      this.queue = new Queue<SummaryEventData>(QUEUE_NAME, queueOptions);

      this.queue.on('error', (err: Error) => {
        logger.error('[SUMMARY_EVENTS] Queue error', err);
      });

      await this.queue.waitUntilReady();
      this.initialized = true;

      logger.info('[SUMMARY_EVENTS] Queue initialized', {
        name: QUEUE_NAME,
        updateInterval: SUMMARY_UPDATE_INTERVAL_SEGMENTS,
      });

      return this.queue;
    } catch (err) {
      logger.error('[SUMMARY_EVENTS] Failed to initialize', err);
      throw err;
    }
  }

  /**
   * Submit segment for incremental summary update.
   * Note: Not every segment triggers a summary - batching is applied.
   */
  async submit(data: SummaryEventData): Promise<string | null> {
    if (!this.queue) {
      await this.initialize();
    }

    if (!this.queue) {
      throw new Error('Summary events queue not initialized');
    }

    // Apply batching: only process every Nth segment or on force
    const shouldProcess =
      data.forceUpdate ||
      data.segmentIndex % SUMMARY_UPDATE_INTERVAL_SEGMENTS === 0;

    if (!shouldProcess) {
      logger.debug('[SUMMARY_EVENTS] Skipping segment (batching)', {
        meetingId: data.meetingId,
        segmentIndex: data.segmentIndex,
        nextUpdate: SUMMARY_UPDATE_INTERVAL_SEGMENTS - (data.segmentIndex % SUMMARY_UPDATE_INTERVAL_SEGMENTS),
      });
      return null;
    }

    const jobId = `sum:${data.meetingId}:v${data.currentSummaryVersion}:${Date.now()}`;

    // Priority mapping
    const priorityMap = { high: 1, normal: 5, low: 10 };
    const priority = priorityMap[data.priority] || 5;

    const job = await this.queue.add('summary-update', data, {
      jobId,
      priority,
      // Delay to allow more segments to accumulate
      delay: data.forceUpdate ? 0 : 2000, // 2s delay for batching
    });

    logger.debug('[SUMMARY_EVENTS] Summary update queued', {
      jobId: job.id,
      meetingId: data.meetingId,
      segmentIndex: data.segmentIndex,
      version: data.currentSummaryVersion,
    });

    return job.id || jobId;
  }

  /**
   * Force immediate summary update (e.g., for important content)
   */
  async forceUpdate(meetingId: string, organizationId: string): Promise<string> {
    if (!this.queue) {
      await this.initialize();
    }

    if (!this.queue) {
      throw new Error('Summary events queue not initialized');
    }

    const jobId = `sum:${meetingId}:force:${Date.now()}`;

    const job = await this.queue.add(
      'summary-force',
      {
        meetingId,
        organizationId,
        text: '',
        speakerId: 'system',
        speakerName: 'System',
        timestamp: new Date().toISOString(),
        segmentIndex: -1,
        currentSummaryVersion: 0,
        totalSegments: 0,
        priority: 'high',
        forceUpdate: true,
      },
      {
        jobId,
        priority: 1, // Highest priority
      }
    );

    logger.info('[SUMMARY_EVENTS] Forced summary update queued', {
      meetingId,
      jobId: job.id,
    });

    return job.id || jobId;
  }

  /**
   * Get queue for direct access
   */
  getQueue(): Queue<SummaryEventData> | null {
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
    logger.info('[SUMMARY_EVENTS] Queue shut down');
  }
}

// ── Constants Export ──────────────────────────────────────────

export const SUMMARY_CONFIG = {
  UPDATE_INTERVAL_SEGMENTS: SUMMARY_UPDATE_INTERVAL_SEGMENTS,
  UPDATE_INTERVAL_MS: SUMMARY_UPDATE_INTERVAL_MS,
};

// ── Singleton Export ──────────────────────────────────────────

export const summaryEventsQueue = new SummaryEventsQueueManager();

export async function initializeSummaryEventsQueue(): Promise<Queue<SummaryEventData>> {
  return summaryEventsQueue.initialize();
}

export function getSummaryEventsQueue(): SummaryEventsQueueManager {
  return summaryEventsQueue;
}
