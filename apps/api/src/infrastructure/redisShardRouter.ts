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

import Redis, { Cluster, RedisOptions, ClusterOptions } from 'ioredis';
import * as client from 'prom-client';
import { logger } from '../logger';

// ── Configuration ───────────────────────────────────────────

/**
 * Number of shards for meeting data distribution
 */
export const REDIS_SHARD_COUNT = parseInt(process.env.REDIS_SHARD_COUNT || '32', 10);

/**
 * Shard mode: cluster (Redis Cluster), multi (multiple standalone), standalone
 */
export const REDIS_SHARD_MODE = (process.env.REDIS_SHARD_MODE || 'standalone') as 
  'cluster' | 'multi' | 'standalone';

/**
 * TTL for meeting data (24 hours default, can be overridden per operation)
 */
const DEFAULT_TTL_SECONDS = parseInt(process.env.REDIS_MEETING_TTL || '86400', 10);

/**
 * Memory monitoring interval (5 minutes)
 */
const MEMORY_MONITOR_INTERVAL_MS = 5 * 60 * 1000;

// ── Types ───────────────────────────────────────────────────

export interface MeetingData {
  [key: string]: any;
}

export interface ShardInfo {
  shardIndex: number;
  nodeIndex: number;
  host: string;
  port: number;
  connected: boolean;
  memoryUsed?: number;
  memoryPeak?: number;
}

export interface ShardRouterStats {
  mode: string;
  shardCount: number;
  nodeCount: number;
  totalConnections: number;
  activeConnections: number;
  shards: ShardInfo[];
}

export interface SetOptions {
  ttl?: number; // TTL in seconds
  nx?: boolean; // Only set if not exists
  xx?: boolean; // Only set if exists
}

// ── Prometheus Metrics ──────────────────────────────────────

const register = client.register;

export const redisShardMemoryUsageGauge = new client.Gauge({
  name: 'orgsledger_redis_shard_memory_usage',
  help: 'Memory usage per Redis shard in bytes',
  labelNames: ['shard', 'node'] as const,
  registers: [register],
});

export const redisShardKeysGauge = new client.Gauge({
  name: 'orgsledger_redis_shard_keys_count',
  help: 'Number of keys per Redis shard',
  labelNames: ['shard'] as const,
  registers: [register],
});

export const redisShardOpsCounter = new client.Counter({
  name: 'orgsledger_redis_shard_operations_total',
  help: 'Total operations per shard',
  labelNames: ['shard', 'operation'] as const,
  registers: [register],
});

