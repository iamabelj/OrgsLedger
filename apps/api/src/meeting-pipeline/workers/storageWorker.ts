// ============================================================
// OrgsLedger — Storage Worker
// Consumes transcript-events, persists to PostgreSQL
// Batches writes for efficiency
// ============================================================

import { Worker, Job } from 'bullmq';
import { createBullMQConnection } from '../../infrastructure/redisClient';
import { logger } from '../../logger';
import { TranscriptSegment } from '../types';
import { meetingStateManager } from '../meetingState';
import { db } from '../../db';

const QUEUE_NAME = 'transcript-events';
const WORKER_NAME = 'storage-worker';
const CONCURRENCY = 5;
const BATCH_SIZE = 50;
const BATCH_TIMEOUT_MS = 2000;

interface BatchBuffer {
  segments: TranscriptSegment[];
  timer: NodeJS.Timeout | null;
}

class StorageWorkerManager {
  private worker: Worker<TranscriptSegment> | null = null;
  private isRunning = false;
  private storedCount = 0;
  private batchedCount = 0;

  // Cache meetingId -> organizationId to avoid repeated lookups on every flush
  private orgIdCache = new Map<string, string>();

  // Buffer for batching writes by meeting
  private buffers = new Map<string, BatchBuffer>();

  /**
   * Initialize the storage worker
   */
  async initialize(): Promise<void> {
    if (this.worker) {
      logger.warn('[STORAGE_WORKER] Already initialized');
      return;
    }

    try {
      const redis = createBullMQConnection();

      this.worker = new Worker<TranscriptSegment>(
        QUEUE_NAME,
        async (job: Job<TranscriptSegment>) => {
          await this.processSegment(job.data);
        },
        {
          connection: redis as any,
          concurrency: CONCURRENCY,
          name: WORKER_NAME,
          lockDuration: 30000,
          lockRenewTime: 15000,
        }
      );

      this.worker.on('ready', () => {
        this.isRunning = true;
        logger.info('[STORAGE_WORKER] Ready', { concurrency: CONCURRENCY });
      });

      this.worker.on('error', (err) => {
        logger.error('[STORAGE_WORKER] Error', err);
      });

      // Periodic flush of all buffers
      setInterval(() => this.flushAllBuffers(), BATCH_TIMEOUT_MS);

      logger.info('[STORAGE_WORKER] Initialized');
    } catch (err) {
      logger.error('[STORAGE_WORKER] Failed to initialize', err);
      throw err;
    }
  }

  /**
   * Process a transcript segment
   */
  private async processSegment(segment: TranscriptSegment): Promise<void> {
    // Only store final segments
    if (!segment.isFinal) return;

    // Store in meeting state for minutes generation
    await meetingStateManager.storeSegment(segment);

    // If an upstream layer already persisted this transcript to PostgreSQL,
    // skip DB insert here to avoid duplicate rows.
    if (segment.alreadyPersisted) return;

    // Add to batch buffer
    let buffer = this.buffers.get(segment.meetingId);
    if (!buffer) {
      buffer = { segments: [], timer: null };
      this.buffers.set(segment.meetingId, buffer);
    }

    buffer.segments.push(segment);

    // Flush if buffer is full
    if (buffer.segments.length >= BATCH_SIZE) {
      await this.flushBuffer(segment.meetingId);
    } else if (!buffer.timer) {
      // Set timer for timeout-based flush
      buffer.timer = setTimeout(() => {
        this.flushBuffer(segment.meetingId).catch((err) => {
          logger.error('[STORAGE_WORKER] Flush error', err);
        });
      }, BATCH_TIMEOUT_MS);
    }
  }

  /**
   * Flush buffer for a specific meeting
   */
  private async flushBuffer(meetingId: string): Promise<void> {
    const buffer = this.buffers.get(meetingId);
    if (!buffer || buffer.segments.length === 0) return;

    // Clear timer
    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }

    // Extract segments to persist
    const segments = [...buffer.segments];
    buffer.segments = [];

    try {
      const organizationId = await this.resolveOrganizationId(meetingId, segments);
      if (!organizationId) {
        throw new Error('Missing organization_id for meeting transcripts insert');
      }

      // Build records for batch insert
      const records = segments.map((s) => ({
        meeting_id: s.meetingId,
        organization_id: organizationId,
        speaker_id: s.speakerId || null,
        speaker_name: s.speakerName || 'Unknown',
        original_text: s.text,
        source_lang: s.language || 'en',
        translations: JSON.stringify({}),
        spoken_at: s.startTime || Date.parse(s.timestamp) || Date.now(),
      }));

      // Batch insert (no conflict handling - spoken_at is not unique)
      await db('meeting_transcripts')
        .insert(records);

      this.storedCount += segments.length;
      this.batchedCount++;

      logger.debug('[STORAGE_WORKER] Batch persisted', {
        meetingId,
        count: segments.length,
        totalStored: this.storedCount,
      });
    } catch (err) {
      // Re-add segments for retry
      buffer.segments.unshift(...segments);
      logger.error('[STORAGE_WORKER] Batch insert failed', {
        meetingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async resolveOrganizationId(
    meetingId: string,
    segments: TranscriptSegment[]
  ): Promise<string | null> {
    // 1) Segment-provided orgId (preferred)
    for (const s of segments) {
      if (s.organizationId && String(s.organizationId).trim().length > 0) {
        const orgId = String(s.organizationId).trim();
        this.orgIdCache.set(meetingId, orgId);
        return orgId;
      }
    }

    // 2) Cache
    const cached = this.orgIdCache.get(meetingId);
    if (cached) return cached;

    // 3) Redis meeting state
    try {
      const state = await meetingStateManager.getMeeting(meetingId);
      const orgId = state?.organizationId?.trim();
      if (orgId) {
        this.orgIdCache.set(meetingId, orgId);
        return orgId;
      }
    } catch (err) {
      logger.warn('[STORAGE_WORKER] Failed to resolve orgId from meeting state', {
        meetingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 4) DB fallback
    try {
      const meeting = await db('meetings').where({ id: meetingId }).select('organization_id').first();
      const orgId = meeting?.organization_id ? String(meeting.organization_id).trim() : '';
      if (orgId) {
        this.orgIdCache.set(meetingId, orgId);
        return orgId;
      }
    } catch (err) {
      logger.warn('[STORAGE_WORKER] Failed to resolve orgId from DB', {
        meetingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return null;
  }

  /**
   * Flush all buffers (called periodically)
   */
  private async flushAllBuffers(): Promise<void> {
    for (const meetingId of this.buffers.keys()) {
      await this.flushBuffer(meetingId);
    }
  }

  /**
   * Get worker status
   */
  getStatus(): {
    running: boolean;
    storedCount: number;
    batchedCount: number;
    pendingBuffers: number;
  } {
    let pending = 0;
    for (const buf of this.buffers.values()) {
      pending += buf.segments.length;
    }
    return {
      running: this.isRunning,
      storedCount: this.storedCount,
      batchedCount: this.batchedCount,
      pendingBuffers: pending,
    };
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    // Flush remaining buffers
    await this.flushAllBuffers();

    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    this.isRunning = false;
    logger.info('[STORAGE_WORKER] Shut down');
  }
}

export const storageWorkerManager = new StorageWorkerManager();
