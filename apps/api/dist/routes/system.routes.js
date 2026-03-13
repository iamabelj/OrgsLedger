"use strict";
// ============================================================
// OrgsLedger API — System Health Routes
// Production health endpoint for K8s, load balancers, uptime monitors
// Mounted at /api/system/*
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
const express_1 = require("express");
const system_monitor_1 = require("../monitoring/system.monitor");
const meeting_metrics_1 = require("../monitoring/meeting-metrics");
const prometheus_metrics_1 = require("../monitoring/prometheus.metrics");
const worker_heartbeat_monitor_1 = require("../monitoring/worker-heartbeat.monitor");
const backpressure_1 = require("../scaling/backpressure");
const ai_rate_limit_guard_1 = require("../monitoring/ai-rate-limit.guard");
const redisShardRouter_1 = require("../infrastructure/redisShardRouter");
const queue_metrics_exporter_1 = require("../monitoring/queue-metrics.exporter");
const meeting_cleanup_service_1 = require("../services/meeting-cleanup.service");
const cost_guard_middleware_1 = require("../middleware/cost-guard.middleware");
const queue_manager_1 = require("../queues/queue-manager");
const logger_1 = require("../logger");
const worker_identity_1 = require("../scaling/worker-identity");
const broadcast_batch_1 = require("../scaling/broadcast-batch");
const ws_throttle_1 = require("../scaling/ws-throttle");
const router = (0, express_1.Router)();
// ── Constants ─────────────────────────────────────────────
// Queue name mapping from internal names to response keys
const QUEUE_NAME_MAP = {
    'transcript': 'transcript',
    'translation': 'translation',
    'broadcast': 'broadcast',
    'minutes': 'minutes',
};
// Thresholds for status determination
const THRESHOLDS = {
    queueBacklog: 100, // waiting jobs threshold for DEGRADED
};
// ── Health Endpoint ───────────────────────────────────────
/**
 * GET /api/system/health
 *
 * Production health check endpoint for:
 * - Kubernetes liveness/readiness probes
 * - Load balancer health checks
 * - Uptime monitoring services
 *
 * Returns within 100ms under normal conditions.
 *
 * Status Codes:
 * - 200: HEALTHY or DEGRADED (system operational)
 * - 503: UNHEALTHY (core services down)
 */
