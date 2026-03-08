// ============================================================
// OrgsLedger API — Worker Initialization Module
// Centralized startup/shutdown for non-meeting BullMQ workers
// Meeting workers are handled by meeting-pipeline module
// ============================================================

import { logger } from '../logger';
import { getNotificationWorker, startNotificationWorker, stopNotificationWorker } from './notification.worker';
import { getEmailWorker, startEmailWorker, stopEmailWorker } from './email.worker';
import { getAuditWorker, startAuditWorker, stopAuditWorker } from './audit.worker';
import { getBotWorker, startBotWorker, stopBotWorker } from './bot.worker';
import { initializeDeadLetterQueue } from '../queues/dlq.queue';

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
}

// ── Worker Manager ────────────────────────────────────────────

class WorkerManager {
  private isInitialized = false;
  private shutdownPromise: Promise<void> | null = null;

  /**
   * Initialize all non-meeting workers and queues.
   * Meeting workers are started via meeting-pipeline module.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('[WORKER_MANAGER] Already initialized');
      return;
    }

    const startTime = Date.now();
    logger.info('[WORKER_MANAGER] Initializing utility workers...');

    try {
      // Initialize DLQ
      await initializeDeadLetterQueue();
      logger.info('[WORKER_MANAGER] DLQ initialized');

      // Initialize utility workers
      await Promise.all([
        startNotificationWorker(),
        startEmailWorker(),
        startAuditWorker(),
        startBotWorker(),
      ]);

      this.isInitialized = true;

      const elapsed = Date.now() - startTime;
      logger.info('[WORKER_MANAGER] Utility workers initialized', {
        elapsedMs: elapsed,
        workers: ['notification', 'email', 'audit', 'bot'],
      });
    } catch (err) {
      logger.error('[WORKER_MANAGER] Failed to initialize', err);
      throw err;
    }
  }

  /**
   * Get status of all utility workers.
   */
  async getStatus(): Promise<WorkerManagerStatus> {
    if (!this.isInitialized) {
      return {
        initialized: false,
        workers: [],
      };
    }

    const [notificationStatus, emailStatus, auditStatus, botStatus] = await Promise.all([
      getNotificationWorker().getStatus(),
      getEmailWorker().getStatus(),
      getAuditWorker().getStatus(),
      getBotWorker().getStatus(),
    ]);

    const workers: WorkerStatus[] = [
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
      {
        name: 'bot',
        running: botStatus.running,
        processed: botStatus.processed,
        failed: botStatus.failed,
        paused: (botStatus as any).paused ?? false,
        healthy: botStatus.running,
      },
    ];

    return {
      initialized: this.isInitialized,
      workers,
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

    logger.info('[WORKER_MANAGER] Shutting down utility workers...');
    const startTime = Date.now();

    try {
      await Promise.all([
        stopNotificationWorker(),
        stopEmailWorker(),
        stopAuditWorker(),
        stopBotWorker(),
      ]);

      this.isInitialized = false;

      const elapsed = Date.now() - startTime;
      logger.info('[WORKER_MANAGER] Shutdown complete', { elapsedMs: elapsed });
    } catch (err) {
      logger.error('[WORKER_MANAGER] Error during shutdown', err);
      throw err;
    }
  }
}

// Export singleton instance
export const workerManager = new WorkerManager();
