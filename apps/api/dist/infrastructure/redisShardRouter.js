"use strict";
// ============================================================
// OrgsLedger API — Redis Shard Router
// Distributes meeting data across Redis cluster nodes
// ============================================================
//
// Architecture:
//   - 32 shards for meeting data distribution
//   - Deterministic routing: hash(meetingId) % 32
//   - Key pattern: meeting:{shard}:{meetingId}
//   - Support for Redis cluster or multiple standalone nodes
//   - Connection pooling with lazy initialization
//   - Prometheus metrics for memory monitoring
//
// Configuration (Environment Variables):
//   REDIS_SHARD_COUNT=32 (default)
//   REDIS_SHARD_MODE=cluster|standalone|multi (default: standalone)
//   
//   For cluster mode:
//     REDIS_CLUSTER_NODES=host1:port1,host2:port2,...
//   
//   For multi-node mode:
//     REDIS_SHARD_NODES=host1:port1,host2:port2,... (one per shard group)
//   
//   For standalone mode (default):
//     REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
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
exports.redisShardRouter = exports.redisShardLatencyHistogram = exports.redisShardOpsCounter = exports.redisShardKeysGauge = exports.redisShardMemoryUsageGauge = exports.REDIS_SHARD_MODE = exports.REDIS_SHARD_COUNT = void 0;
exports.getMeetingShardIndex = getMeetingShardIndex;
exports.getMeetingKey = getMeetingKey;
exports.initializeRedisShardRouter = initializeRedisShardRouter;
exports.getMeetingRedisClient = getMeetingRedisClient;
exports.setMeetingData = setMeetingData;
exports.getMeetingData = getMeetingData;
exports.deleteMeetingData = deleteMeetingData;
exports.setMeetingField = setMeetingField;
exports.getMeetingField = getMeetingField;
exports.getMeetingAllFields = getMeetingAllFields;
exports.meetingExists = meetingExists;
exports.setMeetingTTL = setMeetingTTL;
exports.appendToMeetingList = appendToMeetingList;
exports.getMeetingList = getMeetingList;
exports.getMeetingListLength = getMeetingListLength;
exports.getRedisShardStats = getRedisShardStats;
exports.shutdownRedisShardRouter = shutdownRedisShardRouter;
const ioredis_1 = __importStar(require("ioredis"));
const client = __importStar(require("prom-client"));
const logger_1 = require("../logger");
// ── Configuration ───────────────────────────────────────────
/**
 * Number of shards for meeting data distribution
 */
exports.REDIS_SHARD_COUNT = parseInt(process.env.REDIS_SHARD_COUNT || '32', 10);
/**
 * Shard mode: cluster (Redis Cluster), multi (multiple standalone), standalone
 */
exports.REDIS_SHARD_MODE = (process.env.REDIS_SHARD_MODE || 'standalone');
/**
 * TTL for meeting data (24 hours default, can be overridden per operation)
 */
const DEFAULT_TTL_SECONDS = parseInt(process.env.REDIS_MEETING_TTL || '86400', 10);
/**
 * Memory monitoring interval (5 minutes)
 */
const MEMORY_MONITOR_INTERVAL_MS = 5 * 60 * 1000;
// ── Prometheus Metrics ──────────────────────────────────────
const register = client.register;
exports.redisShardMemoryUsageGauge = new client.Gauge({
    name: 'orgsledger_redis_shard_memory_usage',
    help: 'Memory usage per Redis shard in bytes',
    labelNames: ['shard', 'node'],
    registers: [register],
});
exports.redisShardKeysGauge = new client.Gauge({
    name: 'orgsledger_redis_shard_keys_count',
    help: 'Number of keys per Redis shard',
    labelNames: ['shard'],
    registers: [register],
});
exports.redisShardOpsCounter = new client.Counter({
    name: 'orgsledger_redis_shard_operations_total',
    help: 'Total operations per shard',
    labelNames: ['shard', 'operation'],
    registers: [register],
});
exports.redisShardLatencyHistogram = new client.Histogram({
    name: 'orgsledger_redis_shard_latency_seconds',
    help: 'Redis shard operation latency in seconds',
    labelNames: ['operation'],
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [register],
});
// ── Hash Function ───────────────────────────────────────────
/**
 * Fast djb2 hash function for deterministic shard routing
 * Same algorithm as queue-manager for consistency
 */