router.get('/health', async (_req, res) => {
    const startTime = Date.now();
    try {
        // Get health report with timeout protection
        const reportPromise = (0, system_monitor_1.getHealthReport)();
        const timeoutPromise = new Promise((resolve) => {
            setTimeout(() => resolve(null), 90); // 90ms timeout to stay under 100ms
        });
        const report = await Promise.race([reportPromise, timeoutPromise]);
        // If timeout occurred, return degraded status
        if (!report) {
            logger_1.logger.warn('[SYSTEM_HEALTH] Health check timed out');
            return res.status(200).json({
                status: 'DEGRADED',
                redis: { connected: false, latencyMs: 0 },
                postgres: { connected: false, latencyMs: 0 },
                queues: {
                    transcript: { waiting: 0, active: 0, failed: 0, paused: false, stuckJobs: 0 },
                    translation: { waiting: 0, active: 0, failed: 0, paused: false, stuckJobs: 0 },
                    broadcast: { waiting: 0, active: 0, failed: 0, paused: false, stuckJobs: 0 },
                    minutes: { waiting: 0, active: 0, failed: 0, paused: false, stuckJobs: 0 },
                },
                workers: {
                    transcript: 'unhealthy',
                    translation: 'unhealthy',
                    broadcast: 'unhealthy',
                    minutes: 'unhealthy',
                },
                pipeline: {
                    transcriptLatencyMs: 0,
                    translationLatencyMs: 0,
                    broadcastLatencyMs: 0,
                    minutesGenerationMs: 0,
                },
                aiCosts: {
                    deepgramMinutes: 0,
                    openaiTokens: 0,
                    estimatedCostUSD: 0,
                },
                _meta: {
                    responseTimeMs: Date.now() - startTime,
                    timeout: true,
                },
            });
        }
        // Determine status based on rules
        let status = 'HEALTHY';
        // UNHEALTHY if core services are down
        if (!report.redis.connected || !report.postgres.connected) {
            status = 'UNHEALTHY';
        }
        // DEGRADED conditions
        else {
            // Check for inactive workers
            const hasInactiveWorker = report.workers.some(w => !w.running && w.processed > 0);
            // Check for queue backlogs
            const hasQueueBacklog = report.queues.some(q => q.waiting > THRESHOLDS.queueBacklog);
            // Check for stuck jobs
            const hasStuckJobs = report.queues.some(q => q.stuckJobs > 0);
            // Check for AI cost alerts
            const hasCostAlerts = report.aiCost.alerts.length > 0;
            if (hasInactiveWorker || hasQueueBacklog || hasStuckJobs || hasCostAlerts) {
                status = 'DEGRADED';
            }
        }
        // Build queue status map
        const queues = {
            transcript: { waiting: 0, active: 0, failed: 0, paused: false, stuckJobs: 0 },
            translation: { waiting: 0, active: 0, failed: 0, paused: false, stuckJobs: 0 },
            broadcast: { waiting: 0, active: 0, failed: 0, paused: false, stuckJobs: 0 },
            minutes: { waiting: 0, active: 0, failed: 0, paused: false, stuckJobs: 0 },
        };
        for (const q of report.queues) {
            const key = QUEUE_NAME_MAP[q.name];
            if (key) {
                queues[key] = {
                    waiting: q.waiting,
                    active: q.active,
                    failed: q.failed,
                    paused: q.paused,
                    stuckJobs: q.stuckJobs,
                };
            }
        }
        // Build worker status map
        const workers = {
            transcript: 'inactive',
            translation: 'inactive',
            broadcast: 'inactive',
            minutes: 'inactive',
        };
        for (const w of report.workers) {
            const key = w.name;
            if (key in workers) {
                if (!w.healthy) {
                    workers[key] = 'unhealthy';
                }
                else if (w.running) {
                    workers[key] = 'running';
                }
                else {
                    workers[key] = 'inactive';
                }
            }
        }
        // Build response
        const response = {
            status,
            redis: {
                connected: report.redis.connected,
                latencyMs: report.redis.latencyMs,
            },
            postgres: {
                connected: report.postgres.connected,
                latencyMs: report.postgres.latencyMs,
            },
            queues,
            workers,
            pipeline: {
                transcriptLatencyMs: report.pipeline.transcriptPipelineDelayMs,
                translationLatencyMs: report.pipeline.translationDurationMs,
                broadcastLatencyMs: report.pipeline.broadcastLatencyMs,
                minutesGenerationMs: report.pipeline.minutesGenerationMs,
            },
            aiCosts: {
                deepgramMinutes: report.aiCost.deepgramMinutes,
                openaiTokens: report.aiCost.openaiInputTokens + report.aiCost.openaiOutputTokens,
                estimatedCostUSD: Math.round(report.aiCost.estimatedCostUSD * 100) / 100,
            },
        };
        // Return appropriate status code
        const httpStatus = status === 'UNHEALTHY' ? 503 : 200;
        // Add response time metadata
        const responseWithMeta = {
            ...response,
            _meta: {
                responseTimeMs: Date.now() - startTime,
                timestamp: report.timestamp,
            },
        };
        res.status(httpStatus).json(responseWithMeta);
    }
    catch (err) {
        logger_1.logger.error('[SYSTEM_HEALTH] Health check failed', { error: err.message });
        // Return UNHEALTHY on error
        res.status(503).json({
            status: 'UNHEALTHY',
            redis: { connected: false, latencyMs: 0 },
            postgres: { connected: false, latencyMs: 0 },
            queues: {
                transcript: { waiting: 0, active: 0, failed: 0, paused: false, stuckJobs: 0 },
                translation: { waiting: 0, active: 0, failed: 0, paused: false, stuckJobs: 0 },
                broadcast: { waiting: 0, active: 0, failed: 0, paused: false, stuckJobs: 0 },
                minutes: { waiting: 0, active: 0, failed: 0, paused: false, stuckJobs: 0 },
            },
            workers: {
                transcript: 'unhealthy',
                translation: 'unhealthy',
                broadcast: 'unhealthy',
                minutes: 'unhealthy',
            },
            pipeline: {
                transcriptLatencyMs: 0,
                translationLatencyMs: 0,
                broadcastLatencyMs: 0,
                minutesGenerationMs: 0,
            },
            aiCosts: {
                deepgramMinutes: 0,
                openaiTokens: 0,
                estimatedCostUSD: 0,
            },
            _meta: {
                responseTimeMs: Date.now() - startTime,
                error: err.message,
            },
        });
    }
});
/**
 * GET /api/system/health/live
 *
 * Minimal liveness probe for Kubernetes.
 * Returns 200 if the process is running.
 */
