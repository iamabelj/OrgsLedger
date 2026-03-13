import { Queue, Job } from 'bullmq';
/**
 * Per-queue-type shard counts for optimal horizontal scaling.
 * Different queue types have different throughput requirements.
 *
 * TRANSCRIPT_SHARDS = 32 (highest throughput - 250k jobs/min)
 * TRANSLATION_SHARDS = 16 (moderate throughput - API calls)
 * BROADCAST_SHARDS = 16 (moderate throughput - PubSub)
 * MINUTES_SHARDS = 8 (lowest throughput - AI processing)
 */
export declare const QUEUE_SHARD_COUNTS: {
    readonly transcript: number;
    readonly translation: number;
    readonly broadcast: number;
    readonly minutes: number;
};
/** @deprecated Use QUEUE_SHARD_COUNTS instead. Legacy compatibility. */
export declare const QUEUE_SHARDS: number;
/**
 * Get shard count for a specific queue type.
 */
export declare function getShardCount(queueType: ShardedQueueType): number;
/**
 * Queue type names — canonical queue type identifiers.
 */
export declare const SHARDED_QUEUE_TYPES: {
    readonly TRANSCRIPT_EVENTS: "transcript";
    readonly TRANSLATION_JOBS: "translation";
    readonly BROADCAST_EVENTS: "broadcast";
    readonly MINUTES_GENERATION: "minutes";
};
export type ShardedQueueType = typeof SHARDED_QUEUE_TYPES[keyof typeof SHARDED_QUEUE_TYPES];
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
/**
 * Get shard index for a given meeting ID
 * @param meetingId - Meeting identifier
 * @param queueType - Queue type to get shard count for
 * @returns Shard index (0 to shardCount - 1)
 */
export declare function getShardIndex(meetingId: string, queueType?: ShardedQueueType): number;
/**
 * Get full shard queue name
 * @param queueType - Base queue type name
 * @param shardIndex - Shard index
 * @returns Full queue name with shard suffix
 */
export declare function getShardQueueName(queueType: ShardedQueueType, shardIndex: number): string;
/**
 * Get dead letter queue name for a queue type.
 * DLQs store jobs that have exceeded max retry attempts.
 */
export declare function getDLQName(queueType: ShardedQueueType): string;
/**
 * DLQ names for fault tolerance.
 */
