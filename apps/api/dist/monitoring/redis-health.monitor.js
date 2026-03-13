"use strict";
// ============================================================
// OrgsLedger API — Redis Health Monitor
// Monitors Redis memory pressure and connection health
// ============================================================
//
// Metrics Monitored:
//   - used_memory / maxmemory
//   - evicted_keys (CRITICAL if > 0)
//   - mem_fragmentation_ratio
//   - connected_clients
//   - blocked_clients
//   - keyspace_hits / keyspace_misses
//
// Alerts:
//   - Memory usage > 80%: WARNING
//   - Memory usage > 95%: CRITICAL
//   - Evicted keys > 0: CRITICAL
//   - Fragmentation ratio > 1.5: WARNING
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
exports.redisHealthMonitor = exports.redisHealthAlertsCounter = exports.redisHitRateGauge = exports.redisOpsPerSecGauge = exports.redisBlockedClientsGauge = exports.redisConnectedClientsGauge = exports.redisFragmentationGauge = exports.redisEvictedKeysGauge = exports.redisMemoryUsageGauge = exports.redisMemoryMaxGauge = exports.redisMemoryUsedGauge = void 0;
exports.startRedisHealthMonitor = startRedisHealthMonitor;
exports.stopRedisHealthMonitor = stopRedisHealthMonitor;
exports.getRedisHealthReport = getRedisHealthReport;
exports.getLastRedisHealthReport = getLastRedisHealthReport;
exports.onRedisHealthAlert = onRedisHealthAlert;
const client = __importStar(require("prom-client"));
const events_1 = require("events");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
const DEFAULT_CONFIG = {
    checkIntervalMs: parseInt(process.env.REDIS_HEALTH_CHECK_INTERVAL_MS || '30000', 10),
    memoryWarningThreshold: parseFloat(process.env.REDIS_MEMORY_WARNING_THRESHOLD || '0.80'),
    memoryCriticalThreshold: parseFloat(process.env.REDIS_MEMORY_CRITICAL_THRESHOLD || '0.95'),
    fragmentationWarningThreshold: parseFloat(process.env.REDIS_FRAGMENTATION_WARNING || '1.5'),
    alertOnEviction: process.env.REDIS_ALERT_ON_EVICTION !== 'false',
};
// ── Prometheus Metrics ──────────────────────────────────────
const PREFIX = 'orgsledger_redis_';
exports.redisMemoryUsedGauge = new client.Gauge({
    name: `${PREFIX}memory_used_bytes`,
    help: 'Redis used memory in bytes',
});
exports.redisMemoryMaxGauge = new client.Gauge({
    name: `${PREFIX}memory_max_bytes`,
    help: 'Redis max memory in bytes',
});
exports.redisMemoryUsageGauge = new client.Gauge({
    name: `${PREFIX}memory_usage_percent`,
    help: 'Redis memory usage percentage',
});
exports.redisEvictedKeysGauge = new client.Gauge({
    name: `${PREFIX}evicted_keys_total`,
    help: 'Total number of evicted keys',
});
exports.redisFragmentationGauge = new client.Gauge({
    name: `${PREFIX}memory_fragmentation_ratio`,
    help: 'Redis memory fragmentation ratio',
});
exports.redisConnectedClientsGauge = new client.Gauge({
    name: `${PREFIX}connected_clients`,
    help: 'Number of connected Redis clients',
});
exports.redisBlockedClientsGauge = new client.Gauge({
    name: `${PREFIX}blocked_clients`,
    help: 'Number of blocked Redis clients',
});
exports.redisOpsPerSecGauge = new client.Gauge({
    name: `${PREFIX}ops_per_sec`,
    help: 'Redis instantaneous operations per second',
});
exports.redisHitRateGauge = new client.Gauge({
    name: `${PREFIX}hit_rate`,
    help: 'Redis keyspace hit rate (0-1)',
});
exports.redisHealthAlertsCounter = new client.Counter({
    name: `${PREFIX}health_alerts_total`,
    help: 'Total Redis health alerts',
    labelNames: ['level', 'type'],
});
// ── Redis Health Monitor Class ──────────────────────────────
class RedisHealthMonitor extends events_1.EventEmitter {
    config;
    redis = null;
    checkInterval = null;
    lastReport = null;
    previousEvictedKeys = 0;
    isRunning = false;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Initialize and start monitoring.
     */
    async start() {
        if (this.isRunning) {
            logger_1.logger.warn('[REDIS_HEALTH] Monitor already running');
            return;
        }
        try {
            this.redis = (0, redisClient_1.createBullMQConnection)();
            this.isRunning = true;
            logger_1.logger.info('[REDIS_HEALTH] Starting Redis health monitor', {
                intervalMs: this.config.checkIntervalMs,
                memoryWarning: `${this.config.memoryWarningThreshold * 100}%`,
                memoryCritical: `${this.config.memoryCriticalThreshold * 100}%`,
            });
            // Run initial check
            await this.runHealthCheck();
            // Start periodic checks
            this.checkInterval = setInterval(async () => {
                try {
                    await this.runHealthCheck();
                }
                catch (err) {
                    logger_1.logger.error('[REDIS_HEALTH] Health check failed', {
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }, this.config.checkIntervalMs);
            this.checkInterval.unref();
        }
        catch (err) {
            logger_1.logger.error('[REDIS_HEALTH] Failed to start monitor', {
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    }
    /**
     * Stop monitoring.
     */
    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.isRunning = false;
        logger_1.logger.info('[REDIS_HEALTH] Monitor stopped');
    }
    /**
     * Run a single health check.
     */
    async runHealthCheck() {
        if (!this.redis) {
            throw new Error('Redis not initialized');
        }
        const [memoryInfo, clientsInfo, statsInfo] = await Promise.all([
            this.getMemoryInfo(),
            this.getClientsInfo(),
            this.getStatsInfo(),
        ]);
        const alerts = this.evaluateAlerts(memoryInfo, clientsInfo);
        // Determine overall status
        let status = 'healthy';
        if (alerts.some(a => a.level === 'critical')) {
            status = 'critical';
        }
        else if (alerts.some(a => a.level === 'warning')) {
            status = 'warning';
        }
        const report = {
            timestamp: new Date(),
            status,
            memory: memoryInfo,
            clients: clientsInfo,
            stats: statsInfo,
            alerts,
        };
        // Update Prometheus metrics
        this.updateMetrics(report);
        // Log alerts
        for (const alert of alerts) {
            const message = `[REDIS_HEALTH] ${alert.message}`;
            const meta = {
                type: alert.type,
                value: alert.value,
                threshold: alert.threshold,
            };
            if (alert.level === 'critical') {
                logger_1.logger.error(message, meta);
            }
            else {
                logger_1.logger.warn(message, meta);
            }
            exports.redisHealthAlertsCounter.inc({ level: alert.level, type: alert.type });
            this.emit('alert', alert);
        }
        this.lastReport = report;
        this.emit('health', report);
        return report;
    }
    /**
     * Get memory information from Redis INFO.
     */
    async getMemoryInfo() {
        const info = await this.redis.info('memory');
        const parsed = this.parseRedisInfo(info);
        const usedMemory = parseInt(parsed.used_memory || '0', 10);
        const usedMemoryPeak = parseInt(parsed.used_memory_peak || '0', 10);
        const maxMemory = parseInt(parsed.maxmemory || '0', 10);
        const fragmentationRatio = parseFloat(parsed.mem_fragmentation_ratio || '1');
        const evictedKeys = parseInt(parsed.evicted_keys || '0', 10);
        // Calculate usage percentage
        const memoryUsagePercent = maxMemory > 0 ? usedMemory / maxMemory : 0;
        return {
            usedMemory,
            usedMemoryHuman: parsed.used_memory_human || this.formatBytes(usedMemory),
            usedMemoryPeak,
            usedMemoryPeakHuman: parsed.used_memory_peak_human || this.formatBytes(usedMemoryPeak),
            maxMemory,
            maxMemoryHuman: parsed.maxmemory_human || this.formatBytes(maxMemory),
            memoryUsagePercent,
            fragmentationRatio,
            evictedKeys,
        };
    }
    /**
     * Get client information from Redis INFO.
     */
    async getClientsInfo() {
        const info = await this.redis.info('clients');
        const parsed = this.parseRedisInfo(info);
        return {
            connectedClients: parseInt(parsed.connected_clients || '0', 10),
            blockedClients: parseInt(parsed.blocked_clients || '0', 10),
            clientRecentMaxInputBuffer: parseInt(parsed.client_recent_max_input_buffer || '0', 10),
            clientRecentMaxOutputBuffer: parseInt(parsed.client_recent_max_output_buffer || '0', 10),
        };
    }
    /**
     * Get stats information from Redis INFO.
     */
    async getStatsInfo() {
        const info = await this.redis.info('stats');
        const parsed = this.parseRedisInfo(info);
        const keyspaceHits = parseInt(parsed.keyspace_hits || '0', 10);
        const keyspaceMisses = parseInt(parsed.keyspace_misses || '0', 10);
        const totalRequests = keyspaceHits + keyspaceMisses;
        const hitRate = totalRequests > 0 ? keyspaceHits / totalRequests : 1;
        return {
            totalConnectionsReceived: parseInt(parsed.total_connections_received || '0', 10),
            totalCommandsProcessed: parseInt(parsed.total_commands_processed || '0', 10),
            instantaneousOpsPerSec: parseInt(parsed.instantaneous_ops_per_sec || '0', 10),
            keyspaceHits,
            keyspaceMisses,
            hitRate,
        };
    }
    /**
     * Evaluate alerts based on metrics.
     */
    evaluateAlerts(memory, clients) {
        const alerts = [];
        // Memory pressure check
        if (memory.memoryUsagePercent >= this.config.memoryCriticalThreshold) {
            alerts.push({
                level: 'critical',
                type: 'memory_pressure',
                message: `CRITICAL: Redis memory at ${(memory.memoryUsagePercent * 100).toFixed(1)}%`,
                value: memory.memoryUsagePercent,
                threshold: this.config.memoryCriticalThreshold,
            });
        }
        else if (memory.memoryUsagePercent >= this.config.memoryWarningThreshold) {
            alerts.push({
                level: 'warning',
                type: 'memory_pressure',
                message: `WARNING: Redis memory at ${(memory.memoryUsagePercent * 100).toFixed(1)}%`,
                value: memory.memoryUsagePercent,
                threshold: this.config.memoryWarningThreshold,
            });
        }
        // Eviction check (CRITICAL if any keys evicted since last check)
        if (this.config.alertOnEviction && memory.evictedKeys > this.previousEvictedKeys) {
            const newEvictions = memory.evictedKeys - this.previousEvictedKeys;
            alerts.push({
                level: 'critical',
                type: 'eviction',
                message: `CRITICAL: Redis evicted ${newEvictions} keys - memory pressure!`,
                value: newEvictions,
                threshold: 0,
            });
        }
        this.previousEvictedKeys = memory.evictedKeys;
        // Fragmentation check
        if (memory.fragmentationRatio > this.config.fragmentationWarningThreshold) {
            alerts.push({
                level: 'warning',
                type: 'fragmentation',
                message: `WARNING: Redis fragmentation ratio ${memory.fragmentationRatio.toFixed(2)} (threshold: ${this.config.fragmentationWarningThreshold})`,
                value: memory.fragmentationRatio,
                threshold: this.config.fragmentationWarningThreshold,
            });
        }
        // Blocked clients check
        if (clients.blockedClients > 10) {
            alerts.push({
                level: 'warning',
                type: 'blocked_clients',
                message: `WARNING: ${clients.blockedClients} blocked Redis clients`,
                value: clients.blockedClients,
                threshold: 10,
            });
        }
        return alerts;
    }
    /**
     * Update Prometheus metrics.
     */
    updateMetrics(report) {
        exports.redisMemoryUsedGauge.set(report.memory.usedMemory);
        exports.redisMemoryMaxGauge.set(report.memory.maxMemory);
        exports.redisMemoryUsageGauge.set(report.memory.memoryUsagePercent);
        exports.redisEvictedKeysGauge.set(report.memory.evictedKeys);
        exports.redisFragmentationGauge.set(report.memory.fragmentationRatio);
        exports.redisConnectedClientsGauge.set(report.clients.connectedClients);
        exports.redisBlockedClientsGauge.set(report.clients.blockedClients);
        exports.redisOpsPerSecGauge.set(report.stats.instantaneousOpsPerSec);
        exports.redisHitRateGauge.set(report.stats.hitRate);
    }
    /**
     * Parse Redis INFO response into key-value object.
     */
    parseRedisInfo(info) {
        const result = {};
        const lines = info.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#'))
                continue;
            const colonIndex = trimmed.indexOf(':');
            if (colonIndex > 0) {
                const key = trimmed.substring(0, colonIndex);
                const value = trimmed.substring(colonIndex + 1);
                result[key] = value;
            }
        }
        return result;
    }
    /**
     * Format bytes to human-readable string.
     */
    formatBytes(bytes) {
        if (bytes === 0)
            return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    /**
     * Get the last health report.
     */
    getLastReport() {
        return this.lastReport;
    }
    /**
     * Check if monitor is running.
     */
    isMonitorRunning() {
        return this.isRunning;
    }
}
// ── Singleton ───────────────────────────────────────────────
exports.redisHealthMonitor = new RedisHealthMonitor();
// ── Exports ─────────────────────────────────────────────────
async function startRedisHealthMonitor() {
    await exports.redisHealthMonitor.start();
}
function stopRedisHealthMonitor() {
    exports.redisHealthMonitor.stop();
}
async function getRedisHealthReport() {
    return exports.redisHealthMonitor.runHealthCheck();
}
function getLastRedisHealthReport() {
    return exports.redisHealthMonitor.getLastReport();
}
function onRedisHealthAlert(callback) {
    exports.redisHealthMonitor.on('alert', callback);
    return () => exports.redisHealthMonitor.off('alert', callback);
}
//# sourceMappingURL=redis-health.monitor.js.map