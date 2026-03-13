"use strict";
// ============================================================
// OrgsLedger API — Worker Heartbeat Monitor
// Production-grade heartbeat monitoring for BullMQ workers
// ============================================================
//
// Architecture:
//   - Workers send heartbeat every 5 seconds
//   - Monitor scans all heartbeats every 10 seconds
//   - TTL: 15 seconds (auto-cleanup of dead workers)
//   - WORKER_UNHEALTHY: heartbeat older than 15 seconds
//   - WORKER_DEAD: unhealthy for 60+ seconds
//
// Redis key format:
//   worker:heartbeat:{workerName}:{workerId}
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
exports.HEARTBEAT_INTERVALS = exports.workerHeartbeatMonitor = exports.workerActiveJobsGauge = exports.workerHeartbeatLatencyMs = exports.workerDeadGauge = exports.workerUnhealthyGauge = exports.workerAliveGauge = void 0;
exports.startWorkerHeartbeatMonitor = startWorkerHeartbeatMonitor;
exports.stopWorkerHeartbeatMonitor = stopWorkerHeartbeatMonitor;
exports.sendWorkerHeartbeat = sendWorkerHeartbeat;
exports.startAutomaticHeartbeat = startAutomaticHeartbeat;
exports.getWorkerHeartbeatStats = getWorkerHeartbeatStats;
exports.getWorkersByName = getWorkersByName;
exports.getWorkersByQueue = getWorkersByQueue;
exports.isWorkerHealthy = isWorkerHealthy;
exports.onWorkerEvent = onWorkerEvent;
exports.offWorkerEvent = offWorkerEvent;
const events_1 = require("events");
const client = __importStar(require("prom-client"));
const logger_1 = require("../logger");
const redisClient_1 = require("../infrastructure/redisClient");
// ── Configuration ───────────────────────────────────────────
const HEARTBEAT_CONFIG = {
    // Workers should send heartbeat every 5 seconds
    heartbeatIntervalMs: 5000,
    // TTL for heartbeat key (15 seconds)
    heartbeatTtlMs: 15000,
    // Monitor scan interval (10 seconds)
    monitorIntervalMs: 10000,
    // Time before WORKER_DEAD event (60 seconds unhealthy)
    deadThresholdMs: 60000,
    // Redis key prefix
    keyPrefix: 'worker:heartbeat:',
    // Prometheus metrics prefix
    metricsPrefix: 'orgsledger_',
};
// ── Prometheus Metrics ──────────────────────────────────────
// Get existing registry or create isolated one
const register = client.register;
exports.workerAliveGauge = new client.Gauge({
    name: `${HEARTBEAT_CONFIG.metricsPrefix}worker_alive`,
    help: 'Number of workers with recent heartbeat (alive)',
    labelNames: ['worker_name', 'queue'],
    registers: [register],
});
exports.workerUnhealthyGauge = new client.Gauge({
    name: `${HEARTBEAT_CONFIG.metricsPrefix}worker_unhealthy`,
    help: 'Number of unhealthy workers (missed heartbeats)',
    labelNames: ['worker_name', 'queue'],
    registers: [register],
});
exports.workerDeadGauge = new client.Gauge({
    name: `${HEARTBEAT_CONFIG.metricsPrefix}worker_dead`,
    help: 'Number of dead workers (unhealthy > 60s)',
    labelNames: ['worker_name', 'queue'],
    registers: [register],
});
exports.workerHeartbeatLatencyMs = new client.Gauge({
    name: `${HEARTBEAT_CONFIG.metricsPrefix}worker_heartbeat_latency_ms`,
    help: 'Worker heartbeat age in milliseconds',
    labelNames: ['worker_name', 'worker_id'],
    registers: [register],
});
exports.workerActiveJobsGauge = new client.Gauge({
    name: `${HEARTBEAT_CONFIG.metricsPrefix}worker_active_jobs`,
    help: 'Number of active jobs per worker',
    labelNames: ['worker_name', 'worker_id'],
    registers: [register],
});
// ── Worker Heartbeat Monitor Class ──────────────────────────
class WorkerHeartbeatMonitor extends events_1.EventEmitter {
    redis = null;
    monitorInterval = null;
    isRunning = false;
    // Track unhealthy state for WORKER_DEAD detection
    unhealthyTimestamps = new Map();
    // Cache of last known worker states
    workerStates = new Map();
    constructor() {
        super();
    }
    // ── Heartbeat Sending (for workers) ─────────────────────────
    /**
     * Send heartbeat from a worker
     * Workers should call this every 5 seconds
     * Non-blocking - never throws
     *
     * @param workerName - Logical worker name (e.g., 'transcript', 'translation')
     * @param workerId - Unique worker instance ID (e.g., UUID or pod name)
     * @param activeJobs - Number of jobs currently processing
     * @param queueName - Queue the worker is consuming from
     */
    async sendHeartbeat(workerName, workerId, activeJobs, queueName) {
        try {
            const redis = await this.getRedis();
            if (!redis) {
                logger_1.logger.debug('[HEARTBEAT] Cannot send heartbeat - Redis not available');
                return;
            }
            const key = this.getHeartbeatKey(workerName, workerId);
            const data = {
                lastHeartbeat: Date.now(),
                activeJobs,
                queueName,
                workerId,
                workerName,
                hostname: process.env.HOSTNAME || process.env.POD_NAME,
                pid: process.pid,
                uptime: process.uptime(),
            };
            const ttlSeconds = Math.ceil(HEARTBEAT_CONFIG.heartbeatTtlMs / 1000);
            await redis.setex(key, ttlSeconds, JSON.stringify(data));
            // Update Prometheus metrics
            exports.workerActiveJobsGauge.labels(workerName, workerId).set(activeJobs);
            logger_1.logger.debug('[HEARTBEAT] Sent', { workerName, workerId, activeJobs, queueName });
        }
        catch (err) {
            // Non-blocking - just log
            logger_1.logger.debug('[HEARTBEAT] Failed to send', {
                workerName,
                workerId,
                error: err.message
            });
        }
    }
    /**
     * Create a heartbeat sender function for a worker
     * Returns a function that can be called periodically
     */
    createHeartbeatSender(workerName, workerId, queueName) {
        return async (activeJobs) => {
            await this.sendHeartbeat(workerName, workerId, activeJobs, queueName);
        };
    }
    /**
     * Start automatic heartbeat for a worker
     * Returns cleanup function to stop heartbeat
     */
    startAutomaticHeartbeat(workerName, workerId, queueName, getActiveJobs) {
        const interval = setInterval(async () => {
            await this.sendHeartbeat(workerName, workerId, getActiveJobs(), queueName);
        }, HEARTBEAT_CONFIG.heartbeatIntervalMs);
        // Send initial heartbeat immediately
        this.sendHeartbeat(workerName, workerId, getActiveJobs(), queueName);
        logger_1.logger.info('[HEARTBEAT] Started automatic heartbeat', { workerName, workerId });
        return () => {
            clearInterval(interval);
            logger_1.logger.info('[HEARTBEAT] Stopped automatic heartbeat', { workerName, workerId });
        };
    }
    // ── Monitoring ──────────────────────────────────────────────
    /**
     * Start the heartbeat monitor
     * Scans all worker heartbeats every 10 seconds
     */
    async start() {
        if (this.isRunning) {
            logger_1.logger.warn('[HEARTBEAT_MONITOR] Already running');
            return;
        }
        try {
            // Ensure Redis connection
            this.redis = await this.getRedis();
            if (!this.redis) {
                throw new Error('Redis not available');
            }
            // Start monitoring loop
            this.monitorInterval = setInterval(() => this.runMonitorCycle(), HEARTBEAT_CONFIG.monitorIntervalMs);
            this.isRunning = true;
            logger_1.logger.info('[HEARTBEAT_MONITOR] Started', {
                monitorIntervalMs: HEARTBEAT_CONFIG.monitorIntervalMs,
                heartbeatTtlMs: HEARTBEAT_CONFIG.heartbeatTtlMs,
                deadThresholdMs: HEARTBEAT_CONFIG.deadThresholdMs,
            });
            // Run initial check
            await this.runMonitorCycle();
        }
        catch (err) {
            logger_1.logger.error('[HEARTBEAT_MONITOR] Failed to start', err);
            throw err;
        }
    }
    /**
     * Stop the heartbeat monitor
     */
    stop() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
        this.isRunning = false;
        this.unhealthyTimestamps.clear();
        this.workerStates.clear();
        logger_1.logger.info('[HEARTBEAT_MONITOR] Stopped');
    }
    /**
     * Run a single monitoring cycle
     * Scans all heartbeats and emits events
     */
    async runMonitorCycle() {
        try {
            const redis = await this.getRedis();
            if (!redis)
                return;
            const now = Date.now();
            const workers = await this.scanAllHeartbeats(redis);
            // Track metrics by worker type and queue
            const metricCounts = new Map();
            for (const worker of workers) {
                const workerKey = `${worker.workerName}:${worker.workerId}`;
                const heartbeatAge = now - worker.lastHeartbeat;
                const isStale = heartbeatAge > HEARTBEAT_CONFIG.heartbeatTtlMs;
                // Update heartbeat latency metric
                exports.workerHeartbeatLatencyMs.labels(worker.workerName, worker.workerId).set(heartbeatAge);
                // Initialize metric counts for this worker type/queue combo
                const metricKey = `${worker.workerName}:${worker.queueName}`;
                if (!metricCounts.has(metricKey)) {
                    metricCounts.set(metricKey, { alive: 0, unhealthy: 0, dead: 0 });
                }
                const counts = metricCounts.get(metricKey);
                if (isStale) {
                    // Worker is unhealthy
                    const unhealthySince = this.unhealthyTimestamps.get(workerKey) || now;
                    if (!this.unhealthyTimestamps.has(workerKey)) {
                        this.unhealthyTimestamps.set(workerKey, now);
                    }
                    const unhealthyDuration = now - unhealthySince;
                    if (unhealthyDuration >= HEARTBEAT_CONFIG.deadThresholdMs) {
                        // Worker is dead
                        worker.status = 'dead';
                        counts.dead++;
                        // Emit WORKER_DEAD if not already emitted
                        const previousState = this.workerStates.get(workerKey);
                        if (!previousState || previousState.status !== 'dead') {
                            this.emitWorkerEvent('WORKER_DEAD', worker, unhealthyDuration);
                        }
                    }
                    else {
                        // Worker is unhealthy (not yet dead)
                        worker.status = 'unhealthy';
                        worker.unhealthySince = unhealthySince;
                        counts.unhealthy++;
                        // Emit WORKER_UNHEALTHY on first detection
                        const previousState = this.workerStates.get(workerKey);
                        if (!previousState || previousState.status === 'alive') {
                            this.emitWorkerEvent('WORKER_UNHEALTHY', worker, unhealthyDuration);
                        }
                    }
                }
                else {
                    // Worker is alive
                    worker.status = 'alive';
                    counts.alive++;
                    // Check if recovered from unhealthy
                    const previousState = this.workerStates.get(workerKey);
                    if (previousState && previousState.status !== 'alive') {
                        const unhealthySince = this.unhealthyTimestamps.get(workerKey);
                        if (unhealthySince) {
                            const unhealthyDuration = now - unhealthySince;
                            this.emitWorkerEvent('WORKER_RECOVERED', worker, unhealthyDuration);
                        }
                    }
                    // Clear unhealthy tracking
                    this.unhealthyTimestamps.delete(workerKey);
                }
                worker.lastHeartbeatAge = heartbeatAge;
                this.workerStates.set(workerKey, worker);
            }
            // Update Prometheus gauges
            for (const [key, counts] of metricCounts) {
                const [workerName, queueName] = key.split(':');
                exports.workerAliveGauge.labels(workerName, queueName).set(counts.alive);
                exports.workerUnhealthyGauge.labels(workerName, queueName).set(counts.unhealthy);
                exports.workerDeadGauge.labels(workerName, queueName).set(counts.dead);
            }
            logger_1.logger.debug('[HEARTBEAT_MONITOR] Cycle complete', {
                totalWorkers: workers.length,
                alive: workers.filter(w => w.status === 'alive').length,
                unhealthy: workers.filter(w => w.status === 'unhealthy').length,
                dead: workers.filter(w => w.status === 'dead').length,
            });
        }
        catch (err) {
            logger_1.logger.error('[HEARTBEAT_MONITOR] Monitor cycle failed', err);
        }
    }
    /**
     * Emit worker health event
     */
    emitWorkerEvent(type, worker, unhealthyDuration) {
        const event = {
            type,
            workerName: worker.workerName,
            workerId: worker.workerId,
            queueName: worker.queueName,
            lastHeartbeat: worker.lastHeartbeat,
            unhealthyDuration,
            timestamp: new Date().toISOString(),
        };
        this.emit(type, event);
        this.emit('worker-event', event);
        const logLevel = type === 'WORKER_RECOVERED' ? 'info' : 'warn';
        logger_1.logger[logLevel](`[HEARTBEAT_MONITOR] ${type}`, {
            workerName: worker.workerName,
            workerId: worker.workerId,
            queueName: worker.queueName,
            unhealthyDuration,
        });
    }
    /**
     * Scan all worker heartbeat keys from Redis
     */
    async scanAllHeartbeats(redis) {
        const workers = [];
        const pattern = `${HEARTBEAT_CONFIG.keyPrefix}*`;
        const now = Date.now();
        let cursor = '0';
        do {
            const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = nextCursor;
            if (keys.length === 0)
                continue;
            // Get all values in parallel
            const values = await redis.mget(...keys);
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const value = values[i];
                if (!value)
                    continue;
                try {
                    const data = JSON.parse(value);
                    workers.push({
                        workerName: data.workerName,
                        workerId: data.workerId,
                        queueName: data.queueName,
                        status: 'alive', // Will be updated by monitor
                        lastHeartbeat: data.lastHeartbeat,
                        lastHeartbeatAge: now - data.lastHeartbeat,
                        activeJobs: data.activeJobs,
                        hostname: data.hostname,
                        pid: data.pid,
                    });
                }
                catch (parseErr) {
                    logger_1.logger.debug('[HEARTBEAT_MONITOR] Failed to parse heartbeat', { key });
                }
            }
        } while (cursor !== '0');
        return workers;
    }
    // ── Public API ──────────────────────────────────────────────
    /**
     * Get current worker statistics
     */
    async getStats() {
        try {
            const redis = await this.getRedis();
            if (!redis) {
                return {
                    totalWorkers: 0,
                    aliveWorkers: 0,
                    unhealthyWorkers: 0,
                    deadWorkers: 0,
                    workers: [],
                };
            }
            const workers = await this.scanAllHeartbeats(redis);
            const now = Date.now();
            // Determine status for each worker
            for (const worker of workers) {
                const workerKey = `${worker.workerName}:${worker.workerId}`;
                const heartbeatAge = now - worker.lastHeartbeat;
                const isStale = heartbeatAge > HEARTBEAT_CONFIG.heartbeatTtlMs;
                if (isStale) {
                    const unhealthySince = this.unhealthyTimestamps.get(workerKey);
                    if (unhealthySince && now - unhealthySince >= HEARTBEAT_CONFIG.deadThresholdMs) {
                        worker.status = 'dead';
                    }
                    else {
                        worker.status = 'unhealthy';
                        worker.unhealthySince = unhealthySince;
                    }
                }
                else {
                    worker.status = 'alive';
                }
                worker.lastHeartbeatAge = heartbeatAge;
            }
            return {
                totalWorkers: workers.length,
                aliveWorkers: workers.filter(w => w.status === 'alive').length,
                unhealthyWorkers: workers.filter(w => w.status === 'unhealthy').length,
                deadWorkers: workers.filter(w => w.status === 'dead').length,
                workers,
            };
        }
        catch (err) {
            logger_1.logger.error('[HEARTBEAT_MONITOR] Failed to get stats', err);
            return {
                totalWorkers: 0,
                aliveWorkers: 0,
                unhealthyWorkers: 0,
                deadWorkers: 0,
                workers: [],
            };
        }
    }
    /**
     * Get workers by name
     */
    async getWorkersByName(workerName) {
        const stats = await this.getStats();
        return stats.workers.filter(w => w.workerName === workerName);
    }
    /**
     * Get workers by queue
     */
    async getWorkersByQueue(queueName) {
        const stats = await this.getStats();
        return stats.workers.filter(w => w.queueName === queueName);
    }
    /**
     * Check if a specific worker is healthy
     */
    async isWorkerHealthy(workerName, workerId) {
        try {
            const redis = await this.getRedis();
            if (!redis)
                return false;
            const key = this.getHeartbeatKey(workerName, workerId);
            const value = await redis.get(key);
            if (!value)
                return false;
            const data = JSON.parse(value);
            const age = Date.now() - data.lastHeartbeat;
            return age <= HEARTBEAT_CONFIG.heartbeatTtlMs;
        }
        catch (err) {
            logger_1.logger.debug('[HEARTBEAT_MONITOR] Failed to check worker health', { workerName, workerId });
            return false;
        }
    }
    /**
     * Manually remove a worker's heartbeat (for cleanup)
     */
    async removeWorkerHeartbeat(workerName, workerId) {
        try {
            const redis = await this.getRedis();
            if (!redis)
                return;
            const key = this.getHeartbeatKey(workerName, workerId);
            await redis.del(key);
            // Clean up tracking
            const workerKey = `${workerName}:${workerId}`;
            this.unhealthyTimestamps.delete(workerKey);
            this.workerStates.delete(workerKey);
            logger_1.logger.info('[HEARTBEAT_MONITOR] Worker heartbeat removed', { workerName, workerId });
        }
        catch (err) {
            logger_1.logger.error('[HEARTBEAT_MONITOR] Failed to remove heartbeat', { workerName, workerId });
        }
    }
    /**
     * Check if monitor is running
     */
    isMonitorRunning() {
        return this.isRunning;
    }
    // ── Helpers ─────────────────────────────────────────────────
    getHeartbeatKey(workerName, workerId) {
        return `${HEARTBEAT_CONFIG.keyPrefix}${workerName}:${workerId}`;
    }
    async getRedis() {
        try {
            if (this.redis && this.redis.status === 'ready') {
                return this.redis;
            }
            this.redis = await (0, redisClient_1.getRedisClient)();
            return this.redis;
        }
        catch (err) {
            logger_1.logger.debug('[HEARTBEAT_MONITOR] Redis not available');
            return null;
        }
    }
}
// ── Singleton Instance ──────────────────────────────────────
const workerHeartbeatMonitor = new WorkerHeartbeatMonitor();
exports.workerHeartbeatMonitor = workerHeartbeatMonitor;
/**
 * Start the heartbeat monitor
 */