export declare const DLQ_NAMES: {
    readonly TRANSCRIPT: string;
    readonly TRANSLATION: string;
    readonly BROADCAST: string;
    readonly MINUTES: string;
};
declare class ShardedQueueManager {
    /** Redis connection for BullMQ (standalone or cluster) */
    private redisConnection;
    /** Cached queue instances: Map<"queueType-jobs-shard-N", Queue> */
    private queueCache;
    /** Cached DLQ instances: Map<"queueType-dlq", Queue> */
    private dlqCache;
    /** Default job options by queue type */
    private defaultJobOptions;
    /** Initialization promise for singleton pattern */
    private initPromise;
    /** Whether the manager has been initialized */
    private initialized;
    /** Connection retry state */
    private connecting;
    constructor();
    /**
     * Initialize Redis connection for BullMQ.
     * Supports both standalone Redis and Redis Cluster.
     */
    initialize(): Promise<void>;
    private _initialize;
    /**
     * Initialize a standalone Redis connection.
     */
    private initializeStandalone;
    /**
     * Initialize a Redis Cluster connection.
     * Expects REDIS_CLUSTER_NODES as comma-separated "host:port" pairs.
     */
    private initializeCluster;
    /**
     * Wait for a standalone Redis connection to become ready.
     */
    private waitForConnection;
    /**
     * Get or create a queue instance for a given type and shard (lazy, cached).
     */
    private getOrCreateQueue;
    /**
     * Public API: get a queue by type and shard ID.
     * The queue is created lazily and cached for subsequent calls.
     */
    getQueue<T = any>(queueType: ShardedQueueType, shardId: number): Queue<T>;
    /**
     * Get transcript queue for a specific meeting
     */
    getTranscriptQueue(meetingId: string): Queue<TranscriptEventData>;
    /**
     * Get translation queue for a specific meeting
     */
    getTranslationQueue(meetingId: string): Queue<TranslationJobData>;
    /**
     * Get broadcast queue for a specific meeting
     */
    getBroadcastQueue(meetingId: string): Queue<BroadcastEventData>;
    /**
     * Get minutes generation queue for a specific meeting
     */
    getMinutesQueue(meetingId: string): Queue<MinutesJobData>;
    /**
     * Get ALL shard queues for a queue type (for worker consumption).
     * Workers must consume from ALL shards for complete coverage.
     */
    getAllQueues<T = any>(queueType: ShardedQueueType): Queue<T>[];
    getAllTranscriptQueues(): Queue<TranscriptEventData>[];
    getAllTranslationQueues(): Queue<TranslationJobData>[];
    getAllBroadcastQueues(): Queue<BroadcastEventData>[];
    getAllMinutesQueues(): Queue<MinutesJobData>[];
    /**
     * Get or create a DLQ for a specific queue type.
     * DLQs store jobs that have exceeded max retry attempts.
     */
    getDLQ<T = any>(queueType: ShardedQueueType): Queue<T>;
    /**
     * Move a failed job to its corresponding DLQ for later inspection/replay.
     * Call this from worker's 'failed' event handler after max retries exhausted.
     */
    moveToDeadLetter<T = any>(queueType: ShardedQueueType, job: Job<T>, failureReason: string): Promise<void>;
    /**
     * Get DLQ stats for monitoring.
     */
    getDLQStats(queueType: ShardedQueueType): Promise<{
        waiting: number;
        active: number;
        failed: number;
        completed: number;
    }>;
    /**
     * Replay jobs from DLQ back to their original queues.
     * Useful for manual recovery after fixing underlying issues.
     */
    replayDLQJobs(queueType: ShardedQueueType, count?: number): Promise<number>;
    /**
     * Get queue names for a specific type (for worker registration)
     */
    getQueueNames(queueType: ShardedQueueType): string[];
    submitTranscript(data: TranscriptEventData, options?: {
        priority?: number;
    }): Promise<Job<TranscriptEventData>>;
    submitTranslation(data: TranslationJobData, options?: {
        delay?: number;
    }): Promise<Job<TranslationJobData>>;
    submitBroadcast(data: BroadcastEventData): Promise<Job<BroadcastEventData>>;
    submitMinutes(data: MinutesJobData, options?: {
        delay?: number;
    }): Promise<Job<MinutesJobData>>;
    /**
     * Get statistics for all shards of a queue type.
     */
    getShardStats(queueType: ShardedQueueType): Promise<QueueManagerStats>;
    private getShardStatsSingle;
    getAllStats(): Promise<Record<ShardedQueueType, QueueManagerStats>>;
    getShardDistribution(queueType: ShardedQueueType): Promise<ShardDistribution[]>;
    checkShardBalance(queueType: ShardedQueueType, maxDeviationPercent?: number): Promise<{
        balanced: boolean;
        overloadedShards: number[];
    }>;
    /**
     * Start periodic Prometheus metrics collection (every 15s).
     */
    private startMetricsCollection;
    getCachedQueueCount(): number;
    isInitialized(): boolean;
    getConnectionStatus(): 'connected' | 'disconnected' | 'connecting';
    shutdown(): Promise<void>;
    pauseAllShards(queueType: ShardedQueueType): Promise<void>;
    resumeAllShards(queueType: ShardedQueueType): Promise<void>;
    drainShard(queueType: ShardedQueueType, shardIndex: number): Promise<void>;
    obliterateShard(queueType: ShardedQueueType, shardIndex: number, options?: {
        force?: boolean;
    }): Promise<void>;
}
declare const queueManager: ShardedQueueManager;
export { queueManager };
export declare function initializeQueueManager(): Promise<void>;
/**
 * Check if the queue manager has been initialized.
 * Useful for metrics collectors that run on a timer.
 */
export declare function isQueueManagerInitialized(): boolean;
export declare function getQueue<T = any>(queueType: ShardedQueueType, shardId: number): Queue<T>;
export declare function getTranscriptQueue(meetingId: string): Queue<TranscriptEventData>;
export declare function getTranslationQueue(meetingId: string): Queue<TranslationJobData>;
export declare function getBroadcastQueue(meetingId: string): Queue<BroadcastEventData>;
export declare function getMinutesQueue(meetingId: string): Queue<MinutesJobData>;
export declare function getAllQueues<T = any>(queueType: ShardedQueueType): Queue<T>[];
export declare function getShardStats(queueType: ShardedQueueType): Promise<QueueManagerStats>;
export declare function submitTranscript(data: TranscriptEventData, options?: {
    priority?: number;
}): Promise<Job<TranscriptEventData>>;
export declare function submitTranslation(data: TranslationJobData, options?: {
    delay?: number;
}): Promise<Job<TranslationJobData>>;
export declare function submitBroadcast(data: BroadcastEventData): Promise<Job<BroadcastEventData>>;
export declare function submitMinutes(data: MinutesJobData, options?: {
    delay?: number;
}): Promise<Job<MinutesJobData>>;
export declare function getDLQ<T = any>(queueType: ShardedQueueType): Queue<T>;
export declare function moveToDeadLetter<T = any>(queueType: ShardedQueueType, job: Job<T>, failureReason: string): Promise<void>;
export declare function getDLQStats(queueType: ShardedQueueType): Promise<{
    waiting: number;
    active: number;
    failed: number;
    completed: number;
}>;
export declare function replayDLQJobs(queueType: ShardedQueueType, count?: number): Promise<number>;
export declare function shutdownQueueManager(): Promise<void>;
export type { Queue, Job, };
//# sourceMappingURL=queue-manager.d.ts.map