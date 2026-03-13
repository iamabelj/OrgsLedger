"use strict";
// ============================================================
// OrgsLedger API — Socket.IO Redis Adapter Infrastructure
// Provides pub/sub clients for horizontal WebSocket scaling
// ============================================================
//
// Architecture:
//   - Uses node-redis (v5+) for socket.io/redis-adapter
//   - Separate pub/sub clients (Redis requirement)
//   - Auto-reconnect with exponential backoff
//   - Health monitoring & latency metrics
//
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKER_ID = void 0;
exports.initializeSocketRedis = initializeSocketRedis;
exports.getSocketRedisHealth = getSocketRedisHealth;
exports.getPublisher = getPublisher;
exports.getSubscriber = getSubscriber;
exports.isSocketRedisInitialized = isSocketRedisInitialized;
exports.shutdownSocketRedis = shutdownSocketRedis;
const redis_1 = require("redis");
const logger_1 = require("../../logger");
const os_1 = __importDefault(require("os"));
// ── Configuration ───────────────────────────────────────────
function getRedisUrl() {
    if (process.env.REDIS_URL) {
        return process.env.REDIS_URL;
    }
    const host = process.env.REDIS_HOST || 'localhost';
    const port = process.env.REDIS_PORT || '6379';
    const password = process.env.REDIS_PASSWORD;
    const db = process.env.REDIS_DB || '0';
    if (password) {
        return `redis://:${password}@${host}:${port}/${db}`;
    }
    return `redis://${host}:${port}/${db}`;
}
// ── State ───────────────────────────────────────────────────
let pubClient = null;
let subClient = null;
let initialized = false;
let reconnectAttempts = 0;
let lastReconnectAttempt = null;
const WORKER_ID = `${os_1.default.hostname()}-${process.pid}`;
exports.WORKER_ID = WORKER_ID;
// ── Client Factory ──────────────────────────────────────────
function createRedisClient(name) {
    const url = getRedisUrl();
    const client = (0, redis_1.createClient)({
        url,
        socket: {
            connectTimeout: 10000,
            reconnectStrategy: (retries) => {
                reconnectAttempts++;
                lastReconnectAttempt = new Date();
                const delay = Math.min(1000 * Math.pow(2, retries), 30000);
                logger_1.logger.warn(`[SOCKET_REDIS] ${name} reconnecting (attempt ${retries + 1}), delay: ${delay}ms`, {
                    workerId: WORKER_ID,
                });
                return delay;
            },
        },
    });
    // Event handlers
    client.on('error', (err) => {
        logger_1.logger.error(`[SOCKET_REDIS] ${name} error`, {
            error: err.message,
            workerId: WORKER_ID,
        });
    });
    client.on('connect', () => {
        logger_1.logger.info(`[SOCKET_REDIS] ${name} connecting...`, {
            workerId: WORKER_ID,
        });
    });
    client.on('ready', () => {
        logger_1.logger.info(`[SOCKET_REDIS] ${name} ready`, {
            workerId: WORKER_ID,
        });
        reconnectAttempts = 0;
    });
    client.on('reconnecting', () => {
        logger_1.logger.info(`[SOCKET_REDIS] ${name} reconnecting...`, {
            workerId: WORKER_ID,
        });
    });
    client.on('end', () => {
        logger_1.logger.warn(`[SOCKET_REDIS] ${name} connection ended`, {
            workerId: WORKER_ID,
        });
    });
    return client;
}
// ── Initialization ──────────────────────────────────────────
/**
 * Initialize Redis pub/sub clients for Socket.IO adapter.
 * Must be called before attaching adapter to Socket.IO server.
 */
async function initializeSocketRedis() {
    if (initialized && pubClient && subClient) {
        return { pubClient, subClient };
    }
    logger_1.logger.info('[SOCKET_REDIS] Initializing pub/sub clients...', {
        workerId: WORKER_ID,
        redisUrl: getRedisUrl().replace(/:[^:@]+@/, ':***@'), // Mask password
    });
    try {
        // Create dedicated pub/sub clients
        pubClient = createRedisClient('publisher');
        subClient = createRedisClient('subscriber');
        // Connect both clients in parallel
        await Promise.all([
            pubClient.connect(),
            subClient.connect(),
        ]);
        initialized = true;
        logger_1.logger.info('[SOCKET_REDIS] Pub/sub clients initialized successfully', {
            workerId: WORKER_ID,
        });
        return { pubClient, subClient };
    }
    catch (err) {
        logger_1.logger.error('[SOCKET_REDIS] Failed to initialize pub/sub clients', {
            error: err instanceof Error ? err.message : String(err),
            workerId: WORKER_ID,
        });
        throw err;
    }
}
// ── Health Check ────────────────────────────────────────────
/**
 * Check health of Socket.IO Redis connections.
 */
async function getSocketRedisHealth() {
    const health = {
        connected: false,
        pubConnected: false,
        subConnected: false,
        latencyMs: null,
        lastReconnectAttempt,
        reconnectAttempts,
    };
    if (!pubClient || !subClient) {
        return health;
    }
    health.pubConnected = pubClient.isReady;
    health.subConnected = subClient.isReady;
    health.connected = health.pubConnected && health.subConnected;
    // Measure latency
    if (health.pubConnected) {
        try {
            const start = Date.now();
            await pubClient.ping();
            health.latencyMs = Date.now() - start;
        }
        catch {
            health.latencyMs = null;
        }
    }
    return health;
}
// ── Getters ─────────────────────────────────────────────────
/**
 * Get the publisher client (throws if not initialized).
 */
function getPublisher() {
    if (!pubClient) {
        throw new Error('[SOCKET_REDIS] Publisher not initialized. Call initializeSocketRedis() first.');
    }
    return pubClient;
}
/**
 * Get the subscriber client (throws if not initialized).
 */
function getSubscriber() {
    if (!subClient) {
        throw new Error('[SOCKET_REDIS] Subscriber not initialized. Call initializeSocketRedis() first.');
    }
    return subClient;
}
/**
 * Check if Socket.IO Redis is initialized.
 */
function isSocketRedisInitialized() {
    return initialized && !!pubClient && !!subClient;
}
// ── Shutdown ────────────────────────────────────────────────
/**
 * Gracefully shut down Redis connections.
 */
async function shutdownSocketRedis() {
    logger_1.logger.info('[SOCKET_REDIS] Shutting down pub/sub clients...', {
        workerId: WORKER_ID,
    });
    const closePromises = [];
    if (pubClient) {
        closePromises.push(pubClient.quit().then(() => { }).catch((err) => {
            logger_1.logger.error('[SOCKET_REDIS] Error closing publisher', { error: err.message });
        }));
    }
    if (subClient) {
        closePromises.push(subClient.quit().then(() => { }).catch((err) => {
            logger_1.logger.error('[SOCKET_REDIS] Error closing subscriber', { error: err.message });
        }));
    }
    await Promise.all(closePromises);
    pubClient = null;
    subClient = null;
    initialized = false;
    logger_1.logger.info('[SOCKET_REDIS] Pub/sub clients shut down', {
        workerId: WORKER_ID,
    });
}
//# sourceMappingURL=socket-redis.js.map