import Redis, { Cluster } from 'ioredis';
interface RedisConfig {
    host: string;
    port: number;
    password?: string;
    db?: number;
}
declare class RedisClientManager {
    /** Primary client for general use (get/set, pipeline, etc.) */
    private client;
    private connectionPromise;
    /** Dedicated subscriber client (Redis requires a separate connection for subscriptions) */
    private subClient;
    private subPromise;
    /** Dedicated publisher client */
    private pubClient;
    private pubPromise;
    /** Pool of connections available for BullMQ workers and high-concurrency paths */
    private pool;
    private poolIdx;
    /** Track cluster mode */
    private isCluster;
    private standaloneConfig;
    private clusterNodes;
    constructor();
    private createStandaloneClient;
    private createClusterClient;
    private createClient;
    /** Connect a client and wait for "ready" with a timeout. */
    private waitForReady;
    getInstance(): Promise<Redis | Cluster>;
    /**
     * Synchronous access to the already-connected client.
     * Throws if not yet initialized — call `getInstance()` first.
     */
    getSync(): Redis | Cluster;
    /**
     * Get a pooled connection (round-robin).
     * Pool is lazily filled up to MAX_POOL_SIZE.
     */
    getPooled(): Promise<Redis | Cluster>;
    getPublisher(): Promise<Redis | Cluster>;
    getSubscriber(): Promise<Redis | Cluster>;
    ping(): Promise<boolean>;
    getStatus(): Promise<{
        connected: boolean;
        mode: 'cluster' | 'standalone';
        status?: string;
        poolSize: number;
        error?: string;
    }>;
    healthCheck(): Promise<{
        healthy: boolean;
        latencyMs: number;
        mode: 'cluster' | 'standalone';
        poolSize: number;
    }>;
    disconnect(): Promise<void>;
    /**
     * Get raw client reference (advanced use only).
     */
    getClient(): Redis | Cluster | null;
}
export declare const redisClientManager: RedisClientManager;
/**
 * Get the singleton Redis client (lazy-initialized, waits for ready).
 * Used by queues, monitoring, services.
 */
export declare function getRedisClient(): Promise<Redis | Cluster>;
/**
 * Run a callback with a Redis client.
 */
export declare function withRedis<T>(callback: (redis: Redis | Cluster) => Promise<T>): Promise<T>;
/**
 * Publish a JSON payload to a Redis channel.
 */
export declare function publish(channel: string, payload: unknown): Promise<void>;
/**
 * Subscribe to a Redis channel. Returns an unsubscribe function.
 * Automatically uses the dedicated subscriber connection.
 */
export declare function subscribe(channel: string, onMessage: (message: string, channel: string) => void): Promise<() => Promise<void>>;
/**
 * Get a value by key. Returns null if not found.
 */
export declare function get(key: string): Promise<string | null>;
/**
 * Set a key/value. Optionally provide TTL in seconds.
 */
export declare function set(key: string, value: string, ttlSeconds?: number): Promise<void>;
/**
 * Create a new Redis connection optimized for BullMQ workers.
 * BullMQ requires `maxRetriesPerRequest: null` for blocking commands.
 * Each worker should call this to get its own dedicated connection.
 */
export declare function createBullMQConnection(): Redis;
export { Redis, Cluster };
export type { RedisConfig };
//# sourceMappingURL=redisClient.d.ts.map