router.get('/health/live', (_req, res) => {
    res.status(200).json({ alive: true });
});
/**
 * GET /api/system/health/ready
 *
 * Readiness probe for Kubernetes.
 * Returns 200 only if Redis and Postgres are connected.
 */
router.get('/health/ready', async (_req, res) => {
    try {
        const report = await Promise.race([
            (0, system_monitor_1.getHealthReport)(),
            new Promise((resolve) => setTimeout(() => resolve(null), 50)),
        ]);
        if (!report) {
            return res.status(503).json({ ready: false, reason: 'timeout' });
        }
        if (!report.redis.connected || !report.postgres.connected) {
            return res.status(503).json({
                ready: false,
                redis: report.redis.connected,
                postgres: report.postgres.connected,
            });
        }
        res.status(200).json({ ready: true });
    }
    catch (err) {
        res.status(503).json({ ready: false, reason: err.message });
    }
});
// ── Meeting Pipeline Metrics Endpoint ─────────────────────
/**
 * GET /api/system/meeting-metrics/:meetingId
 *
 * Returns aggregated pipeline metrics for a specific meeting.
 *
 * Response:
 * - meetingId: UUID
 * - transcriptsGenerated: number
 * - translationsGenerated: number
 * - broadcastEvents: number
 * - minutesGenerationMs: number | null
 * - createdAt: ISO timestamp
 * - updatedAt: ISO timestamp
 */
router.get('/meeting-metrics/:meetingId', async (req, res) => {
    const { meetingId } = req.params;
    // Basic UUID validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(meetingId)) {
        return res.status(400).json({
            error: 'Invalid meetingId format',
            message: 'meetingId must be a valid UUID',
        });
    }
    try {
        const metrics = await (0, meeting_metrics_1.getMeetingMetrics)(meetingId);
        if (!metrics) {
            return res.status(404).json({
                error: 'Not found',
                message: `No metrics found for meeting ${meetingId}`,
            });
        }
        res.status(200).json(metrics);
    }
    catch (err) {
        logger_1.logger.error('[SYSTEM_ROUTES] Failed to get meeting metrics', {
            meetingId,
            error: err.message,
        });
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to retrieve meeting metrics',
        });
    }
});
// ── Worker Status Endpoint ────────────────────────────────
/**
 * GET /api/system/workers
 *
 * Returns current status of all BullMQ workers.
 * Includes heartbeat health, active jobs, and worker metadata.
 *
 * Response:
 * - totalWorkers: number of registered workers
 * - aliveWorkers: workers with recent heartbeat
 * - unhealthyWorkers: workers with stale heartbeat (<60s)
 * - deadWorkers: workers unhealthy for >60s
 * - workers[]: detailed worker status array
 */
router.get('/workers', async (_req, res) => {
    try {
        const stats = await (0, worker_heartbeat_monitor_1.getWorkerHeartbeatStats)();
        res.status(200).json({
            ...stats,
            _meta: {
                timestamp: new Date().toISOString(),
                heartbeatTtlMs: 15000,
                deadThresholdMs: 60000,
            },
        });
    }
    catch (err) {
        logger_1.logger.error('[SYSTEM_ROUTES] Failed to get worker stats', {
            error: err.message,
        });
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to retrieve worker status',
        });
    }
});
/**
 * GET /api/system/workers/:workerName
 *
 * Returns status of workers by name.
 */
router.get('/workers/:workerName', async (req, res) => {
    try {
        const { workerName } = req.params;
        const stats = await (0, worker_heartbeat_monitor_1.getWorkerHeartbeatStats)();
        const workers = stats.workers.filter(w => w.workerName === workerName);
        res.status(200).json({
            workerName,
            count: workers.length,
            alive: workers.filter(w => w.status === 'alive').length,
            unhealthy: workers.filter(w => w.status === 'unhealthy').length,
            dead: workers.filter(w => w.status === 'dead').length,
            workers,
        });
    }
    catch (err) {
        logger_1.logger.error('[SYSTEM_ROUTES] Failed to get worker stats by name', {
            error: err.message,
        });
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to retrieve worker status',
        });
    }
});
// ── Backpressure Status Endpoint ──────────────────────────
/**
 * GET /api/system/backpressure
 *
 * Returns backpressure status for all queues.
 * Useful for monitoring and alerting on queue capacity.
 */
