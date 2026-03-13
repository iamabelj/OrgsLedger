import Redis, { Cluster } from 'ioredis';
import * as client from 'prom-client';
import { EventEmitter } from 'events';
export type RedisMode = 'standalone' | 'sentinel' | 'cluster';
interface RedisFailoverConfig {
    mode: RedisMode;
    host: string;
    port: number;
    password?: string;
    db: number;
    sentinelNodes: Array<{
        host: string;
        port: number;
    }>;
    sentinelMasterName: string;
    sentinelPassword?: string;
    clusterNodes: Array<{
        host: string;
        port: number;
    }>;
    maxRetriesPerRequest: number | null;
    enableReadyCheck: boolean;
    retryDelayMs: number;
    maxRetryDelayMs: number;
    connectTimeoutMs: number;
    commandTimeoutMs: number;
    healthCheckIntervalMs: number;
}
export declare const redisFailoverModeGauge: client.Gauge<string>;
export declare const redisFailoverConnectedGauge: client.Gauge<string>;
export declare const redisFailoverReconnectsCounter: client.Counter<string>;
export declare const redisFailoverFailoversCounter: client.Counter<string>;
export declare const redisFailoverLatencyHistogram: client.Histogram<string>;
export declare const redisFailoverErrorsCounter: client.Counter<"type">;
export interface RedisHealthStatus {
    connected: boolean;
    mode: RedisMode;
    master?: {
        host: string;
        port: number;
    };
    latencyMs: number;
    uptime: number;
    lastError?: string;
    lastFailover?: Date;
}
export type RedisFailoverEvent = {
    type: 'connected';
} | {
    type: 'disconnected';
    error?: Error;
} | {
    type: 'reconnecting';
    attempt: number;
} | {
    type: 'failover';
    oldMaster: string;
    newMaster: string;
} | {
    type: 'error';
    error: Error;
};
declare class RedisFailoverManager extends EventEmitter {
    private config;
    private connection;
    private healthCheckInterval;
    private isConnected;
    private startTime;
    private lastError?;
    private lastFailover?;
    private reconnectAttempts;
    constructor(config?: Partial<RedisFailoverConfig>);
    /**
     * Create and connect to Redis based on configured mode.
     */
    connect(): Promise<Redis | Cluster>;
    /**
     * Create standalone Redis connection.
     */
    private createStandaloneConnection;
    /**
     * Create Sentinel connection with automatic master discovery.
     */
    private createSentinelConnection;
    /**
     * Create Redis Cluster connection.
     */
    private createClusterConnection;
    /**
     * Retry strategy with exponential backoff.
     */
    private retryStrategy;
    /**
     * Setup event handlers for connection lifecycle.
     */
    private setupEventHandlers;
    /**
     * Wait for the connection to be established.
     */
    private waitForConnection;
    /**
     * Start health check loop.
     */
    private startHealthCheck;
    /**
     * Get current health status.
     */
    getHealthStatus(): Promise<RedisHealthStatus>;
    /**
     * Get the Redis connection.
     */
    getConnection(): Redis | Cluster | null;
    /**
     * Check if connected.
     */
    isRedisConnected(): boolean;
    /**
     * Gracefully disconnect.
     */
    disconnect(): Promise<void>;
    /**
     * Force reconnect (useful for testing failover).
     */
    forceReconnect(): Promise<void>;
}
export declare const redisFailoverManager: RedisFailoverManager;
/**
 * Create a BullMQ-compatible Redis connection with failover support.
 * Use this instead of createBullMQConnection() for HA deployments.
 */
export declare function createFailoverConnection(): Redis | Cluster;
export declare function connectRedisWithFailover(): Promise<Redis | Cluster>;
export declare function disconnectRedis(): Promise<void>;
export declare function getRedisFailoverHealth(): Promise<RedisHealthStatus>;
export declare function isRedisConnected(): boolean;
export declare function onRedisFailoverEvent(callback: (event: RedisFailoverEvent) => void): () => void;
export declare function getRedisConnection(): Redis | Cluster | null;
export {};
//# sourceMappingURL=redis-failover.d.ts.map