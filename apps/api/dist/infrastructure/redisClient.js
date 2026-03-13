"use strict";
// ============================================================
// OrgsLedger API — Redis Client Singleton
// Production-grade Redis client with Cluster + Standalone support,
// connection pooling, pub/sub helpers, and BullMQ integration.
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
exports.Cluster = exports.Redis = exports.redisClientManager = void 0;
exports.getRedisClient = getRedisClient;
exports.withRedis = withRedis;
exports.publish = publish;
exports.subscribe = subscribe;
exports.get = get;
exports.set = set;
exports.createBullMQConnection = createBullMQConnection;
const ioredis_1 = __importStar(require("ioredis"));
exports.Redis = ioredis_1.default;
Object.defineProperty(exports, "Cluster", { enumerable: true, get: function () { return ioredis_1.Cluster; } });
const logger_1 = require("../logger");
function envInt(key, fallback) {
    const v = process.env[key];
    if (!v)
        return fallback;
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? fallback : n;
}
function buildStandaloneConfig() {
    return {
        host: process.env.REDIS_HOST || 'localhost',
        port: envInt('REDIS_PORT', 6379),
        password: process.env.REDIS_PASSWORD || undefined,
        db: envInt('REDIS_DB', 0),
    };
}
/**
 * Parse REDIS_CLUSTER_NODES env var.
 * Format: "host1:port1,host2:port2,host3:port3"
 */