router.get('/backpressure', async (_req, res) => {
    try {
        const status = await (0, backpressure_1.getAllBackpressureStatus)();
        // Calculate overall status
        const allAllowed = Object.values(status).every(s => s.allowed);
        const anyOverloaded = Object.values(status).some(s => !s.allowed);
        res.status(200).json({
            status: anyOverloaded ? 'OVERLOADED' : 'NORMAL',
            queues: status,
            summary: {
                totalQueues: Object.keys(status).length,
                overloadedQueues: Object.values(status).filter(s => !s.allowed).length,
                highestUtilization: Math.max(...Object.values(status).map(s => s.utilizationPercent)),
            },
        });
    }
    catch (err) {
        logger_1.logger.error('[SYSTEM_ROUTES] Failed to get backpressure status', {
            error: err.message,
        });
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to retrieve backpressure status',
        });
    }
});
// ── AI Rate Limit Status Endpoint ─────────────────────────
/**
 * GET /api/system/ai-rate-limits
 *
 * Returns AI service rate limit status.
 * Useful for monitoring and alerting on AI service capacity.
 */
router.get('/ai-rate-limits', async (_req, res) => {
    try {
        const metrics = await (0, ai_rate_limit_guard_1.getAIRateLimitMetrics)();
        res.status(200).json({
            status: metrics.anyBackpressureActive ? 'DEGRADED' : 'NORMAL',
            services: {
                deepgram: metrics.deepgram,
                openai: metrics.openai,
                translate: metrics.translate,
            },
            degradationStrategies: metrics.degradationStrategies,
            summary: {
                anyBackpressureActive: metrics.anyBackpressureActive,
                highestUtilization: Math.max(metrics.deepgram.utilizationPercent, metrics.openai.utilizationPercent, metrics.translate.utilizationPercent),
                servicesInWarning: [
                    metrics.deepgram.isWarning && 'deepgram',
                    metrics.openai.isWarning && 'openai',
                    metrics.translate.isWarning && 'translate',
                ].filter(Boolean),
                servicesInBackpressure: [
                    metrics.deepgram.backpressureActive && 'deepgram',
                    metrics.openai.backpressureActive && 'openai',
                    metrics.translate.backpressureActive && 'translate',
                ].filter(Boolean),
            },
        });
    }
    catch (err) {
        logger_1.logger.error('[SYSTEM_ROUTES] Failed to get AI rate limit status', {
            error: err.message,
        });
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to retrieve AI rate limit status',
        });
    }
});
// ── AI Cost Guard Status Endpoint ─────────────────────────
/**
 * GET /api/system/cost-guard
 *
 * Returns AI cost guard status including:
 * - Current budget utilization
 * - Whether new meetings are being blocked
 * - Cost breakdown by service
 * - Remaining budget
 */
router.get('/cost-guard', async (_req, res) => {
    try {
        const status = await (0, cost_guard_middleware_1.getCostGuardStatus)();
        res.status(200).json({
            status: status.isBlocking ? 'BUDGET_EXCEEDED' : 'NORMAL',
            ...status,
            timestamp: new Date().toISOString(),
        });
    }
    catch (err) {
        logger_1.logger.error('[SYSTEM_ROUTES] Failed to get cost guard status', {
            error: err.message,
        });
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to retrieve cost guard status',
        });
    }
});
// ── Redis Shard Stats Endpoint ────────────────────────────
/**
 * GET /api/system/redis-shards
 *
 * Returns Redis shard distribution statistics.
 * Useful for monitoring data distribution and memory usage.
 */
router.get('/redis-shards', async (_req, res) => {
    try {
        const stats = await (0, redisShardRouter_1.getRedisShardStats)();
        res.status(200).json({
            status: stats.activeConnections === stats.totalConnections ? 'HEALTHY' : 'DEGRADED',
            ...stats,
            summary: {
                totalShards: stats.shardCount,
                nodesOnline: stats.activeConnections,
                nodesOffline: stats.totalConnections - stats.activeConnections,
                totalMemoryUsed: stats.shards.reduce((sum, s) => sum + (s.memoryUsed || 0), 0),
            },
        });
    }
    catch (err) {
        logger_1.logger.error('[SYSTEM_ROUTES] Failed to get Redis shard stats', {
            error: err.message,
        });
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to retrieve Redis shard statistics',
        });
    }
});
// ── Queue Metrics Endpoint ────────────────────────────────
/**
 * GET /api/system/queue-metrics
 *
 * Returns BullMQ sharded queue metrics and statistics.
 * Data is collected every 5 seconds and cached.
 */
