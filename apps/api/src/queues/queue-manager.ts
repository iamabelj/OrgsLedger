// ============================================================
// OrgsLedger API — Sharded Queue Manager
// Horizontal scaling for 50k+ simultaneous meetings
// ============================================================
//
// Architecture:
//   - Up to 128 shards per queue type for even distribution
//   - Deterministic routing: hash(meetingId) % SHARD_COUNT
//   - Lazy queue instantiation with internal cache
//   - Redis standalone + Redis Cluster connection support
//   - Prometheus metrics: queue_waiting, queue_active, queue_failed
//   - Worker support: iterate all shards for consumption
//
// Queue naming pattern:
//   {queue-type}-jobs-shard-{N}
//   e.g., transcript-jobs-shard-0 ... transcript-jobs-shard-15
//
// ============================================================

import { Queue, QueueOptions, Job } from 'bullmq';
import Redis, { Cluster } from 'ioredis';
import * as client from 'prom-client';
import { logger } from '../logger';

// ── Configuration ───────────────────────────────────────────

/**
 * Per-queue-type shard counts for optimal horizontal scaling.
 * Different queue types have different throughput requirements.
 * 
 * TRANSCRIPT_SHARDS = 32 (highest throughput - 250k jobs/min)
 * TRANSLATION_SHARDS = 16 (moderate throughput - API calls)
 * BROADCAST_SHARDS = 16 (moderate throughput - PubSub)
 * MINUTES_SHARDS = 8 (lowest throughput - AI processing)
 */
export const QUEUE_SHARD_COUNTS = {
  transcript: parseInt(process.env.TRANSCRIPT_SHARDS || '32', 10),
  translation: parseInt(process.env.TRANSLATION_SHARDS || '16', 10),
  broadcast: parseInt(process.env.BROADCAST_SHARDS || '16', 10),
  minutes: parseInt(process.env.MINUTES_SHARDS || '8', 10),
} as const;

/** @deprecated Use QUEUE_SHARD_COUNTS instead. Legacy compatibility. */
export const QUEUE_SHARDS: number = QUEUE_SHARD_COUNTS.transcript;

/**
 * Get shard count for a specific queue type.
 */
export function getShardCount(queueType: ShardedQueueType): number {
  return QUEUE_SHARD_COUNTS[queueType] || 16;
}

/**
 * Queue type names — canonical queue type identifiers.
 */
export const SHARDED_QUEUE_TYPES = {
  TRANSCRIPT_EVENTS: 'transcript',
  TRANSLATION_JOBS: 'translation',
  BROADCAST_EVENTS: 'broadcast',
  MINUTES_GENERATION: 'minutes',
} as const;

export type ShardedQueueType = typeof SHARDED_QUEUE_TYPES[keyof typeof SHARDED_QUEUE_TYPES];

// ── Types ───────────────────────────────────────────────────

export interface TranscriptEventData {
  meetingId: string;
  speaker: string;
  speakerId?: string;
  text: string;
  timestamp: string;
  isFinal: boolean;
  confidence?: number;
  language?: string;
}

export interface TranslationJobData {
  meetingId: string;
  speaker: string;
  speakerId?: string;
  text: string;
  timestamp: string;
  sourceLanguage: string;
  targetLanguages: string[];
}

export interface BroadcastEventData {
  meetingId: string;
  eventType: 'transcript' | 'translation' | 'minutes';
  data: Record<string, any>;
}

export interface MinutesJobData {
  meetingId: string;
  organizationId: string;
}

export interface ShardStats {
  shard: number;
  queueName: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export interface QueueManagerStats {
  queueType: ShardedQueueType;
  totalShards: number;
  shards: ShardStats[];
  totals: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
}

export interface ShardDistribution {
  shard: number;
  jobCount: number;
  percentage: number;
}

// ── Hash Function ───────────────────────────────────────────

/**
 * Fast djb2 hash function for deterministic shard routing
 * @param str - String to hash (typically meetingId)
 * @returns 32-bit unsigned hash value
 */
function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    // hash * 33 + char
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  // Return as unsigned 32-bit integer
  return hash >>> 0;
}

