// ============================================================
// OrgsLedger — Broadcast Worker
// Consumes transcript-events, emits to WebSocket clients
// Real-time captions path (50-120ms target latency)
// ============================================================

import { Worker, Job } from 'bullmq';
import { Server as SocketIOServer } from 'socket.io';
import { createBullMQConnection } from '../../infrastructure/redisClient';
import { logger } from '../../logger';
import { TranscriptSegment, BroadcastPayload } from '../types';

const QUEUE_NAME = 'broadcast-events';
const WORKER_NAME = 'broadcast-worker';
const CONCURRENCY = 50; // High concurrency for real-time

class BroadcastWorkerManager {
  private worker: Worker<TranscriptSegment> | null = null;
  private ioServer: SocketIOServer | null = null;
  private isRunning = false;
  private broadcastCount = 0;
  private latencySum = 0;

  /**
   * Initialize the broadcast worker
   */
  async initialize(ioServer: SocketIOServer): Promise<void> {
    if (this.worker) {
      logger.warn('[BROADCAST_WORKER] Already initialized');
      return;
    }

    try {
      this.ioServer = ioServer;
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
          lockDuration: 5000, // Short lock for real-time
          lockRenewTime: 2000,
          maxStalledCount: 1,
        }
      );

      this.worker.on('ready', () => {
        this.isRunning = true;
        logger.info('[BROADCAST_WORKER] Ready', { concurrency: CONCURRENCY });
      });

      this.worker.on('error', (err) => {
        logger.error('[BROADCAST_WORKER] Error', err);
      });

      this.worker.on('failed', (job, err) => {
        logger.warn('[BROADCAST_WORKER] Job failed', {
          jobId: job?.id,
          error: err.message,
        });
      });

      logger.info('[BROADCAST_WORKER] Initialized');
    } catch (err) {
      logger.error('[BROADCAST_WORKER] Failed to initialize', err);
      throw err;
    }
  }

  /**
   * Process a transcript segment
   */
  private async processSegment(segment: TranscriptSegment): Promise<void> {
    const startTime = Date.now();

    try {
      if (!this.ioServer) {
        throw new Error('Socket.IO server not available');
      }

      // Build broadcast payload
      const payload: BroadcastPayload = {
        type: 'caption',
        meetingId: segment.meetingId,
        speakerId: segment.speakerId,
        speakerName: segment.speakerName,
        text: segment.text,
        language: segment.language,
        isFinal: segment.isFinal,
        timestamp: segment.timestamp,
      };

      // Emit to meeting room
      const eventName = segment.isFinal ? 'caption:final' : 'caption:interim';
      this.ioServer.to(`meeting:${segment.meetingId}`).emit(eventName, payload);

      // Track metrics
      const latency = Date.now() - startTime;
      this.broadcastCount++;
      this.latencySum += latency;

      // Warn if latency exceeds target
      if (latency > 100) {
        logger.warn('[BROADCAST_WORKER] High latency', {
          meetingId: segment.meetingId,
          latencyMs: latency,
        });
      }

      logger.debug('[BROADCAST_WORKER] Broadcast sent', {
        meetingId: segment.meetingId,
        eventName,
        latencyMs: latency,
      });
    } catch (err) {
      logger.error('[BROADCAST_WORKER] Failed to broadcast', {
        meetingId: segment.meetingId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Broadcast translation results (called from translation worker)
   */
  broadcastTranslation(
    meetingId: string,
    speakerId: string,
    speakerName: string,
    originalText: string,
    sourceLang: string,
    translations: Record<string, string>,
    timestamp: number,
    isFinal: boolean
  ): void {
    if (!this.ioServer) return;

    // Match client expectations (web + Flutter):
    // { meetingId, speakerId, speakerName, originalText, sourceLang, translations, timestamp }
    this.ioServer.to(`meeting:${meetingId}`).emit('translation:result', {
      meetingId,
      speakerId,
      speakerName,
      originalText,
      sourceLang,
      translations,
      isFinal,
      timestamp,
    });
    logger.debug('[BROADCAST_WORKER] Translation broadcast', { meetingId });
  }

  /**
   * Broadcast summary update
   */
  broadcastSummary(
    meetingId: string,
    summary: { summary: string; keyPoints: string[]; actionItems: string[] }
  ): void {
    if (!this.ioServer) return;

    const payload: BroadcastPayload = {
      type: 'summary',
      meetingId,
      summary: {
        meetingId,
        ...summary,
        lastSegmentIndex: 0,
        version: 0,
        updatedAt: new Date().toISOString(),
      },
      isFinal: false,
      timestamp: new Date().toISOString(),
    };

    this.ioServer.to(`meeting:${meetingId}`).emit('summary:update', payload);
    logger.debug('[BROADCAST_WORKER] Summary broadcast', { meetingId });
  }

  /**
   * Get worker status
   */
  getStatus(): { running: boolean; broadcastCount: number; avgLatencyMs: number } {
    return {
      running: this.isRunning,
      broadcastCount: this.broadcastCount,
      avgLatencyMs: this.broadcastCount > 0
        ? Math.round(this.latencySum / this.broadcastCount)
        : 0,
    };
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    this.isRunning = false;
    logger.info('[BROADCAST_WORKER] Shut down');
  }
}

export const broadcastWorkerManager = new BroadcastWorkerManager();
