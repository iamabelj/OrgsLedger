// ============================================================
// OrgsLedger API — Redis Client Singleton
// Distributed queue infrastructure for transcript processing
// ============================================================

import Redis from 'ioredis';
import { logger } from '../logger';

interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  lazyConnect?: boolean;
  retryStrategy?: (times: number) => number;
  reconnectOnError?: (err: Error) => boolean;
}

class RedisClientManager {
  private client: Redis | null = null;
  private config: RedisConfig;
  private connectionPromise: Promise<Redis> | null = null;

  constructor() {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);
    const password = process.env.REDIS_PASSWORD;

    this.config = {
      host,
      port,
      password,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      lazyConnect: false,
      retryStrategy: (times: number) => {
        // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
        const delay = Math.min(1000 * Math.pow(2, times - 1), 30000);
        logger.info(`Redis reconnection attempt #${times}, waiting ${delay}ms`);
        return delay;
      },
      reconnectOnError: (err: Error) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          // Only reconnect when the error contains "READONLY"
          return true;
        }
        return false;
      },
    };

    logger.info('Redis client manager initialized', {
      host: this.config.host,
      port: this.config.port,
      db: this.config.db,
    });
  }

  /**
   * Get Redis client instance (lazy-initialized)
   */
  async getInstance(): Promise<Redis> {
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
  private async connect(): Promise<Redis> {
    return new Promise((resolve, reject) => {
      const redis = new Redis(this.config);

      redis.on('ready', () => {
        logger.info('Redis client ready', {
          host: this.config.host,
          port: this.config.port,
        });
        this.client = redis;
        resolve(redis);
      });

      redis.on('error', (err) => {
        logger.error('Redis client error', err);
        // Don't reject, just log — client might recover with retry strategy
      });

      redis.on('close', () => {
        logger.warn('Redis connection closed');
      });

      redis.on('reconnecting', () => {
        logger.info('Redis client reconnecting...');
      });

      redis.on('connect', () => {
        logger.debug('Redis socket connected');
      });

      redis.on('reconnect', () => {
        logger.info('Redis client reconnected');
      });

      // Timeout if connection takes > 10s
      const timeout = setTimeout(() => {
        redis.disconnect();
        this.connectionPromise = null;
        reject(new Error('Redis connection timeout (10s)'));
      }, 10000);

      // Clear timeout on ready
      redis.once('ready', () => clearTimeout(timeout));
    });
  }

  /**
   * Get sync client (for non-async contexts, use with caution)
   */
  getSync(): Redis {
    if (!this.client) {
      throw new Error('Redis client not initialized. Call getInstance() first.');
    }
    return this.client;
  }

  /**
   * Health check
   */
  async ping(): Promise<boolean> {
    try {
      const client = await this.getInstance();
      const result = await client.ping();
      return result === 'PONG';
    } catch (err) {
      logger.error('Redis ping failed', err);
      return false;
    }
  }

  /**
   * Get connection statistics
   */
  async getStatus(): Promise<{
    connected: boolean;
    status?: string;
    mode?: string;
    error?: string;
  }> {
    try {
      if (!this.client) {
        return { connected: false, error: 'Client not initialized' };
      }

      return {
        connected: this.client.status === 'ready',
        status: this.client.status,
        mode: this.client.mode,
      };
    } catch (err: any) {
      return {
        connected: false,
        error: err.message,
      };
    }
  }

  /**
   * Graceful shutdown
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
        logger.info('Redis client disconnected gracefully');
      } catch (err) {
        logger.error('Error during Redis disconnect', err);
      } finally {
        this.client = null;
        this.connectionPromise = null;
      }
    }
  }

  /**
   * Get raw client info (for advanced use)
   */
  getClient(): Redis | null {
    return this.client;
  }
}

// Export singleton instance
export const redisClientManager = new RedisClientManager();

/**
 * Helper for concurrent operations
 */
export async function withRedis<T>(
  callback: (redis: Redis) => Promise<T>
): Promise<T> {
  const redis = await redisClientManager.getInstance();
  return callback(redis);
}

/**
 * Get the singleton instance
 */
export async function getRedisClient(): Promise<Redis> {
  return redisClientManager.getInstance();
}

export { Redis, RedisConfig };