/**
 * Get shard index for a given meeting ID
 * @param meetingId - Meeting identifier
 * @param queueType - Queue type to get shard count for
 * @returns Shard index (0 to shardCount - 1)
 */
export function getShardIndex(meetingId: string, queueType?: ShardedQueueType): number {
  const shardCount = queueType ? getShardCount(queueType) : QUEUE_SHARD_COUNTS.transcript;
  return djb2Hash(meetingId) % shardCount;
}

/**
 * Get full shard queue name
 * @param queueType - Base queue type name
 * @param shardIndex - Shard index
 * @returns Full queue name with shard suffix
 */
export function getShardQueueName(queueType: ShardedQueueType, shardIndex: number): string {
  return `${queueType}-jobs-shard-${shardIndex}`;
}

/**
 * Get dead letter queue name for a queue type.
 * DLQs store jobs that have exceeded max retry attempts.
 */
export function getDLQName(queueType: ShardedQueueType): string {
  return `${queueType}-dlq`;
}

/**
 * DLQ names for fault tolerance.
 */
export const DLQ_NAMES = {
  TRANSCRIPT: getDLQName(SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS),
  TRANSLATION: getDLQName(SHARDED_QUEUE_TYPES.TRANSLATION_JOBS),
  BROADCAST: getDLQName(SHARDED_QUEUE_TYPES.BROADCAST_EVENTS),
  MINUTES: getDLQName(SHARDED_QUEUE_TYPES.MINUTES_GENERATION),
} as const;

// ── Prometheus Metrics ──────────────────────────────────────

const queueWaiting = new client.Gauge({
  name: 'orgsledger_queue_waiting',
  help: 'Number of waiting jobs in a queue shard',
  labelNames: ['queue_type', 'shard'] as const,
});

const queueActive = new client.Gauge({
  name: 'orgsledger_queue_active',
  help: 'Number of active (in-progress) jobs in a queue shard',
  labelNames: ['queue_type', 'shard'] as const,
});

const queueFailed = new client.Gauge({
  name: 'orgsledger_queue_failed',
  help: 'Number of failed jobs in a queue shard',
  labelNames: ['queue_type', 'shard'] as const,
});

/**
 * Metrics collection interval handle — stopped on shutdown.
 */
let metricsInterval: ReturnType<typeof setInterval> | null = null;

// ── Queue Manager Class ─────────────────────────────────────

class ShardedQueueManager {
  /** Redis connection for BullMQ (standalone or cluster) */
  private redisConnection: Redis | Cluster | null = null;

  /** Cached queue instances: Map<"queueType-jobs-shard-N", Queue> */
  private queueCache: Map<string, Queue> = new Map();

  /** Cached DLQ instances: Map<"queueType-dlq", Queue> */
  private dlqCache: Map<string, Queue> = new Map();

  /** Default job options by queue type */
  private defaultJobOptions: Record<ShardedQueueType, QueueOptions['defaultJobOptions']>;

  /** Initialization promise for singleton pattern */
  private initPromise: Promise<void> | null = null;

  /** Whether the manager has been initialized */
  private initialized = false;

  /** Connection retry state */
  private connecting = false;