async function startWorkerHeartbeatMonitor() {
    return workerHeartbeatMonitor.start();
}
/**
 * Stop the heartbeat monitor
 */
function stopWorkerHeartbeatMonitor() {
    workerHeartbeatMonitor.stop();
}
/**
 * Send a single heartbeat from a worker
 */
async function sendWorkerHeartbeat(workerName, workerId, activeJobs, queueName) {
    return workerHeartbeatMonitor.sendHeartbeat(workerName, workerId, activeJobs, queueName);
}
/**
 * Start automatic heartbeat for a worker
 * Returns cleanup function
 */
function startAutomaticHeartbeat(workerName, workerId, queueName, getActiveJobs) {
    return workerHeartbeatMonitor.startAutomaticHeartbeat(workerName, workerId, queueName, getActiveJobs);
}
/**
 * Get current worker heartbeat statistics
 */
async function getWorkerHeartbeatStats() {
    return workerHeartbeatMonitor.getStats();
}
/**
 * Get workers by name
 */
async function getWorkersByName(workerName) {
    return workerHeartbeatMonitor.getWorkersByName(workerName);
}
/**
 * Get workers by queue
 */
async function getWorkersByQueue(queueName) {
    return workerHeartbeatMonitor.getWorkersByQueue(queueName);
}
/**
 * Check if a specific worker is healthy
 */
async function isWorkerHealthy(workerName, workerId) {
    return workerHeartbeatMonitor.isWorkerHealthy(workerName, workerId);
}
/**
 * Register event listener for worker events
 */
function onWorkerEvent(event, listener) {
    workerHeartbeatMonitor.on(event, listener);
}
/**
 * Remove event listener
 */
function offWorkerEvent(event, listener) {
    workerHeartbeatMonitor.off(event, listener);
}
// ── Configuration Export ────────────────────────────────────
exports.HEARTBEAT_INTERVALS = {
    heartbeatIntervalMs: HEARTBEAT_CONFIG.heartbeatIntervalMs,
    heartbeatTtlMs: HEARTBEAT_CONFIG.heartbeatTtlMs,
    monitorIntervalMs: HEARTBEAT_CONFIG.monitorIntervalMs,
    deadThresholdMs: HEARTBEAT_CONFIG.deadThresholdMs,
};
//# sourceMappingURL=worker-heartbeat.monitor.js.map