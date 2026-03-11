// ============================================================
// OrgsLedger API — Queue Metrics Exporter
// Prometheus metrics for BullMQ sharded queues
// ============================================================
//
// Collects metrics from all BullMQ sharded queues every 5 seconds
// and exposes them via Prometheus for /metrics endpoint
//
// Metrics exported:
//   - orgsledger_queue_waiting_jobs{queue, shard}
//   - orgsledger_queue_active_jobs{queue, shard}
//   - orgsledger_queue_completed_jobs{queue, shard}
//   - orgsledger_queue_failed_jobs{queue, shard}
//   - orgsledger_queue_delayed_jobs{queue, shard}
//   - orgsledger_queue_collection_duration_ms
//   - orgsledger_queue_collection_errors_total
//
// ============================================================

import * as client from 'prom-client';
import { logger } from '../logger';
import {
  getShardStats,
  isQueueManagerInitialized,
  SHARDED_QUEUE_TYPES,
  ShardedQueueType,
  QueueManagerStats,
} from '../queues/queue-manager';
import { getRegistry } from './prometheus.metrics';

// ── Configuration ───────────────────────────────────────────

const METRICS_PREFIX = 'orgsledger_';
const COLLECTION_INTERVAL_MS = 5_000; // 5 seconds

// ── Prometheus Metrics ──────────────────────────────────────

const register = getRegistry();

// Per-shard queue metrics
export const queueWaitingJobsSharded = new client.Gauge({
  name: `${METRICS_PREFIX}queue_shard_waiting_jobs`,
  help: 'Number of waiting jobs per queue shard',
  labelNames: ['queue', 'shard'] as const,
  registers: [register],
});

export const queueActiveJobsSharded = new client.Gauge({
  name: `${METRICS_PREFIX}queue_shard_active_jobs`,
  help: 'Number of active jobs per queue shard',
  labelNames: ['queue', 'shard'] as const,
  registers: [register],
});

export const queueCompletedJobsSharded = new client.Gauge({
  name: `${METRICS_PREFIX}queue_shard_completed_jobs`,
  help: 'Number of completed jobs per queue shard',
  labelNames: ['queue', 'shard'] as const,
  registers: [register],
});

export const queueFailedJobsSharded = new client.Gauge({
  name: `${METRICS_PREFIX}queue_shard_failed_jobs`,
  help: 'Number of failed jobs per queue shard',
  labelNames: ['queue', 'shard'] as const,
  registers: [register],
});

export const queueDelayedJobsSharded = new client.Gauge({
  name: `${METRICS_PREFIX}queue_shard_delayed_jobs`,
  help: 'Number of delayed jobs per queue shard',
  labelNames: ['queue', 'shard'] as const,
  registers: [register],
});

// Collection performance metrics
export const queueCollectionDurationMs = new client.Histogram({
  name: `${METRICS_PREFIX}queue_metrics_collection_duration_ms`,
  help: 'Time to collect all queue metrics in milliseconds',
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500],
  registers: [register],
});

export const queueCollectionErrorsTotal = new client.Counter({
  name: `${METRICS_PREFIX}queue_metrics_collection_errors_total`,
  help: 'Total number of queue metrics collection errors',
  labelNames: ['queue'] as const,
  registers: [register],
});

// ── Queue Metrics Exporter Class ────────────────────────────

export class QueueMetricsExporter {
  private collectionInterval: NodeJS.Timeout | null = null;
  private isCollecting: boolean = false;
  private lastCollectionTime: number = 0;
  private lastStats: Map<ShardedQueueType, QueueManagerStats> = new Map();

  /**
   * Start periodic metrics collection
   */
  start(): void {
    if (this.collectionInterval) {
      logger.warn('[QUEUE_METRICS] Exporter already running');
      return;
    }

    logger.info('[QUEUE_METRICS] Starting queue metrics exporter', {
      intervalMs: COLLECTION_INTERVAL_MS,
      queueTypes: Object.values(SHARDED_QUEUE_TYPES),
    });

    // Collect immediately on start
    this.collectMetrics().catch((err) => {
      logger.error('[QUEUE_METRICS] Initial collection failed', err);
    });

    // Start periodic collection
    this.collectionInterval = setInterval(() => {
      this.collectMetrics().catch((err) => {
        logger.error('[QUEUE_METRICS] Periodic collection failed', err);
      });
    }, COLLECTION_INTERVAL_MS);

    // Ensure interval doesn't prevent process exit
    this.collectionInterval.unref();
  }

