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

import Redis, { Cluster, RedisOptions, ClusterOptions } from 'ioredis';
import * as client from 'prom-client';
import { EventEmitter } from 'events';
import { logger } from '../logger';

// ── Configuration ───────────────────────────────────────────

export type RedisMode = 'standalone' | 'sentinel' | 'cluster';

interface RedisFailoverConfig {
  mode: RedisMode;
  // Standalone settings
  host: string;
  port: number;
  password?: string;
  db: number;
  // Sentinel settings
  sentinelNodes: Array<{ host: string; port: number }>;
  sentinelMasterName: string;
  sentinelPassword?: string;
  // Cluster settings
  clusterNodes: Array<{ host: string; port: number }>;
  // Connection behavior
  maxRetriesPerRequest: number | null;
  enableReadyCheck: boolean;
  retryDelayMs: number;
  maxRetryDelayMs: number;
  connectTimeoutMs: number;
  commandTimeoutMs: number;
  // Health check
  healthCheckIntervalMs: number;
}

function parseNodeList(envVar: string | undefined): Array<{ host: string; port: number }> {
  if (!envVar) return [];
  return envVar.split(',').map(node => {
    const [host, portStr] = node.trim().split(':');
    return { host, port: parseInt(portStr || '6379', 10) };
  });
}

const DEFAULT_CONFIG: RedisFailoverConfig = {
  mode: (process.env.REDIS_MODE as RedisMode) || 'standalone',
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

export const redisFailoverModeGauge = new client.Gauge({
  name: `${PREFIX}mode`,
  help: 'Current Redis mode (1=standalone, 2=sentinel, 3=cluster)',
});

export const redisFailoverConnectedGauge = new client.Gauge({
  name: `${PREFIX}connected`,
  help: 'Redis connection status (1=connected, 0=disconnected)',
});

export const redisFailoverReconnectsCounter = new client.Counter({
  name: `${PREFIX}reconnects_total`,
  help: 'Total Redis reconnection attempts',
});

export const redisFailoverFailoversCounter = new client.Counter({
  name: `${PREFIX}failovers_total`,
  help: 'Total Redis master failovers (Sentinel mode)',
});

export const redisFailoverLatencyHistogram = new client.Histogram({
  name: `${PREFIX}command_latency_seconds`,
  help: 'Redis command latency',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
});

export const redisFailoverErrorsCounter = new client.Counter({
  name: `${PREFIX}errors_total`,
  help: 'Total Redis errors',
  labelNames: ['type'],
});

// ── Types ───────────────────────────────────────────────────

export interface RedisHealthStatus {
  connected: boolean;
  mode: RedisMode;
  master?: { host: string; port: number };
  latencyMs: number;
  uptime: number;
  lastError?: string;
  lastFailover?: Date;
}

export type RedisFailoverEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; error?: Error }
  | { type: 'reconnecting'; attempt: number }
  | { type: 'failover'; oldMaster: string; newMaster: string }
  | { type: 'error'; error: Error };

// ── Redis Failover Manager ──────────────────────────────────

class RedisFailoverManager extends EventEmitter {
  private config: RedisFailoverConfig;
  private connection: Redis | Cluster | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isConnected = false;
  private startTime = Date.now();
  private lastError?: Error;
  private lastFailover?: Date;
  private reconnectAttempts = 0;

