"use strict";
// ============================================================
// OrgsLedger API — Prometheus Metrics
// Production-grade metrics export for observability
// ============================================================
//
// Exports Prometheus-compatible metrics for:
//   - AI service usage (Deepgram, OpenAI, Translation)
//   - Queue health (waiting, failed jobs)
//   - Worker statistics (processed, failed)
//   - Pipeline latencies (broadcast, minutes generation)
//
// Endpoint: GET /metrics
// Format: Prometheus text exposition format
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
exports.recoveryJobsFailed = exports.recoveryJobsRecovered = exports.systemAlertCount = exports.systemOverallStatus = exports.systemPostgresLatencyMs = exports.systemPostgresConnected = exports.systemRedisLatencyMs = exports.systemRedisConnected = exports.pipelineTranslationThroughput = exports.pipelineTranscriptThroughput = exports.pipelineMinutesGenerationMs = exports.pipelineBroadcastLatencyMs = exports.workerLastHeartbeatAgeMs = exports.workerHealthy = exports.workerFailedJobsTotal = exports.workerProcessedJobsTotal = exports.queueStuckJobs = exports.queueFailedJobs = exports.queueActiveJobs = exports.queueWaitingJobs = exports.aiEstimatedCostUsd = exports.aiTranslationCharactersTotal = exports.aiOpenaiTokensTotal = exports.aiDeepgramMinutesTotal = void 0;
exports.updatePrometheusMetrics = updatePrometheusMetrics;
exports.incrementRecoveryMetrics = incrementRecoveryMetrics;
exports.createMetricsRouter = createMetricsRouter;
exports.getRegistry = getRegistry;
exports.getMetricsString = getMetricsString;
const client = __importStar(require("prom-client"));
const express_1 = require("express");
const logger_1 = require("../logger");
// ── Configuration ───────────────────────────────────────────
const METRICS_CONFIG = {
    // Prefix for all metrics
    prefix: 'orgsledger_',
    // Default labels applied to all metrics
    defaultLabels: {
        app: 'orgsledger-api',
    },
};
// ── Initialize Registry ─────────────────────────────────────
// Create a custom registry (allows isolation from default metrics)
const register = new client.Registry();
// Set default labels
register.setDefaultLabels(METRICS_CONFIG.defaultLabels);
// Collect default Node.js metrics (memory, CPU, event loop)
client.collectDefaultMetrics({ register, prefix: METRICS_CONFIG.prefix });
// ── AI Usage Metrics ────────────────────────────────────────
exports.aiDeepgramMinutesTotal = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}ai_deepgram_minutes_total`,
    help: 'Total Deepgram transcription minutes consumed',
    registers: [register],
});
exports.aiOpenaiTokensTotal = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}ai_openai_tokens_total`,
    help: 'Total OpenAI tokens consumed',
    labelNames: ['type'], // 'input' or 'output'
    registers: [register],
});
exports.aiTranslationCharactersTotal = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}ai_translation_characters_total`,
    help: 'Total translation characters processed',
    registers: [register],
});
exports.aiEstimatedCostUsd = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}ai_estimated_cost_usd`,
    help: 'Estimated AI service cost in USD',
    registers: [register],
});
// ── Queue Metrics ───────────────────────────────────────────
exports.queueWaitingJobs = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}queue_waiting_jobs`,
    help: 'Number of jobs waiting in queue',
    labelNames: ['queue'],
    registers: [register],
});
exports.queueActiveJobs = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}queue_active_jobs`,
    help: 'Number of jobs currently active',
    labelNames: ['queue'],
    registers: [register],
});
exports.queueFailedJobs = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}queue_failed_jobs`,
    help: 'Number of failed jobs in queue',
    labelNames: ['queue'],
    registers: [register],
});
exports.queueStuckJobs = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}queue_stuck_jobs`,
    help: 'Number of stuck jobs in queue',
    labelNames: ['queue'],
    registers: [register],
});
// ── Worker Metrics ──────────────────────────────────────────
exports.workerProcessedJobsTotal = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}worker_processed_jobs_total`,
    help: 'Total jobs processed by worker',
    labelNames: ['worker'],
    registers: [register],
});
exports.workerFailedJobsTotal = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}worker_failed_jobs_total`,
    help: 'Total jobs failed by worker',
    labelNames: ['worker'],
    registers: [register],
});
exports.workerHealthy = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}worker_healthy`,
    help: 'Worker health status (1 = healthy, 0 = unhealthy)',
    labelNames: ['worker'],
    registers: [register],
});
exports.workerLastHeartbeatAgeMs = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}worker_last_heartbeat_age_ms`,
    help: 'Age of last worker heartbeat in milliseconds',
    labelNames: ['worker'],
    registers: [register],
});
// ── Pipeline Metrics ────────────────────────────────────────
exports.pipelineBroadcastLatencyMs = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}pipeline_broadcast_latency_ms`,
    help: 'Broadcast pipeline latency in milliseconds',
    registers: [register],
});
exports.pipelineMinutesGenerationMs = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}pipeline_minutes_generation_ms`,
    help: 'Minutes generation time in milliseconds',
    registers: [register],
});
exports.pipelineTranscriptThroughput = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}pipeline_transcript_throughput_per_min`,
    help: 'Transcript events processed per minute',
    registers: [register],
});
exports.pipelineTranslationThroughput = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}pipeline_translation_throughput_per_min`,
    help: 'Translation events processed per minute',
    registers: [register],
});
// ── System Health Metrics ───────────────────────────────────
exports.systemRedisConnected = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}system_redis_connected`,
    help: 'Redis connection status (1 = connected, 0 = disconnected)',
    registers: [register],
});
exports.systemRedisLatencyMs = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}system_redis_latency_ms`,
    help: 'Redis ping latency in milliseconds',
    registers: [register],
});
exports.systemPostgresConnected = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}system_postgres_connected`,
    help: 'PostgreSQL connection status (1 = connected, 0 = disconnected)',
    registers: [register],
});
exports.systemPostgresLatencyMs = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}system_postgres_latency_ms`,
    help: 'PostgreSQL query latency in milliseconds',
    registers: [register],
});
exports.systemOverallStatus = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}system_overall_status`,
    help: 'Overall system status (2 = healthy, 1 = degraded, 0 = critical)',
    registers: [register],
});
exports.systemAlertCount = new client.Gauge({
    name: `${METRICS_CONFIG.prefix}system_alert_count`,
    help: 'Number of active system alerts',
    registers: [register],
});
// ── Recovery Metrics ────────────────────────────────────────
exports.recoveryJobsRecovered = new client.Counter({
    name: `${METRICS_CONFIG.prefix}recovery_jobs_recovered_total`,
    help: 'Total number of stuck jobs recovered',
    labelNames: ['queue'],
    registers: [register],
});
exports.recoveryJobsFailed = new client.Counter({
    name: `${METRICS_CONFIG.prefix}recovery_jobs_failed_total`,
    help: 'Total number of stuck jobs that exceeded max retries',
    labelNames: ['queue'],
    registers: [register],
});
/**
 * Update all Prometheus metrics with current values
 * Called every monitoring cycle from SystemMonitor
 */
function updatePrometheusMetrics(data) {
    try {
        // Update AI metrics
        if (data.ai) {
            exports.aiDeepgramMinutesTotal.set(data.ai.deepgramMinutes);
            exports.aiOpenaiTokensTotal.labels('input').set(data.ai.openaiInputTokens);
            exports.aiOpenaiTokensTotal.labels('output').set(data.ai.openaiOutputTokens);
            exports.aiTranslationCharactersTotal.set(data.ai.translationCharacters);
            exports.aiEstimatedCostUsd.set(data.ai.estimatedCostUsd);
        }
        // Update queue metrics
        if (data.queues) {
            for (const queue of data.queues) {
                exports.queueWaitingJobs.labels(queue.name).set(queue.waiting);
                exports.queueActiveJobs.labels(queue.name).set(queue.active);
                exports.queueFailedJobs.labels(queue.name).set(queue.failed);
                exports.queueStuckJobs.labels(queue.name).set(queue.stuckJobs);
            }
        }
        // Update worker metrics
        if (data.workers) {
            for (const worker of data.workers) {
                exports.workerProcessedJobsTotal.labels(worker.name).set(worker.processed);
                exports.workerFailedJobsTotal.labels(worker.name).set(worker.failed);
                exports.workerHealthy.labels(worker.name).set(worker.healthy ? 1 : 0);
                exports.workerLastHeartbeatAgeMs.labels(worker.name).set(worker.heartbeatAgeMs);
            }
        }
        // Update pipeline metrics
        if (data.pipeline) {
            exports.pipelineBroadcastLatencyMs.set(data.pipeline.broadcastLatencyMs);
            exports.pipelineMinutesGenerationMs.set(data.pipeline.minutesGenerationMs);
            exports.pipelineTranscriptThroughput.set(data.pipeline.transcriptThroughputPerMin);
            exports.pipelineTranslationThroughput.set(data.pipeline.translationThroughputPerMin);
        }
        // Update system health metrics
        if (data.system) {
            exports.systemRedisConnected.set(data.system.redisConnected ? 1 : 0);
            exports.systemRedisLatencyMs.set(data.system.redisLatencyMs);
            exports.systemPostgresConnected.set(data.system.postgresConnected ? 1 : 0);
            exports.systemPostgresLatencyMs.set(data.system.postgresLatencyMs);
            // Map status to numeric value
            const statusMap = {
                'HEALTHY': 2,
                'DEGRADED': 1,
                'CRITICAL': 0,
            };
            exports.systemOverallStatus.set(statusMap[data.system.overallStatus] ?? 0);
            exports.systemAlertCount.set(data.system.alertCount);
        }
        logger_1.logger.debug('[PROMETHEUS] Metrics updated');
    }
    catch (err) {
        logger_1.logger.error('[PROMETHEUS] Failed to update metrics', err);
    }
}
/**
 * Increment recovery counters
 */
function incrementRecoveryMetrics(queueName, action) {
    try {
        if (action === 'recovered') {
            exports.recoveryJobsRecovered.labels(queueName).inc();
        }
        else {
            exports.recoveryJobsFailed.labels(queueName).inc();
        }
    }
    catch (err) {
        logger_1.logger.debug('[PROMETHEUS] Failed to increment recovery metrics', err);
    }
}
// ── Express Router ──────────────────────────────────────────
/**
 * Create Express router for /metrics endpoint
 */
function createMetricsRouter() {
    const router = (0, express_1.Router)();
    // GET /metrics - Prometheus scrape endpoint
    router.get('/', async (_req, res) => {
        try {
            res.set('Content-Type', register.contentType);
            const metrics = await register.metrics();
            res.end(metrics);
        }
        catch (err) {
            logger_1.logger.error('[PROMETHEUS] Failed to generate metrics', err);
            res.status(500).end('Error generating metrics');
        }
    });
    return router;
}
/**
 * Get the Prometheus registry (for testing or custom integrations)
 */
function getRegistry() {
    return register;
}
/**
 * Get metrics as string (for debugging)
 */
async function getMetricsString() {
    return register.metrics();
}
// ── Exports ─────────────────────────────────────────────────
exports.default = {
    updatePrometheusMetrics,
    incrementRecoveryMetrics,
    createMetricsRouter,
    getRegistry,
    getMetricsString,
};
//# sourceMappingURL=prometheus.metrics.js.map