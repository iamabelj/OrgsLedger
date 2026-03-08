// ============================================================
// OrgsLedger API — Broadcast Worker (Real-Time UX Path)
// Emits Socket.IO events for live captions
// TWO PATHS:
//   1. REAL-TIME PATH: Captions from transcript-events (50-120ms)
//   2. AI PATH: Translations from broadcast-events (async)
// The real-time UX path ≠ AI processing path
// ============================================================

import { Worker, Job } from 'bullmq';
import { Server as SocketIOServer } from 'socket.io';
import { createBullMQConnection } from '../infrastructure/redisClient';
import { logger } from '../logger';
import { BroadcastJobData } from '../queues/broadcast.queue';
import { TranscriptEventData } from '../queues/transcriptEvents.queue';

// ── Configuration ─────────────────────────────────────────────

const REALTIME_CONCURRENCY = parseInt(process.env.BROADCAST_REALTIME_CONCURRENCY || '50', 10);
const TRANSLATION_CONCURRENCY = parseInt(process.env.BROADCAST_TRANSLATION_CONCURRENCY || '20', 10);
const LATENCY_THRESHOLD_MS = 120; // Target: 50-120ms

// ── Worker Class ──────────────────────────────────────────────

class BroadcastWorker {
  private realtimeWorker: Worker<TranscriptEventData> | null = null;
  private translationWorker: Worker<BroadcastJobData> | null = null;
  private ioServer: SocketIOServer | null = null;
  private isRunning = false;
  private realtimeBroadcasts = 0;
  private translationBroadcasts = 0;
  private latencySum = 0;
  private latencyCount = 0;

  /**
   * Initialize BOTH real-time and translation broadcast workers
   */
  async initialize(ioServer: SocketIOServer): Promise<void> {
    try {
      this.ioServer = ioServer;
      const redis = createBullMQConnection();

      // ── REAL-TIME PATH: Captions directly from transcript-events ──
      // This path is FAST (50-120ms) and does NOT wait for translation
      this.realtimeWorker = new Worker<TranscriptEventData>(
        'transcript-events',
        async (job: Job<TranscriptEventData>) => {
          return this.broadcastCaption(job);
        },
        {
          connection: redis as any,
          concurrency: REALTIME_CONCURRENCY, // High concurrency for real-time
          maxStalledCount: 1,
          stalledInterval: 2000,
          lockDuration: 5000, // Short lock for speed
          lockRenewTime: 2000,
          name: 'broadcast-realtime', // Distinguish from other transcript-events consumers
        }
      );

      // ── AI PATH: Translations from broadcast-events ──
      // This path delivers translations AFTER AI processing
      this.translationWorker = new Worker<BroadcastJobData>(
        'broadcast-events',
        async (job: Job<BroadcastJobData>) => {
          return this.broadcastTranslation(job);
        },
        {
          connection: redis as any,
          concurrency: TRANSLATION_CONCURRENCY,
          maxStalledCount: 2,
          stalledInterval: 5000,
          lockDuration: 10000,
          lockRenewTime: 5000,
        }
      );

      // Setup event handlers for real-time worker
      this.realtimeWorker.on('ready', () => {
        logger.info('[BROADCAST] Real-time caption worker ready', {
          concurrency: REALTIME_CONCURRENCY,
        });
      });

      this.realtimeWorker.on('error', (err: Error) => {
        logger.error('[BROADCAST] Real-time worker error', err);
      });

      // Setup event handlers for translation worker
      this.translationWorker.on('ready', () => {
        logger.info('[BROADCAST] Translation broadcast worker ready', {
          concurrency: TRANSLATION_CONCURRENCY,
        });
        this.isRunning = true;
      });

      this.translationWorker.on('error', (err: Error) => {
        logger.error('[BROADCAST] Translation worker error', err);
      });

      logger.info('[BROADCAST] Workers initialized', {
        realtimeConcurrency: REALTIME_CONCURRENCY,
        translationConcurrency: TRANSLATION_CONCURRENCY,
        latencyTarget: `${LATENCY_THRESHOLD_MS}ms`,
      });
    } catch (err) {
      logger.error('[BROADCAST] Failed to initialize', err);
      throw err;
    }
  }