  constructor(config: Partial<RedisFailoverConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create and connect to Redis based on configured mode.
   */
  async connect(): Promise<Redis | Cluster> {
    const mode = this.config.mode;

    logger.info('[REDIS_FAILOVER] Connecting', {
      mode,
      host: mode === 'standalone' ? this.config.host : undefined,
      sentinelNodes: mode === 'sentinel' ? this.config.sentinelNodes.length : undefined,
      clusterNodes: mode === 'cluster' ? this.config.clusterNodes.length : undefined,
    });

    // Set mode metric
    const modeValue = mode === 'standalone' ? 1 : mode === 'sentinel' ? 2 : 3;
    redisFailoverModeGauge.set(modeValue);

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
  private createStandaloneConnection(): Redis {
    const options: RedisOptions = {
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

    return new Redis(options);
  }

  /**
   * Create Sentinel connection with automatic master discovery.
   */
  private createSentinelConnection(): Redis {
    if (this.config.sentinelNodes.length === 0) {
      throw new Error('REDIS_SENTINEL_NODES not configured');
    }

    const options: RedisOptions = {
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

    return new Redis(options);
  }

  /**
   * Create Redis Cluster connection.
   */
  private createClusterConnection(): Cluster {
    if (this.config.clusterNodes.length === 0) {
      throw new Error('REDIS_CLUSTER_NODES not configured');
    }

    const options: ClusterOptions = {
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

    return new Cluster(this.config.clusterNodes, options);
  }

  /**
   * Retry strategy with exponential backoff.
   */
  private retryStrategy(times: number): number | null {
    this.reconnectAttempts = times;
    redisFailoverReconnectsCounter.inc();

    if (times > 100) {
      logger.error('[REDIS_FAILOVER] Max retries exceeded, giving up', { attempts: times });
      return null; // Stop retrying
    }

    const delay = Math.min(
      this.config.retryDelayMs * Math.pow(2, times - 1),
      this.config.maxRetryDelayMs
    );

    logger.warn('[REDIS_FAILOVER] Reconnecting', {
      attempt: times,
      delayMs: delay,
    });

    this.emit('event', { type: 'reconnecting', attempt: times } as RedisFailoverEvent);

    return delay;
  }

  /**
   * Setup event handlers for connection lifecycle.
   */
  private setupEventHandlers(): void {
    if (!this.connection) return;

    this.connection.on('connect', () => {
      logger.info('[REDIS_FAILOVER] Connected');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      redisFailoverConnectedGauge.set(1);
      this.emit('event', { type: 'connected' } as RedisFailoverEvent);
    });

    this.connection.on('ready', () => {
      logger.info('[REDIS_FAILOVER] Ready');
    });

    this.connection.on('close', () => {
      logger.warn('[REDIS_FAILOVER] Connection closed');
      this.isConnected = false;
      redisFailoverConnectedGauge.set(0);
      this.emit('event', { type: 'disconnected' } as RedisFailoverEvent);
    });

    this.connection.on('error', (err) => {
      this.lastError = err;
      redisFailoverErrorsCounter.inc({ type: err.name || 'unknown' });
      logger.error('[REDIS_FAILOVER] Error', {
        error: err.message,
        code: (err as any).code,
      });
      this.emit('event', { type: 'error', error: err } as RedisFailoverEvent);
    });

    this.connection.on('reconnecting', () => {
      logger.info('[REDIS_FAILOVER] Reconnecting...');
    });

    // Sentinel-specific: master change event
    if (this.config.mode === 'sentinel' && this.connection instanceof Redis) {
      this.connection.on('+switch-master', (data: any) => {
        const [name, oldHost, oldPort, newHost, newPort] = data;
        this.lastFailover = new Date();
        redisFailoverFailoversCounter.inc();

        logger.warn('[REDIS_FAILOVER] Master switched (Sentinel failover)', {
          name,
          oldMaster: `${oldHost}:${oldPort}`,
          newMaster: `${newHost}:${newPort}`,
        });

        this.emit('event', {
          type: 'failover',
          oldMaster: `${oldHost}:${oldPort}`,
          newMaster: `${newHost}:${newPort}`,
        } as RedisFailoverEvent);
      });
    }

    // Cluster-specific: node events
    if (this.connection instanceof Cluster) {
      this.connection.on('node error', (err, address) => {
        logger.error('[REDIS_FAILOVER] Cluster node error', {
          address,
          error: err.message,
        });
      });
    }
  }

  /**
   * Wait for the connection to be established.
   */
  private async waitForConnection(timeoutMs = 30000): Promise<void> {
    if (!this.connection) throw new Error('No connection');

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
  private startHealthCheck(): void {
    if (this.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(async () => {
      if (!this.connection || !this.isConnected) return;

      try {
        const start = Date.now();
        await this.connection.ping();
        const latencyMs = Date.now() - start;

        redisFailoverLatencyHistogram.observe(latencyMs / 1000);

        if (latencyMs > 100) {
          logger.warn('[REDIS_FAILOVER] High latency', { latencyMs });
        }
      } catch (err) {
        logger.error('[REDIS_FAILOVER] Health check failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, this.config.healthCheckIntervalMs);

    this.healthCheckInterval.unref();
  }

  /**
   * Get current health status.
   */
  async getHealthStatus(): Promise<RedisHealthStatus> {
    const status: RedisHealthStatus = {
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
        if (this.config.mode === 'sentinel' && this.connection instanceof Redis) {
          const info = await this.connection.info('replication');
          const masterMatch = info.match(/master_host:(\S+)\s+master_port:(\d+)/);
          if (masterMatch) {
            status.master = { host: masterMatch[1], port: parseInt(masterMatch[2], 10) };
          }
        }
      } catch (err) {
        status.connected = false;
        status.lastError = err instanceof Error ? err.message : String(err);
      }
    }

    return status;
  }

  /**
   * Get the Redis connection.
   */
  getConnection(): Redis | Cluster | null {
    return this.connection;
  }

  /**
   * Check if connected.
   */
  isRedisConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Gracefully disconnect.
   */
  async disconnect(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.connection) {
      await this.connection.quit();
      this.connection = null;
    }

    this.isConnected = false;
    redisFailoverConnectedGauge.set(0);
    logger.info('[REDIS_FAILOVER] Disconnected');
  }

  /**
   * Force reconnect (useful for testing failover).
   */
  async forceReconnect(): Promise<void> {
    logger.info('[REDIS_FAILOVER] Forcing reconnect');
    if (this.connection) {
      await this.connection.disconnect();
      // ioredis will auto-reconnect due to retry strategy
    }
  }
}

// ── Singleton ───────────────────────────────────────────────

export const redisFailoverManager = new RedisFailoverManager();

// ── Factory for BullMQ-compatible connections ───────────────

/**
 * Create a BullMQ-compatible Redis connection with failover support.
 * Use this instead of createBullMQConnection() for HA deployments.
 */
export function createFailoverConnection(): Redis | Cluster {
  const config = DEFAULT_CONFIG;
  const mode = config.mode;

  switch (mode) {
    case 'sentinel': {
      if (config.sentinelNodes.length === 0) {
        logger.warn('[REDIS_FAILOVER] Sentinel nodes not configured, falling back to standalone');
        return new Redis({
          host: config.host,
          port: config.port,
          password: config.password,
          db: config.db,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        });
      }

      return new Redis({
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
        logger.warn('[REDIS_FAILOVER] Cluster nodes not configured, falling back to standalone');
        return new Redis({
          host: config.host,
          port: config.port,
          password: config.password,
          db: config.db,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        });
      }

      return new Cluster(config.clusterNodes, {
        redisOptions: {
          password: config.password,
        },
        maxRedirections: 16,
        enableReadyCheck: false,
      });
    }

    case 'standalone':
    default:
      return new Redis({
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

export async function connectRedisWithFailover(): Promise<Redis | Cluster> {
  return redisFailoverManager.connect();
}

export async function disconnectRedis(): Promise<void> {
  return redisFailoverManager.disconnect();
}

export async function getRedisFailoverHealth(): Promise<RedisHealthStatus> {
  return redisFailoverManager.getHealthStatus();
}

export function isRedisConnected(): boolean {
  return redisFailoverManager.isRedisConnected();
}

export function onRedisFailoverEvent(
  callback: (event: RedisFailoverEvent) => void
): () => void {
  redisFailoverManager.on('event', callback);
  return () => redisFailoverManager.off('event', callback);
}

export function getRedisConnection(): Redis | Cluster | null {
  return redisFailoverManager.getConnection();
}