router.get('/queue-metrics', async (_req, res) => {
    try {
        const exporter = (0, queue_metrics_exporter_1.getQueueMetricsExporter)();
        const summary = exporter.getStatsSummary();
        res.status(200).json({
            status: 'OK',
            isRunning: exporter.isRunning(),
            collectionIntervalMs: 5000,
            lastCollectionTime: summary.lastCollectionTime,
            lastCollectionAgeMs: summary.lastCollectionTime
                ? Date.now() - summary.lastCollectionTime
                : null,
            byQueue: summary.byQueue,
            totals: summary.totals,
        });
    }
    catch (err) {
        logger_1.logger.error('[SYSTEM_ROUTES] Failed to get queue metrics', {
            error: err.message,
        });
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to retrieve queue metrics',
        });
    }
});
/**
 * GET /api/system/queue-metrics/:queueType
 *
 * Returns detailed per-shard statistics for a specific queue type.
 * Valid queue types: transcript, translation, broadcast, minutes
 */
router.get('/queue-metrics/:queueType', async (req, res) => {
    try {
        const { queueType } = req.params;
        const validTypes = Object.values(queue_manager_1.SHARDED_QUEUE_TYPES);
        if (!validTypes.includes(queueType)) {
            return res.status(400).json({
                error: 'Invalid queue type',
                message: `Valid types: ${validTypes.join(', ')}`,
            });
        }
        const exporter = (0, queue_metrics_exporter_1.getQueueMetricsExporter)();
        const stats = exporter.getQueueStats(queueType);
        if (!stats) {
            return res.status(404).json({
                error: 'No stats available',
                message: 'Metrics collection may not have run yet. Try again shortly.',
            });
        }
        res.status(200).json({
            status: 'OK',
            queueType,
            totalShards: stats.totalShards,
            totals: stats.totals,
            shards: stats.shards,
        });
    }
    catch (err) {
        logger_1.logger.error('[SYSTEM_ROUTES] Failed to get queue type metrics', {
            error: err.message,
            queueType: req.params.queueType,
        });
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to retrieve queue metrics',
        });
    }
});
// ── Prometheus Metrics Endpoint ───────────────────────────
/**
 * GET /api/system/metrics
 *
 * Prometheus-compatible metrics scrape endpoint.
 * Returns all system metrics in Prometheus text exposition format.
 *
 * Response: text/plain
 * - Node.js runtime metrics (memory, CPU, event loop)
 * - AI usage metrics (Deepgram, OpenAI, Translation)
 * - Queue metrics (waiting, active, failed, stuck jobs)
 * - Worker metrics (processed, failed, health)
 * - Pipeline metrics (latency, throughput)
 * - System health metrics (Redis, PostgreSQL connectivity)
 * - Recovery metrics (jobs recovered/failed)
 *
 * For Prometheus scrape config:
 *   - job_name: 'orgsledger-api'
 *     static_configs:
 *       - targets: ['api:3001']
 *     metrics_path: '/api/system/metrics'
 */
router.get('/metrics', async (_req, res) => {
    try {
        const registry = (0, prometheus_metrics_1.getRegistry)();
        res.set('Content-Type', registry.contentType);
        const metrics = await (0, prometheus_metrics_1.getMetricsString)();
        res.end(metrics);
    }
    catch (err) {
        logger_1.logger.error('[SYSTEM_ROUTES] Failed to generate Prometheus metrics', {
            error: err.message,
        });
        res.status(500).end('Error generating metrics');
    }
});
// ── Internal Metrics Endpoint (JSON) ──────────────────────
/**
 * GET /api/system/internal/metrics
 *
 * Comprehensive JSON metrics endpoint for scaling dashboards.
 * Returns system-wide metrics for 50k+ meeting scale monitoring.
 *
 * Response includes:
 * - activeMeetings: Estimated active meetings count
 * - queueDepth: Per-queue-type depth and DLQ stats
 * - workerHealth: Worker status and scaling info
 * - throughput: Jobs processed per minute estimates
 * - backpressure: Throttle and batch stats
 * - infrastructure: Redis, CPU, memory info
 *
 * Use for:
 * - Real-time dashboards
 * - Auto-scaling decisions
 * - Capacity planning
 */
