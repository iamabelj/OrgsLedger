import Redis, { Cluster } from 'ioredis';
import * as client from 'prom-client';
/**
 * Number of shards for meeting data distribution
 */
export declare const REDIS_SHARD_COUNT: number;
/**
 * Shard mode: cluster (Redis Cluster), multi (multiple standalone), standalone
 */
export declare const REDIS_SHARD_MODE: "cluster" | "multi" | "standalone";
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
    ttl?: number;
    nx?: boolean;
    xx?: boolean;
}
export declare const redisShardMemoryUsageGauge: client.Gauge<"node" | "shard">;
export declare const redisShardKeysGauge: client.Gauge<"shard">;
export declare const redisShardOpsCounter: client.Counter<"shard" | "operation">;
export declare const redisShardLatencyHistogram: client.Histogram<"operation">;
/**
 * Get shard index for a meeting ID
 */
export declare function getMeetingShardIndex(meetingId: string): number;
/**
 * Build Redis key for meeting data
 * Pattern: meeting:{shard}:{meetingId}
 */
export declare function getMeetingKey(meetingId: string, suffix?: string): string;
declare class RedisShardRouter {
    private mode;
    private shardCount;
    private nodes;
    private nodeConfigs;
    private cluster;
    private isInitialized;
    private initPromise;
    private memoryMonitorInterval;
    constructor();
    /**
     * Initialize Redis connections
     */
    initialize(): Promise<void>;
    private doInitialize;
    private initializeCluster;
    private initializeNodes;
    /**
     * Get Redis client for a specific meeting
     * Routes to the correct shard based on meeting ID
     */
    getMeetingRedisClient(meetingId: string): Redis | Cluster;
    /**
     * Set meeting data
     */
    setMeetingData(meetingId: string, data: MeetingData, options?: SetOptions): Promise<boolean>;
    /**
     * Get meeting data
     */
    getMeetingData(meetingId: string): Promise<MeetingData | null>;
    /**
     * Delete meeting data
     */
    deleteMeetingData(meetingId: string): Promise<boolean>;
    /**
     * Set a specific field in meeting data (hash field)
     */
    setMeetingField(meetingId: string, field: string, value: any, ttl?: number): Promise<void>;
    /**
     * Get a specific field from meeting data (hash field)
     */
    getMeetingField(meetingId: string, field: string): Promise<any>;
    /**
     * Get all meeting hash fields
     */
    getMeetingAllFields(meetingId: string): Promise<Record<string, any> | null>;
    /**
     * Check if meeting data exists
     */
    meetingExists(meetingId: string): Promise<boolean>;
    /**
     * Set TTL on meeting data
     */
    setMeetingTTL(meetingId: string, ttlSeconds: number): Promise<boolean>;
    /**
     * Append to meeting list (e.g., transcripts, events)
     */
    appendToMeetingList(meetingId: string, listName: string, value: any, maxLength?: number): Promise<number>;
    /**
     * Get meeting list items
     */
    getMeetingList(meetingId: string, listName: string, start?: number, end?: number): Promise<any[]>;
    /**
     * Get meeting list length
     */
    getMeetingListLength(meetingId: string, listName: string): Promise<number>;
    /**
     * Start memory monitoring for shards
     */
    private startMemoryMonitoring;
    /**
     * Collect memory metrics from all nodes
     */
    private collectMemoryMetrics;
    /**
     * Collect key statistics per shard
     */
    private collectShardKeyStats;
    /**
     * Parse Redis INFO output for a specific value
     */
    private parseRedisInfoValue;
    /**
     * Get router statistics
     */
    getStats(): Promise<ShardRouterStats>;
    /**
     * Get shard distribution stats (for debugging)
     */
    getShardDistribution(sampleMeetingIds: string[]): Map<number, string[]>;
    /**
     * Shutdown all connections
     */
    shutdown(): Promise<void>;
}
declare const redisShardRouter: RedisShardRouter;
export { redisShardRouter };
/**
 * Initialize the shard router
 */
export declare function initializeRedisShardRouter(): Promise<void>;
/**
 * Get Redis client for a specific meeting
 */
export declare function getMeetingRedisClient(meetingId: string): Redis | Cluster;
/**
 * Set meeting data with optional TTL
 */
export declare function setMeetingData(meetingId: string, data: MeetingData, options?: SetOptions): Promise<boolean>;
/**
 * Get meeting data
 */
export declare function getMeetingData(meetingId: string): Promise<MeetingData | null>;
/**
 * Delete meeting data
 */
export declare function deleteMeetingData(meetingId: string): Promise<boolean>;
/**
 * Set meeting hash field
 */
export declare function setMeetingField(meetingId: string, field: string, value: any, ttl?: number): Promise<void>;
/**
 * Get meeting hash field
 */
export declare function getMeetingField(meetingId: string, field: string): Promise<any>;
/**
 * Get all meeting hash fields
 */
export declare function getMeetingAllFields(meetingId: string): Promise<Record<string, any> | null>;
/**
 * Check if meeting exists
 */
export declare function meetingExists(meetingId: string): Promise<boolean>;
/**
 * Set meeting TTL
 */
export declare function setMeetingTTL(meetingId: string, ttlSeconds: number): Promise<boolean>;
/**
 * Append to meeting list
 */
export declare function appendToMeetingList(meetingId: string, listName: string, value: any, maxLength?: number): Promise<number>;
/**
 * Get meeting list
 */
export declare function getMeetingList(meetingId: string, listName: string, start?: number, end?: number): Promise<any[]>;
/**
 * Get meeting list length
 */
export declare function getMeetingListLength(meetingId: string, listName: string): Promise<number>;
/**
 * Get router statistics
 */
export declare function getRedisShardStats(): Promise<ShardRouterStats>;
/**
 * Shutdown router
 */
export declare function shutdownRedisShardRouter(): Promise<void>;
//# sourceMappingURL=redisShardRouter.d.ts.map