  /**
   * Stop periodic metrics collection
   */
  stop(): void {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
      logger.info('[QUEUE_METRICS] Exporter stopped');
    }
  }

  /**
   * Collect metrics from all sharded queues
   */
  async collectMetrics(): Promise<void> {
    // Skip collection if queue manager isn't initialized yet
    if (!isQueueManagerInitialized()) {
      logger.debug('[QUEUE_METRICS] Skipping collection (queue manager not initialized)');
      return;
    }

    if (this.isCollecting) {
      logger.debug('[QUEUE_METRICS] Skipping collection (already in progress)');
      return;
    }

    this.isCollecting = true;
    const startTime = Date.now();

    try {
      // Collect stats from all queue types in parallel
      const queueTypes = Object.values(SHARDED_QUEUE_TYPES);
      const statsResults = await Promise.allSettled(
        queueTypes.map((queueType) => this.collectQueueTypeMetrics(queueType))
      );

      // Process results
      for (let i = 0; i < statsResults.length; i++) {
        const result = statsResults[i];
        const queueType = queueTypes[i];

        if (result.status === 'rejected') {
          logger.error(`[QUEUE_METRICS] Failed to collect ${queueType}`, result.reason);
          queueCollectionErrorsTotal.labels(queueType).inc();
        }
      }

      this.lastCollectionTime = Date.now();
      const durationMs = this.lastCollectionTime - startTime;
      queueCollectionDurationMs.observe(durationMs);

      logger.debug('[QUEUE_METRICS] Collection completed', {
        durationMs,
        queueTypes: queueTypes.length,
      });
    } catch (err) {
      logger.error('[QUEUE_METRICS] Collection failed', err);
    } finally {
      this.isCollecting = false;
    }
  }

  /**
   * Collect metrics for a single queue type
   */
  private async collectQueueTypeMetrics(queueType: ShardedQueueType): Promise<void> {
    const stats = await getShardStats(queueType);
    this.lastStats.set(queueType, stats);

    // Update per-shard metrics
    for (const shardStat of stats.shards) {
      const labels = {
        queue: queueType,
        shard: String(shardStat.shard),
      };

      queueWaitingJobsSharded.labels(labels).set(shardStat.waiting);
      queueActiveJobsSharded.labels(labels).set(shardStat.active);
      queueCompletedJobsSharded.labels(labels).set(shardStat.completed);
      queueFailedJobsSharded.labels(labels).set(shardStat.failed);
      queueDelayedJobsSharded.labels(labels).set(shardStat.delayed);
    }
  }

  /**
   * Get last collected stats for all queue types
   */
  getLastStats(): Map<ShardedQueueType, QueueManagerStats> {
    return new Map(this.lastStats);
  }

  /**
   * Get aggregated stats summary
   */
  getStatsSummary(): {
    byQueue: Record<string, { waiting: number; active: number; failed: number; delayed: number }>;
    totals: { waiting: number; active: number; failed: number; delayed: number };
    lastCollectionTime: number;
  } {
    const byQueue: Record<string, { waiting: number; active: number; failed: number; delayed: number }> = {};
    const totals = { waiting: 0, active: 0, failed: 0, delayed: 0 };

    for (const [queueType, stats] of this.lastStats) {
      byQueue[queueType] = {
        waiting: stats.totals.waiting,
        active: stats.totals.active,
        failed: stats.totals.failed,
        delayed: stats.totals.delayed,
      };

      totals.waiting += stats.totals.waiting;
      totals.active += stats.totals.active;
      totals.failed += stats.totals.failed;
      totals.delayed += stats.totals.delayed;
    }

    return {
      byQueue,
      totals,
      lastCollectionTime: this.lastCollectionTime,
    };
  }

  /**
   * Force immediate collection (for testing/debugging)
   */
  async forceCollection(): Promise<void> {
    await this.collectMetrics();
  }

  /**
   * Check if exporter is running
   */
  isRunning(): boolean {
    return this.collectionInterval !== null;
  }

  /**
   * Get detailed stats for a specific queue type
   */
  getQueueStats(queueType: ShardedQueueType): QueueManagerStats | undefined {
    return this.lastStats.get(queueType);
  }
}

// ── Singleton Instance ──────────────────────────────────────

let exporter: QueueMetricsExporter | null = null;

/**
 * Get or create the queue metrics exporter singleton
 */
export function getQueueMetricsExporter(): QueueMetricsExporter {
  if (!exporter) {
    exporter = new QueueMetricsExporter();
  }
  return exporter;
}

/**
 * Start the queue metrics exporter
 */
export function startQueueMetricsExporter(): QueueMetricsExporter {
  const instance = getQueueMetricsExporter();
  instance.start();
  return instance;
}

/**
 * Stop the queue metrics exporter
 */
export function stopQueueMetricsExporter(): void {
  if (exporter) {
    exporter.stop();
  }
}

// ── Express Route Handler (optional API endpoint) ───────────

import { Router, Request, Response } from 'express';

/**
 * Create Express router for queue metrics API endpoint
 * GET /api/system/queue-metrics - Get queue stats summary
 */
export function createQueueMetricsRouter(): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const instance = getQueueMetricsExporter();
      const summary = instance.getStatsSummary();
      
      res.json({
        success: true,
        data: {
          ...summary,
          isRunning: instance.isRunning(),
          collectionIntervalMs: COLLECTION_INTERVAL_MS,
        },
      });
    } catch (err) {
      logger.error('[QUEUE_METRICS] API error', err);
      res.status(500).json({
        success: false,
        error: 'Failed to get queue metrics',
      });
    }
  });

  // GET /api/system/queue-metrics/:queueType - Get detailed stats for a queue type
  router.get('/:queueType', async (req: Request, res: Response) => {
    try {
      const { queueType } = req.params;
      const validTypes = Object.values(SHARDED_QUEUE_TYPES);

      if (!validTypes.includes(queueType as ShardedQueueType)) {
        return res.status(400).json({
          success: false,
          error: `Invalid queue type. Valid types: ${validTypes.join(', ')}`,
        });
      }

      const instance = getQueueMetricsExporter();
      const stats = instance.getQueueStats(queueType as ShardedQueueType);

      if (!stats) {
        return res.status(404).json({
          success: false,
          error: 'No stats available. Metrics collection may not have run yet.',
        });
      }

      res.json({
        success: true,
        data: stats,
      });
    } catch (err) {
      logger.error('[QUEUE_METRICS] API error', err);
      res.status(500).json({
        success: false,
        error: 'Failed to get queue metrics',
      });
    }
  });

  return router;
}

// ── Default Export ──────────────────────────────────────────

export default {
  QueueMetricsExporter,
  getQueueMetricsExporter,
  startQueueMetricsExporter,
  stopQueueMetricsExporter,
  createQueueMetricsRouter,
};
