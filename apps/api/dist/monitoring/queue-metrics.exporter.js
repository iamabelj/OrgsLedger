"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueueMetricsExporter = exports.queueCollectionErrorsTotal = exports.queueCollectionDurationMs = exports.queueDelayedJobsSharded = exports.queueFailedJobsSharded = exports.queueCompletedJobsSharded = exports.queueActiveJobsSharded = exports.queueWaitingJobsSharded = void 0;
exports.getQueueMetricsExporter = getQueueMetricsExporter;
exports.startQueueMetricsExporter = startQueueMetricsExporter;
exports.stopQueueMetricsExporter = stopQueueMetricsExporter;
exports.createQueueMetricsRouter = createQueueMetricsRouter;
const client = __importStar(require("prom-client"));
const logger_1 = require("../logger");
const queue_manager_1 = require("../queues/queue-manager");
const prometheus_metrics_1 = require("./prometheus.metrics");
// ── Configuration ───────────────────────────────────────────
const METRICS_PREFIX = 'orgsledger_';
const COLLECTION_INTERVAL_MS = 5_000; // 5 seconds
// ── Prometheus Metrics ──────────────────────────────────────
const register = (0, prometheus_metrics_1.getRegistry)();
// Per-shard queue metrics
exports.queueWaitingJobsSharded = new client.Gauge({
    name: `${METRICS_PREFIX}queue_shard_waiting_jobs`,
    help: 'Number of waiting jobs per queue shard',
    labelNames: ['queue', 'shard'],
    registers: [register],
});
exports.queueActiveJobsSharded = new client.Gauge({
    name: `${METRICS_PREFIX}queue_shard_active_jobs`,
    help: 'Number of active jobs per queue shard',
    labelNames: ['queue', 'shard'],
    registers: [register],
});
exports.queueCompletedJobsSharded = new client.Gauge({
    name: `${METRICS_PREFIX}queue_shard_completed_jobs`,
    help: 'Number of completed jobs per queue shard',
    labelNames: ['queue', 'shard'],
    registers: [register],
});
exports.queueFailedJobsSharded = new client.Gauge({
    name: `${METRICS_PREFIX}queue_shard_failed_jobs`,
    help: 'Number of failed jobs per queue shard',
    labelNames: ['queue', 'shard'],
    registers: [register],
});
exports.queueDelayedJobsSharded = new client.Gauge({
    name: `${METRICS_PREFIX}queue_shard_delayed_jobs`,
    help: 'Number of delayed jobs per queue shard',
    labelNames: ['queue', 'shard'],
    registers: [register],
});
// Collection performance metrics
exports.queueCollectionDurationMs = new client.Histogram({
    name: `${METRICS_PREFIX}queue_metrics_collection_duration_ms`,
    help: 'Time to collect all queue metrics in milliseconds',
    buckets: [10, 25, 50, 100, 250, 500, 1000, 2500],
    registers: [register],
});
exports.queueCollectionErrorsTotal = new client.Counter({
    name: `${METRICS_PREFIX}queue_metrics_collection_errors_total`,
    help: 'Total number of queue metrics collection errors',
    labelNames: ['queue'],
    registers: [register],
});
// ── Queue Metrics Exporter Class ────────────────────────────
class QueueMetricsExporter {
    collectionInterval = null;
    isCollecting = false;
    lastCollectionTime = 0;
    lastStats = new Map();
    /**
     * Start periodic metrics collection
     */
    start() {
        if (this.collectionInterval) {
            logger_1.logger.warn('[QUEUE_METRICS] Exporter already running');
            return;
        }
        logger_1.logger.info('[QUEUE_METRICS] Starting queue metrics exporter', {
            intervalMs: COLLECTION_INTERVAL_MS,
            queueTypes: Object.values(queue_manager_1.SHARDED_QUEUE_TYPES),
        });
        // Collect immediately on start
        this.collectMetrics().catch((err) => {
            logger_1.logger.error('[QUEUE_METRICS] Initial collection failed', err);
        });
        // Start periodic collection
        this.collectionInterval = setInterval(() => {
            this.collectMetrics().catch((err) => {
                logger_1.logger.error('[QUEUE_METRICS] Periodic collection failed', err);
            });
        }, COLLECTION_INTERVAL_MS);
        // Ensure interval doesn't prevent process exit
        this.collectionInterval.unref();
    }
    /**
     * Stop periodic metrics collection
     */
    stop() {
        if (this.collectionInterval) {
            clearInterval(this.collectionInterval);
            this.collectionInterval = null;
            logger_1.logger.info('[QUEUE_METRICS] Exporter stopped');
        }
    }
    /**
     * Collect metrics from all sharded queues
     */
    async collectMetrics() {
        // Skip collection if queue manager isn't initialized yet
        if (!(0, queue_manager_1.isQueueManagerInitialized)()) {
            logger_1.logger.debug('[QUEUE_METRICS] Skipping collection (queue manager not initialized)');
            return;
        }
        if (this.isCollecting) {
            logger_1.logger.debug('[QUEUE_METRICS] Skipping collection (already in progress)');
            return;
        }
        this.isCollecting = true;
        const startTime = Date.now();
        try {
            // Collect stats from all queue types in parallel
            const queueTypes = Object.values(queue_manager_1.SHARDED_QUEUE_TYPES);
            const statsResults = await Promise.allSettled(queueTypes.map((queueType) => this.collectQueueTypeMetrics(queueType)));
            // Process results
            for (let i = 0; i < statsResults.length; i++) {
                const result = statsResults[i];
                const queueType = queueTypes[i];
                if (result.status === 'rejected') {
                    logger_1.logger.error(`[QUEUE_METRICS] Failed to collect ${queueType}`, result.reason);
                    exports.queueCollectionErrorsTotal.labels(queueType).inc();
                }
            }
            this.lastCollectionTime = Date.now();
            const durationMs = this.lastCollectionTime - startTime;
            exports.queueCollectionDurationMs.observe(durationMs);
            logger_1.logger.debug('[QUEUE_METRICS] Collection completed', {
                durationMs,
                queueTypes: queueTypes.length,
            });
        }
        catch (err) {
            logger_1.logger.error('[QUEUE_METRICS] Collection failed', err);
        }
        finally {
            this.isCollecting = false;
        }
    }
    /**
     * Collect metrics for a single queue type
     */
    async collectQueueTypeMetrics(queueType) {
        const stats = await (0, queue_manager_1.getShardStats)(queueType);
        this.lastStats.set(queueType, stats);
        // Update per-shard metrics
        for (const shardStat of stats.shards) {
            const labels = {
                queue: queueType,
                shard: String(shardStat.shard),
            };
            exports.queueWaitingJobsSharded.labels(labels).set(shardStat.waiting);
            exports.queueActiveJobsSharded.labels(labels).set(shardStat.active);
            exports.queueCompletedJobsSharded.labels(labels).set(shardStat.completed);
            exports.queueFailedJobsSharded.labels(labels).set(shardStat.failed);
            exports.queueDelayedJobsSharded.labels(labels).set(shardStat.delayed);
        }
    }
    /**
     * Get last collected stats for all queue types
     */
    getLastStats() {
        return new Map(this.lastStats);
    }
    /**
     * Get aggregated stats summary
     */
    getStatsSummary() {
        const byQueue = {};
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
    async forceCollection() {
        await this.collectMetrics();
    }
    /**
     * Check if exporter is running
     */
    isRunning() {
        return this.collectionInterval !== null;
    }
    /**
     * Get detailed stats for a specific queue type
     */
    getQueueStats(queueType) {
        return this.lastStats.get(queueType);
    }
}
exports.QueueMetricsExporter = QueueMetricsExporter;
// ── Singleton Instance ──────────────────────────────────────
let exporter = null;
/**
 * Get or create the queue metrics exporter singleton
 */
function getQueueMetricsExporter() {
    if (!exporter) {
        exporter = new QueueMetricsExporter();
    }
    return exporter;
}
/**
 * Start the queue metrics exporter
 */
function startQueueMetricsExporter() {
    const instance = getQueueMetricsExporter();
    instance.start();
    return instance;
}
/**
 * Stop the queue metrics exporter
 */
function stopQueueMetricsExporter() {
    if (exporter) {
        exporter.stop();
    }
}
// ── Express Route Handler (optional API endpoint) ───────────
const express_1 = require("express");
/**
 * Create Express router for queue metrics API endpoint
 * GET /api/system/queue-metrics - Get queue stats summary
 */
function createQueueMetricsRouter() {
    const router = (0, express_1.Router)();
    router.get('/', async (_req, res) => {
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
        }
        catch (err) {
            logger_1.logger.error('[QUEUE_METRICS] API error', err);
            res.status(500).json({
                success: false,
                error: 'Failed to get queue metrics',
            });
        }
    });
    // GET /api/system/queue-metrics/:queueType - Get detailed stats for a queue type
    router.get('/:queueType', async (req, res) => {
        try {
            const { queueType } = req.params;
            const validTypes = Object.values(queue_manager_1.SHARDED_QUEUE_TYPES);
            if (!validTypes.includes(queueType)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid queue type. Valid types: ${validTypes.join(', ')}`,
                });
            }
            const instance = getQueueMetricsExporter();
            const stats = instance.getQueueStats(queueType);
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
        }
        catch (err) {
            logger_1.logger.error('[QUEUE_METRICS] API error', err);
            res.status(500).json({
                success: false,
                error: 'Failed to get queue metrics',
            });
        }
    });
    return router;
}
// ── Default Export ──────────────────────────────────────────
exports.default = {
    QueueMetricsExporter,
    getQueueMetricsExporter,
    startQueueMetricsExporter,
    stopQueueMetricsExporter,
    createQueueMetricsRouter,
};
//# sourceMappingURL=queue-metrics.exporter.js.map