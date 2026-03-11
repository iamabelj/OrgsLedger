// ============================================================
// OrgsLedger API — Redis Client Singleton
// Production-grade Redis client with Cluster + Standalone support,
// connection pooling, pub/sub helpers, and BullMQ integration.
// ============================================================

import Redis, { Cluster, ClusterNode, ClusterOptions, RedisOptions } from 'ioredis';
import { logger } from '../logger';

// ── Configuration ───────────────────────────────────────────

interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

function buildStandaloneConfig(): RedisConfig {
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
function parseClusterNodes(): ClusterNode[] | null {
  const raw = process.env.REDIS_CLUSTER_NODES;
  if (!raw) return null;
  const nodes: ClusterNode[] = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const [host, portStr] = trimmed.split(':');
    nodes.push({ host, port: parseInt(portStr || '6379', 10) });
  }
  return nodes.length > 0 ? nodes : null;
}

const CONNECTION_TIMEOUT_MS = envInt('REDIS_CONNECT_TIMEOUT_MS', 10_000);
const MAX_POOL_SIZE = envInt('REDIS_POOL_SIZE', 8);
const RETRY_MAX_DELAY_MS = 30_000;

// ── Retry Strategy ──────────────────────────────────────────

function retryStrategy(times: number): number {
  const delay = Math.min(1000 * Math.pow(2, times - 1), RETRY_MAX_DELAY_MS);
  logger.info(`[REDIS] Reconnection attempt #${times}, waiting ${delay}ms`);
  return delay;
}

// ── Redis Client Manager ────────────────────────────────────

class RedisClientManager {
  /** Primary client for general use (get/set, pipeline, etc.) */
  private client: Redis | Cluster | null = null;
  private connectionPromise: Promise<Redis | Cluster> | null = null;

  /** Dedicated subscriber client (Redis requires a separate connection for subscriptions) */
  private subClient: Redis | Cluster | null = null;
  private subPromise: Promise<Redis | Cluster> | null = null;

  /** Dedicated publisher client */
  private pubClient: Redis | Cluster | null = null;
  private pubPromise: Promise<Redis | Cluster> | null = null;

  /** Pool of connections available for BullMQ workers and high-concurrency paths */
  private pool: (Redis | Cluster)[] = [];
  private poolIdx = 0;

  /** Track cluster mode */
  private isCluster = false;
  private standaloneConfig: RedisConfig;
  private clusterNodes: ClusterNode[] | null;

  constructor() {
    this.standaloneConfig = buildStandaloneConfig();
    this.clusterNodes = parseClusterNodes();
    this.isCluster = !!this.clusterNodes;

    logger.info('[REDIS] Client manager initialized', {
      mode: this.isCluster ? 'cluster' : 'standalone',
      host: this.isCluster ? undefined : this.standaloneConfig.host,
      port: this.isCluster ? undefined : this.standaloneConfig.port,
      clusterNodes: this.clusterNodes?.length,
    });
  }

  // ── Internal Connection Factories ───────────────────────────

  private createStandaloneClient(opts?: Partial<RedisOptions>): Redis {
    const cfg = this.standaloneConfig;
    return new Redis({
      host: cfg.host,
      port: cfg.port,
      password: cfg.password,
      db: cfg.db,
      lazyConnect: false,
      enableReadyCheck: true,
      retryStrategy,
      reconnectOnError: (err: Error) => err.message.includes('READONLY'),
      ...opts,
    });
  }

  private createClusterClient(opts?: Partial<RedisOptions>): Cluster {
    const password = this.standaloneConfig.password;
    const clusterOpts: ClusterOptions = {
      redisOptions: {
        password,
        enableReadyCheck: true,
        ...opts,
      },
      clusterRetryStrategy: retryStrategy,
      enableOfflineQueue: true,
      scaleReads: 'slave',
    };
    return new Redis.Cluster(this.clusterNodes!, clusterOpts);
  }

  private createClient(opts?: Partial<RedisOptions>): Redis | Cluster {
    return this.isCluster
      ? this.createClusterClient(opts)
      : this.createStandaloneClient(opts);
  }

