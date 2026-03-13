"use strict";
// ============================================================
// OrgsLedger API — Global Load Shedder
// Protects API from overload by rejecting requests at capacity
// ============================================================
//
// Monitors:
//   - Redis memory usage
//   - Queue latency (from queue-lag.monitor)
//   - Active WebSocket connections
//   - Active meetings (from meeting-coordinator)
//
// Thresholds:
//   MAX_ACTIVE_MEETINGS = 60000
//   MAX_QUEUE_LATENCY_MS = 2000
//   MAX_WS_CONNECTIONS = 200000
//
// When exceeded:
//   - Reject new meeting creation/join requests
//   - Return HTTP 503 with SYSTEM_AT_CAPACITY error
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
exports.globalLoadShedder = exports.loadShedderRedisMemoryGauge = exports.loadShedderWsConnectionsGauge = exports.loadShedderQueueLatencyGauge = exports.loadShedderActiveMeetingsGauge = exports.loadShedderSheddingGauge = exports.loadShedderRejectionsCounter = void 0;
exports.createLoadShedderMiddleware = createLoadShedderMiddleware;
exports.startLoadShedder = startLoadShedder;
exports.stopLoadShedder = stopLoadShedder;
exports.getLoadShedderStatus = getLoadShedderStatus;
exports.reportWsConnections = reportWsConnections;
exports.reportQueueLatency = reportQueueLatency;
const client = __importStar(require("prom-client"));
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
const DEFAULT_CONFIG = {
    maxActiveMeetings: parseInt(process.env.LOAD_SHEDDER_MAX_MEETINGS || '60000', 10),
    maxQueueLatencyMs: parseInt(process.env.LOAD_SHEDDER_MAX_QUEUE_LATENCY_MS || '2000', 10),
    maxWsConnections: parseInt(process.env.LOAD_SHEDDER_MAX_WS_CONNECTIONS || '200000', 10),
    maxRedisMemoryUsage: parseFloat(process.env.LOAD_SHEDDER_MAX_REDIS_MEMORY || '0.90'),
    refreshIntervalMs: parseInt(process.env.LOAD_SHEDDER_REFRESH_MS || '5000', 10),
    enabled: process.env.LOAD_SHEDDER_ENABLED !== 'false',
    protectedPaths: [
        /^\/api\/v\d+\/meetings\/create$/i,
        /^\/api\/v\d+\/meetings\/join$/i,
        /^\/meetings\/create$/i,
        /^\/meetings\/join$/i,
        /^\/meetings$/i, // POST to create
    ],
};
// ── Prometheus Metrics ──────────────────────────────────────
const PREFIX = 'orgsledger_load_shedder_';
exports.loadShedderRejectionsCounter = new client.Counter({
    name: `${PREFIX}rejections_total`,
    help: 'Total requests rejected by load shedder',
    labelNames: ['reason', 'path'],
});
exports.loadShedderSheddingGauge = new client.Gauge({
    name: `${PREFIX}shedding`,
    help: 'Whether load shedding is active (1=yes, 0=no)',
});
exports.loadShedderActiveMeetingsGauge = new client.Gauge({
    name: `${PREFIX}active_meetings`,
    help: 'Current active meetings count',
});
exports.loadShedderQueueLatencyGauge = new client.Gauge({
    name: `${PREFIX}queue_latency_ms`,
    help: 'Current queue latency in ms',
});
exports.loadShedderWsConnectionsGauge = new client.Gauge({
    name: `${PREFIX}ws_connections`,
    help: 'Current WebSocket connections',
});
exports.loadShedderRedisMemoryGauge = new client.Gauge({
    name: `${PREFIX}redis_memory_usage`,
    help: 'Current Redis memory usage (0-1)',
});
// ── Redis Keys ──────────────────────────────────────────────
const REDIS_KEYS = {
    activeMeetings: 'global:active_meetings',
    wsConnections: 'global:ws_connections',
    queueLatency: 'global:queue_latency_ms',
};
// ── Global Load Shedder Class ───────────────────────────────
class GlobalLoadShedder {
    config;
    redis = null;
    pressure;
    refreshInterval = null;
    isRunning = false;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.pressure = {
            activeMeetings: 0,
            queueLatencyMs: 0,
            wsConnections: 0,
            redisMemoryUsage: 0,
            timestamp: new Date(),
        };
    }
    /**
     * Initialize and start the load shedder.
     */
    async start() {
        if (this.isRunning) {
            logger_1.logger.warn('[LOAD_SHEDDER] Already running');
            return;
        }
        if (!this.config.enabled) {
            logger_1.logger.info('[LOAD_SHEDDER] Disabled via configuration');
            return;
        }
        try {
            this.redis = (0, redisClient_1.createBullMQConnection)();
            this.isRunning = true;
            logger_1.logger.info('[LOAD_SHEDDER] Starting', {
                maxActiveMeetings: this.config.maxActiveMeetings,
                maxQueueLatencyMs: this.config.maxQueueLatencyMs,
                maxWsConnections: this.config.maxWsConnections,
                maxRedisMemoryUsage: `${this.config.maxRedisMemoryUsage * 100}%`,
            });
            // Initial refresh
            await this.refreshPressure();
            // Start periodic refresh
            this.refreshInterval = setInterval(async () => {
                try {
                    await this.refreshPressure();
                }
                catch (err) {
                    logger_1.logger.error('[LOAD_SHEDDER] Refresh failed', {
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }, this.config.refreshIntervalMs);
            this.refreshInterval.unref();
        }
        catch (err) {
            logger_1.logger.error('[LOAD_SHEDDER] Failed to start', {
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    }
    /**
     * Stop the load shedder.
     */
    stop() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
        this.isRunning = false;
        logger_1.logger.info('[LOAD_SHEDDER] Stopped');
    }
    /**
     * Refresh system pressure metrics.
     */
    async refreshPressure() {
        if (!this.redis)
            return;
        try {
            // Get active meetings count
            const activeMeetings = await this.redis.scard(REDIS_KEYS.activeMeetings);
            // Get WebSocket connections (set by socket.ts)
            const wsConnectionsStr = await this.redis.get(REDIS_KEYS.wsConnections);
            const wsConnections = parseInt(wsConnectionsStr || '0', 10);
            // Get queue latency (set by queue-lag.monitor)
            const queueLatencyStr = await this.redis.get(REDIS_KEYS.queueLatency);
            const queueLatencyMs = parseFloat(queueLatencyStr || '0');
            // Get Redis memory usage
            const memoryInfo = await this.redis.info('memory');
            const redisMemoryUsage = this.parseRedisMemoryUsage(memoryInfo);
            // Update pressure
            this.pressure = {
                activeMeetings,
                queueLatencyMs,
                wsConnections,
                redisMemoryUsage,
                timestamp: new Date(),
            };
            // Update Prometheus metrics
            exports.loadShedderActiveMeetingsGauge.set(activeMeetings);
            exports.loadShedderQueueLatencyGauge.set(queueLatencyMs);
            exports.loadShedderWsConnectionsGauge.set(wsConnections);
            exports.loadShedderRedisMemoryGauge.set(redisMemoryUsage);
            // Check if we're shedding
            const status = this.checkPressure();
            exports.loadShedderSheddingGauge.set(status.exceeded ? 1 : 0);
        }
        catch (err) {
            logger_1.logger.error('[LOAD_SHEDDER] Failed to refresh pressure', {
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    /**
     * Parse Redis memory usage from INFO memory response.
     */
    parseRedisMemoryUsage(info) {
        const usedMatch = info.match(/used_memory:(\d+)/);
        const maxMatch = info.match(/maxmemory:(\d+)/);
        if (!usedMatch || !maxMatch)
            return 0;
        const used = parseInt(usedMatch[1], 10);
        const max = parseInt(maxMatch[1], 10);
        if (max === 0)
            return 0; // No maxmemory set
        return used / max;
    }
    /**
     * Check if any pressure threshold is exceeded.
     */
    checkPressure() {
        // Check active meetings
        if (this.pressure.activeMeetings >= this.config.maxActiveMeetings) {
            return {
                exceeded: true,
                reason: 'active_meetings',
                value: this.pressure.activeMeetings,
                threshold: this.config.maxActiveMeetings,
            };
        }
        // Check queue latency
        if (this.pressure.queueLatencyMs >= this.config.maxQueueLatencyMs) {
            return {
                exceeded: true,
                reason: 'queue_latency',
                value: this.pressure.queueLatencyMs,
                threshold: this.config.maxQueueLatencyMs,
            };
        }
        // Check WebSocket connections
        if (this.pressure.wsConnections >= this.config.maxWsConnections) {
            return {
                exceeded: true,
                reason: 'ws_connections',
                value: this.pressure.wsConnections,
                threshold: this.config.maxWsConnections,
            };
        }
        // Check Redis memory
        if (this.pressure.redisMemoryUsage >= this.config.maxRedisMemoryUsage) {
            return {
                exceeded: true,
                reason: 'redis_memory',
                value: this.pressure.redisMemoryUsage,
                threshold: this.config.maxRedisMemoryUsage,
            };
        }
        return { exceeded: false, reason: '', value: 0, threshold: 0 };
    }
    /**
     * Check if a request should be shed.
     */
    shouldShed(path, method) {
        if (!this.config.enabled || !this.isRunning) {
            return { shed: false };
        }
        // Only shed POST requests to protected paths
        if (method.toUpperCase() !== 'POST') {
            return { shed: false };
        }
        // Check if path is protected
        const isProtected = this.config.protectedPaths.some(pattern => pattern.test(path));
        if (!isProtected) {
            return { shed: false };
        }
        // Check pressure
        const pressure = this.checkPressure();
        if (pressure.exceeded) {
            return { shed: true, reason: pressure.reason };
        }
        return { shed: false };
    }
    /**
     * Get current status.
     */
    getStatus() {
        const pressure = this.checkPressure();
        return {
            shedding: pressure.exceeded,
            reason: pressure.exceeded ? pressure.reason : undefined,
            pressure: this.pressure,
            thresholds: {
                maxActiveMeetings: this.config.maxActiveMeetings,
                maxQueueLatencyMs: this.config.maxQueueLatencyMs,
                maxWsConnections: this.config.maxWsConnections,
                maxRedisMemoryUsage: this.config.maxRedisMemoryUsage,
            },
        };
    }
    /**
     * Report WebSocket connection count (called by socket.ts).
     */
    async reportWsConnections(count) {
        if (!this.redis)
            return;
        await this.redis.set(REDIS_KEYS.wsConnections, count.toString());
    }
    /**
     * Report queue latency (called by queue-lag.monitor).
     */
    async reportQueueLatency(latencyMs) {
        if (!this.redis)
            return;
        await this.redis.set(REDIS_KEYS.queueLatency, latencyMs.toString());
    }
}
// ── Singleton ───────────────────────────────────────────────
exports.globalLoadShedder = new GlobalLoadShedder();
// ── Express Middleware ──────────────────────────────────────
/**
 * Create Express middleware for load shedding.
 *
 * Usage:
 * ```ts
 * import { createLoadShedderMiddleware } from './scaling/global-load-shedder';
 * app.use(createLoadShedderMiddleware());
 * ```
 */
function createLoadShedderMiddleware() {
    return (req, res, next) => {
        const { shed, reason } = exports.globalLoadShedder.shouldShed(req.path, req.method);
        if (shed) {
            // Increment rejection counter
            exports.loadShedderRejectionsCounter.inc({
                reason: reason || 'unknown',
                path: req.path,
            });
            logger_1.logger.warn('[LOAD_SHEDDER] Rejecting request', {
                path: req.path,
                method: req.method,
                reason,
                ip: req.ip,
            });
            res.status(503).json({
                error: 'SYSTEM_AT_CAPACITY',
                message: 'The system is temporarily at capacity. Please retry shortly.',
                retryAfter: 30,
            });
            return;
        }
        next();
    };
}
// ── Exports ─────────────────────────────────────────────────
async function startLoadShedder() {
    await exports.globalLoadShedder.start();
}
function stopLoadShedder() {
    exports.globalLoadShedder.stop();
}
function getLoadShedderStatus() {
    return exports.globalLoadShedder.getStatus();
}
async function reportWsConnections(count) {
    return exports.globalLoadShedder.reportWsConnections(count);
}
async function reportQueueLatency(latencyMs) {
    return exports.globalLoadShedder.reportQueueLatency(latencyMs);
}
//# sourceMappingURL=global-load-shedder.js.map