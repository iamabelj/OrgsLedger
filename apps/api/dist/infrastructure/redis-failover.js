"use strict";
// ============================================================
// OrgsLedger API — Redis Failover (Sentinel & Cluster)
// High-availability Redis for production deployments
// ============================================================
//
// Supports three modes:
//   1. Standalone (default) - Single Redis instance
//   2. Sentinel - Automatic master failover
//   3. Cluster - Sharded, multi-node cluster
//
// Configuration via environment:
//   REDIS_MODE=standalone|sentinel|cluster
//   REDIS_SENTINEL_NODES=host1:26379,host2:26379,host3:26379
//   REDIS_SENTINEL_MASTER=mymaster
//   REDIS_SENTINEL_PASSWORD=
//   REDIS_CLUSTER_NODES=host1:6379,host2:6379,host3:6379
//
// Features:
//   - Automatic reconnection with exponential backoff
//   - Health monitoring and Prometheus metrics
//   - Graceful degradation on partial failures
//   - Connection pooling via ioredis
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
exports.redisFailoverManager = exports.redisFailoverErrorsCounter = exports.redisFailoverLatencyHistogram = exports.redisFailoverFailoversCounter = exports.redisFailoverReconnectsCounter = exports.redisFailoverConnectedGauge = exports.redisFailoverModeGauge = void 0;
exports.createFailoverConnection = createFailoverConnection;
exports.connectRedisWithFailover = connectRedisWithFailover;
exports.disconnectRedis = disconnectRedis;
exports.getRedisFailoverHealth = getRedisFailoverHealth;
exports.isRedisConnected = isRedisConnected;
exports.onRedisFailoverEvent = onRedisFailoverEvent;
exports.getRedisConnection = getRedisConnection;
const ioredis_1 = __importStar(require("ioredis"));
const client = __importStar(require("prom-client"));
const events_1 = require("events");
const logger_1 = require("../logger");
function parseNodeList(envVar) {
    if (!envVar)
        return [];
    return envVar.split(',').map(node => {
        const [host, portStr] = node.trim().split(':');
        return { host, port: parseInt(portStr || '6379', 10) };
    });
}
const DEFAULT_CONFIG = {
    mode: process.env.REDIS_MODE || 'standalone',
    // Standalone
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    // Sentinel
    sentinelNodes: parseNodeList(process.env.REDIS_SENTINEL_NODES),
    sentinelMasterName: process.env.REDIS_SENTINEL_MASTER || 'mymaster',
    sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD || undefined,
    // Cluster
    clusterNodes: parseNodeList(process.env.REDIS_CLUSTER_NODES),
    // Connection behavior
    maxRetriesPerRequest: null, // BullMQ requirement
    enableReadyCheck: true,
    retryDelayMs: parseInt(process.env.REDIS_RETRY_DELAY_MS || '100', 10),
    maxRetryDelayMs: parseInt(process.env.REDIS_MAX_RETRY_DELAY_MS || '5000', 10),
    connectTimeoutMs: parseInt(process.env.REDIS_CONNECT_TIMEOUT_MS || '10000', 10),
    commandTimeoutMs: parseInt(process.env.REDIS_COMMAND_TIMEOUT_MS || '5000', 10),
    // Health
    healthCheckIntervalMs: parseInt(process.env.REDIS_HEALTH_CHECK_MS || '10000', 10),
};
// ── Prometheus Metrics ──────────────────────────────────────
const PREFIX = 'orgsledger_redis_failover_';
exports.redisFailoverModeGauge = new client.Gauge({
    name: `${PREFIX}mode`,
    help: 'Current Redis mode (1=standalone, 2=sentinel, 3=cluster)',
});
exports.redisFailoverConnectedGauge = new client.Gauge({
    name: `${PREFIX}connected`,
    help: 'Redis connection status (1=connected, 0=disconnected)',
});
exports.redisFailoverReconnectsCounter = new client.Counter({
    name: `${PREFIX}reconnects_total`,
    help: 'Total Redis reconnection attempts',
});
exports.redisFailoverFailoversCounter = new client.Counter({
    name: `${PREFIX}failovers_total`,
    help: 'Total Redis master failovers (Sentinel mode)',
});
exports.redisFailoverLatencyHistogram = new client.Histogram({
    name: `${PREFIX}command_latency_seconds`,
    help: 'Redis command latency',
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
});
exports.redisFailoverErrorsCounter = new client.Counter({
    name: `${PREFIX}errors_total`,
    help: 'Total Redis errors',
    labelNames: ['type'],
});
// ── Redis Failover Manager ──────────────────────────────────
class RedisFailoverManager extends events_1.EventEmitter {
    config;
    connection = null;
    healthCheckInterval = null;
    isConnected = false;
    startTime = Date.now();
    lastError;
    lastFailover;
    reconnectAttempts = 0;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Create and connect to Redis based on configured mode.
     */
    async connect() {
        const mode = this.config.mode;
        logger_1.logger.info('[REDIS_FAILOVER] Connecting', {
            mode,
            host: mode === 'standalone' ? this.config.host : undefined,
            sentinelNodes: mode === 'sentinel' ? this.config.sentinelNodes.length : undefined,
            clusterNodes: mode === 'cluster' ? this.config.clusterNodes.length : undefined,
        });
        // Set mode metric
        const modeValue = mode === 'standalone' ? 1 : mode === 'sentinel' ? 2 : 3;
        exports.redisFailoverModeGauge.set(modeValue);
        switch (mode) {
            case 'sentinel':
                this.connection = this.createSentinelConnection();
                break;
            case 'cluster':
                this.connection = this.createClusterConnection();
                break;
            case 'standalone':
            default:
                this.connection = this.createStandaloneConnection();
                break;
        }
        this.setupEventHandlers();
        this.startHealthCheck();
        // Wait for initial connection
        await this.waitForConnection();
        return this.connection;
    }
    /**
     * Create standalone Redis connection.
     */
    createStandaloneConnection() {
        const options = {
            host: this.config.host,
            port: this.config.port,
            password: this.config.password,
            db: this.config.db,
            maxRetriesPerRequest: this.config.maxRetriesPerRequest,
            enableReadyCheck: this.config.enableReadyCheck,
            connectTimeout: this.config.connectTimeoutMs,
            commandTimeout: this.config.commandTimeoutMs,
            retryStrategy: (times) => this.retryStrategy(times),
            lazyConnect: false,
        };
        return new ioredis_1.default(options);
    }
    /**
     * Create Sentinel connection with automatic master discovery.
     */
    createSentinelConnection() {
        if (this.config.sentinelNodes.length === 0) {
            throw new Error('REDIS_SENTINEL_NODES not configured');
        }
        const options = {
            sentinels: this.config.sentinelNodes,
            name: this.config.sentinelMasterName,
            password: this.config.password,
            sentinelPassword: this.config.sentinelPassword,
            db: this.config.db,
            maxRetriesPerRequest: this.config.maxRetriesPerRequest,
            enableReadyCheck: this.config.enableReadyCheck,
            connectTimeout: this.config.connectTimeoutMs,
            commandTimeout: this.config.commandTimeoutMs,
            retryStrategy: (times) => this.retryStrategy(times),
            // Sentinel-specific
            failoverDetector: true,
            enableAutoPipelining: true,
            lazyConnect: false,
        };
        return new ioredis_1.default(options);
    }
    /**
     * Create Redis Cluster connection.
     */
    createClusterConnection() {
        if (this.config.clusterNodes.length === 0) {
            throw new Error('REDIS_CLUSTER_NODES not configured');
        }
        const options = {
            redisOptions: {
                password: this.config.password,
                connectTimeout: this.config.connectTimeoutMs,
                commandTimeout: this.config.commandTimeoutMs,
            },
            clusterRetryStrategy: (times) => this.retryStrategy(times),
            enableReadyCheck: this.config.enableReadyCheck,
            maxRedirections: 16,
            retryDelayOnFailover: 200,
            retryDelayOnClusterDown: 1000,
            scaleReads: 'slave', // Read from replicas for scaling
            lazyConnect: false,
        };
        return new ioredis_1.Cluster(this.config.clusterNodes, options);
    }
    /**
     * Retry strategy with exponential backoff.
     */
    retryStrategy(times) {
        this.reconnectAttempts = times;
        exports.redisFailoverReconnectsCounter.inc();
        if (times > 100) {
            logger_1.logger.error('[REDIS_FAILOVER] Max retries exceeded, giving up', { attempts: times });
            return null; // Stop retrying
        }
        const delay = Math.min(this.config.retryDelayMs * Math.pow(2, times - 1), this.config.maxRetryDelayMs);
        logger_1.logger.warn('[REDIS_FAILOVER] Reconnecting', {
            attempt: times,
            delayMs: delay,
        });
        this.emit('event', { type: 'reconnecting', attempt: times });
        return delay;
    }
    /**
     * Setup event handlers for connection lifecycle.
     */
    setupEventHandlers() {
        if (!this.connection)
            return;
        this.connection.on('connect', () => {
            logger_1.logger.info('[REDIS_FAILOVER] Connected');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            exports.redisFailoverConnectedGauge.set(1);
            this.emit('event', { type: 'connected' });
        });
        this.connection.on('ready', () => {
            logger_1.logger.info('[REDIS_FAILOVER] Ready');
        });
        this.connection.on('close', () => {
            logger_1.logger.warn('[REDIS_FAILOVER] Connection closed');
            this.isConnected = false;
            exports.redisFailoverConnectedGauge.set(0);
            this.emit('event', { type: 'disconnected' });
        });
        this.connection.on('error', (err) => {
            this.lastError = err;
            exports.redisFailoverErrorsCounter.inc({ type: err.name || 'unknown' });
            logger_1.logger.error('[REDIS_FAILOVER] Error', {
                error: err.message,
                code: err.code,
            });
            this.emit('event', { type: 'error', error: err });
        });
        this.connection.on('reconnecting', () => {
            logger_1.logger.info('[REDIS_FAILOVER] Reconnecting...');
        });
        // Sentinel-specific: master change event
        if (this.config.mode === 'sentinel' && this.connection instanceof ioredis_1.default) {
            this.connection.on('+switch-master', (data) => {
                const [name, oldHost, oldPort, newHost, newPort] = data;
                this.lastFailover = new Date();
                exports.redisFailoverFailoversCounter.inc();
                logger_1.logger.warn('[REDIS_FAILOVER] Master switched (Sentinel failover)', {
                    name,
                    oldMaster: `${oldHost}:${oldPort}`,
                    newMaster: `${newHost}:${newPort}`,
                });
                this.emit('event', {
                    type: 'failover',
                    oldMaster: `${oldHost}:${oldPort}`,
                    newMaster: `${newHost}:${newPort}`,
                });
            });
        }
        // Cluster-specific: node events
        if (this.connection instanceof ioredis_1.Cluster) {
            this.connection.on('node error', (err, address) => {
                logger_1.logger.error('[REDIS_FAILOVER] Cluster node error', {
                    address,
                    error: err.message,
                });
            });
        }
    }
    /**
     * Wait for the connection to be established.
     */
    async waitForConnection(timeoutMs = 30000) {
        if (!this.connection)
            throw new Error('No connection');
        const start = Date.now();
        while (!this.isConnected && Date.now() - start < timeoutMs) {
            await new Promise(r => setTimeout(r, 100));
        }
        if (!this.isConnected) {
            throw new Error(`Redis connection timeout after ${timeoutMs}ms`);
        }
    }
    /**
     * Start health check loop.
     */
    startHealthCheck() {
        if (this.healthCheckInterval)
            return;
        this.healthCheckInterval = setInterval(async () => {
            if (!this.connection || !this.isConnected)
                return;
            try {
                const start = Date.now();
                await this.connection.ping();
                const latencyMs = Date.now() - start;
                exports.redisFailoverLatencyHistogram.observe(latencyMs / 1000);
                if (latencyMs > 100) {
                    logger_1.logger.warn('[REDIS_FAILOVER] High latency', { latencyMs });
                }
            }
            catch (err) {
                logger_1.logger.error('[REDIS_FAILOVER] Health check failed', {
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }, this.config.healthCheckIntervalMs);
        this.healthCheckInterval.unref();
    }
    /**
     * Get current health status.
     */
    async getHealthStatus() {
        const status = {
            connected: this.isConnected,
            mode: this.config.mode,
            latencyMs: -1,
            uptime: (Date.now() - this.startTime) / 1000,
            lastError: this.lastError?.message,
            lastFailover: this.lastFailover,
        };
        if (this.connection && this.isConnected) {
            try {
                const start = Date.now();
                await this.connection.ping();
                status.latencyMs = Date.now() - start;
                // Get master info for Sentinel mode
                if (this.config.mode === 'sentinel' && this.connection instanceof ioredis_1.default) {
                    const info = await this.connection.info('replication');
                    const masterMatch = info.match(/master_host:(\S+)\s+master_port:(\d+)/);
                    if (masterMatch) {
                        status.master = { host: masterMatch[1], port: parseInt(masterMatch[2], 10) };
                    }
                }
            }
            catch (err) {
                status.connected = false;
                status.lastError = err instanceof Error ? err.message : String(err);
            }
        }
        return status;
    }
    /**
     * Get the Redis connection.
     */
    getConnection() {
        return this.connection;
    }
    /**
     * Check if connected.
     */
    isRedisConnected() {
        return this.isConnected;
    }
    /**
     * Gracefully disconnect.
     */
    async disconnect() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        if (this.connection) {
            await this.connection.quit();
            this.connection = null;
        }
        this.isConnected = false;
        exports.redisFailoverConnectedGauge.set(0);
        logger_1.logger.info('[REDIS_FAILOVER] Disconnected');
    }
    /**
     * Force reconnect (useful for testing failover).
     */
    async forceReconnect() {
        logger_1.logger.info('[REDIS_FAILOVER] Forcing reconnect');
        if (this.connection) {
            await this.connection.disconnect();
            // ioredis will auto-reconnect due to retry strategy
        }
    }
}
// ── Singleton ───────────────────────────────────────────────
exports.redisFailoverManager = new RedisFailoverManager();
// ── Factory for BullMQ-compatible connections ───────────────
/**
 * Create a BullMQ-compatible Redis connection with failover support.
 * Use this instead of createBullMQConnection() for HA deployments.
 */
function createFailoverConnection() {
    const config = DEFAULT_CONFIG;
    const mode = config.mode;
    switch (mode) {
        case 'sentinel': {
            if (config.sentinelNodes.length === 0) {
                logger_1.logger.warn('[REDIS_FAILOVER] Sentinel nodes not configured, falling back to standalone');
                return new ioredis_1.default({
                    host: config.host,
                    port: config.port,
                    password: config.password,
                    db: config.db,
                    maxRetriesPerRequest: null,
                    enableReadyCheck: false,
                });
            }
            return new ioredis_1.default({
                sentinels: config.sentinelNodes,
                name: config.sentinelMasterName,
                password: config.password,
                sentinelPassword: config.sentinelPassword,
                db: config.db,
                maxRetriesPerRequest: null,
                enableReadyCheck: false,
                failoverDetector: true,
            });
        }
        case 'cluster': {
            if (config.clusterNodes.length === 0) {
                logger_1.logger.warn('[REDIS_FAILOVER] Cluster nodes not configured, falling back to standalone');
                return new ioredis_1.default({
                    host: config.host,
                    port: config.port,
                    password: config.password,
                    db: config.db,
                    maxRetriesPerRequest: null,
                    enableReadyCheck: false,
                });
            }
            return new ioredis_1.Cluster(config.clusterNodes, {
                redisOptions: {
                    password: config.password,
                },
                maxRedirections: 16,
                enableReadyCheck: false,
            });
        }
        case 'standalone':
        default:
            return new ioredis_1.default({
                host: config.host,
                port: config.port,
                password: config.password,
                db: config.db,
                maxRetriesPerRequest: null,
                enableReadyCheck: false,
            });
    }
}
// ── Exports ─────────────────────────────────────────────────
async function connectRedisWithFailover() {
    return exports.redisFailoverManager.connect();
}
async function disconnectRedis() {
    return exports.redisFailoverManager.disconnect();
}
async function getRedisFailoverHealth() {
    return exports.redisFailoverManager.getHealthStatus();
}
function isRedisConnected() {
    return exports.redisFailoverManager.isRedisConnected();
}
function onRedisFailoverEvent(callback) {
    exports.redisFailoverManager.on('event', callback);
    return () => exports.redisFailoverManager.off('event', callback);
}
function getRedisConnection() {
    return exports.redisFailoverManager.getConnection();
}
//# sourceMappingURL=redis-failover.js.map