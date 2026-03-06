// ============================================================
// OrgsLedger API — Broadcast Worker
// Emits Socket.IO events from broadcast queue
// Ensures non-blocking broadcasting with retry support
// ============================================================

import { Worker, Job } from 'bullmq';
import { Server as SocketIOServer } from 'socket.io';
import { createBullMQConnection } from '../infrastructure/redisClient';
import { logger } from '../logger';
import { BroadcastJobData } from '../queues/broadcast.queue';

class BroadcastWorker {
  private worker: Worker<BroadcastJobData> | null = null;
  private ioServer: SocketIOServer | null = null;
  private isRunning = false;

  /**
   * Initialize broadcast worker with Socket.IO server
   */
  async initialize(ioServer: SocketIOServer): Promise<void> {
    try {
      this.ioServer = ioServer;
      const redis = createBullMQConnection();

      this.worker = new Worker<BroadcastJobData>(
        'broadcast-events',
        async (job: Job<BroadcastJobData>) => {
          return this.broadcastEvent(job);
        },
        {
          connection: redis as any,
          concurrency: parseInt(process.env.BROADCAST_WORKER_CONCURRENCY || '20', 10),
          maxStalledCount: 2,
          stalledInterval: 5000,
          lockDuration: 10000, // Shorter lock for broadcasts
          lockRenewTime: 5000,
        }
      );

      // Setup event handlers
      this.worker.on('ready', () => {
        logger.info('Broadcast worker ready');
        this.isRunning = true;
      });

      this.worker.on('error', (err: Error) => {
        logger.error('Broadcast worker error', err);
      });

      this.worker.on('failed', (job: Job<BroadcastJobData> | undefined, err: Error) => {
        logger.warn(`Broadcast job ${job?.id} failed after max retries`, {
          jobId: job?.id,
          meetingId: job?.data.meetingId,
          error: err.message,
        });
      });

      this.worker.on('completed', (job: Job<BroadcastJobData>) => {
        logger.debug(`Broadcast job ${job.id} completed`, {
          jobId: job.id,
          meetingId: job.data.meetingId,
        });
      });

      logger.info('Broadcast worker initialized', {
        concurrency: this.worker.opts.concurrency,
      });
    } catch (err) {
      logger.error('Failed to initialize broadcast worker', err);
      throw err;
    }
  }

  /**
   * Process a single broadcast job
   */
  private async broadcastEvent(job: Job<BroadcastJobData>): Promise<void> {
    const startTime = Date.now();
    const { meetingId, isFinal, speakerId, originalText } = job.data;

    try {
      if (!this.ioServer) {
        throw new Error('Socket.IO server not initialized');
      }

      // Determine which event to emit
      const eventName = isFinal ? 'translation:result' : 'translation:interim';

      // Build payload (matches existing Socket.IO event structure)
      const payload = {
        speakerId: job.data.speakerId,
        speakerName: job.data.speakerName,
        originalText: job.data.originalText,
        sourceLanguage: job.data.sourceLanguage,
        translations: job.data.translations,
        timestamp: job.data.timestamp,
      };

      // Broadcast to all clients in the meeting room
      this.ioServer.to(meetingId).emit(eventName, payload);

      // Additional event for transcript stored (only on final)
      if (isFinal) {
        this.ioServer.to(meetingId).emit('transcript:stored', {
          meetingId,
          speakerId,
          timestamp: job.data.timestamp,
        });
      }

      const broadcastTime = Date.now() - startTime;

      logger.debug('Socket.IO event broadcasted', {
        jobId: job.id,
        meetingId,
        eventName,
        speakerId,
        textLength: originalText.length,
        recipients: `meeting:${meetingId}`,
        broadcastTimeMs: broadcastTime,
      });

      // Track broadcast latency
      if (job.data.timestamp) {
        const latencyMs = Date.now() - new Date(job.data.timestamp).getTime();
        if (latencyMs > 2000) {
          logger.warn('High broadcast latency detected', {
            jobId: job.id,
            meetingId,
            latencyMs,
            threshold: 2000,
          });
        }
      }
    } catch (err) {
      logger.error(`Broadcast job ${job.id} error`, {
        jobId: job.id,
        meetingId,
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
   * Pause worker
   */
  async pause(): Promise<void> {
    try {
      if (this.worker) {
        await this.worker.pause();
        logger.info('Broadcast worker paused');
      }
    } catch (err) {
      logger.error('Failed to pause broadcast worker', err);
    }
  }

  /**
   * Resume worker
   */
  async resume(): Promise<void> {
    try {
      if (this.worker) {
        await this.worker.resume();
        logger.info('Broadcast worker resumed');
      }
    } catch (err) {
      logger.error('Failed to resume broadcast worker', err);
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
        logger.info('Broadcast worker closed');
      }
    } catch (err) {
      logger.error('Error closing broadcast worker', err);
    }
  }

  /**
   * Check if worker is healthy
   */
  isHealthy(): boolean {
    return this.isRunning && this.worker !== null && this.ioServer !== null;
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
