"use strict";
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
exports.queueManager = exports.DLQ_NAMES = exports.SHARDED_QUEUE_TYPES = exports.QUEUE_SHARDS = exports.QUEUE_SHARD_COUNTS = void 0;
exports.getShardCount = getShardCount;
exports.getShardIndex = getShardIndex;
exports.getShardQueueName = getShardQueueName;
exports.getDLQName = getDLQName;
exports.initializeQueueManager = initializeQueueManager;
exports.isQueueManagerInitialized = isQueueManagerInitialized;
exports.getQueue = getQueue;
exports.getTranscriptQueue = getTranscriptQueue;
exports.getTranslationQueue = getTranslationQueue;
exports.getBroadcastQueue = getBroadcastQueue;
exports.getMinutesQueue = getMinutesQueue;
exports.getAllQueues = getAllQueues;
exports.getShardStats = getShardStats;
exports.submitTranscript = submitTranscript;
exports.submitTranslation = submitTranslation;
exports.submitBroadcast = submitBroadcast;
exports.submitMinutes = submitMinutes;
exports.getDLQ = getDLQ;
exports.moveToDeadLetter = moveToDeadLetter;
exports.getDLQStats = getDLQStats;
exports.replayDLQJobs = replayDLQJobs;
exports.shutdownQueueManager = shutdownQueueManager;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importStar(require("ioredis"));
const client = __importStar(require("prom-client"));
const logger_1 = require("../logger");
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
exports.QUEUE_SHARD_COUNTS = {
    transcript: parseInt(process.env.TRANSCRIPT_SHARDS || '32', 10),
    translation: parseInt(process.env.TRANSLATION_SHARDS || '16', 10),
    broadcast: parseInt(process.env.BROADCAST_SHARDS || '16', 10),
    minutes: parseInt(process.env.MINUTES_SHARDS || '8', 10),
};
/** @deprecated Use QUEUE_SHARD_COUNTS instead. Legacy compatibility. */
exports.QUEUE_SHARDS = exports.QUEUE_SHARD_COUNTS.transcript;
/**
 * Get shard count for a specific queue type.
 */
function getShardCount(queueType) {
    return exports.QUEUE_SHARD_COUNTS[queueType] || 16;
}
/**
 * Queue type names — canonical queue type identifiers.
 */
exports.SHARDED_QUEUE_TYPES = {
    TRANSCRIPT_EVENTS: 'transcript',
    TRANSLATION_JOBS: 'translation',
    BROADCAST_EVENTS: 'broadcast',
    MINUTES_GENERATION: 'minutes',
};
// ── Hash Function ───────────────────────────────────────────
/**
 * Fast djb2 hash function for deterministic shard routing
 * @param str - String to hash (typically meetingId)
 * @returns 32-bit unsigned hash value
 */