  constructor() {
    this.defaultJobOptions = {
      [SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS]: {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        priority: 1, // High priority for real-time
      },
      [SHARDED_QUEUE_TYPES.TRANSLATION_JOBS]: {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
      [SHARDED_QUEUE_TYPES.BROADCAST_EVENTS]: {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        priority: 1,
      },
      [SHARDED_QUEUE_TYPES.MINUTES_GENERATION]: {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    };
  }

  // ── Initialization ──────────────────────────────────────────

  /**
   * Initialize Redis connection for BullMQ.
   * Supports both standalone Redis and Redis Cluster.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._initialize();
    return this.initPromise;
  }

  private async _initialize(): Promise<void> {
    if (this.connecting) return;
    this.connecting = true;

    try {
      const clusterNodes = process.env.REDIS_CLUSTER_NODES; // e.g. "host1:6379,host2:6380"

      if (clusterNodes) {
        await this.initializeCluster(clusterNodes);
      } else {
        await this.initializeStandalone();
      }

      this.initialized = true;
      this.startMetricsCollection();

      logger.info('[QUEUE_MANAGER] Initialized', {
        mode: clusterNodes ? 'cluster' : 'standalone',
        shardCounts: QUEUE_SHARD_COUNTS,
        queueTypes: Object.values(SHARDED_QUEUE_TYPES),
      });
    } catch (err) {
      logger.error('[QUEUE_MANAGER] Initialization failed', err);
      this.connecting = false;
      this.initPromise = null;
      throw err;
    }

    this.connecting = false;
  }

  /**
   * Initialize a standalone Redis connection.
   */
  private async initializeStandalone(): Promise<void> {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);
    const password = process.env.REDIS_PASSWORD;
    const db = parseInt(process.env.REDIS_DB || '0', 10);

    this.redisConnection = new Redis({
      host,
      port,
      password,
      db,
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy: (times: number) => {
        if (times > 10) {
          logger.error('[QUEUE_MANAGER] Redis max retries exceeded');
          return null;
        }
        const delay = Math.min(1000 * Math.pow(2, times - 1), 30000);
        logger.info(`[QUEUE_MANAGER] Redis retry #${times}, delay ${delay}ms`);
        return delay;
      },
    });

    await this.waitForConnection(this.redisConnection as Redis);
  }

  /**
   * Initialize a Redis Cluster connection.
   * Expects REDIS_CLUSTER_NODES as comma-separated "host:port" pairs.
   */
  private async initializeCluster(nodesEnv: string): Promise<void> {
    const password = process.env.REDIS_PASSWORD;
    const nodes = nodesEnv.split(',').map((n) => {
      const trimmed = n.trim();
      const [host, portStr] = trimmed.split(':');
      return { host, port: parseInt(portStr || '6379', 10) };
    });

    const cluster = new Cluster(nodes, {
      redisOptions: {
        password,
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
      },
      clusterRetryStrategy: (times: number) => {
        if (times > 10) {
          logger.error('[QUEUE_MANAGER] Cluster max retries exceeded');
          return null;
        }
        const delay = Math.min(1000 * Math.pow(2, times - 1), 30000);
        logger.info(`[QUEUE_MANAGER] Cluster retry #${times}, delay ${delay}ms`);
        return delay;
      },
      natMap: undefined,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis Cluster connection timeout'));
      }, 15000);

      cluster.on('ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      cluster.on('error', (err) => {
        logger.error('[QUEUE_MANAGER] Cluster error', err);
      });
    });

    this.redisConnection = cluster;
    logger.info('[QUEUE_MANAGER] Redis Cluster connected', {
      nodeCount: nodes.length,
    });
  }

  /**
   * Wait for a standalone Redis connection to become ready.
   */
  private async waitForConnection(conn: Redis): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis connection timeout'));
      }, 10000);

      conn.on('ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      conn.on('error', (err) => {
        logger.error('[QUEUE_MANAGER] Redis error', err);
      });
    });
  }

  // ── Queue Factory Methods ───────────────────────────────────

  /**
   * Get or create a queue instance for a given type and shard (lazy, cached).
   */
  private getOrCreateQueue<T>(queueType: ShardedQueueType, shardIndex: number): Queue<T> {
    const queueName = getShardQueueName(queueType, shardIndex);

    // Return cached queue if exists
    const cached = this.queueCache.get(queueName);
    if (cached) {
      return cached as Queue<T>;
    }

    // Ensure initialized
    if (!this.redisConnection) {
      throw new Error('[QUEUE_MANAGER] Not initialized. Call initialize() first.');
    }

    // Create new queue
    const queue = new Queue<T>(queueName, {
      connection: this.redisConnection as any,
      defaultJobOptions: this.defaultJobOptions[queueType],
    });

    // Cache and return
    this.queueCache.set(queueName, queue);

    logger.debug('[QUEUE_MANAGER] Queue created', { queueName, shardIndex, queueType });

    return queue;
  }

  /**
   * Public API: get a queue by type and shard ID.
   * The queue is created lazily and cached for subsequent calls.
   */
  getQueue<T = any>(queueType: ShardedQueueType, shardId: number): Queue<T> {
    const maxShard = getShardCount(queueType);
    if (shardId < 0 || shardId >= maxShard) {
      throw new RangeError(
        `shardId ${shardId} out of range [0, ${maxShard - 1}] for queue type ${queueType}`
      );
    }
    return this.getOrCreateQueue<T>(queueType, shardId);
  }

  /**
   * Get transcript queue for a specific meeting
   */
  getTranscriptQueue(meetingId: string): Queue<TranscriptEventData> {
    const shardIndex = getShardIndex(meetingId, SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS);
    return this.getOrCreateQueue<TranscriptEventData>(
      SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS,
      shardIndex
    );
  }

  /**
   * Get translation queue for a specific meeting
   */
  getTranslationQueue(meetingId: string): Queue<TranslationJobData> {
    const shardIndex = getShardIndex(meetingId, SHARDED_QUEUE_TYPES.TRANSLATION_JOBS);
    return this.getOrCreateQueue<TranslationJobData>(
      SHARDED_QUEUE_TYPES.TRANSLATION_JOBS,
      shardIndex
    );
  }

  /**
   * Get broadcast queue for a specific meeting
   */
  getBroadcastQueue(meetingId: string): Queue<BroadcastEventData> {
    const shardIndex = getShardIndex(meetingId, SHARDED_QUEUE_TYPES.BROADCAST_EVENTS);
    return this.getOrCreateQueue<BroadcastEventData>(
      SHARDED_QUEUE_TYPES.BROADCAST_EVENTS,
      shardIndex
    );
  }

  /**
   * Get minutes generation queue for a specific meeting
   */
  getMinutesQueue(meetingId: string): Queue<MinutesJobData> {
    const shardIndex = getShardIndex(meetingId, SHARDED_QUEUE_TYPES.MINUTES_GENERATION);
    return this.getOrCreateQueue<MinutesJobData>(
      SHARDED_QUEUE_TYPES.MINUTES_GENERATION,
      shardIndex
    );
  }

  // ── Worker Discovery ────────────────────────────────────────

  /**
   * Get ALL shard queues for a queue type (for worker consumption).
   * Workers must consume from ALL shards for complete coverage.
   */
  getAllQueues<T = any>(queueType: ShardedQueueType): Queue<T>[] {
    const queues: Queue<T>[] = [];
    const shardCount = getShardCount(queueType);

    for (let shard = 0; shard < shardCount; shard++) {
      queues.push(this.getOrCreateQueue<T>(queueType, shard));
    }

    return queues;
  }

  getAllTranscriptQueues(): Queue<TranscriptEventData>[] {
    return this.getAllQueues<TranscriptEventData>(SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS);
  }

  getAllTranslationQueues(): Queue<TranslationJobData>[] {
    return this.getAllQueues<TranslationJobData>(SHARDED_QUEUE_TYPES.TRANSLATION_JOBS);
  }

  getAllBroadcastQueues(): Queue<BroadcastEventData>[] {
    return this.getAllQueues<BroadcastEventData>(SHARDED_QUEUE_TYPES.BROADCAST_EVENTS);
  }

  getAllMinutesQueues(): Queue<MinutesJobData>[] {
    return this.getAllQueues<MinutesJobData>(SHARDED_QUEUE_TYPES.MINUTES_GENERATION);
  }

  // ── Dead Letter Queues ──────────────────────────────────────

  /**
   * Get or create a DLQ for a specific queue type.
   * DLQs store jobs that have exceeded max retry attempts.
   */
  getDLQ<T = any>(queueType: ShardedQueueType): Queue<T> {
    const dlqName = getDLQName(queueType);
    
    if (this.dlqCache.has(dlqName)) {
      return this.dlqCache.get(dlqName) as Queue<T>;
    }

    if (!this.redisConnection) {
      throw new Error('[QUEUE_MANAGER] Not initialized - cannot create DLQ');
    }

    const dlq = new Queue<T>(dlqName, {
      connection: this.redisConnection as any,
      defaultJobOptions: {
        removeOnComplete: false, // Keep failed jobs for inspection
        removeOnFail: false,
        attempts: 1, // No retries in DLQ
      },
    });

    this.dlqCache.set(dlqName, dlq as Queue);
    logger.info('[QUEUE_MANAGER] Created DLQ', { dlqName });
    
    return dlq;
  }

  /**
   * Move a failed job to its corresponding DLQ for later inspection/replay.
   * Call this from worker's 'failed' event handler after max retries exhausted.
   */
  async moveToDeadLetter<T = any>(
    queueType: ShardedQueueType,
    job: Job<T>,
    failureReason: string
  ): Promise<void> {
    const dlq = this.getDLQ(queueType);
    
    // Add to DLQ with failure metadata
    // Use 'any' for Queue to allow flexible job names
    await (dlq as Queue).add('dlq-job', {
      originalJobData: job.data,
      originalJobId: job.id,
      failureReason,
      failedAt: new Date().toISOString(),
      queueType,
    }, {
      jobId: `dlq-${job.id}`,
      removeOnComplete: false,
      removeOnFail: false,
    });

    logger.info('[QUEUE_MANAGER] Job moved to DLQ', {
      queueType,
      originalJobId: job.id,
      failureReason,
      dlqName: getDLQName(queueType),
    });
  }

  /**
   * Get DLQ stats for monitoring.
   */
  async getDLQStats(queueType: ShardedQueueType): Promise<{
    waiting: number;
    active: number;
    failed: number;
    completed: number;
  }> {
    const dlq = this.getDLQ(queueType);
    const [waiting, active, failed, completed] = await Promise.all([
      dlq.getWaitingCount(),
      dlq.getActiveCount(),
      dlq.getFailedCount(),
      dlq.getCompletedCount(),
    ]);
    return { waiting, active, failed, completed };
  }

  /**
   * Replay jobs from DLQ back to their original queues.
   * Useful for manual recovery after fixing underlying issues.
   */
  async replayDLQJobs(
    queueType: ShardedQueueType,
    count: number = 10
  ): Promise<number> {
    const dlq = this.getDLQ(queueType);
    const jobs = await dlq.getJobs(['waiting'], 0, count - 1);
    
    let replayed = 0;
    for (const job of jobs) {
      try {
        // Extract original job data from DLQ wrapper
        const dlqData = job.data as {
          originalJobData: any;
          originalJobId: string;
          failureReason: string;
          failedAt: string;
          queueType: string;
        };
        
        const originalData = dlqData.originalJobData || job.data;
        const meetingId = originalData.meetingId || 'unknown';
        const targetQueue = this.getOrCreateQueue(queueType, getShardIndex(meetingId, queueType));
        
        await (targetQueue as Queue).add('replayed', originalData, {
          jobId: `replay-${dlqData.originalJobId || job.id}`,
        });
        
        // Remove from DLQ after successful replay
        await job.remove();
        replayed++;
      } catch (err) {
        logger.error('[QUEUE_MANAGER] Failed to replay DLQ job', {
          jobId: job.id,
          error: err,
        });
      }
    }
    
    logger.info('[QUEUE_MANAGER] DLQ jobs replayed', {
      queueType,
      replayed,
      requested: count,
    });
    
    return replayed;
  }

  /**
   * Get queue names for a specific type (for worker registration)
   */
  getQueueNames(queueType: ShardedQueueType): string[] {
    const names: string[] = [];
    const shardCount = getShardCount(queueType);
    for (let shard = 0; shard < shardCount; shard++) {
      names.push(getShardQueueName(queueType, shard));
    }
    return names;
  }

  // ── Job Submission ──────────────────────────────────────────

  async submitTranscript(
    data: TranscriptEventData,
    options?: { priority?: number }
  ): Promise<Job<TranscriptEventData>> {
    const queue = this.getTranscriptQueue(data.meetingId);
    return queue.add('transcript', data, {
      priority: options?.priority ?? 1,
    });
  }

  async submitTranslation(
    data: TranslationJobData,
    options?: { delay?: number }
  ): Promise<Job<TranslationJobData>> {
    const queue = this.getTranslationQueue(data.meetingId);
    return queue.add('translate', data, {
      delay: options?.delay,
    });
  }

  async submitBroadcast(
    data: BroadcastEventData
  ): Promise<Job<BroadcastEventData>> {
    const queue = this.getBroadcastQueue(data.meetingId);
    return queue.add('broadcast', data, {
      priority: 1,
    });
  }

  async submitMinutes(
    data: MinutesJobData,
    options?: { delay?: number }
  ): Promise<Job<MinutesJobData>> {
    const queue = this.getMinutesQueue(data.meetingId);
    return queue.add('minutes', data, {
      delay: options?.delay,
    });
  }

  // ── Monitoring ──────────────────────────────────────────────

  /**
   * Get statistics for all shards of a queue type.
   */
  async getShardStats(queueType: ShardedQueueType): Promise<QueueManagerStats> {
    const shards: ShardStats[] = [];
    const totals = {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
    };

    const shardCount = getShardCount(queueType);
    const statsPromises = [];
    for (let shard = 0; shard < shardCount; shard++) {
      statsPromises.push(this.getShardStatsSingle(queueType, shard));
    }

    const results = await Promise.all(statsPromises);

    for (const stat of results) {
      shards.push(stat);
      totals.waiting += stat.waiting;
      totals.active += stat.active;
      totals.completed += stat.completed;
      totals.failed += stat.failed;
      totals.delayed += stat.delayed;
    }

    return {
      queueType,
      totalShards: shardCount,
      shards,
      totals,
    };
  }

  private async getShardStatsSingle(
    queueType: ShardedQueueType,
    shardIndex: number
  ): Promise<ShardStats> {
    const queue = this.getOrCreateQueue(queueType, shardIndex);
    const queueName = getShardQueueName(queueType, shardIndex);

    try {
      const [waiting, active, completed, failed, delayed, isPaused] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
        queue.isPaused(),
      ]);

      return {
        shard: shardIndex,
        queueName,
        waiting,
        active,
        completed,
        failed,
        delayed,
        paused: isPaused ? 1 : 0,
      };
    } catch (err) {
      logger.error('[QUEUE_MANAGER] Failed to get shard stats', {
        queueType,
        shardIndex,
        error: err,
      });

      return {
        shard: shardIndex,
        queueName,
        waiting: -1,
        active: -1,
        completed: -1,
        failed: -1,
        delayed: -1,
        paused: -1,
      };
    }
  }

  async getAllStats(): Promise<Record<ShardedQueueType, QueueManagerStats>> {
    const [transcript, translation, broadcast, minutes] = await Promise.all([
      this.getShardStats(SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS),
      this.getShardStats(SHARDED_QUEUE_TYPES.TRANSLATION_JOBS),
      this.getShardStats(SHARDED_QUEUE_TYPES.BROADCAST_EVENTS),
      this.getShardStats(SHARDED_QUEUE_TYPES.MINUTES_GENERATION),
    ]);

    return {
      [SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS]: transcript,
      [SHARDED_QUEUE_TYPES.TRANSLATION_JOBS]: translation,
      [SHARDED_QUEUE_TYPES.BROADCAST_EVENTS]: broadcast,
      [SHARDED_QUEUE_TYPES.MINUTES_GENERATION]: minutes,
    };
  }

  async getShardDistribution(queueType: ShardedQueueType): Promise<ShardDistribution[]> {
    const stats = await this.getShardStats(queueType);
    const totalJobs = stats.totals.waiting + stats.totals.active;

    return stats.shards.map((shard) => ({
      shard: shard.shard,
      jobCount: shard.waiting + shard.active,
      percentage: totalJobs > 0
        ? Math.round(((shard.waiting + shard.active) / totalJobs) * 10000) / 100
        : 0,
    }));
  }

  async checkShardBalance(
    queueType: ShardedQueueType,
    maxDeviationPercent: number = 50
  ): Promise<{ balanced: boolean; overloadedShards: number[] }> {
    const distribution = await this.getShardDistribution(queueType);
    const shardCount = getShardCount(queueType);
    const idealPercentage = 100 / shardCount;
    const maxPercentage = idealPercentage * (1 + maxDeviationPercent / 100);

    const overloadedShards = distribution
      .filter((d) => d.percentage > maxPercentage)
      .map((d) => d.shard);

    return {
      balanced: overloadedShards.length === 0,
      overloadedShards,
    };
  }

  // ── Prometheus Metrics Collection ───────────────────────────

  /**
   * Start periodic Prometheus metrics collection (every 15s).
   */
  private startMetricsCollection(): void {
    if (metricsInterval) return;

    const collectMetrics = async () => {
      try {
        for (const queueType of Object.values(SHARDED_QUEUE_TYPES)) {
          const stats = await this.getShardStats(queueType);
          for (const shard of stats.shards) {
            const labels = {
              queue_type: queueType,
              shard: String(shard.shard),
            };
            queueWaiting.set(labels, Math.max(shard.waiting, 0));
            queueActive.set(labels, Math.max(shard.active, 0));
            queueFailed.set(labels, Math.max(shard.failed, 0));
          }
        }
      } catch (err) {
        logger.error('[QUEUE_MANAGER] Metrics collection failed', { error: err });
      }
    };

    // Collect immediately, then every 15 seconds
    collectMetrics();
    metricsInterval = setInterval(collectMetrics, 15_000);
  }

  // ── Lifecycle ───────────────────────────────────────────────

  getCachedQueueCount(): number {
    return this.queueCache.size;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getConnectionStatus(): 'connected' | 'disconnected' | 'connecting' {
    if (!this.redisConnection) return 'disconnected';
    if (this.connecting) return 'connecting';
    const status = (this.redisConnection as any).status;
    return status === 'ready' ? 'connected' : 'disconnected';
  }

  async shutdown(): Promise<void> {
    logger.info('[QUEUE_MANAGER] Shutting down...');

    // Stop metrics collection
    if (metricsInterval) {
      clearInterval(metricsInterval);
      metricsInterval = null;
    }

    // Close all cached queues
    const closePromises: Promise<void>[] = [];
    for (const [name, queue] of this.queueCache.entries()) {
      logger.debug(`[QUEUE_MANAGER] Closing queue: ${name}`);
      closePromises.push(queue.close());
    }

    await Promise.allSettled(closePromises);
    this.queueCache.clear();

    // Close Redis connection
    if (this.redisConnection) {
      await (this.redisConnection as any).quit();
      this.redisConnection = null;
    }

    this.initialized = false;
    this.initPromise = null;

    logger.info('[QUEUE_MANAGER] Shutdown complete');
  }

  async pauseAllShards(queueType: ShardedQueueType): Promise<void> {
    const queues = this.getAllQueues(queueType);
    await Promise.all(queues.map((q) => q.pause()));
    logger.info(`[QUEUE_MANAGER] Paused all shards for ${queueType}`);
  }

  async resumeAllShards(queueType: ShardedQueueType): Promise<void> {
    const queues = this.getAllQueues(queueType);
    await Promise.all(queues.map((q) => q.resume()));
    logger.info(`[QUEUE_MANAGER] Resumed all shards for ${queueType}`);
  }

  async drainShard(queueType: ShardedQueueType, shardIndex: number): Promise<void> {
    const queue = this.getOrCreateQueue(queueType, shardIndex);
    await queue.drain();
    logger.info(`[QUEUE_MANAGER] Drained ${getShardQueueName(queueType, shardIndex)}`);
  }

  async obliterateShard(
    queueType: ShardedQueueType,
    shardIndex: number,
    options?: { force?: boolean }
  ): Promise<void> {
    const queue = this.getOrCreateQueue(queueType, shardIndex);
    await queue.obliterate(options);
    logger.warn(`[QUEUE_MANAGER] Obliterated ${getShardQueueName(queueType, shardIndex)}`);
  }
}