router.get('/internal/metrics', async (_req, res) => {
    const startTime = Date.now();
    try {
        // Gather all queue stats in parallel
        const [transcriptStats, translationStats, broadcastStats, minutesStats, transcriptDLQ, translationDLQ, broadcastDLQ, minutesDLQ, healthReport, workerStats, backpressureStatus, aiRateMetrics,] = await Promise.all([
            (0, queue_manager_1.getShardStats)(queue_manager_1.SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS),
            (0, queue_manager_1.getShardStats)(queue_manager_1.SHARDED_QUEUE_TYPES.TRANSLATION_JOBS),
            (0, queue_manager_1.getShardStats)(queue_manager_1.SHARDED_QUEUE_TYPES.BROADCAST_EVENTS),
            (0, queue_manager_1.getShardStats)(queue_manager_1.SHARDED_QUEUE_TYPES.MINUTES_GENERATION),
            (0, queue_manager_1.getDLQStats)(queue_manager_1.SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS),
            (0, queue_manager_1.getDLQStats)(queue_manager_1.SHARDED_QUEUE_TYPES.TRANSLATION_JOBS),
            (0, queue_manager_1.getDLQStats)(queue_manager_1.SHARDED_QUEUE_TYPES.BROADCAST_EVENTS),
            (0, queue_manager_1.getDLQStats)(queue_manager_1.SHARDED_QUEUE_TYPES.MINUTES_GENERATION),
            (0, system_monitor_1.getHealthReport)().catch(() => null),
            (0, worker_heartbeat_monitor_1.getWorkerHeartbeatStats)().catch(() => null),
            (0, backpressure_1.getAllBackpressureStatus)().catch(() => ({})),
            (0, ai_rate_limit_guard_1.getAIRateLimitMetrics)().catch(() => null),
        ]);
        // Calculate queue totals
        const totalWaiting = sumTotalsField([transcriptStats, translationStats, broadcastStats, minutesStats], 'waiting');
        const totalActive = sumTotalsField([transcriptStats, translationStats, broadcastStats, minutesStats], 'active');
        const totalFailed = sumTotalsField([transcriptStats, translationStats, broadcastStats, minutesStats], 'failed');
        // Calculate DLQ totals
        const dlqTotal = transcriptDLQ.waiting + translationDLQ.waiting + broadcastDLQ.waiting + minutesDLQ.waiting;
        // Estimate active meetings from queue activity
        // Rough heuristic: active queue jobs / 3 (approx jobs per meeting)
        const estimatedActiveMeetings = Math.ceil((totalActive + transcriptStats.totals.waiting) / 3);
        // Get throttle and batch stats
        let broadcastBatchStats = null;
        let wsThrottleStats = null;
        try {
            broadcastBatchStats = (0, broadcast_batch_1.getBroadcastBatchStats)();
            wsThrottleStats = (0, ws_throttle_1.getWSThrottleStats)();
        }
        catch {
            // Stats may not be available if scaling modules not initialized
        }
        const response = {
            status: 'OK',
            timestamp: new Date().toISOString(),
            workerId: worker_identity_1.WORKER_ID,
            // ── Active Meetings ─────────────────────────────────
            activeMeetings: {
                estimated: estimatedActiveMeetings,
                note: 'Estimated from queue activity',
            },
            // ── Queue Depths ────────────────────────────────────
            queueDepth: {
                total: {
                    waiting: totalWaiting,
                    active: totalActive,
                    failed: totalFailed,
                    dlq: dlqTotal,
                },
                transcript: {
                    waiting: transcriptStats.totals.waiting,
                    active: transcriptStats.totals.active,
                    failed: transcriptStats.totals.failed,
                    shards: transcriptStats.totalShards,
                    dlq: transcriptDLQ.waiting,
                },
                translation: {
                    waiting: translationStats.totals.waiting,
                    active: translationStats.totals.active,
                    failed: translationStats.totals.failed,
                    shards: translationStats.totalShards,
                    dlq: translationDLQ.waiting,
                },
                broadcast: {
                    waiting: broadcastStats.totals.waiting,
                    active: broadcastStats.totals.active,
                    failed: broadcastStats.totals.failed,
                    shards: broadcastStats.totalShards,
                    dlq: broadcastDLQ.waiting,
                },
                minutes: {
                    waiting: minutesStats.totals.waiting,
                    active: minutesStats.totals.active,
                    failed: minutesStats.totals.failed,
                    shards: minutesStats.totalShards,
                    dlq: minutesDLQ.waiting,
                },
            },
            // ── Worker Health ───────────────────────────────────
            workerHealth: {
                totalWorkers: workerStats?.totalWorkers || 0,
                aliveWorkers: workerStats?.aliveWorkers || 0,
                unhealthyWorkers: workerStats?.unhealthyWorkers || 0,
                deadWorkers: workerStats?.deadWorkers || 0,
                cpuCores: worker_identity_1.CPU_CORES,
                status: workerStats
                    ? (workerStats.unhealthyWorkers === 0 && workerStats.deadWorkers === 0 ? 'HEALTHY' : 'DEGRADED')
                    : 'UNKNOWN',
            },
            // ── Throughput Estimates ────────────────────────────
            throughput: {
                transcriptsPerMinute: healthReport?.pipeline?.transcriptThroughputPerMin || 0,
                translationsPerMinute: healthReport?.pipeline?.translationThroughputPerMin || 0,
                latency: {
                    transcriptMs: healthReport?.pipeline?.transcriptPipelineDelayMs || 0,
                    translationMs: healthReport?.pipeline?.translationDurationMs || 0,
                    broadcastMs: healthReport?.pipeline?.broadcastLatencyMs || 0,
                },
            },
            // ── Backpressure & Throttling ───────────────────────
            backpressure: {
                queues: backpressureStatus,
                broadcastBatch: broadcastBatchStats,
                wsThrottle: wsThrottleStats,
                aiRateLimits: aiRateMetrics ? {
                    deepgramUtilization: aiRateMetrics.deepgram?.utilizationPercent || 0,
                    openaiUtilization: aiRateMetrics.openai?.utilizationPercent || 0,
                    translateUtilization: aiRateMetrics.translate?.utilizationPercent || 0,
                    anyBackpressure: aiRateMetrics.anyBackpressureActive || false,
                } : null,
            },
            // ── Infrastructure ──────────────────────────────────
            infrastructure: {
                redis: healthReport?.redis || { connected: false, latencyMs: 0 },
                postgres: healthReport?.postgres || { connected: false, latencyMs: 0 },
                memory: {
                    heapUsed: process.memoryUsage().heapUsed,
                    heapTotal: process.memoryUsage().heapTotal,
                    external: process.memoryUsage().external,
                    rss: process.memoryUsage().rss,
                },
                uptime: process.uptime(),
            },
            // ── Response Metadata ───────────────────────────────
            _meta: {
                responseTimeMs: Date.now() - startTime,
                version: '2.0.0', // Scaling version
            },
        };
        res.status(200).json(response);
    }
    catch (err) {
        logger_1.logger.error('[SYSTEM_ROUTES] Failed to get internal metrics', {
            error: err.message,
        });
        res.status(500).json({
            status: 'ERROR',
            error: err.message,
            timestamp: new Date().toISOString(),
            _meta: {
                responseTimeMs: Date.now() - startTime,
            },
        });
    }
});
// Helper function to sum a field from totals across multiple stats objects
function sumTotalsField(stats, field) {
    return stats.reduce((sum, s) => sum + (s?.totals?.[field] || 0), 0);
}
// ── Meeting Cleanup Endpoints ─────────────────────────────
/**
 * POST /api/system/meeting-cleanup/:meetingId
 *
 * Manually trigger cleanup for a specific meeting.
 * Useful for debugging or force-evicting stuck meetings.
 */
