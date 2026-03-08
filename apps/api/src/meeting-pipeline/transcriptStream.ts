// ============================================================
// OrgsLedger — Transcript Stream (Redis BullMQ)
// Single entry point for all transcripts from Deepgram
// Fans out to 4 queues: transcript-events, broadcast-events,
// translation-queue, summary-events
// ============================================================

import { Queue, QueueEvents, Job } from 'bullmq';
import { createBullMQConnection } from '../infrastructure/redisClient';
import { logger } from '../logger';
import { TranscriptSegment } from './types';

// Queue names
const QUEUES = {
  TRANSCRIPT: 'transcript-events',    // Storage worker
  BROADCAST: 'broadcast-events',       // Broadcast worker
  TRANSLATION: 'translation-queue',    // Translation worker
  SUMMARY: 'summary-events',           // Summary worker
};

class TranscriptStream {
  private transcriptQueue: Queue<TranscriptSegment> | null = null;
  private broadcastQueue: Queue<TranscriptSegment> | null = null;
  private translationQueue: Queue<TranscriptSegment> | null = null;
  private summaryQueue: Queue<TranscriptSegment> | null = null;
  private isInitialized = false;
  private submittedCount = 0;

  /**
   * Initialize the transcript stream queue
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      const defaultJobOptions = {
        removeOnComplete: { count: 1000, age: 3600 },
        removeOnFail: { count: 500, age: 7200 },
        attempts: 3,
        backoff: { type: 'exponential' as const, delay: 1000 },
      };

      // Create all 4 queues
      this.transcriptQueue = new Queue<TranscriptSegment>(QUEUES.TRANSCRIPT, {
        connection: createBullMQConnection() as any,
        defaultJobOptions,
      });

      this.broadcastQueue = new Queue<TranscriptSegment>(QUEUES.BROADCAST, {
        connection: createBullMQConnection() as any,
        defaultJobOptions: {
          ...defaultJobOptions,
          attempts: 1, // Real-time, don't retry
        },
      });

      this.translationQueue = new Queue<TranscriptSegment>(QUEUES.TRANSLATION, {
        connection: createBullMQConnection() as any,
        defaultJobOptions,
      });

      this.summaryQueue = new Queue<TranscriptSegment>(QUEUES.SUMMARY, {
        connection: createBullMQConnection() as any,
        defaultJobOptions,
      });

      // Wait for all queues to be ready
      await Promise.all([
        this.transcriptQueue.waitUntilReady(),
        this.broadcastQueue.waitUntilReady(),
        this.translationQueue.waitUntilReady(),
        this.summaryQueue.waitUntilReady(),
      ]);

      this.isInitialized = true;

      logger.info('[TRANSCRIPT_STREAM] Initialized 4 queues', {
        queues: Object.values(QUEUES),
      });
    } catch (err) {
      logger.error('[TRANSCRIPT_STREAM] Failed to initialize', err);
      throw err;
    }
  }

  /**
   * Submit a transcript segment to the stream.
   * This is the SINGLE ENTRY POINT for all transcripts.
   * Fans out to all 4 queues.
   */
  async submit(segment: TranscriptSegment): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.transcriptQueue || !this.broadcastQueue || !this.translationQueue || !this.summaryQueue) {
      throw new Error('Transcript stream not initialized');
    }

    const jobId = `ts:${segment.meetingId}:${segment.segmentIndex}:${Date.now()}`;
    const priority = segment.isFinal ? 1 : 2;
    const jobOpts = { jobId, priority };

    // Fan out to all 4 queues in parallel
    await Promise.all([
      this.transcriptQueue.add('transcript', segment, { ...jobOpts, jobId: `${jobId}:storage` }),
      this.broadcastQueue.add('broadcast', segment, { ...jobOpts, jobId: `${jobId}:broadcast` }),
      this.translationQueue.add('translate', segment, { ...jobOpts, jobId: `${jobId}:translate` }),
      this.summaryQueue.add('summarize', segment, { ...jobOpts, jobId: `${jobId}:summary` }),
    ]);

    this.submittedCount++;

    logger.debug('[TRANSCRIPT_STREAM] Segment submitted to 4 queues', {
      jobId,
      meetingId: segment.meetingId,
      segmentIndex: segment.segmentIndex,
      isFinal: segment.isFinal,
      textLength: segment.text.length,
    });

    return jobId;
  }

  /**
   * Submit multiple segments in bulk (for batching)
   */
  async submitBulk(segments: TranscriptSegment[]): Promise<string[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (!this.transcriptQueue) {
      throw new Error('Transcript stream not initialized');
    }

    const jobIds: string[] = [];

    // Submit each segment to all queues
    for (const segment of segments) {
      const jobId = await this.submit(segment);
      jobIds.push(jobId);
    }

    logger.debug('[TRANSCRIPT_STREAM] Bulk submitted', {
      count: jobIds.length,
      meetingId: segments[0]?.meetingId,
    });

    return jobIds;
  }

  /**
   * Get queue status
   */
  async getStatus(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    if (!this.transcriptQueue) return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };

    // Sum up all queues
    const queues = [this.transcriptQueue, this.broadcastQueue, this.translationQueue, this.summaryQueue];
    let waiting = 0, active = 0, completed = 0, failed = 0, delayed = 0;

    for (const q of queues) {
      if (!q) continue;
      waiting += await q.getWaitingCount();
      active += await q.getActiveCount();
      completed += await q.getCompletedCount();
      failed += await q.getFailedCount();
      delayed += await q.getDelayedCount();
    }

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Get submitted count
   */
  getSubmittedCount(): number {
    return this.submittedCount;
  }

  /**
   * Get the queue instance (for workers to consume)
   */
  getQueue(): Queue<TranscriptSegment> | null {
    return this.transcriptQueue;
  }

  /**
   * Get queue names
   */
  getQueueNames(): typeof QUEUES {
    return QUEUES;
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    const queues = [this.transcriptQueue, this.broadcastQueue, this.translationQueue, this.summaryQueue];
    await Promise.all(queues.filter(q => q).map(q => q!.close()));
    this.isInitialized = false;
    logger.info('[TRANSCRIPT_STREAM] Shut down all queues');
  }
}

// Singleton export (also export class for typing)
export const transcriptStream = new TranscriptStream();
export { TranscriptStream };
