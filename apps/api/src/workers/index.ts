// ============================================================
// OrgsLedger API — Worker Initialization Module
// Centralized startup/shutdown for all BullMQ workers
// Supports graceful shutdown and health monitoring
// ============================================================

import { Server as SocketIOServer } from 'socket.io';
import { logger } from '../logger';
import { translationWorker } from './translation.worker';
import { broadcastWorker } from './broadcast.worker';
import { getMinutesWorker, startMinutesWorker, stopMinutesWorker } from './minutes.worker';
import { processingWorker } from './processing.worker';
import { getNotificationWorker, startNotificationWorker, stopNotificationWorker } from './notification.worker';
import { getEmailWorker, startEmailWorker, stopEmailWorker } from './email.worker';
import { getAuditWorker, startAuditWorker, stopAuditWorker } from './audit.worker';
import { MinutesWorkerService } from '../services/workers/minutesWorker.service';
import { ProcessingWorkerService } from '../services/workers/processingWorker.service';
import { pipelineOrchestrator, pipelineMetrics } from '../services/pipeline';
import { initializeDeadLetterQueue } from '../queues/dlq.queue';
import { transcriptQueueManager } from '../queues/transcript.queue';
import { processingQueueManager } from '../queues/processing.queue';
import { broadcastQueueManager } from '../queues/broadcast.queue';
import { getMinutesQueueManager, initializeMinutesQueue } from '../queues/minutes.queue';

// ── Worker Status Types ───────────────────────────────────────

export interface WorkerStatus {
  name: string;
  running: boolean;
  processed: number;
  failed: number;
  paused: boolean;
  healthy: boolean;
}

export interface WorkerManagerStatus {
  initialized: boolean;
  workers: WorkerStatus[];
  queues: {
    name: string;
    size: number;
    active: number;
    waiting: number;
    failed: number;
  }[];
  metrics: ReturnType<typeof pipelineMetrics.getMetrics>;
}

// ── Worker Manager ────────────────────────────────────────────

class WorkerManager {
  private isInitialized = false;
  private io: SocketIOServer | null = null;
  private shutdownPromise: Promise<void> | null = null;

  /**
   * Initialize all workers and queues.
   * Call this during server startup.
   */
  async initialize(io: SocketIOServer): Promise<void> {
    if (this.isInitialized) {
      logger.warn('[WORKER_MANAGER] Already initialized');
      return;
    }

    this.io = io;
    const startTime = Date.now();

    logger.info('[WORKER_MANAGER] Initializing workers and queues...');

    try {
      // Step 1: Initialize queues
      await Promise.all([
        transcriptQueueManager.initialize(),
        processingQueueManager.initialize(),
        broadcastQueueManager.initialize(),
        initializeMinutesQueue(),
        initializeDeadLetterQueue(),
      ]);
      logger.info('[WORKER_MANAGER] Queues initialized');

      // Step 2: Initialize pipeline orchestrator
      await pipelineOrchestrator.initialize();
      logger.info('[WORKER_MANAGER] Pipeline orchestrator initialized');

      // Step 3: Initialize workers with their services
      const minutesService = new MinutesWorkerService(io);
      const processingService = new ProcessingWorkerService();

      await Promise.all([
        translationWorker.initialize(),
        broadcastWorker.initialize(io),
        startMinutesWorker(minutesService),
        processingWorker.initialize(processingService),
        startNotificationWorker(),
        startEmailWorker(),
        startAuditWorker(),
      ]);

      this.isInitialized = true;

      // Setup graceful shutdown handlers
      this.setupShutdownHandlers();

      // Start periodic circuit breaker cleanup
      this.startCleanupInterval();

      const elapsed = Date.now() - startTime;
      logger.info('[WORKER_MANAGER] All workers initialized', {
        elapsedMs: elapsed,
        workers: 7,
        queues: 5,
      });
    } catch (err) {
      logger.error('[WORKER_MANAGER] Failed to initialize', err);
      throw err;
    }
  }