// ── Singleton Instance ──────────────────────────────────────

const queueManager = new ShardedQueueManager();

// ── Exported Functions ──────────────────────────────────────

export { queueManager };

export async function initializeQueueManager(): Promise<void> {
  return queueManager.initialize();
}

export function getQueue<T = any>(queueType: ShardedQueueType, shardId: number): Queue<T> {
  return queueManager.getQueue<T>(queueType, shardId);
}

export function getTranscriptQueue(meetingId: string): Queue<TranscriptEventData> {
  return queueManager.getTranscriptQueue(meetingId);
}

export function getTranslationQueue(meetingId: string): Queue<TranslationJobData> {
  return queueManager.getTranslationQueue(meetingId);
}

export function getBroadcastQueue(meetingId: string): Queue<BroadcastEventData> {
  return queueManager.getBroadcastQueue(meetingId);
}

export function getMinutesQueue(meetingId: string): Queue<MinutesJobData> {
  return queueManager.getMinutesQueue(meetingId);
}

export function getAllQueues<T = any>(queueType: ShardedQueueType): Queue<T>[] {
  return queueManager.getAllQueues<T>(queueType);
}

export async function getShardStats(queueType: ShardedQueueType): Promise<QueueManagerStats> {
  return queueManager.getShardStats(queueType);
}