function djb2Hash(str) {
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
function getShardIndex(meetingId, queueType) {
    const shardCount = queueType ? getShardCount(queueType) : exports.QUEUE_SHARD_COUNTS.transcript;
    return djb2Hash(meetingId) % shardCount;
}
/**
 * Get full shard queue name
 * @param queueType - Base queue type name
 * @param shardIndex - Shard index
 * @returns Full queue name with shard suffix
 */
function getShardQueueName(queueType, shardIndex) {
    return `${queueType}-jobs-shard-${shardIndex}`;
}
/**
 * Get dead letter queue name for a queue type.
 * DLQs store jobs that have exceeded max retry attempts.
 */
function getDLQName(queueType) {
    return `${queueType}-dlq`;
}
/**
 * DLQ names for fault tolerance.
 */
exports.DLQ_NAMES = {
    TRANSCRIPT: getDLQName(exports.SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS),
    TRANSLATION: getDLQName(exports.SHARDED_QUEUE_TYPES.TRANSLATION_JOBS),
    BROADCAST: getDLQName(exports.SHARDED_QUEUE_TYPES.BROADCAST_EVENTS),
    MINUTES: getDLQName(exports.SHARDED_QUEUE_TYPES.MINUTES_GENERATION),
};
// ── Prometheus Metrics ──────────────────────────────────────
const queueWaiting = new client.Gauge({
    name: 'orgsledger_queue_waiting',
    help: 'Number of waiting jobs in a queue shard',
    labelNames: ['queue_type', 'shard'],
});
const queueActive = new client.Gauge({
    name: 'orgsledger_queue_active',
    help: 'Number of active (in-progress) jobs in a queue shard',
    labelNames: ['queue_type', 'shard'],
});
const queueFailed = new client.Gauge({
    name: 'orgsledger_queue_failed',
    help: 'Number of failed jobs in a queue shard',
    labelNames: ['queue_type', 'shard'],
});
/**
 * Metrics collection interval handle — stopped on shutdown.
 */
let metricsInterval = null;
// ── Queue Manager Class ─────────────────────────────────────
class ShardedQueueManager {
    /** Redis connection for BullMQ (standalone or cluster) */
    redisConnection = null;
    /** Cached queue instances: Map<"queueType-jobs-shard-N", Queue> */
    queueCache = new Map();
    /** Cached DLQ instances: Map<"queueType-dlq", Queue> */
    dlqCache = new Map();
    /** Default job options by queue type */
    defaultJobOptions;
    /** Initialization promise for singleton pattern */
    initPromise = null;
    /** Whether the manager has been initialized */
    initialized = false;
    /** Connection retry state */
    connecting = false;
    constructor() {
        this.defaultJobOptions = {
            [exports.SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS]: {
                removeOnComplete: true,
                removeOnFail: false,
                attempts: 3,
                backoff: { type: 'exponential', delay: 1000 },
                priority: 1, // High priority for real-time
            },
            [exports.SHARDED_QUEUE_TYPES.TRANSLATION_JOBS]: {
                removeOnComplete: true,
                removeOnFail: false,
                attempts: 3,
                backoff: { type: 'exponential', delay: 2000 },
            },
            [exports.SHARDED_QUEUE_TYPES.BROADCAST_EVENTS]: {
                removeOnComplete: true,
                removeOnFail: false,
                attempts: 3,
                backoff: { type: 'exponential', delay: 1000 },
                priority: 1,
            },
            [exports.SHARDED_QUEUE_TYPES.MINUTES_GENERATION]: {
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
    async initialize() {
        if (this.initialized)
            return;
        if (this.initPromise) {
            return this.initPromise;
        }
        this.initPromise = this._initialize();
        return this.initPromise;
    }
    async _initialize() {
        if (this.connecting)
            return;
        this.connecting = true;
        try {
            const clusterNodes = process.env.REDIS_CLUSTER_NODES; // e.g. "host1:6379,host2:6380"
            if (clusterNodes) {
                await this.initializeCluster(clusterNodes);
            }
            else {
                await this.initializeStandalone();
            }
            this.initialized = true;
            this.startMetricsCollection();
            logger_1.logger.info('[QUEUE_MANAGER] Initialized', {
                mode: clusterNodes ? 'cluster' : 'standalone',
                shardCounts: exports.QUEUE_SHARD_COUNTS,
                queueTypes: Object.values(exports.SHARDED_QUEUE_TYPES),
            });
        }
        catch (err) {
            logger_1.logger.error('[QUEUE_MANAGER] Initialization failed', err);
            this.connecting = false;
            this.initPromise = null;
            throw err;
        }
        this.connecting = false;
    }
    /**
     * Initialize a standalone Redis connection.
     */
    async initializeStandalone() {
        const host = process.env.REDIS_HOST || 'localhost';
        const port = parseInt(process.env.REDIS_PORT || '6379', 10);
        const password = process.env.REDIS_PASSWORD;
        const db = parseInt(process.env.REDIS_DB || '0', 10);
        this.redisConnection = new ioredis_1.default({
            host,
            port,
            password,
            db,
            maxRetriesPerRequest: null, // Required for BullMQ
            enableReadyCheck: true,
            lazyConnect: false,
            retryStrategy: (times) => {
                if (times > 10) {
                    logger_1.logger.error('[QUEUE_MANAGER] Redis max retries exceeded');
                    return null;
                }
                const delay = Math.min(1000 * Math.pow(2, times - 1), 30000);
                logger_1.logger.info(`[QUEUE_MANAGER] Redis retry #${times}, delay ${delay}ms`);
                return delay;
            },
        });
        await this.waitForConnection(this.redisConnection);
    }
    /**
     * Initialize a Redis Cluster connection.
     * Expects REDIS_CLUSTER_NODES as comma-separated "host:port" pairs.
     */
    async initializeCluster(nodesEnv) {
        const password = process.env.REDIS_PASSWORD;
        const nodes = nodesEnv.split(',').map((n) => {
            const trimmed = n.trim();
            const [host, portStr] = trimmed.split(':');
            return { host, port: parseInt(portStr || '6379', 10) };
        });
        const cluster = new ioredis_1.Cluster(nodes, {
            redisOptions: {
                password,
                maxRetriesPerRequest: null,
                enableReadyCheck: true,
            },
            clusterRetryStrategy: (times) => {
                if (times > 10) {
                    logger_1.logger.error('[QUEUE_MANAGER] Cluster max retries exceeded');
                    return null;
                }
                const delay = Math.min(1000 * Math.pow(2, times - 1), 30000);
                logger_1.logger.info(`[QUEUE_MANAGER] Cluster retry #${times}, delay ${delay}ms`);
                return delay;
            },
            natMap: undefined,
        });
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Redis Cluster connection timeout'));
            }, 15000);
            cluster.on('ready', () => {
                clearTimeout(timeout);
                resolve();
            });
            cluster.on('error', (err) => {
                logger_1.logger.error('[QUEUE_MANAGER] Cluster error', err);
            });
        });
        this.redisConnection = cluster;
        logger_1.logger.info('[QUEUE_MANAGER] Redis Cluster connected', {
            nodeCount: nodes.length,
        });
    }
    /**
     * Wait for a standalone Redis connection to become ready.
     */
    async waitForConnection(conn) {
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Redis connection timeout'));
            }, 10000);
            conn.on('ready', () => {
                clearTimeout(timeout);
                resolve();
            });
            conn.on('error', (err) => {
                logger_1.logger.error('[QUEUE_MANAGER] Redis error', err);
            });
        });
    }
    // ── Queue Factory Methods ───────────────────────────────────
    /**
     * Get or create a queue instance for a given type and shard (lazy, cached).
     */
    getOrCreateQueue(queueType, shardIndex) {
        const queueName = getShardQueueName(queueType, shardIndex);
        // Return cached queue if exists
        const cached = this.queueCache.get(queueName);
        if (cached) {
            return cached;
        }
        // Ensure initialized
        if (!this.redisConnection) {
            throw new Error('[QUEUE_MANAGER] Not initialized. Call initialize() first.');
        }
        // Create new queue
        const queue = new bullmq_1.Queue(queueName, {
            connection: this.redisConnection,
            defaultJobOptions: this.defaultJobOptions[queueType],
        });
        // Cache and return
        this.queueCache.set(queueName, queue);
        logger_1.logger.debug('[QUEUE_MANAGER] Queue created', { queueName, shardIndex, queueType });
        return queue;
    }
    /**
     * Public API: get a queue by type and shard ID.
     * The queue is created lazily and cached for subsequent calls.
     */
    getQueue(queueType, shardId) {
        const maxShard = getShardCount(queueType);
        if (shardId < 0 || shardId >= maxShard) {
            throw new RangeError(`shardId ${shardId} out of range [0, ${maxShard - 1}] for queue type ${queueType}`);
        }
        return this.getOrCreateQueue(queueType, shardId);
    }
    /**
     * Get transcript queue for a specific meeting
     */
    getTranscriptQueue(meetingId) {
        const shardIndex = getShardIndex(meetingId, exports.SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS);
        return this.getOrCreateQueue(exports.SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS, shardIndex);
    }
    /**
     * Get translation queue for a specific meeting
     */
    getTranslationQueue(meetingId) {
        const shardIndex = getShardIndex(meetingId, exports.SHARDED_QUEUE_TYPES.TRANSLATION_JOBS);
        return this.getOrCreateQueue(exports.SHARDED_QUEUE_TYPES.TRANSLATION_JOBS, shardIndex);
    }
    /**
     * Get broadcast queue for a specific meeting
     */
    getBroadcastQueue(meetingId) {
        const shardIndex = getShardIndex(meetingId, exports.SHARDED_QUEUE_TYPES.BROADCAST_EVENTS);
        return this.getOrCreateQueue(exports.SHARDED_QUEUE_TYPES.BROADCAST_EVENTS, shardIndex);
    }
    /**
     * Get minutes generation queue for a specific meeting
     */
    getMinutesQueue(meetingId) {
        const shardIndex = getShardIndex(meetingId, exports.SHARDED_QUEUE_TYPES.MINUTES_GENERATION);
        return this.getOrCreateQueue(exports.SHARDED_QUEUE_TYPES.MINUTES_GENERATION, shardIndex);
    }
    // ── Worker Discovery ────────────────────────────────────────
    /**
     * Get ALL shard queues for a queue type (for worker consumption).
     * Workers must consume from ALL shards for complete coverage.
     */
    getAllQueues(queueType) {
        const queues = [];
        const shardCount = getShardCount(queueType);
        for (let shard = 0; shard < shardCount; shard++) {
            queues.push(this.getOrCreateQueue(queueType, shard));
        }
        return queues;
    }
    getAllTranscriptQueues() {
        return this.getAllQueues(exports.SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS);
    }
    getAllTranslationQueues() {
        return this.getAllQueues(exports.SHARDED_QUEUE_TYPES.TRANSLATION_JOBS);
    }
    getAllBroadcastQueues() {
        return this.getAllQueues(exports.SHARDED_QUEUE_TYPES.BROADCAST_EVENTS);
    }
    getAllMinutesQueues() {
        return this.getAllQueues(exports.SHARDED_QUEUE_TYPES.MINUTES_GENERATION);
    }
    // ── Dead Letter Queues ──────────────────────────────────────
    /**
     * Get or create a DLQ for a specific queue type.
     * DLQs store jobs that have exceeded max retry attempts.
     */
    getDLQ(queueType) {
        const dlqName = getDLQName(queueType);
        if (this.dlqCache.has(dlqName)) {
            return this.dlqCache.get(dlqName);
        }
        if (!this.redisConnection) {
            throw new Error('[QUEUE_MANAGER] Not initialized - cannot create DLQ');
        }
        const dlq = new bullmq_1.Queue(dlqName, {
            connection: this.redisConnection,
            defaultJobOptions: {
                removeOnComplete: false, // Keep failed jobs for inspection
                removeOnFail: false,
                attempts: 1, // No retries in DLQ
            },
        });
        this.dlqCache.set(dlqName, dlq);
        logger_1.logger.info('[QUEUE_MANAGER] Created DLQ', { dlqName });
        return dlq;
    }
    /**
     * Move a failed job to its corresponding DLQ for later inspection/replay.
     * Call this from worker's 'failed' event handler after max retries exhausted.
     */
    async moveToDeadLetter(queueType, job, failureReason) {
        const dlq = this.getDLQ(queueType);
        // Add to DLQ with failure metadata
        // Use 'any' for Queue to allow flexible job names
        await dlq.add('dlq-job', {
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
        logger_1.logger.info('[QUEUE_MANAGER] Job moved to DLQ', {
            queueType,
            originalJobId: job.id,
            failureReason,
            dlqName: getDLQName(queueType),
        });
    }
    /**
     * Get DLQ stats for monitoring.
     */
    async getDLQStats(queueType) {
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
    async replayDLQJobs(queueType, count = 10) {
        const dlq = this.getDLQ(queueType);
        const jobs = await dlq.getJobs(['waiting'], 0, count - 1);
        let replayed = 0;
        for (const job of jobs) {
            try {
                // Extract original job data from DLQ wrapper
                const dlqData = job.data;
                const originalData = dlqData.originalJobData || job.data;
                const meetingId = originalData.meetingId || 'unknown';
                const targetQueue = this.getOrCreateQueue(queueType, getShardIndex(meetingId, queueType));
                await targetQueue.add('replayed', originalData, {
                    jobId: `replay-${dlqData.originalJobId || job.id}`,
                });
                // Remove from DLQ after successful replay
                await job.remove();
                replayed++;
            }
            catch (err) {
                logger_1.logger.error('[QUEUE_MANAGER] Failed to replay DLQ job', {
                    jobId: job.id,
                    error: err,
                });
            }
        }
        logger_1.logger.info('[QUEUE_MANAGER] DLQ jobs replayed', {
            queueType,
            replayed,
            requested: count,
        });
        return replayed;
    }
    /**
     * Get queue names for a specific type (for worker registration)
     */
    getQueueNames(queueType) {
        const names = [];
        const shardCount = getShardCount(queueType);
        for (let shard = 0; shard < shardCount; shard++) {
            names.push(getShardQueueName(queueType, shard));
        }
        return names;
    }
    // ── Job Submission ──────────────────────────────────────────
    async submitTranscript(data, options) {
        const queue = this.getTranscriptQueue(data.meetingId);
        return queue.add('transcript', data, {
            priority: options?.priority ?? 1,
        });
    }
    async submitTranslation(data, options) {
        const queue = this.getTranslationQueue(data.meetingId);
        return queue.add('translate', data, {
            delay: options?.delay,
        });
    }
    async submitBroadcast(data) {
        const queue = this.getBroadcastQueue(data.meetingId);
        return queue.add('broadcast', data, {
            priority: 1,
        });
    }
    async submitMinutes(data, options) {
        const queue = this.getMinutesQueue(data.meetingId);
        return queue.add('minutes', data, {
            delay: options?.delay,
        });
    }
    // ── Monitoring ──────────────────────────────────────────────
    /**
     * Get statistics for all shards of a queue type.
     */
    async getShardStats(queueType) {
        const shards = [];
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
    async getShardStatsSingle(queueType, shardIndex) {
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
        }
        catch (err) {
            logger_1.logger.error('[QUEUE_MANAGER] Failed to get shard stats', {
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
    async getAllStats() {
        const [transcript, translation, broadcast, minutes] = await Promise.all([
            this.getShardStats(exports.SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS),
            this.getShardStats(exports.SHARDED_QUEUE_TYPES.TRANSLATION_JOBS),
            this.getShardStats(exports.SHARDED_QUEUE_TYPES.BROADCAST_EVENTS),
            this.getShardStats(exports.SHARDED_QUEUE_TYPES.MINUTES_GENERATION),
        ]);
        return {
            [exports.SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS]: transcript,
            [exports.SHARDED_QUEUE_TYPES.TRANSLATION_JOBS]: translation,
            [exports.SHARDED_QUEUE_TYPES.BROADCAST_EVENTS]: broadcast,
            [exports.SHARDED_QUEUE_TYPES.MINUTES_GENERATION]: minutes,
        };
    }
    async getShardDistribution(queueType) {
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
    async checkShardBalance(queueType, maxDeviationPercent = 50) {
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
    startMetricsCollection() {
        if (metricsInterval)
            return;
        const collectMetrics = async () => {
            try {
                for (const queueType of Object.values(exports.SHARDED_QUEUE_TYPES)) {
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
            }
            catch (err) {
                logger_1.logger.error('[QUEUE_MANAGER] Metrics collection failed', { error: err });
            }
        };
        // Collect immediately, then every 15 seconds
        collectMetrics();
        metricsInterval = setInterval(collectMetrics, 15_000);
    }
    // ── Lifecycle ───────────────────────────────────────────────
    getCachedQueueCount() {
        return this.queueCache.size;
    }
    isInitialized() {
        return this.initialized;
    }
    getConnectionStatus() {
        if (!this.redisConnection)
            return 'disconnected';
        if (this.connecting)
            return 'connecting';
        const status = this.redisConnection.status;
        return status === 'ready' ? 'connected' : 'disconnected';
    }
    async shutdown() {
        logger_1.logger.info('[QUEUE_MANAGER] Shutting down...');
        // Stop metrics collection
        if (metricsInterval) {
            clearInterval(metricsInterval);
            metricsInterval = null;
        }
        // Close all cached queues
        const closePromises = [];
        for (const [name, queue] of this.queueCache.entries()) {
            logger_1.logger.debug(`[QUEUE_MANAGER] Closing queue: ${name}`);
            closePromises.push(queue.close());
        }
        await Promise.allSettled(closePromises);
        this.queueCache.clear();
        // Close Redis connection
        if (this.redisConnection) {
            await this.redisConnection.quit();
            this.redisConnection = null;
        }
        this.initialized = false;
        this.initPromise = null;
        logger_1.logger.info('[QUEUE_MANAGER] Shutdown complete');
    }
    async pauseAllShards(queueType) {
        const queues = this.getAllQueues(queueType);
        await Promise.all(queues.map((q) => q.pause()));
        logger_1.logger.info(`[QUEUE_MANAGER] Paused all shards for ${queueType}`);
    }
    async resumeAllShards(queueType) {
        const queues = this.getAllQueues(queueType);
        await Promise.all(queues.map((q) => q.resume()));
        logger_1.logger.info(`[QUEUE_MANAGER] Resumed all shards for ${queueType}`);
    }
    async drainShard(queueType, shardIndex) {
        const queue = this.getOrCreateQueue(queueType, shardIndex);
        await queue.drain();
        logger_1.logger.info(`[QUEUE_MANAGER] Drained ${getShardQueueName(queueType, shardIndex)}`);
    }
    async obliterateShard(queueType, shardIndex, options) {
        const queue = this.getOrCreateQueue(queueType, shardIndex);
        await queue.obliterate(options);
        logger_1.logger.warn(`[QUEUE_MANAGER] Obliterated ${getShardQueueName(queueType, shardIndex)}`);
    }
}
// ── Singleton Instance ──────────────────────────────────────
const queueManager = new ShardedQueueManager();
exports.queueManager = queueManager;
async function initializeQueueManager() {
    return queueManager.initialize();
}
/**
 * Check if the queue manager has been initialized.
 * Useful for metrics collectors that run on a timer.
 */
function isQueueManagerInitialized() {
    return queueManager.isInitialized();
}
function getQueue(queueType, shardId) {
    return queueManager.getQueue(queueType, shardId);
}
function getTranscriptQueue(meetingId) {
    return queueManager.getTranscriptQueue(meetingId);
}
function getTranslationQueue(meetingId) {
    return queueManager.getTranslationQueue(meetingId);
}
function getBroadcastQueue(meetingId) {
    return queueManager.getBroadcastQueue(meetingId);
}
function getMinutesQueue(meetingId) {
    return queueManager.getMinutesQueue(meetingId);
}
function getAllQueues(queueType) {
    return queueManager.getAllQueues(queueType);
}
async function getShardStats(queueType) {
    return queueManager.getShardStats(queueType);
}
async function submitTranscript(data, options) {
    return queueManager.submitTranscript(data, options);
}
async function submitTranslation(data, options) {
    return queueManager.submitTranslation(data, options);
}
async function submitBroadcast(data) {
    return queueManager.submitBroadcast(data);
}
async function submitMinutes(data, options) {
    return queueManager.submitMinutes(data, options);
}
// ── DLQ Functions ───────────────────────────────────────────
function getDLQ(queueType) {
    return queueManager.getDLQ(queueType);
}
async function moveToDeadLetter(queueType, job, failureReason) {
    return queueManager.moveToDeadLetter(queueType, job, failureReason);
}
async function getDLQStats(queueType) {
    return queueManager.getDLQStats(queueType);
}
async function replayDLQJobs(queueType, count) {
    return queueManager.replayDLQJobs(queueType, count);
}
async function shutdownQueueManager() {
    return queueManager.shutdown();
}
//# sourceMappingURL=queue-manager.js.map