  /**
   * Get status of all workers and queues.
   */
  async getStatus(): Promise<WorkerManagerStatus> {
    if (!this.isInitialized) {
      return {
        initialized: false,
        workers: [],
        queues: [],
        metrics: pipelineMetrics.getMetrics(),
      };
    }

    // Get worker statuses in parallel
    const [
      translationStatus,
      broadcastStatus,
      minutesStatus,
      processingStatus,
      notificationStatus,
      emailStatus,
      auditStatus,
    ] = await Promise.all([
      translationWorker.getStatus(),
      broadcastWorker.getStatus(),
      getMinutesWorker().getStatus(),
      processingWorker.getStatus(),
      getNotificationWorker().getStatus(),
      getEmailWorker().getStatus(),
      getAuditWorker().getStatus(),
    ]);

    // Get queue statuses
    const [transcriptQ, processingQ, broadcastQ, minutesQ] = await Promise.all([
      transcriptQueueManager.getStatus(),
      processingQueueManager.getStatus(),
      broadcastQueueManager.getStatus(),
      getMinutesQueueManager().getStatus(),
    ]);

    const workers: WorkerStatus[] = [
      {
        name: 'translation',
        running: translationStatus.running,
        processed: translationStatus.processed,
        failed: translationStatus.failed,
        paused: translationStatus.paused ?? false,
        healthy: translationStatus.running && !(translationStatus.paused ?? false),
      },
      {
        name: 'broadcast',
        running: broadcastStatus.running,
        processed: broadcastStatus.processed,
        failed: broadcastStatus.failed,
        paused: broadcastStatus.paused ?? false,
        healthy: broadcastStatus.running && !(broadcastStatus.paused ?? false),
      },
      {
        name: 'minutes',
        running: minutesStatus.running,
        processed: minutesStatus.processed,
        failed: minutesStatus.failed,
        paused: (minutesStatus as any).paused ?? false,
        healthy: minutesStatus.running,
      },
      {
        name: 'processing',
        running: processingStatus.running,
        processed: processingStatus.processed,
        failed: processingStatus.failed,
        paused: processingStatus.paused ?? false,
        healthy: processingStatus.running && !(processingStatus.paused ?? false),
      },
      {
        name: 'notification',
        running: notificationStatus.running,
        processed: notificationStatus.processed,
        failed: notificationStatus.failed,
        paused: (notificationStatus as any).paused ?? false,
        healthy: notificationStatus.running,
      },
      {
        name: 'email',
        running: emailStatus.running,
        processed: emailStatus.processed,
        failed: emailStatus.failed,
        paused: (emailStatus as any).paused ?? false,
        healthy: emailStatus.running,
      },
      {
        name: 'audit',
        running: auditStatus.running,
        processed: auditStatus.processed,
        failed: auditStatus.failed,
        paused: (auditStatus as any).paused ?? false,
        healthy: auditStatus.running,
      },
    ];

    const queues = [
      {
        name: 'transcript',
        size: transcriptQ.size,
        active: transcriptQ.activeCount,
        waiting: transcriptQ.waitingCount,
        failed: transcriptQ.failedCount,
      },
      {
        name: 'processing',
        size: processingQ.size,
        active: processingQ.activeCount,
        waiting: processingQ.waitingCount,
        failed: processingQ.failedCount,
      },
      {
        name: 'broadcast',
        size: broadcastQ.size,
        active: broadcastQ.activeCount,
        waiting: broadcastQ.waitingCount,
        failed: broadcastQ.failedCount,
      },
      {
        name: 'minutes',
        size: minutesQ.size,
        active: minutesQ.activeCount,
        waiting: minutesQ.waitingCount,
        failed: minutesQ.failedCount,
      },
    ];

    return {
      initialized: this.isInitialized,
      workers,
      queues,
      metrics: pipelineMetrics.getMetrics(),
    };
  }

  /**
   * Check if all workers are healthy.
   */
  async isHealthy(): Promise<boolean> {
    if (!this.isInitialized) return false;

    const status = await this.getStatus();
    const unhealthyWorkers = status.workers.filter((w) => !w.healthy);

    if (unhealthyWorkers.length > 0) {
      logger.warn('[WORKER_MANAGER] Unhealthy workers detected', {
        unhealthy: unhealthyWorkers.map((w) => w.name),
      });
      return false;
    }

    return true;
  }

  /**
   * Pause all workers (for maintenance).
   */
  async pauseAll(): Promise<void> {
    logger.info('[WORKER_MANAGER] Pausing all workers...');

    await Promise.all([
      translationWorker.pause(),
      broadcastWorker.pause(),
      getMinutesWorker().pause?.() || Promise.resolve(),
      processingWorker.pause(),
      getNotificationWorker().pause?.() || Promise.resolve(),
      getEmailWorker().pause?.() || Promise.resolve(),
      getAuditWorker().pause?.() || Promise.resolve(),
    ]);

    logger.info('[WORKER_MANAGER] All workers paused');
  }

  /**
   * Resume all workers.
   */
  async resumeAll(): Promise<void> {
    logger.info('[WORKER_MANAGER] Resuming all workers...');

    await Promise.all([
      translationWorker.resume(),
      broadcastWorker.resume(),
      getMinutesWorker().resume?.() || Promise.resolve(),
      processingWorker.resume(),
      getNotificationWorker().resume?.() || Promise.resolve(),
      getEmailWorker().resume?.() || Promise.resolve(),
      getAuditWorker().resume?.() || Promise.resolve(),
    ]);

    logger.info('[WORKER_MANAGER] All workers resumed');
  }

  /**
   * Gracefully shutdown all workers.
   */
  async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.doShutdown();
    return this.shutdownPromise;
  }

  private async doShutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    logger.info('[WORKER_MANAGER] Shutting down workers...');
    const startTime = Date.now();

    try {
      // First pause to stop accepting new jobs
      await this.pauseAll();

      // Then close workers
      await Promise.all([
        translationWorker.close(),
        broadcastWorker.close(),
        stopMinutesWorker(),
        processingWorker.close(),
        stopNotificationWorker(),
        stopEmailWorker(),
        stopAuditWorker(),
      ]);

      this.isInitialized = false;

      const elapsed = Date.now() - startTime;
      logger.info('[WORKER_MANAGER] Shutdown complete', { elapsedMs: elapsed });
    } catch (err) {
      logger.error('[WORKER_MANAGER] Error during shutdown', err);
      throw err;
    }
  }

  /**
   * Setup SIGTERM/SIGINT handlers for graceful shutdown.
   */
  private setupShutdownHandlers(): void {
    const handleShutdown = async (signal: string) => {
      logger.info(`[WORKER_MANAGER] Received ${signal}, shutting down...`);
      await this.shutdown();
      process.exit(0);
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
  }

  /**
   * Start periodic cleanup tasks.
   */
  private startCleanupInterval(): void {
    // Cleanup stale circuit breakers every 5 minutes
    setInterval(() => {
      try {
        translationWorker.cleanupCircuitBreakers();
      } catch {
        // Ignore errors
      }
    }, 5 * 60 * 1000);
  }
}

// Export singleton instance
export const workerManager = new WorkerManager();
