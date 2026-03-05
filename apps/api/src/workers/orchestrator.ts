// ============================================================
// OrgsLedger API — Worker Orchestrator
// Initializes and manages lifecycle of all workers
// Provides health checks and graceful shutdown
// ============================================================

import { Server as SocketIOServer } from 'socket.io';
import { logger } from '../logger';
import { startBroadcastWorker, stopBroadcastWorker, broadcastWorker } from './broadcast.worker';
import { startProcessingWorker, stopProcessingWorker, processingWorker } from './processing.worker';
import { startMinutesWorker, stopMinutesWorker, getMinutesWorker } from './minutes.worker';
import { ProcessingWorker as IProcessingWorkerService } from '../services/workers/processingWorker.service';
import { MinutesWorkerService } from '../services/workers/minutesWorker.service';

class WorkerOrchestrator {
  private isInitialized = false;
  private initialiationStartTime: number | null = null;

  /**
   * Initialize all workers
   */
  async initialize(
    ioServer: SocketIOServer,
    processingService: IProcessingWorkerService,
    minutesService: MinutesWorkerService
  ): Promise<void> {
    try {
      this.initialiationStartTime = Date.now();

      logger.info('Starting worker orchestrator initialization', {
        workers: ['broadcast', 'processing', 'minutes'],
      });

      // Start all workers in parallel
      await Promise.all([
        startBroadcastWorker(ioServer),
        startProcessingWorker(processingService),
        startMinutesWorker(minutesService),
      ]);

      this.isInitialized = true;
      const initTime = Date.now() - this.initialiationStartTime;

      logger.info('Worker orchestrator initialized successfully', {
        initTimeMs: initTime,
        workers: 3,
      });
    } catch (err) {
      logger.error('Failed to initialize worker orchestrator', err);
      throw err;
    }
  }

  /**
   * Check health of all workers
   */
  async getHealthStatus(): Promise<{
    orchestratorReady: boolean;
    broadcast: {
      healthy: boolean;
      running: boolean;
      processed: number;
      failed: number;
    };
    processing: {
      healthy: boolean;
      running: boolean;
      processed: number;
      failed: number;
    };
    minutes: {
      healthy: boolean;
      running: boolean;
      processed: number;
      failed: number;
    };
  }> {
    try {
      const broadcastStatus = await broadcastWorker.getStatus();
      const processingStatus = await processingWorker.getStatus();
      const minutesWorker = getMinutesWorker();
      const minutesStatus = await minutesWorker.getStatus();

      return {
        orchestratorReady: this.isInitialized,
        broadcast: {
          healthy: broadcastWorker.isHealthy(),
          ...broadcastStatus,
        },
        processing: {
          healthy: processingWorker.isHealthy(),
          ...processingStatus,
        },
        minutes: {
          healthy: minutesWorker.isHealthy(),
          ...minutesStatus,
        },
      };
    } catch (err) {
      logger.error('Failed to get worker health status', err);
      return {
        orchestratorReady: false,
        broadcast: {
          healthy: false,
          running: false,
          processed: 0,
          failed: 0,
        },
        processing: {
          healthy: false,
          running: false,
          processed: 0,
          failed: 0,
        },
        minutes: {
          healthy: false,
          running: false,
          processed: 0,
          failed: 0,
        },
      };
    }
  }

  /**
   * Pause all workers
   */
  async pauseAll(): Promise<void> {
    try {
      logger.info('Pausing all workers');
      const minutesWorker = getMinutesWorker();
      await Promise.all([broadcastWorker.pause(), processingWorker.pause(), minutesWorker.pause()]);
      logger.info('All workers paused');
    } catch (err) {
      logger.error('Failed to pause all workers', err);
    }
  }

  /**
   * Resume all workers
   */
  async resumeAll(): Promise<void> {
    try {
      logger.info('Resuming all workers');
      const minutesWorker = getMinutesWorker();
      await Promise.all([broadcastWorker.resume(), processingWorker.resume(), minutesWorker.resume()]);
      logger.info('All workers resumed');
    } catch (err) {
      logger.error('Failed to resume all workers', err);
    }
  }

  /**
   * Gracefully shutdown all workers
   */
  async shutdown(): Promise<void> {
    try {
      logger.info('Starting worker orchestrator shutdown');

      // Pause workers to stop accepting new jobs
      await this.pauseAll();

      // Give workers time to finish current jobs
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Close workers
      await Promise.all([stopBroadcastWorker(), stopProcessingWorker(), stopMinutesWorker()]);

      this.isInitialized = false;
      logger.info('Worker orchestrator shutdown completed');
    } catch (err) {
      logger.error('Error during worker orchestrator shutdown', err);
    }
  }

  /**
   * Check if orchestrator is initialized and healthy
   */
  isHealthy(): boolean {
    const minutesWorker = getMinutesWorker();
    return this.isInitialized && broadcastWorker.isHealthy() && processingWorker.isHealthy() && minutesWorker.isHealthy();
  }
}

// Export singleton instance
export const workerOrchestrator = new WorkerOrchestrator();

/**
 * Initialize worker orchestrator
 */
export async function initializeWorkerOrchestrator(
  ioServer: SocketIOServer,
  processingService: IProcessingWorkerService,
  minutesService: MinutesWorkerService
): Promise<void> {
  await workerOrchestrator.initialize(ioServer, processingService, minutesService);
}

/**
 * Shutdown worker orchestrator gracefully
 */
export async function shutdownWorkerOrchestrator(): Promise<void> {
  await workerOrchestrator.shutdown();
}