  /**
   * REAL-TIME PATH: Broadcast caption immediately (no translation)
   * Target latency: 50-120ms from speech to caption
   */
  private async broadcastCaption(job: Job<TranscriptEventData>): Promise<void> {
    const startTime = Date.now();
    const data = job.data;

    try {
      if (!this.ioServer) {
        throw new Error('Socket.IO server not initialized');
      }

      // Event name based on final/interim
      const eventName = data.isFinal ? 'caption:final' : 'caption:interim';

      // Build caption payload (original language only - no translation wait)
      const payload = {
        speakerId: data.speakerId,
        speakerName: data.speakerName,
        text: data.text,
        language: data.language,
        timestamp: data.timestamp,
        segmentIndex: data.segmentIndex,
        isFinal: data.isFinal,
      };

      // Broadcast to meeting room
      this.ioServer.to(`meeting:${data.meetingId}`).emit(eventName, payload);

      // Track latency
      const broadcastLatency = Date.now() - startTime;
      const totalLatency = Date.now() - new Date(data.timestamp).getTime();

      this.realtimeBroadcasts++;
      this.latencySum += totalLatency;
      this.latencyCount++;

      // Log if exceeding target
      if (totalLatency > LATENCY_THRESHOLD_MS) {
        logger.warn('[BROADCAST] Caption latency exceeded target', {
          meetingId: data.meetingId,
          latencyMs: totalLatency,
          target: LATENCY_THRESHOLD_MS,
          broadcastMs: broadcastLatency,
        });
      }

      logger.debug('[BROADCAST] Caption sent', {
        meetingId: data.meetingId,
        eventName,
        latencyMs: totalLatency,
        textLength: data.text.length,
      });
    } catch (err) {
      logger.error('[BROADCAST] Caption broadcast failed', {
        meetingId: data.meetingId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * AI PATH: Broadcast translation (async, after AI processing)
   */
  private async broadcastTranslation(job: Job<BroadcastJobData>): Promise<void> {
    const startTime = Date.now();
    const data = job.data;

    try {
      if (!this.ioServer) {
        throw new Error('Socket.IO server not initialized');
      }

      const eventName = data.isFinal ? 'translation:result' : 'translation:interim';

      const payload = {
        speakerId: data.speakerId,
        speakerName: data.speakerName,
        originalText: data.originalText,
        sourceLanguage: data.sourceLanguage,
        translations: data.translations,
        timestamp: data.timestamp,
        isFinal: data.isFinal,
      };

      this.ioServer.to(`meeting:${data.meetingId}`).emit(eventName, payload);

      // Emit storage event for final transcripts
      if (data.isFinal) {
        this.ioServer.to(`meeting:${data.meetingId}`).emit('transcript:stored', {
          meetingId: data.meetingId,
          speakerId: data.speakerId,
          timestamp: data.timestamp,
        });
      }

      this.translationBroadcasts++;

      const broadcastMs = Date.now() - startTime;

      logger.debug('[BROADCAST] Translation sent', {
        meetingId: data.meetingId,
        eventName,
        languages: Object.keys(data.translations).length,
        broadcastMs,
      });
    } catch (err) {
      logger.error('[BROADCAST] Translation broadcast failed', {
        meetingId: data.meetingId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Get worker status with latency metrics
   */
  async getStatus(): Promise<{
    running: boolean;
    processed: number;
    failed: number;
    paused: boolean;
    realtimeBroadcasts: number;
    translationBroadcasts: number;
    avgLatencyMs: number;
  }> {
    const avgLatency = this.latencyCount > 0
      ? Math.round(this.latencySum / this.latencyCount)
      : 0;

    return {
      running: this.isRunning,
      processed: this.realtimeBroadcasts + this.translationBroadcasts,
      failed: 0,
      paused: (this.realtimeWorker?.isPaused() || false) && (this.translationWorker?.isPaused() || false),
      realtimeBroadcasts: this.realtimeBroadcasts,
      translationBroadcasts: this.translationBroadcasts,
      avgLatencyMs: avgLatency,
    };
  }

  /**
   * Pause both workers
   */
  async pause(): Promise<void> {
    try {
      await Promise.all([
        this.realtimeWorker?.pause(),
        this.translationWorker?.pause(),
      ]);
      logger.info('[BROADCAST] Workers paused');
    } catch (err) {
      logger.error('[BROADCAST] Failed to pause', err);
    }
  }

  /**
   * Resume both workers
   */
  async resume(): Promise<void> {
    try {
      await Promise.all([
        this.realtimeWorker?.resume(),
        this.translationWorker?.resume(),
      ]);
      logger.info('[BROADCAST] Workers resumed');
    } catch (err) {
      logger.error('[BROADCAST] Failed to resume', err);
    }
  }

  /**
   * Close both workers gracefully
   */
  async close(): Promise<void> {
    try {
      await Promise.all([
        this.realtimeWorker?.close(),
        this.translationWorker?.close(),
      ]);
      this.realtimeWorker = null;
      this.translationWorker = null;
      this.isRunning = false;
      logger.info('[BROADCAST] Workers closed', {
        realtimeBroadcasts: this.realtimeBroadcasts,
        translationBroadcasts: this.translationBroadcasts,
      });
    } catch (err) {
      logger.error('[BROADCAST] Error closing workers', err);
    }
  }

  /**
   * Check if workers are healthy
   */
  isHealthy(): boolean {
    return this.isRunning && this.ioServer !== null;
  }
}

// Export singleton instance
export const broadcastWorker = new BroadcastWorker();

/**
 * Initialize and start broadcast worker
 */
export async function startBroadcastWorker(ioServer: SocketIOServer): Promise<void> {
  await broadcastWorker.initialize(ioServer);
}

/**
 * Gracefully shutdown broadcast worker
 */
export async function stopBroadcastWorker(): Promise<void> {
  await broadcastWorker.close();
}
