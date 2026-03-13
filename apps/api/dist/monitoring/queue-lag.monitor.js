"use strict";
// ============================================================
// OrgsLedger API — Queue Lag Monitor
// Monitors queue processing latency and alerts on lag
// ============================================================
//
// What It Monitors:
//   - Time from job enqueue to job start (waiting time)
//   - Time from job start to job complete (processing time)
//   - Total job latency (waiting + processing)
//
// Alert Thresholds:
//   - Warning: Total latency > 1 second
//   - Critical: Total latency > 2 seconds (workers can't keep up)
//
// Integration:
//   - Wraps BullMQ job processing
//   - Emits Prometheus metrics
//   - Fires alerts via EventEmitter
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
exports.queueLagMonitor = exports.queueLagAlertsCounter = exports.queueLagGauge = exports.queueTotalLatencyHistogram = exports.queueProcessingLatencyHistogram = exports.queueWaitingLatencyHistogram = void 0;
exports.withLagTracking = withLagTracking;
exports.onQueueLagAlert = onQueueLagAlert;
exports.getQueueLagStats = getQueueLagStats;
exports.getAllQueueLagStats = getAllQueueLagStats;
const client = __importStar(require("prom-client"));
const events_1 = require("events");
const logger_1 = require("../logger");
const DEFAULT_CONFIG = {
    lagWarningMs: parseInt(process.env.QUEUE_LAG_WARNING_MS || '1000', 10),
    lagCriticalMs: parseInt(process.env.QUEUE_LAG_CRITICAL_MS || '2000', 10),
    sampleWindowSize: parseInt(process.env.QUEUE_LAG_SAMPLE_SIZE || '100', 10),
    minSamplesForAlert: parseInt(process.env.QUEUE_LAG_MIN_SAMPLES || '10', 10),
    alertCooldownMs: parseInt(process.env.QUEUE_LAG_COOLDOWN_MS || '60000', 10),
};
// ── Prometheus Metrics ──────────────────────────────────────
const PREFIX = 'orgsledger_queue_';
exports.queueWaitingLatencyHistogram = new client.Histogram({
    name: `${PREFIX}waiting_latency_seconds`,
    help: 'Time jobs spend waiting in queue before processing',
    labelNames: ['queue'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
});
exports.queueProcessingLatencyHistogram = new client.Histogram({
    name: `${PREFIX}processing_latency_seconds`,
    help: 'Time jobs spend being processed',
    labelNames: ['queue'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
});
exports.queueTotalLatencyHistogram = new client.Histogram({
    name: `${PREFIX}total_latency_seconds`,
    help: 'Total time from job enqueue to completion',
    labelNames: ['queue'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
});
exports.queueLagGauge = new client.Gauge({
    name: `${PREFIX}lag_avg_seconds`,
    help: 'Average queue lag over sample window',
    labelNames: ['queue'],
});
exports.queueLagAlertsCounter = new client.Counter({
    name: `${PREFIX}lag_alerts_total`,
    help: 'Total queue lag alerts',
    labelNames: ['queue', 'level'],
});
// ── Queue Lag Monitor Class ─────────────────────────────────
class QueueLagMonitor extends events_1.EventEmitter {
    config;
    samples = new Map();
    lastAlertTime = new Map();
    isRunning = false;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Record a job's latency when it starts processing.
     * Call this at the beginning of your worker processor.
     */
    recordJobStart(job, queueName) {
        const now = Date.now();
        const waitingMs = now - job.timestamp;
        exports.queueWaitingLatencyHistogram.observe({ queue: queueName }, waitingMs / 1000);
        return { startTime: now, waitingMs };
    }
    /**
     * Record a job's complete latency.
     * Call this at the end of your worker processor.
     */
    recordJobComplete(job, queueName, startTime, waitingMs) {
        const now = Date.now();
        const processingMs = now - startTime;
        const totalMs = waitingMs + processingMs;
        // Record to Prometheus histograms
        exports.queueProcessingLatencyHistogram.observe({ queue: queueName }, processingMs / 1000);
        exports.queueTotalLatencyHistogram.observe({ queue: queueName }, totalMs / 1000);
        // Add to samples
        this.addSample(queueName, { waitingMs, processingMs, totalMs, timestamp: now });
        // Check for alerts
        this.checkAlerts(queueName);
    }
    /**
     * Add a sample to the rolling window.
     */
    addSample(queueName, sample) {
        let queueSamples = this.samples.get(queueName);
        if (!queueSamples) {
            queueSamples = [];
            this.samples.set(queueName, queueSamples);
        }
        queueSamples.push(sample);
        // Trim to window size
        while (queueSamples.length > this.config.sampleWindowSize) {
            queueSamples.shift();
        }
    }
    /**
     * Check if we need to fire alerts for a queue.
     */
    checkAlerts(queueName) {
        const samples = this.samples.get(queueName);
        if (!samples || samples.length < this.config.minSamplesForAlert) {
            return;
        }
        // Calculate average total latency
        const avgTotalMs = samples.reduce((sum, s) => sum + s.totalMs, 0) / samples.length;
        // Update gauge
        exports.queueLagGauge.set({ queue: queueName }, avgTotalMs / 1000);
        // Check cooldown
        const lastAlert = this.lastAlertTime.get(queueName) || 0;
        if (Date.now() - lastAlert < this.config.alertCooldownMs) {
            return;
        }
        // Determine alert level
        let level = null;
        let threshold = 0;
        if (avgTotalMs >= this.config.lagCriticalMs) {
            level = 'critical';
            threshold = this.config.lagCriticalMs;
        }
        else if (avgTotalMs >= this.config.lagWarningMs) {
            level = 'warning';
            threshold = this.config.lagWarningMs;
        }
        if (level) {
            const alert = {
                level,
                queueName,
                avgLatencyMs: avgTotalMs,
                threshold,
                sampleCount: samples.length,
                timestamp: new Date(),
            };
            this.fireAlert(alert);
            this.lastAlertTime.set(queueName, Date.now());
        }
    }
    /**
     * Fire an alert.
     */
    fireAlert(alert) {
        const message = `[QUEUE_LAG] ${alert.level.toUpperCase()}: Queue "${alert.queueName}" lag at ${alert.avgLatencyMs.toFixed(0)}ms (threshold: ${alert.threshold}ms)`;
        const meta = {
            queue: alert.queueName,
            avgLatencyMs: alert.avgLatencyMs,
            threshold: alert.threshold,
            sampleCount: alert.sampleCount,
        };
        if (alert.level === 'critical') {
            logger_1.logger.error(message, meta);
        }
        else {
            logger_1.logger.warn(message, meta);
        }
        exports.queueLagAlertsCounter.inc({ queue: alert.queueName, level: alert.level });
        this.emit('alert', alert);
    }
    /**
     * Get stats for a specific queue.
     */
    getQueueStats(queueName) {
        const samples = this.samples.get(queueName);
        if (!samples || samples.length === 0) {
            return null;
        }
        const sortedTotal = samples.map(s => s.totalMs).sort((a, b) => a - b);
        return {
            queueName,
            sampleCount: samples.length,
            avgWaitingMs: samples.reduce((sum, s) => sum + s.waitingMs, 0) / samples.length,
            avgProcessingMs: samples.reduce((sum, s) => sum + s.processingMs, 0) / samples.length,
            avgTotalMs: samples.reduce((sum, s) => sum + s.totalMs, 0) / samples.length,
            p50TotalMs: this.percentile(sortedTotal, 50),
            p95TotalMs: this.percentile(sortedTotal, 95),
            p99TotalMs: this.percentile(sortedTotal, 99),
            maxTotalMs: sortedTotal[sortedTotal.length - 1],
        };
    }
    /**
     * Get stats for all queues.
     */
    getAllQueueStats() {
        const stats = [];
        for (const queueName of this.samples.keys()) {
            const queueStats = this.getQueueStats(queueName);
            if (queueStats) {
                stats.push(queueStats);
            }
        }
        return stats;
    }
    /**
     * Calculate percentile from sorted array.
     */
    percentile(sorted, p) {
        if (sorted.length === 0)
            return 0;
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    }
    /**
     * Reset all samples (useful for testing).
     */
    reset() {
        this.samples.clear();
        this.lastAlertTime.clear();
    }
}
// ── Singleton ───────────────────────────────────────────────
exports.queueLagMonitor = new QueueLagMonitor();
// ── Helper: Wrap Worker Processor ───────────────────────────
/**
 * Wraps a BullMQ worker processor to automatically track latency.
 *
 * Usage:
 * ```ts
 * const processor = withLagTracking('transcript', async (job) => {
 *   // your processing logic
 * });
 * new Worker('transcript', processor, { connection });
 * ```
 */
function withLagTracking(queueName, processor) {
    return async (job) => {
        const { startTime, waitingMs } = exports.queueLagMonitor.recordJobStart(job, queueName);
        try {
            const result = await processor(job);
            exports.queueLagMonitor.recordJobComplete(job, queueName, startTime, waitingMs);
            return result;
        }
        catch (err) {
            // Still record completion on error to track failed job latency
            exports.queueLagMonitor.recordJobComplete(job, queueName, startTime, waitingMs);
            throw err;
        }
    };
}
// ── Exports ─────────────────────────────────────────────────
function onQueueLagAlert(callback) {
    exports.queueLagMonitor.on('alert', callback);
    return () => exports.queueLagMonitor.off('alert', callback);
}
function getQueueLagStats(queueName) {
    return exports.queueLagMonitor.getQueueStats(queueName);
}
function getAllQueueLagStats() {
    return exports.queueLagMonitor.getAllQueueStats();
}
//# sourceMappingURL=queue-lag.monitor.js.map