function parseClusterNodes() {
    const raw = process.env.REDIS_CLUSTER_NODES;
    if (!raw)
        return null;
    const nodes = [];
    for (const entry of raw.split(',')) {
        const trimmed = entry.trim();
        if (!trimmed)
            continue;
        const [host, portStr] = trimmed.split(':');
        nodes.push({ host, port: parseInt(portStr || '6379', 10) });
    }
    return nodes.length > 0 ? nodes : null;
}
const CONNECTION_TIMEOUT_MS = envInt('REDIS_CONNECT_TIMEOUT_MS', 10_000);
const MAX_POOL_SIZE = envInt('REDIS_POOL_SIZE', 8);
const RETRY_MAX_DELAY_MS = 30_000;
// ── Retry Strategy ──────────────────────────────────────────
function retryStrategy(times) {
    const delay = Math.min(1000 * Math.pow(2, times - 1), RETRY_MAX_DELAY_MS);
    logger_1.logger.info(`[REDIS] Reconnection attempt #${times}, waiting ${delay}ms`);
    return delay;
}
// ── Redis Client Manager ────────────────────────────────────
class RedisClientManager {
    /** Primary client for general use (get/set, pipeline, etc.) */
    client = null;
    connectionPromise = null;
    /** Dedicated subscriber client (Redis requires a separate connection for subscriptions) */
    subClient = null;
    subPromise = null;
    /** Dedicated publisher client */
    pubClient = null;
    pubPromise = null;
    /** Pool of connections available for BullMQ workers and high-concurrency paths */
    pool = [];
    poolIdx = 0;
    /** Track cluster mode */
    isCluster = false;
    standaloneConfig;
    clusterNodes;
    constructor() {
        this.standaloneConfig = buildStandaloneConfig();
        this.clusterNodes = parseClusterNodes();
        this.isCluster = !!this.clusterNodes;
        logger_1.logger.info('[REDIS] Client manager initialized', {
            mode: this.isCluster ? 'cluster' : 'standalone',
            host: this.isCluster ? undefined : this.standaloneConfig.host,
            port: this.isCluster ? undefined : this.standaloneConfig.port,
            clusterNodes: this.clusterNodes?.length,
        });
    }
    // ── Internal Connection Factories ───────────────────────────
    createStandaloneClient(opts) {
        const cfg = this.standaloneConfig;
        return new ioredis_1.default({
            host: cfg.host,
            port: cfg.port,
            password: cfg.password,
            db: cfg.db,
            lazyConnect: false,
            enableReadyCheck: true,
            retryStrategy,
            reconnectOnError: (err) => err.message.includes('READONLY'),
            ...opts,
        });
    }
    createClusterClient(opts) {
        const password = this.standaloneConfig.password;
        const clusterOpts = {
            redisOptions: {
                password,
                enableReadyCheck: true,
                ...opts,
            },
            clusterRetryStrategy: retryStrategy,
            enableOfflineQueue: true,
            scaleReads: 'slave',
        };
        return new ioredis_1.default.Cluster(this.clusterNodes, clusterOpts);
    }
    createClient(opts) {
        return this.isCluster
            ? this.createClusterClient(opts)
            : this.createStandaloneClient(opts);
    }
    /** Connect a client and wait for "ready" with a timeout. */
    waitForReady(redis, label) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                redis.disconnect();
                reject(new Error(`[REDIS] ${label} connection timeout (${CONNECTION_TIMEOUT_MS}ms)`));
            }, CONNECTION_TIMEOUT_MS);
            const onReady = () => {
                clearTimeout(timeout);
                logger_1.logger.info(`[REDIS] ${label} ready`);
                resolve(redis);
            };
            redis.on('error', (err) => {
                logger_1.logger.error(`[REDIS] ${label} error`, err);
            });
            redis.on('close', () => {
                logger_1.logger.warn(`[REDIS] ${label} connection closed`);
            });
            redis.on('reconnecting', () => {
                logger_1.logger.info(`[REDIS] ${label} reconnecting…`);
            });
            // ioredis emits "ready" when the connection is usable
            if (redis.status === 'ready') {
                onReady();
            }
            else {
                redis.once('ready', onReady);
            }
        });
    }
    // ── Public: Primary Client ──────────────────────────────────
    async getInstance() {
        if (this.client && this.client.status === 'ready') {
            return this.client;
        }
        if (this.connectionPromise) {
            return this.connectionPromise;
        }
        this.connectionPromise = this.waitForReady(this.createClient(), 'primary')
            .then((c) => { this.client = c; return c; })
            .catch((err) => { this.connectionPromise = null; throw err; });
        return this.connectionPromise;
    }
    /**
     * Synchronous access to the already-connected client.
     * Throws if not yet initialized — call `getInstance()` first.
     */
    getSync() {
        if (!this.client) {
            throw new Error('[REDIS] Client not initialized. Call getInstance() first.');
        }
        return this.client;
    }
    // ── Public: Connection Pool ─────────────────────────────────
    /**
     * Get a pooled connection (round-robin).
     * Pool is lazily filled up to MAX_POOL_SIZE.
     */
    async getPooled() {
        if (this.pool.length < MAX_POOL_SIZE) {
            const conn = await this.waitForReady(this.createClient(), `pool-${this.pool.length}`);
            this.pool.push(conn);
            return conn;
        }
        const conn = this.pool[this.poolIdx % this.pool.length];
        this.poolIdx++;
        return conn;
    }
    // ── Public: Pub/Sub Clients ─────────────────────────────────
    async getPublisher() {
        if (this.pubClient && this.pubClient.status === 'ready') {
            return this.pubClient;
        }
        if (this.pubPromise)
            return this.pubPromise;
        this.pubPromise = this.waitForReady(this.createClient(), 'publisher')
            .then((c) => { this.pubClient = c; return c; })
            .catch((err) => { this.pubPromise = null; throw err; });
        return this.pubPromise;
    }
    async getSubscriber() {
        if (this.subClient && this.subClient.status === 'ready') {
            return this.subClient;
        }
        if (this.subPromise)
            return this.subPromise;
        this.subPromise = this.waitForReady(this.createClient(), 'subscriber')
            .then((c) => { this.subClient = c; return c; })
            .catch((err) => { this.subPromise = null; throw err; });
        return this.subPromise;
    }
    // ── Public: Health Check ────────────────────────────────────
    async ping() {
        try {
            const client = await this.getInstance();
            const result = await client.ping();
            return result === 'PONG';
        }
        catch (err) {
            logger_1.logger.error('[REDIS] Ping failed', err);
            return false;
        }
    }
    async getStatus() {
        try {
            if (!this.client) {
                return { connected: false, mode: this.isCluster ? 'cluster' : 'standalone', poolSize: this.pool.length, error: 'Client not initialized' };
            }
            return {
                connected: this.client.status === 'ready',
                mode: this.isCluster ? 'cluster' : 'standalone',
                status: this.client.status,
                poolSize: this.pool.length,
            };
        }
        catch (err) {
            return { connected: false, mode: this.isCluster ? 'cluster' : 'standalone', poolSize: this.pool.length, error: err.message };
        }
    }
    async healthCheck() {
        const start = Date.now();
        try {
            const pong = await this.ping();
            return {
                healthy: pong,
                latencyMs: Date.now() - start,
                mode: this.isCluster ? 'cluster' : 'standalone',
                poolSize: this.pool.length,
            };
        }
        catch {
            return {
                healthy: false,
                latencyMs: Date.now() - start,
                mode: this.isCluster ? 'cluster' : 'standalone',
                poolSize: this.pool.length,
            };
        }
    }
    // ── Public: Graceful Shutdown ───────────────────────────────
    async disconnect() {
        const quits = [];
        const safeQuit = async (label, c) => {
            if (!c)
                return;
            try {
                await c.quit();
                logger_1.logger.info(`[REDIS] ${label} disconnected`);
            }
            catch (err) {
                logger_1.logger.error(`[REDIS] Error disconnecting ${label}`, err);
            }
        };
        quits.push(safeQuit('primary', this.client));
        quits.push(safeQuit('publisher', this.pubClient));
        quits.push(safeQuit('subscriber', this.subClient));
        for (let i = 0; i < this.pool.length; i++) {
            quits.push(safeQuit(`pool-${i}`, this.pool[i]));
        }
        await Promise.allSettled(quits);
        this.client = null;
        this.pubClient = null;
        this.subClient = null;
        this.pool = [];
        this.poolIdx = 0;
        this.connectionPromise = null;
        this.pubPromise = null;
        this.subPromise = null;
        logger_1.logger.info('[REDIS] All connections closed');
    }
    /**
     * Get raw client reference (advanced use only).
     */
    getClient() {
        return this.client;
    }
}
// ── Singleton ───────────────────────────────────────────────
exports.redisClientManager = new RedisClientManager();
// ── Convenience Exports ─────────────────────────────────────
/**
 * Get the singleton Redis client (lazy-initialized, waits for ready).
 * Used by queues, monitoring, services.
 */