function djb2Hash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }
    return hash >>> 0; // Return as unsigned 32-bit integer
}
/**
 * Get shard index for a meeting ID
 */
function getMeetingShardIndex(meetingId) {
    return djb2Hash(meetingId) % exports.REDIS_SHARD_COUNT;
}
/**
 * Build Redis key for meeting data
 * Pattern: meeting:{shard}:{meetingId}
 */
function getMeetingKey(meetingId, suffix) {
    const shardIndex = getMeetingShardIndex(meetingId);
    const baseKey = `meeting:${shardIndex}:${meetingId}`;
    return suffix ? `${baseKey}:${suffix}` : baseKey;
}
function parseNodeConfigs() {
    const defaultHost = process.env.REDIS_HOST || 'localhost';
    const defaultPort = parseInt(process.env.REDIS_PORT || '6379', 10);
    const password = process.env.REDIS_PASSWORD;
    const db = parseInt(process.env.REDIS_DB || '0', 10);
    if (exports.REDIS_SHARD_MODE === 'multi') {
        // Parse comma-separated node list
        const nodesString = process.env.REDIS_SHARD_NODES || `${defaultHost}:${defaultPort}`;
        return nodesString.split(',').map(node => {
            const [host, portStr] = node.trim().split(':');
            return {
                host,
                port: parseInt(portStr, 10),
                password,
                db,
            };
        });
    }
    // Single node for standalone/cluster
    return [{
            host: defaultHost,
            port: defaultPort,
            password,
            db,
        }];
}
function parseClusterNodes() {
    const nodesString = process.env.REDIS_CLUSTER_NODES;
    if (!nodesString) {
        const defaultHost = process.env.REDIS_HOST || 'localhost';
        const defaultPort = parseInt(process.env.REDIS_PORT || '6379', 10);
        return [{ host: defaultHost, port: defaultPort }];
    }
    return nodesString.split(',').map(node => {
        const [host, portStr] = node.trim().split(':');
        return {
            host,
            port: parseInt(portStr, 10),
        };
    });
}
// ── Redis Shard Router Class ────────────────────────────────
class RedisShardRouter {
    mode;
    shardCount;
    // For standalone/multi mode: array of Redis connections
    nodes = [];
    nodeConfigs = [];
    // For cluster mode: single cluster connection
    cluster = null;
    isInitialized = false;
    initPromise = null;
    // Memory monitoring
    memoryMonitorInterval = null;
    constructor() {
        this.mode = exports.REDIS_SHARD_MODE;
        this.shardCount = exports.REDIS_SHARD_COUNT;
        this.nodeConfigs = parseNodeConfigs();
        logger_1.logger.info('[REDIS_SHARD_ROUTER] Initialized', {
            mode: this.mode,
            shardCount: this.shardCount,
            nodeCount: this.nodeConfigs.length,
        });
    }
    /**
     * Initialize Redis connections
     */
    async initialize() {
        if (this.isInitialized)
            return;
        if (this.initPromise)
            return this.initPromise;
        this.initPromise = this.doInitialize();
        await this.initPromise;
        this.isInitialized = true;
        // Start memory monitoring
        this.startMemoryMonitoring();
    }
    async doInitialize() {
        try {
            if (this.mode === 'cluster') {
                await this.initializeCluster();
            }
            else {
                await this.initializeNodes();
            }
            logger_1.logger.info('[REDIS_SHARD_ROUTER] Connected', {
                mode: this.mode,
                shardCount: this.shardCount,
            });
        }
        catch (err) {
            logger_1.logger.error('[REDIS_SHARD_ROUTER] Initialization failed', err);
            throw err;
        }
    }
    async initializeCluster() {
        const clusterNodes = parseClusterNodes();
        const password = process.env.REDIS_PASSWORD;
        const clusterOptions = {
            redisOptions: {
                password,
                connectTimeout: 10000,
            },
            clusterRetryStrategy: (times) => Math.min(1000 * Math.pow(2, times - 1), 30000),
            enableReadyCheck: true,
            scaleReads: 'slave', // Read from replicas when possible
        };
        this.cluster = new ioredis_1.Cluster(clusterNodes, clusterOptions);
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Cluster connection timeout'));
            }, 15000);
            this.cluster.on('ready', () => {
                clearTimeout(timeout);
                logger_1.logger.info('[REDIS_SHARD_ROUTER] Cluster ready', {
                    nodes: clusterNodes.length,
                });
                resolve();
            });
            this.cluster.on('error', (err) => {
                logger_1.logger.error('[REDIS_SHARD_ROUTER] Cluster error', { error: err.message });
            });
            this.cluster.on('node error', (err, address) => {
                logger_1.logger.warn('[REDIS_SHARD_ROUTER] Node error', { error: err.message, address });
            });
        });
    }
    async initializeNodes() {
        const connectionPromises = [];
        for (const config of this.nodeConfigs) {
            const nodePromise = new Promise((resolve, reject) => {
                const options = {
                    host: config.host,
                    port: config.port,
                    password: config.password,
                    db: config.db,
                    connectTimeout: 10000,
                    retryStrategy: (times) => {
                        const delay = Math.min(1000 * Math.pow(2, times - 1), 30000);
                        return delay;
                    },
                    lazyConnect: false,
                };
                const redis = new ioredis_1.default(options);
                redis.on('ready', () => {
                    logger_1.logger.info('[REDIS_SHARD_ROUTER] Node connected', {
                        host: config.host,
                        port: config.port,
                        nodeIndex: this.nodes.length,
                    });
                    this.nodes.push(redis);
                    resolve();
                });
                redis.on('error', (err) => {
                    logger_1.logger.error('[REDIS_SHARD_ROUTER] Node error', {
                        host: config.host,
                        port: config.port,
                        error: err.message,
                    });
                });
                // Timeout
                setTimeout(() => {
                    if (redis.status !== 'ready') {
                        reject(new Error(`Connection timeout: ${config.host}:${config.port}`));
                    }
                }, 10000);
            });
            connectionPromises.push(nodePromise);
        }
        await Promise.all(connectionPromises);
    }
    /**
     * Get Redis client for a specific meeting
     * Routes to the correct shard based on meeting ID
     */
    getMeetingRedisClient(meetingId) {
        const shardIndex = getMeetingShardIndex(meetingId);
        if (this.mode === 'cluster') {
            if (!this.cluster) {
                throw new Error('Cluster not initialized');
            }
            return this.cluster;
        }
        // For multi/standalone: route to node based on shard
        const nodeIndex = shardIndex % this.nodes.length;
        const node = this.nodes[nodeIndex];
        if (!node) {
            throw new Error(`No node available for shard ${shardIndex}`);
        }
        return node;
    }
    /**
     * Set meeting data
     */
    async setMeetingData(meetingId, data, options = {}) {
        const startTime = Date.now();
        const shardIndex = getMeetingShardIndex(meetingId);
        const key = getMeetingKey(meetingId);
        try {
            const client = this.getMeetingRedisClient(meetingId);
            const serialized = JSON.stringify(data);
            const ttl = options.ttl ?? DEFAULT_TTL_SECONDS;
            let result;
            if (options.nx) {
                // SET only if not exists
                result = await client.set(key, serialized, 'EX', ttl, 'NX');
            }
            else if (options.xx) {
                // SET only if exists
                result = await client.set(key, serialized, 'EX', ttl, 'XX');
            }
            else {
                // Normal SET with TTL
                result = await client.set(key, serialized, 'EX', ttl);
            }
            // Update metrics
            const duration = (Date.now() - startTime) / 1000;
            exports.redisShardOpsCounter.labels(String(shardIndex), 'set').inc();
            exports.redisShardLatencyHistogram.labels('set').observe(duration);
            return result === 'OK';
        }
        catch (err) {
            logger_1.logger.error('[REDIS_SHARD_ROUTER] setMeetingData failed', {
                meetingId,
                shardIndex,
                error: err.message,
            });
            throw err;
        }
    }
    /**
     * Get meeting data
     */
    async getMeetingData(meetingId) {
        const startTime = Date.now();
        const shardIndex = getMeetingShardIndex(meetingId);
        const key = getMeetingKey(meetingId);
        try {
            const client = this.getMeetingRedisClient(meetingId);
            const data = await client.get(key);
            // Update metrics
            const duration = (Date.now() - startTime) / 1000;
            exports.redisShardOpsCounter.labels(String(shardIndex), 'get').inc();
            exports.redisShardLatencyHistogram.labels('get').observe(duration);
            if (!data)
                return null;
            return JSON.parse(data);
        }
        catch (err) {
            logger_1.logger.error('[REDIS_SHARD_ROUTER] getMeetingData failed', {
                meetingId,
                shardIndex,
                error: err.message,
            });
            throw err;
        }
    }
    /**
     * Delete meeting data
     */
    async deleteMeetingData(meetingId) {
        const startTime = Date.now();
        const shardIndex = getMeetingShardIndex(meetingId);
        const key = getMeetingKey(meetingId);
        try {
            const client = this.getMeetingRedisClient(meetingId);
            const result = await client.del(key);
            // Update metrics
            const duration = (Date.now() - startTime) / 1000;
            exports.redisShardOpsCounter.labels(String(shardIndex), 'delete').inc();
            exports.redisShardLatencyHistogram.labels('delete').observe(duration);
            return result > 0;
        }
        catch (err) {
            logger_1.logger.error('[REDIS_SHARD_ROUTER] deleteMeetingData failed', {
                meetingId,
                shardIndex,
                error: err.message,
            });
            throw err;
        }
    }
    /**
     * Set a specific field in meeting data (hash field)
     */
    async setMeetingField(meetingId, field, value, ttl) {
        const startTime = Date.now();
        const shardIndex = getMeetingShardIndex(meetingId);
        const key = getMeetingKey(meetingId);
        try {
            const client = this.getMeetingRedisClient(meetingId);
            const serialized = typeof value === 'string' ? value : JSON.stringify(value);
            const pipeline = client.pipeline();
            pipeline.hset(key, field, serialized);
            if (ttl) {
                pipeline.expire(key, ttl);
            }
            else {
                pipeline.expire(key, DEFAULT_TTL_SECONDS);
            }
            await pipeline.exec();
            // Update metrics
            const duration = (Date.now() - startTime) / 1000;
            exports.redisShardOpsCounter.labels(String(shardIndex), 'hset').inc();
            exports.redisShardLatencyHistogram.labels('hset').observe(duration);
        }
        catch (err) {
            logger_1.logger.error('[REDIS_SHARD_ROUTER] setMeetingField failed', {
                meetingId,
                field,
                shardIndex,
                error: err.message,
            });
            throw err;
        }
    }
    /**
     * Get a specific field from meeting data (hash field)
     */
    async getMeetingField(meetingId, field) {
        const startTime = Date.now();
        const shardIndex = getMeetingShardIndex(meetingId);
        const key = getMeetingKey(meetingId);
        try {
            const client = this.getMeetingRedisClient(meetingId);
            const data = await client.hget(key, field);
            // Update metrics
            const duration = (Date.now() - startTime) / 1000;
            exports.redisShardOpsCounter.labels(String(shardIndex), 'hget').inc();
            exports.redisShardLatencyHistogram.labels('hget').observe(duration);
            if (!data)
                return null;
            try {
                return JSON.parse(data);
            }
            catch {
                return data; // Return as-is if not JSON
            }
        }
        catch (err) {
            logger_1.logger.error('[REDIS_SHARD_ROUTER] getMeetingField failed', {
                meetingId,
                field,
                shardIndex,
                error: err.message,
            });
            throw err;
        }
    }
    /**
     * Get all meeting hash fields
     */
    async getMeetingAllFields(meetingId) {
        const startTime = Date.now();
        const shardIndex = getMeetingShardIndex(meetingId);
        const key = getMeetingKey(meetingId);
        try {
            const client = this.getMeetingRedisClient(meetingId);
            const data = await client.hgetall(key);
            // Update metrics
            const duration = (Date.now() - startTime) / 1000;
            exports.redisShardOpsCounter.labels(String(shardIndex), 'hgetall').inc();
            exports.redisShardLatencyHistogram.labels('hgetall').observe(duration);
            if (!data || Object.keys(data).length === 0)
                return null;
            // Parse JSON fields
            const result = {};
            for (const [key, value] of Object.entries(data)) {
                try {
                    result[key] = JSON.parse(value);
                }
                catch {
                    result[key] = value;
                }
            }
            return result;
        }
        catch (err) {
            logger_1.logger.error('[REDIS_SHARD_ROUTER] getMeetingAllFields failed', {
                meetingId,
                shardIndex,
                error: err.message,
            });
            throw err;
        }
    }
    /**
     * Check if meeting data exists
     */
    async meetingExists(meetingId) {
        const shardIndex = getMeetingShardIndex(meetingId);
        const key = getMeetingKey(meetingId);
        try {
            const client = this.getMeetingRedisClient(meetingId);
            const exists = await client.exists(key);
            return exists > 0;
        }
        catch (err) {
            logger_1.logger.error('[REDIS_SHARD_ROUTER] meetingExists failed', {
                meetingId,
                shardIndex,
                error: err.message,
            });
            throw err;
        }
    }
    /**
     * Set TTL on meeting data
     */
    async setMeetingTTL(meetingId, ttlSeconds) {
        const shardIndex = getMeetingShardIndex(meetingId);
        const key = getMeetingKey(meetingId);
        try {
            const client = this.getMeetingRedisClient(meetingId);
            const result = await client.expire(key, ttlSeconds);
            return result === 1;
        }
        catch (err) {
            logger_1.logger.error('[REDIS_SHARD_ROUTER] setMeetingTTL failed', {
                meetingId,
                shardIndex,
                error: err.message,
            });
            throw err;
        }
    }
    /**
     * Append to meeting list (e.g., transcripts, events)
     */
    async appendToMeetingList(meetingId, listName, value, maxLength) {
        const startTime = Date.now();
        const shardIndex = getMeetingShardIndex(meetingId);
        const key = getMeetingKey(meetingId, listName);
        try {
            const client = this.getMeetingRedisClient(meetingId);
            const serialized = JSON.stringify(value);
            const pipeline = client.pipeline();
            pipeline.rpush(key, serialized);
            if (maxLength) {
                pipeline.ltrim(key, -maxLength, -1);
            }
            pipeline.expire(key, DEFAULT_TTL_SECONDS);
            const results = await pipeline.exec();
            const length = results?.[0]?.[1] || 0;
            // Update metrics
            const duration = (Date.now() - startTime) / 1000;
            exports.redisShardOpsCounter.labels(String(shardIndex), 'rpush').inc();
            exports.redisShardLatencyHistogram.labels('rpush').observe(duration);
            return length;
        }
        catch (err) {
            logger_1.logger.error('[REDIS_SHARD_ROUTER] appendToMeetingList failed', {
                meetingId,
                listName,
                shardIndex,
                error: err.message,
            });
            throw err;
        }
    }
    /**
     * Get meeting list items
     */
    async getMeetingList(meetingId, listName, start = 0, end = -1) {
        const startTime = Date.now();
        const shardIndex = getMeetingShardIndex(meetingId);
        const key = getMeetingKey(meetingId, listName);
        try {
            const client = this.getMeetingRedisClient(meetingId);
            const items = await client.lrange(key, start, end);
            // Update metrics
            const duration = (Date.now() - startTime) / 1000;
            exports.redisShardOpsCounter.labels(String(shardIndex), 'lrange').inc();
            exports.redisShardLatencyHistogram.labels('lrange').observe(duration);
            return items.map(item => {
                try {
                    return JSON.parse(item);
                }
                catch {
                    return item;
                }
            });
        }
        catch (err) {
            logger_1.logger.error('[REDIS_SHARD_ROUTER] getMeetingList failed', {
                meetingId,
                listName,
                shardIndex,
                error: err.message,
            });
            throw err;
        }
    }
    /**
     * Get meeting list length
     */
    async getMeetingListLength(meetingId, listName) {
        const shardIndex = getMeetingShardIndex(meetingId);
        const key = getMeetingKey(meetingId, listName);
        try {
            const client = this.getMeetingRedisClient(meetingId);
            return await client.llen(key);
        }
        catch (err) {
            logger_1.logger.error('[REDIS_SHARD_ROUTER] getMeetingListLength failed', {
                meetingId,
                listName,
                shardIndex,
                error: err.message,
            });
            throw err;
        }
    }
    /**
     * Start memory monitoring for shards
     */
    startMemoryMonitoring() {
        if (this.memoryMonitorInterval)
            return;
        // Initial collection
        this.collectMemoryMetrics().catch(err => {
            logger_1.logger.warn('[REDIS_SHARD_ROUTER] Initial memory metrics collection failed', { error: err.message });
        });
        // Periodic collection
        this.memoryMonitorInterval = setInterval(() => {
            this.collectMemoryMetrics().catch(err => {
                logger_1.logger.warn('[REDIS_SHARD_ROUTER] Memory metrics collection failed', { error: err.message });
            });
        }, MEMORY_MONITOR_INTERVAL_MS);
    }
    /**
     * Collect memory metrics from all nodes
     */
    async collectMemoryMetrics() {
        if (this.mode === 'cluster' && this.cluster) {
            // For cluster mode, get info from all nodes
            const nodes = this.cluster.nodes('master');
            for (let i = 0; i < nodes.length; i++) {
                try {
                    const info = await nodes[i].info('memory');
                    const memoryUsed = this.parseRedisInfoValue(info, 'used_memory');
                    exports.redisShardMemoryUsageGauge.labels('cluster', String(i)).set(memoryUsed);
                }
                catch (err) {
                    // Node might be unavailable
                }
            }
        }
        else {
            // For standalone/multi mode
            for (let i = 0; i < this.nodes.length; i++) {
                try {
                    const node = this.nodes[i];
                    if (node.status !== 'ready')
                        continue;
                    const info = await node.info('memory');
                    const memoryUsed = this.parseRedisInfoValue(info, 'used_memory');
                    // Calculate which shards map to this node
                    const shardsForNode = [];
                    for (let s = 0; s < this.shardCount; s++) {
                        if (s % this.nodes.length === i) {
                            shardsForNode.push(s);
                        }
                    }
                    // Distribute memory across shards (approximation)
                    const memoryPerShard = memoryUsed / shardsForNode.length;
                    for (const shard of shardsForNode) {
                        exports.redisShardMemoryUsageGauge.labels(String(shard), String(i)).set(memoryPerShard);
                    }
                    // Also count keys per shard pattern
                    await this.collectShardKeyStats(node, i, shardsForNode);
                }
                catch (err) {
                    // Node might be unavailable
                }
            }
        }
    }
    /**
     * Collect key statistics per shard
     */
    async collectShardKeyStats(node, nodeIndex, shardsForNode) {
        try {
            for (const shard of shardsForNode) {
                // Count keys matching the shard pattern (sampling)
                const pattern = `meeting:${shard}:*`;
                const keys = await node.keys(pattern);
                exports.redisShardKeysGauge.labels(String(shard)).set(keys.length);
            }
        }
        catch (err) {
            // Keys command might be slow, ignore errors
        }
    }
    /**
     * Parse Redis INFO output for a specific value
     */
    parseRedisInfoValue(info, key) {
        const lines = info.split('\r\n');
        for (const line of lines) {
            if (line.startsWith(`${key}:`)) {
                return parseInt(line.split(':')[1], 10) || 0;
            }
        }
        return 0;
    }
    /**
     * Get router statistics
     */
    async getStats() {
        const shards = [];
        let activeConnections = 0;
        if (this.mode === 'cluster' && this.cluster) {
            const nodes = this.cluster.nodes('all');
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                const isConnected = node.status === 'ready';
                if (isConnected)
                    activeConnections++;
                let memoryUsed = 0;
                let memoryPeak = 0;
                try {
                    const info = await node.info('memory');
                    memoryUsed = this.parseRedisInfoValue(info, 'used_memory');
                    memoryPeak = this.parseRedisInfoValue(info, 'used_memory_peak');
                }
                catch { }
                shards.push({
                    shardIndex: i,
                    nodeIndex: i,
                    host: node.options.host || 'unknown',
                    port: node.options.port || 0,
                    connected: isConnected,
                    memoryUsed,
                    memoryPeak,
                });
            }
            return {
                mode: 'cluster',
                shardCount: this.shardCount,
                nodeCount: nodes.length,
                totalConnections: nodes.length,
                activeConnections,
                shards,
            };
        }
        // Standalone/multi mode
        for (let i = 0; i < this.nodes.length; i++) {
            const node = this.nodes[i];
            const config = this.nodeConfigs[i];
            const isConnected = node.status === 'ready';
            if (isConnected)
                activeConnections++;
            let memoryUsed = 0;
            let memoryPeak = 0;
            try {
                const info = await node.info('memory');
                memoryUsed = this.parseRedisInfoValue(info, 'used_memory');
                memoryPeak = this.parseRedisInfoValue(info, 'used_memory_peak');
            }
            catch { }
            // Each node handles multiple shards
            for (let s = i; s < this.shardCount; s += this.nodes.length) {
                shards.push({
                    shardIndex: s,
                    nodeIndex: i,
                    host: config.host,
                    port: config.port,
                    connected: isConnected,
                    memoryUsed: memoryUsed / Math.ceil(this.shardCount / this.nodes.length),
                    memoryPeak: memoryPeak / Math.ceil(this.shardCount / this.nodes.length),
                });
            }
        }
        return {
            mode: this.mode,
            shardCount: this.shardCount,
            nodeCount: this.nodes.length,
            totalConnections: this.nodes.length,
            activeConnections,
            shards: shards.sort((a, b) => a.shardIndex - b.shardIndex),
        };
    }
    /**
     * Get shard distribution stats (for debugging)
     */
    getShardDistribution(sampleMeetingIds) {
        const distribution = new Map();
        for (const meetingId of sampleMeetingIds) {
            const shard = getMeetingShardIndex(meetingId);
            const existing = distribution.get(shard) || [];
            existing.push(meetingId);
            distribution.set(shard, existing);
        }
        return distribution;
    }
    /**
     * Shutdown all connections
     */
    async shutdown() {
        // Stop memory monitoring
        if (this.memoryMonitorInterval) {
            clearInterval(this.memoryMonitorInterval);
            this.memoryMonitorInterval = null;
        }
        // Close connections
        if (this.mode === 'cluster' && this.cluster) {
            await this.cluster.quit();
            this.cluster = null;
        }
        else {
            await Promise.all(this.nodes.map(node => node.quit()));
            this.nodes = [];
        }
        this.isInitialized = false;
        this.initPromise = null;
        logger_1.logger.info('[REDIS_SHARD_ROUTER] Shutdown complete');
    }
}
// ── Singleton Instance ──────────────────────────────────────
const redisShardRouter = new RedisShardRouter();
exports.redisShardRouter = redisShardRouter;
/**
 * Initialize the shard router
 */