  /** Connect a client and wait for "ready" with a timeout. */
  private waitForReady(redis: Redis | Cluster, label: string): Promise<Redis | Cluster> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        redis.disconnect();
        reject(new Error(`[REDIS] ${label} connection timeout (${CONNECTION_TIMEOUT_MS}ms)`));
      }, CONNECTION_TIMEOUT_MS);

      const onReady = () => {
        clearTimeout(timeout);
        logger.info(`[REDIS] ${label} ready`);
        resolve(redis);
      };

      redis.on('error', (err) => {
        logger.error(`[REDIS] ${label} error`, err);
      });
      redis.on('close', () => {
        logger.warn(`[REDIS] ${label} connection closed`);
      });
      redis.on('reconnecting', () => {
        logger.info(`[REDIS] ${label} reconnecting…`);
      });

      // ioredis emits "ready" when the connection is usable
      if ((redis as any).status === 'ready') {
        onReady();
      } else {
        redis.once('ready', onReady);
      }
    });
  }

  // ── Public: Primary Client ──────────────────────────────────

  async getInstance(): Promise<Redis | Cluster> {
    if (this.client && (this.client as any).status === 'ready') {
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
  getSync(): Redis | Cluster {
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
  async getPooled(): Promise<Redis | Cluster> {
    if (this.pool.length < MAX_POOL_SIZE) {
      const conn = await this.waitForReady(
        this.createClient(),
        `pool-${this.pool.length}`
      );
      this.pool.push(conn);
      return conn;
    }
    const conn = this.pool[this.poolIdx % this.pool.length];
    this.poolIdx++;
    return conn;
  }

  // ── Public: Pub/Sub Clients ─────────────────────────────────

  async getPublisher(): Promise<Redis | Cluster> {
    if (this.pubClient && (this.pubClient as any).status === 'ready') {
      return this.pubClient;
    }
    if (this.pubPromise) return this.pubPromise;
    this.pubPromise = this.waitForReady(this.createClient(), 'publisher')
      .then((c) => { this.pubClient = c; return c; })
      .catch((err) => { this.pubPromise = null; throw err; });
    return this.pubPromise;
  }

  async getSubscriber(): Promise<Redis | Cluster> {
    if (this.subClient && (this.subClient as any).status === 'ready') {
      return this.subClient;
    }
    if (this.subPromise) return this.subPromise;
    this.subPromise = this.waitForReady(this.createClient(), 'subscriber')
      .then((c) => { this.subClient = c; return c; })
      .catch((err) => { this.subPromise = null; throw err; });
    return this.subPromise;
  }

  // ── Public: Health Check ────────────────────────────────────

  async ping(): Promise<boolean> {
    try {
      const client = await this.getInstance();
      const result = await client.ping();
      return result === 'PONG';
    } catch (err) {
      logger.error('[REDIS] Ping failed', err);
      return false;
    }
  }

  async getStatus(): Promise<{
    connected: boolean;
    mode: 'cluster' | 'standalone';
    status?: string;
    poolSize: number;
    error?: string;
  }> {
    try {
      if (!this.client) {
        return { connected: false, mode: this.isCluster ? 'cluster' : 'standalone', poolSize: this.pool.length, error: 'Client not initialized' };
      }
      return {
        connected: (this.client as any).status === 'ready',
        mode: this.isCluster ? 'cluster' : 'standalone',
        status: (this.client as any).status,
        poolSize: this.pool.length,
      };
    } catch (err: any) {
      return { connected: false, mode: this.isCluster ? 'cluster' : 'standalone', poolSize: this.pool.length, error: err.message };
    }
  }

  async healthCheck(): Promise<{
    healthy: boolean;
    latencyMs: number;
    mode: 'cluster' | 'standalone';
    poolSize: number;
  }> {
    const start = Date.now();
    try {
      const pong = await this.ping();
      return {
        healthy: pong,
        latencyMs: Date.now() - start,
        mode: this.isCluster ? 'cluster' : 'standalone',
        poolSize: this.pool.length,
      };
    } catch {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        mode: this.isCluster ? 'cluster' : 'standalone',
        poolSize: this.pool.length,
      };
    }
  }

  // ── Public: Graceful Shutdown ───────────────────────────────

  async disconnect(): Promise<void> {
    const quits: Promise<void>[] = [];

    const safeQuit = async (label: string, c: Redis | Cluster | null) => {
      if (!c) return;
      try {
        await c.quit();
        logger.info(`[REDIS] ${label} disconnected`);
      } catch (err) {
        logger.error(`[REDIS] Error disconnecting ${label}`, err);
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

    logger.info('[REDIS] All connections closed');
  }

  /**
   * Get raw client reference (advanced use only).
   */
  getClient(): Redis | Cluster | null {
    return this.client;
  }
}

// ── Singleton ───────────────────────────────────────────────

export const redisClientManager = new RedisClientManager();

// ── Convenience Exports ─────────────────────────────────────

/**
 * Get the singleton Redis client (lazy-initialized, waits for ready).
 * Used by queues, monitoring, services.
 */
export async function getRedisClient(): Promise<Redis | Cluster> {
  return redisClientManager.getInstance();
}

/**
 * Run a callback with a Redis client.
 */
export async function withRedis<T>(
  callback: (redis: Redis | Cluster) => Promise<T>
): Promise<T> {
  const redis = await redisClientManager.getInstance();
  return callback(redis);
}

// ── Pub/Sub Helpers ─────────────────────────────────────────

/**
 * Publish a JSON payload to a Redis channel.
 */
export async function publish(channel: string, payload: unknown): Promise<void> {
  const pub = await redisClientManager.getPublisher();
  const message = typeof payload === 'string' ? payload : JSON.stringify(payload);
  await pub.publish(channel, message);
}

/**
 * Subscribe to a Redis channel. Returns an unsubscribe function.
 * Automatically uses the dedicated subscriber connection.
 */
export async function subscribe(
  channel: string,
  onMessage: (message: string, channel: string) => void
): Promise<() => Promise<void>> {
  const sub = await redisClientManager.getSubscriber();
  sub.on('message', (ch: string, msg: string) => {
    if (ch === channel) onMessage(msg, ch);
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
export async function get(key: string): Promise<string | null> {
  const client = await redisClientManager.getInstance();
  return client.get(key);
}

/**
 * Set a key/value. Optionally provide TTL in seconds.
 */
export async function set(key: string, value: string, ttlSeconds?: number): Promise<void> {
  const client = await redisClientManager.getInstance();
  if (ttlSeconds !== undefined) {
    await client.set(key, value, 'EX', ttlSeconds);
  } else {
    await client.set(key, value);
  }
}

// ── BullMQ Integration ─────────────────────────────────────

/**
 * Create a new Redis connection optimized for BullMQ workers.
 * BullMQ requires `maxRetriesPerRequest: null` for blocking commands.
 * Each worker should call this to get its own dedicated connection.
 */
export function createBullMQConnection(): Redis {
  const cfg = buildStandaloneConfig();
  return new Redis({
    host: cfg.host,
    port: cfg.port,
    password: cfg.password,
    db: cfg.db,
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
    retryStrategy,
  });
}

export { Redis, Cluster };
export type { RedisConfig };