async function getRedisClient() {
    return exports.redisClientManager.getInstance();
}
/**
 * Run a callback with a Redis client.
 */
async function withRedis(callback) {
    const redis = await exports.redisClientManager.getInstance();
    return callback(redis);
}
// ── Pub/Sub Helpers ─────────────────────────────────────────
/**
 * Publish a JSON payload to a Redis channel.
 */
async function publish(channel, payload) {
    const pub = await exports.redisClientManager.getPublisher();
    const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
    await pub.publish(channel, message);
}
/**
 * Subscribe to a Redis channel. Returns an unsubscribe function.
 * Automatically uses the dedicated subscriber connection.
 */
async function subscribe(channel, onMessage) {
    const sub = await exports.redisClientManager.getSubscriber();
    sub.on('message', (ch, msg) => {
        if (ch === channel)
            onMessage(msg, ch);
    });
    await sub.subscribe(channel);
    return async () => {
        await sub.unsubscribe(channel);
    };
}
// ── Key/Value Helpers ───────────────────────────────────────
/**
 * Get a value by key. Returns null if not found.
 */
async function get(key) {
    const client = await exports.redisClientManager.getInstance();
    return client.get(key);
}
/**
 * Set a key/value. Optionally provide TTL in seconds.
 */
async function set(key, value, ttlSeconds) {
    const client = await exports.redisClientManager.getInstance();
    if (ttlSeconds !== undefined) {
        await client.set(key, value, 'EX', ttlSeconds);
    }
    else {
        await client.set(key, value);
    }
}
// ── BullMQ Integration ─────────────────────────────────────
/**
 * Create a new Redis connection optimized for BullMQ workers.
 * BullMQ requires `maxRetriesPerRequest: null` for blocking commands.
 * Each worker should call this to get its own dedicated connection.
 */
function createBullMQConnection() {
    const cfg = buildStandaloneConfig();
    return new ioredis_1.default({
        host: cfg.host,
        port: cfg.port,
        password: cfg.password,
        db: cfg.db,
        maxRetriesPerRequest: null, // Required by BullMQ
        enableReadyCheck: false,
        retryStrategy,
    });
}
//# sourceMappingURL=redisClient.js.map