async function initializeRedisShardRouter() {
    return redisShardRouter.initialize();
}
/**
 * Get Redis client for a specific meeting
 */
function getMeetingRedisClient(meetingId) {
    return redisShardRouter.getMeetingRedisClient(meetingId);
}
/**
 * Set meeting data with optional TTL
 */
async function setMeetingData(meetingId, data, options) {
    return redisShardRouter.setMeetingData(meetingId, data, options);
}
/**
 * Get meeting data
 */
async function getMeetingData(meetingId) {
    return redisShardRouter.getMeetingData(meetingId);
}
/**
 * Delete meeting data
 */
async function deleteMeetingData(meetingId) {
    return redisShardRouter.deleteMeetingData(meetingId);
}
/**
 * Set meeting hash field
 */
async function setMeetingField(meetingId, field, value, ttl) {
    return redisShardRouter.setMeetingField(meetingId, field, value, ttl);
}
/**
 * Get meeting hash field
 */
async function getMeetingField(meetingId, field) {
    return redisShardRouter.getMeetingField(meetingId, field);
}
/**
 * Get all meeting hash fields
 */
async function getMeetingAllFields(meetingId) {
    return redisShardRouter.getMeetingAllFields(meetingId);
}
/**
 * Check if meeting exists
 */
async function meetingExists(meetingId) {
    return redisShardRouter.meetingExists(meetingId);
}
/**
 * Set meeting TTL
 */
async function setMeetingTTL(meetingId, ttlSeconds) {
    return redisShardRouter.setMeetingTTL(meetingId, ttlSeconds);
}
/**
 * Append to meeting list
 */
async function appendToMeetingList(meetingId, listName, value, maxLength) {
    return redisShardRouter.appendToMeetingList(meetingId, listName, value, maxLength);
}
/**
 * Get meeting list
 */
async function getMeetingList(meetingId, listName, start, end) {
    return redisShardRouter.getMeetingList(meetingId, listName, start, end);
}
/**
 * Get meeting list length
 */
async function getMeetingListLength(meetingId, listName) {
    return redisShardRouter.getMeetingListLength(meetingId, listName);
}
/**
 * Get router statistics
 */
async function getRedisShardStats() {
    return redisShardRouter.getStats();
}
/**
 * Shutdown router
 */
async function shutdownRedisShardRouter() {
    return redisShardRouter.shutdown();
}
//# sourceMappingURL=redisShardRouter.js.map