router.post('/meeting-cleanup/:meetingId', async (req, res) => {
    try {
        const { meetingId } = req.params;
        const { organizationId } = req.body;
        const result = await (0, meeting_cleanup_service_1.cleanupMeeting)(meetingId, organizationId);
        res.status(result.success ? 200 : 207).json({
            status: result.success ? 'OK' : 'PARTIAL',
            meetingId,
            durationMs: result.durationMs,
            steps: result.steps,
            errors: result.errors.length > 0 ? result.errors : undefined,
        });
    }
    catch (err) {
        logger_1.logger.error('[SYSTEM_ROUTES] Meeting cleanup failed', {
            error: err.message,
            meetingId: req.params.meetingId,
        });
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to cleanup meeting',
        });
    }
});
/**
 * POST /api/system/meeting-cleanup/stale
 *
 * Trigger auto-cleanup of stale meetings.
 * Finds meetings inactive for maxAgeHours and cleans them up.
 */
router.post('/meeting-cleanup/stale', async (req, res) => {
    try {
        const maxAgeHours = parseInt(req.body.maxAgeHours || '24', 10);
        const result = await (0, meeting_cleanup_service_1.autoCleanupStaleMeetings)(maxAgeHours);
        res.status(200).json({
            status: 'OK',
            maxAgeHours,
            cleaned: result.cleaned,
            errors: result.errors,
        });
    }
    catch (err) {
        logger_1.logger.error('[SYSTEM_ROUTES] Stale meeting cleanup failed', {
            error: err.message,
        });
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to cleanup stale meetings',
        });
    }
});
/**
 * GET /api/system/dependency-check
 *
 * Returns dependency health status including:
 * - Redis connection status
 * - Required NPM packages availability
 * - Configuration status for critical services
 *
 * Used by deployment pipelines and monitoring.
 */