export const redisShardLatencyHistogram = new client.Histogram({
  name: 'orgsledger_redis_shard_latency_seconds',
  help: 'Redis shard operation latency in seconds',
  labelNames: ['operation'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

// ── Hash Function ───────────────────────────────────────────

/**
 * Fast djb2 hash function for deterministic shard routing
 * Same algorithm as queue-manager for consistency
 */
function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return hash >>> 0; // Return as unsigned 32-bit integer
}

/**
 * Get shard index for a meeting ID
 */
export function getMeetingShardIndex(meetingId: string): number {
  return djb2Hash(meetingId) % REDIS_SHARD_COUNT;
}

/**
 * Build Redis key for meeting data
 * Pattern: meeting:{shard}:{meetingId}
 */
export function getMeetingKey(meetingId: string, suffix?: string): string {
  const shardIndex = getMeetingShardIndex(meetingId);
  const baseKey = `meeting:${shardIndex}:${meetingId}`;
  return suffix ? `${baseKey}:${suffix}` : baseKey;
}

// ── Redis Node Configuration ────────────────────────────────

interface NodeConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
}

function parseNodeConfigs(): NodeConfig[] {
  const defaultHost = process.env.REDIS_HOST || 'localhost';
  const defaultPort = parseInt(process.env.REDIS_PORT || '6379', 10);
  const password = process.env.REDIS_PASSWORD;
  const db = parseInt(process.env.REDIS_DB || '0', 10);

  if (REDIS_SHARD_MODE === 'multi') {
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

function parseClusterNodes(): Array<{ host: string; port: number }> {
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
  private mode: 'cluster' | 'multi' | 'standalone';
  private shardCount: number;
  
  // For standalone/multi mode: array of Redis connections
  private nodes: Redis[] = [];
  private nodeConfigs: NodeConfig[] = [];
  
  // For cluster mode: single cluster connection
  private cluster: Cluster | null = null;
  
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  
  // Memory monitoring
  private memoryMonitorInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.mode = REDIS_SHARD_MODE;
    this.shardCount = REDIS_SHARD_COUNT;
    this.nodeConfigs = parseNodeConfigs();
    
    logger.info('[REDIS_SHARD_ROUTER] Initialized', {
      mode: this.mode,
      shardCount: this.shardCount,
      nodeCount: this.nodeConfigs.length,
    });
  }

  /**
   * Initialize Redis connections
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInitialize();
    await this.initPromise;
    this.isInitialized = true;

    // Start memory monitoring
    this.startMemoryMonitoring();
  }

  private async doInitialize(): Promise<void> {
    try {
      if (this.mode === 'cluster') {
        await this.initializeCluster();
      } else {
        await this.initializeNodes();
      }

      logger.info('[REDIS_SHARD_ROUTER] Connected', {
        mode: this.mode,
        shardCount: this.shardCount,
      });
    } catch (err) {
      logger.error('[REDIS_SHARD_ROUTER] Initialization failed', err);
      throw err;
    }
  }

  private async initializeCluster(): Promise<void> {
    const clusterNodes = parseClusterNodes();
    const password = process.env.REDIS_PASSWORD;

    const clusterOptions: ClusterOptions = {
      redisOptions: {
        password,
        connectTimeout: 10000,
      },
      clusterRetryStrategy: (times: number) => Math.min(1000 * Math.pow(2, times - 1), 30000),
      enableReadyCheck: true,
      scaleReads: 'slave', // Read from replicas when possible
    };

    this.cluster = new Cluster(clusterNodes, clusterOptions);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Cluster connection timeout'));
      }, 15000);

      this.cluster!.on('ready', () => {
        clearTimeout(timeout);
        logger.info('[REDIS_SHARD_ROUTER] Cluster ready', {
          nodes: clusterNodes.length,
        });
        resolve();
      });

      this.cluster!.on('error', (err) => {
        logger.error('[REDIS_SHARD_ROUTER] Cluster error', { error: err.message });
      });

      this.cluster!.on('node error', (err, address) => {
        logger.warn('[REDIS_SHARD_ROUTER] Node error', { error: err.message, address });
      });
    });
  }

  private async initializeNodes(): Promise<void> {
    const connectionPromises: Promise<void>[] = [];

    for (const config of this.nodeConfigs) {
      const nodePromise = new Promise<void>((resolve, reject) => {
        const options: RedisOptions = {
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

        const redis = new Redis(options);

        redis.on('ready', () => {
          logger.info('[REDIS_SHARD_ROUTER] Node connected', {
            host: config.host,
            port: config.port,
            nodeIndex: this.nodes.length,
          });
          this.nodes.push(redis);
          resolve();
        });

        redis.on('error', (err) => {
          logger.error('[REDIS_SHARD_ROUTER] Node error', {
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
  getMeetingRedisClient(meetingId: string): Redis | Cluster {
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
  async setMeetingData(
    meetingId: string,
    data: MeetingData,
    options: SetOptions = {}
  ): Promise<boolean> {
    const startTime = Date.now();
    const shardIndex = getMeetingShardIndex(meetingId);
    const key = getMeetingKey(meetingId);

    try {
      const client = this.getMeetingRedisClient(meetingId);
      const serialized = JSON.stringify(data);
      const ttl = options.ttl ?? DEFAULT_TTL_SECONDS;

      let result: string | null;

      if (options.nx) {
        // SET only if not exists
        result = await client.set(key, serialized, 'EX', ttl, 'NX');
      } else if (options.xx) {
        // SET only if exists
        result = await client.set(key, serialized, 'EX', ttl, 'XX');
      } else {
        // Normal SET with TTL
        result = await client.set(key, serialized, 'EX', ttl);
      }

      // Update metrics
      const duration = (Date.now() - startTime) / 1000;
      redisShardOpsCounter.labels(String(shardIndex), 'set').inc();
      redisShardLatencyHistogram.labels('set').observe(duration);

      return result === 'OK';
    } catch (err: any) {
      logger.error('[REDIS_SHARD_ROUTER] setMeetingData failed', {
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
  async getMeetingData(meetingId: string): Promise<MeetingData | null> {
    const startTime = Date.now();
    const shardIndex = getMeetingShardIndex(meetingId);
    const key = getMeetingKey(meetingId);

    try {
      const client = this.getMeetingRedisClient(meetingId);
      const data = await client.get(key);

      // Update metrics
      const duration = (Date.now() - startTime) / 1000;
      redisShardOpsCounter.labels(String(shardIndex), 'get').inc();
      redisShardLatencyHistogram.labels('get').observe(duration);

      if (!data) return null;
      return JSON.parse(data);
    } catch (err: any) {
      logger.error('[REDIS_SHARD_ROUTER] getMeetingData failed', {
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
  async deleteMeetingData(meetingId: string): Promise<boolean> {
    const startTime = Date.now();
    const shardIndex = getMeetingShardIndex(meetingId);
    const key = getMeetingKey(meetingId);

    try {
      const client = this.getMeetingRedisClient(meetingId);
      const result = await client.del(key);

      // Update metrics
      const duration = (Date.now() - startTime) / 1000;
      redisShardOpsCounter.labels(String(shardIndex), 'delete').inc();
      redisShardLatencyHistogram.labels('delete').observe(duration);

      return result > 0;
    } catch (err: any) {
      logger.error('[REDIS_SHARD_ROUTER] deleteMeetingData failed', {
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
  async setMeetingField(
    meetingId: string,
    field: string,
    value: any,
    ttl?: number
  ): Promise<void> {
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
      } else {
        pipeline.expire(key, DEFAULT_TTL_SECONDS);
      }
      await pipeline.exec();

      // Update metrics
      const duration = (Date.now() - startTime) / 1000;
      redisShardOpsCounter.labels(String(shardIndex), 'hset').inc();
      redisShardLatencyHistogram.labels('hset').observe(duration);
    } catch (err: any) {
      logger.error('[REDIS_SHARD_ROUTER] setMeetingField failed', {
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
  async getMeetingField(meetingId: string, field: string): Promise<any> {
    const startTime = Date.now();
    const shardIndex = getMeetingShardIndex(meetingId);
    const key = getMeetingKey(meetingId);

    try {
      const client = this.getMeetingRedisClient(meetingId);
      const data = await client.hget(key, field);

      // Update metrics
      const duration = (Date.now() - startTime) / 1000;
      redisShardOpsCounter.labels(String(shardIndex), 'hget').inc();
      redisShardLatencyHistogram.labels('hget').observe(duration);

      if (!data) return null;
      
      try {
        return JSON.parse(data);
      } catch {
        return data; // Return as-is if not JSON
      }
    } catch (err: any) {
      logger.error('[REDIS_SHARD_ROUTER] getMeetingField failed', {
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
  async getMeetingAllFields(meetingId: string): Promise<Record<string, any> | null> {
    const startTime = Date.now();
    const shardIndex = getMeetingShardIndex(meetingId);
    const key = getMeetingKey(meetingId);

    try {
      const client = this.getMeetingRedisClient(meetingId);
      const data = await client.hgetall(key);

      // Update metrics
      const duration = (Date.now() - startTime) / 1000;
      redisShardOpsCounter.labels(String(shardIndex), 'hgetall').inc();
      redisShardLatencyHistogram.labels('hgetall').observe(duration);

      if (!data || Object.keys(data).length === 0) return null;

      // Parse JSON fields
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(data)) {
        try {
          result[key] = JSON.parse(value);
        } catch {
          result[key] = value;
        }
      }
      return result;
    } catch (err: any) {
      logger.error('[REDIS_SHARD_ROUTER] getMeetingAllFields failed', {
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
  async meetingExists(meetingId: string): Promise<boolean> {
    const shardIndex = getMeetingShardIndex(meetingId);
    const key = getMeetingKey(meetingId);

    try {
      const client = this.getMeetingRedisClient(meetingId);
      const exists = await client.exists(key);
      return exists > 0;
    } catch (err: any) {
      logger.error('[REDIS_SHARD_ROUTER] meetingExists failed', {
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
  async setMeetingTTL(meetingId: string, ttlSeconds: number): Promise<boolean> {
    const shardIndex = getMeetingShardIndex(meetingId);
    const key = getMeetingKey(meetingId);

    try {
      const client = this.getMeetingRedisClient(meetingId);
      const result = await client.expire(key, ttlSeconds);
      return result === 1;
    } catch (err: any) {
      logger.error('[REDIS_SHARD_ROUTER] setMeetingTTL failed', {
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
  async appendToMeetingList(
    meetingId: string,
    listName: string,
    value: any,
    maxLength?: number
  ): Promise<number> {
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
      const length = results?.[0]?.[1] as number || 0;

      // Update metrics
      const duration = (Date.now() - startTime) / 1000;
      redisShardOpsCounter.labels(String(shardIndex), 'rpush').inc();
      redisShardLatencyHistogram.labels('rpush').observe(duration);

      return length;
    } catch (err: any) {
      logger.error('[REDIS_SHARD_ROUTER] appendToMeetingList failed', {
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
  async getMeetingList(
    meetingId: string,
    listName: string,
    start: number = 0,
    end: number = -1
  ): Promise<any[]> {
    const startTime = Date.now();
    const shardIndex = getMeetingShardIndex(meetingId);
    const key = getMeetingKey(meetingId, listName);

    try {
      const client = this.getMeetingRedisClient(meetingId);
      const items = await client.lrange(key, start, end);

      // Update metrics
      const duration = (Date.now() - startTime) / 1000;
      redisShardOpsCounter.labels(String(shardIndex), 'lrange').inc();
      redisShardLatencyHistogram.labels('lrange').observe(duration);

      return items.map(item => {
        try {
          return JSON.parse(item);
        } catch {
          return item;
        }
      });
    } catch (err: any) {
      logger.error('[REDIS_SHARD_ROUTER] getMeetingList failed', {
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
  async getMeetingListLength(meetingId: string, listName: string): Promise<number> {
    const shardIndex = getMeetingShardIndex(meetingId);
    const key = getMeetingKey(meetingId, listName);

    try {
      const client = this.getMeetingRedisClient(meetingId);
      return await client.llen(key);
    } catch (err: any) {
      logger.error('[REDIS_SHARD_ROUTER] getMeetingListLength failed', {
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
  private startMemoryMonitoring(): void {
    if (this.memoryMonitorInterval) return;

    // Initial collection
    this.collectMemoryMetrics().catch(err => {
      logger.warn('[REDIS_SHARD_ROUTER] Initial memory metrics collection failed', { error: err.message });
    });

    // Periodic collection
    this.memoryMonitorInterval = setInterval(() => {
      this.collectMemoryMetrics().catch(err => {
        logger.warn('[REDIS_SHARD_ROUTER] Memory metrics collection failed', { error: err.message });
      });
    }, MEMORY_MONITOR_INTERVAL_MS);
  }

  /**
   * Collect memory metrics from all nodes
   */
  private async collectMemoryMetrics(): Promise<void> {
    if (this.mode === 'cluster' && this.cluster) {
      // For cluster mode, get info from all nodes
      const nodes = this.cluster.nodes('master');
      for (let i = 0; i < nodes.length; i++) {
        try {
          const info = await nodes[i].info('memory');
          const memoryUsed = this.parseRedisInfoValue(info, 'used_memory');
          
          redisShardMemoryUsageGauge.labels('cluster', String(i)).set(memoryUsed);
        } catch (err) {
          // Node might be unavailable
        }
      }
    } else {
      // For standalone/multi mode
      for (let i = 0; i < this.nodes.length; i++) {
        try {
          const node = this.nodes[i];
          if (node.status !== 'ready') continue;

          const info = await node.info('memory');
          const memoryUsed = this.parseRedisInfoValue(info, 'used_memory');
          
          // Calculate which shards map to this node
          const shardsForNode: number[] = [];
          for (let s = 0; s < this.shardCount; s++) {
            if (s % this.nodes.length === i) {
              shardsForNode.push(s);
            }
          }

          // Distribute memory across shards (approximation)
          const memoryPerShard = memoryUsed / shardsForNode.length;
          for (const shard of shardsForNode) {
            redisShardMemoryUsageGauge.labels(String(shard), String(i)).set(memoryPerShard);
          }

          // Also count keys per shard pattern
          await this.collectShardKeyStats(node, i, shardsForNode);
        } catch (err) {
          // Node might be unavailable
        }
      }
    }
  }

  /**
   * Collect key statistics per shard
   */
  private async collectShardKeyStats(
    node: Redis,
    nodeIndex: number,
    shardsForNode: number[]
  ): Promise<void> {
    try {
      for (const shard of shardsForNode) {
        // Count keys matching the shard pattern (sampling)
        const pattern = `meeting:${shard}:*`;
        const keys = await node.keys(pattern);
        redisShardKeysGauge.labels(String(shard)).set(keys.length);
      }
    } catch (err) {
      // Keys command might be slow, ignore errors
    }
  }

  /**
   * Parse Redis INFO output for a specific value
   */
  private parseRedisInfoValue(info: string, key: string): number {
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
  async getStats(): Promise<ShardRouterStats> {
    const shards: ShardInfo[] = [];
    let activeConnections = 0;

    if (this.mode === 'cluster' && this.cluster) {
      const nodes = this.cluster.nodes('all');
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const isConnected = node.status === 'ready';
        if (isConnected) activeConnections++;

        let memoryUsed = 0;
        let memoryPeak = 0;
        
        try {
          const info = await node.info('memory');
          memoryUsed = this.parseRedisInfoValue(info, 'used_memory');
          memoryPeak = this.parseRedisInfoValue(info, 'used_memory_peak');
        } catch {}

        shards.push({
          shardIndex: i,
          nodeIndex: i,
          host: (node.options as any).host || 'unknown',
          port: (node.options as any).port || 0,
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
      if (isConnected) activeConnections++;

      let memoryUsed = 0;
      let memoryPeak = 0;

      try {
        const info = await node.info('memory');
        memoryUsed = this.parseRedisInfoValue(info, 'used_memory');
        memoryPeak = this.parseRedisInfoValue(info, 'used_memory_peak');
      } catch {}

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
  getShardDistribution(sampleMeetingIds: string[]): Map<number, string[]> {
    const distribution = new Map<number, string[]>();
    
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
  async shutdown(): Promise<void> {
    // Stop memory monitoring
    if (this.memoryMonitorInterval) {
      clearInterval(this.memoryMonitorInterval);
      this.memoryMonitorInterval = null;
    }

    // Close connections
    if (this.mode === 'cluster' && this.cluster) {
      await this.cluster.quit();
      this.cluster = null;
    } else {
      await Promise.all(this.nodes.map(node => node.quit()));
      this.nodes = [];
    }

    this.isInitialized = false;
    this.initPromise = null;

    logger.info('[REDIS_SHARD_ROUTER] Shutdown complete');
  }
}

// ── Singleton Instance ──────────────────────────────────────

const redisShardRouter = new RedisShardRouter();

// ── Exported Functions ──────────────────────────────────────

export { redisShardRouter };

/**
 * Initialize the shard router
 */
export async function initializeRedisShardRouter(): Promise<void> {
  return redisShardRouter.initialize();
}

/**
 * Get Redis client for a specific meeting
 */
export function getMeetingRedisClient(meetingId: string): Redis | Cluster {
  return redisShardRouter.getMeetingRedisClient(meetingId);
}

/**
 * Set meeting data with optional TTL
 */
export async function setMeetingData(
  meetingId: string,
  data: MeetingData,
  options?: SetOptions
): Promise<boolean> {
  return redisShardRouter.setMeetingData(meetingId, data, options);
}

/**
 * Get meeting data
 */
export async function getMeetingData(meetingId: string): Promise<MeetingData | null> {
  return redisShardRouter.getMeetingData(meetingId);
}

/**
 * Delete meeting data
 */
export async function deleteMeetingData(meetingId: string): Promise<boolean> {
  return redisShardRouter.deleteMeetingData(meetingId);
}

/**
 * Set meeting hash field
 */
export async function setMeetingField(
  meetingId: string,
  field: string,
  value: any,
  ttl?: number
): Promise<void> {
  return redisShardRouter.setMeetingField(meetingId, field, value, ttl);
}

/**
 * Get meeting hash field
 */
export async function getMeetingField(meetingId: string, field: string): Promise<any> {
  return redisShardRouter.getMeetingField(meetingId, field);
}

/**
 * Get all meeting hash fields
 */
export async function getMeetingAllFields(meetingId: string): Promise<Record<string, any> | null> {
  return redisShardRouter.getMeetingAllFields(meetingId);
}

/**
 * Check if meeting exists
 */
export async function meetingExists(meetingId: string): Promise<boolean> {
  return redisShardRouter.meetingExists(meetingId);
}

/**
 * Set meeting TTL
 */
export async function setMeetingTTL(meetingId: string, ttlSeconds: number): Promise<boolean> {
  return redisShardRouter.setMeetingTTL(meetingId, ttlSeconds);
}

/**
 * Append to meeting list
 */
export async function appendToMeetingList(
  meetingId: string,
  listName: string,
  value: any,
  maxLength?: number
): Promise<number> {
  return redisShardRouter.appendToMeetingList(meetingId, listName, value, maxLength);
}

/**
 * Get meeting list
 */
export async function getMeetingList(
  meetingId: string,
  listName: string,
  start?: number,
  end?: number
): Promise<any[]> {
  return redisShardRouter.getMeetingList(meetingId, listName, start, end);
}

/**
 * Get meeting list length
 */
export async function getMeetingListLength(meetingId: string, listName: string): Promise<number> {
  return redisShardRouter.getMeetingListLength(meetingId, listName);
}

/**
 * Get router statistics
 */
export async function getRedisShardStats(): Promise<ShardRouterStats> {
  return redisShardRouter.getStats();
}

/**
 * Shutdown router
 */
export async function shutdownRedisShardRouter(): Promise<void> {
  return redisShardRouter.shutdown();
}
