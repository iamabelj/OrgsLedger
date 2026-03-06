"use strict";
// ============================================================
// OrgsLedger API — Redis Client Singleton
// Distributed queue infrastructure for transcript processing
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Redis = exports.redisClientManager = void 0;
exports.withRedis = withRedis;
exports.getRedisClient = getRedisClient;
const ioredis_1 = __importDefault(require("ioredis"));
exports.Redis = ioredis_1.default;
const logger_1 = require("../logger");
class RedisClientManager {
    client = null;
    config;
    connectionPromise = null;
    constructor() {
        const host = process.env.REDIS_HOST || 'localhost';
        const port = parseInt(process.env.REDIS_PORT || '6379', 10);
        const password = process.env.REDIS_PASSWORD;
        this.config = {
            host,
            port,
            password,
            db: parseInt(process.env.REDIS_DB || '0', 10),
            lazyConnect: true,
            retryStrategy: (times) => {
                // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
                const delay = Math.min(1000 * Math.pow(2, times - 1), 30000);
                logger_1.logger.info(`Redis reconnection attempt #${times}, waiting ${delay}ms`);
                return delay;
            },
            reconnectOnError: (err) => {
                const targetError = 'READONLY';
                if (err.message.includes(targetError)) {
                    // Only reconnect when the error contains "READONLY"
                    return true;
                }
                return false;
            },
        };
        logger_1.logger.info('Redis client manager initialized', {
            host: this.config.host,
            port: this.config.port,
            db: this.config.db,
        });
    }
    /**
     * Get Redis client instance (lazy-initialized)
     */
    async getInstance() {
        if (this.client?.status === 'ready') {
            return this.client;
        }
        // If connection in progress, wait for it
        if (this.connectionPromise) {
            return this.connectionPromise;
        }
        // Start connection
        this.connectionPromise = this.connect();
        return this.connectionPromise;
    }
    /**
     * Establish Redis connection with event handlers
     */
    async connect() {
        return new Promise((resolve, reject) => {
            const redis = new ioredis_1.default(this.config);
            redis.on('ready', () => {
                logger_1.logger.info('Redis client ready', {
                    host: this.config.host,
                    port: this.config.port,
                });
                this.client = redis;
                resolve(redis);
            });
            redis.on('error', (err) => {
                logger_1.logger.error('Redis client error', err);
                // Don't reject, just log — client might recover with retry strategy
            });
            redis.on('close', () => {
                logger_1.logger.warn('Redis connection closed');
            });
            redis.on('reconnecting', () => {
                logger_1.logger.info('Redis client reconnecting...');
            });
            redis.on('connect', () => {
                logger_1.logger.debug('Redis socket connected');
            });
            redis.on('reconnect', () => {
                logger_1.logger.info('Redis client reconnected');
            });
            // Timeout if connection takes > 10s
            const timeout = setTimeout(() => {
                redis.disconnect();
                this.connectionPromise = null;
                reject(new Error('Redis connection timeout (10s)'));
            }, 10000);
            // Clear timeout on ready
            redis.once('ready', () => clearTimeout(timeout));
            redis.once('error', () => clearTimeout(timeout));
        });
    }
    /**
     * Get sync client (for non-async contexts, use with caution)
     */
    getSync() {
        if (!this.client) {
            throw new Error('Redis client not initialized. Call getInstance() first.');
        }
        return this.client;
    }
    /**
     * Health check
     */
    async ping() {
        try {
            const client = await this.getInstance();
            const result = await client.ping();
            return result === 'PONG';
        }
        catch (err) {
            logger_1.logger.error('Redis ping failed', err);
            return false;
        }
    }
    /**
     * Get connection statistics
     */
    async getStatus() {
        try {
            if (!this.client) {
                return { connected: false, error: 'Client not initialized' };
            }
            return {
                connected: this.client.status === 'ready',
                status: this.client.status,
                mode: this.client.mode,
            };
        }
        catch (err) {
            return {
                connected: false,
                error: err.message,
            };
        }
    }
    /**
     * Graceful shutdown
     */
    async disconnect() {
        if (this.client) {
            try {
                await this.client.quit();
                logger_1.logger.info('Redis client disconnected gracefully');
            }
            catch (err) {
                logger_1.logger.error('Error during Redis disconnect', err);
            }
            finally {
                this.client = null;
                this.connectionPromise = null;
            }
        }
    }
    /**
     * Get raw client info (for advanced use)
     */
    getClient() {
        return this.client;
    }
}
// Export singleton instance
exports.redisClientManager = new RedisClientManager();
/**
 * Helper for concurrent operations
 */
async function withRedis(callback) {
    const redis = await exports.redisClientManager.getInstance();
    return callback(redis);
}
/**
 * Get the singleton instance
 */
async function getRedisClient() {
    return exports.redisClientManager.getInstance();
}
//# sourceMappingURL=redisClient.js.map