router.get('/dependency-check', async (_req, res) => {
    try {
        const result = {
            status: 'HEALTHY',
            timestamp: new Date().toISOString(),
            dependencies: {
                redis: { status: 'ok' },
                packages: [],
                config: {
                    deepgram: false,
                    livekit: false,
                    openai: false,
                    translationProvider: 'none',
                },
            },
        };
        // Check Redis connectivity
        try {
            const { redisClientManager } = await Promise.resolve().then(() => __importStar(require('../infrastructure/redisClient')));
            const health = await redisClientManager.healthCheck();
            result.dependencies.redis = {
                status: health.healthy ? 'ok' : 'error',
                latencyMs: health.latencyMs,
                error: health.healthy ? undefined : 'Redis connection failed',
            };
        }
        catch (err) {
            result.dependencies.redis = {
                status: 'error',
                error: err.message,
            };
            result.status = 'DEGRADED';
        }
        // Check required NPM packages (safe import check)
        const packageChecks = [
            { name: 'ioredis', importPath: 'ioredis' },
            { name: 'franc', importPath: 'franc' },
            { name: '@google-cloud/translate', importPath: '@google-cloud/translate' },
            { name: 'deepl-node', importPath: 'deepl-node' },
            { name: 'openai', importPath: 'openai' },
            { name: 'bullmq', importPath: 'bullmq' },
        ];
        for (const pkg of packageChecks) {
            try {
                // Dynamic import to check availability
                const mod = await Promise.resolve(`${pkg.importPath}`).then(s => __importStar(require(s)));
                const version = mod.version || mod.default?.version || 'unknown';
                result.dependencies.packages.push({
                    name: pkg.name,
                    status: 'ok',
                    version: typeof version === 'string' ? version : 'loaded',
                });
            }
            catch (err) {
                result.dependencies.packages.push({
                    name: pkg.name,
                    status: 'missing',
                    error: err.message,
                });
                result.status = 'DEGRADED';
            }
        }
        // Check configuration
        const { config } = await Promise.resolve().then(() => __importStar(require('../config')));
        result.dependencies.config = {
            deepgram: !!config.deepgram?.apiKey,
            livekit: !!(config.livekit?.url && config.livekit?.apiKey && config.livekit?.apiSecret),
            openai: !!config.ai?.openaiApiKey,
            translationProvider: config.translation?.provider || 'none',
        };
        // Set status based on critical config
        if (!result.dependencies.config.deepgram || !result.dependencies.config.livekit) {
            // In production, missing critical config is unhealthy
            if (config.env === 'production' || config.env === 'staging') {
                result.status = 'UNHEALTHY';
            }
            else {
                result.status = 'DEGRADED';
            }
        }
        const statusCode = result.status === 'HEALTHY' ? 200 : result.status === 'DEGRADED' ? 200 : 503;
        res.status(statusCode).json(result);
    }
    catch (err) {
        logger_1.logger.error('[SYSTEM_ROUTES] Dependency check failed', {
            error: err.message,
        });
        res.status(500).json({
            status: 'UNHEALTHY',
            timestamp: new Date().toISOString(),
            error: 'Failed to run dependency check',
            message: err.message,
        });
    }
});
exports.default = router;
//# sourceMappingURL=system.routes.js.map