export async function submitTranscript(
  data: TranscriptEventData,
  options?: { priority?: number }
): Promise<Job<TranscriptEventData>> {
  return queueManager.submitTranscript(data, options);
}

export async function submitTranslation(
  data: TranslationJobData,
  options?: { delay?: number }
): Promise<Job<TranslationJobData>> {
  return queueManager.submitTranslation(data, options);
}

export async function submitBroadcast(
  data: BroadcastEventData
): Promise<Job<BroadcastEventData>> {
  return queueManager.submitBroadcast(data);
}

export async function submitMinutes(
  data: MinutesJobData,
  options?: { delay?: number }
): Promise<Job<MinutesJobData>> {
  return queueManager.submitMinutes(data, options);
}

// ── DLQ Functions ───────────────────────────────────────────

export function getDLQ<T = any>(queueType: ShardedQueueType): Queue<T> {
  return queueManager.getDLQ<T>(queueType);
}

export async function moveToDeadLetter<T = any>(
  queueType: ShardedQueueType,
  job: Job<T>,
  failureReason: string
): Promise<void> {
  return queueManager.moveToDeadLetter(queueType, job, failureReason);
}

export async function getDLQStats(queueType: ShardedQueueType): Promise<{
  waiting: number;
  active: number;
  failed: number;
  completed: number;
}> {
  return queueManager.getDLQStats(queueType);
}

export async function replayDLQJobs(
  queueType: ShardedQueueType,
  count?: number
): Promise<number> {
  return queueManager.replayDLQJobs(queueType, count);
}

export async function shutdownQueueManager(): Promise<void> {
  return queueManager.shutdown();
}

// ── Export Types ────────────────────────────────────────────

export type {
  Queue,
  Job,
};
