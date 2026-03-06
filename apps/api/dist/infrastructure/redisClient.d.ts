import Redis from 'ioredis';
interface RedisConfig {
    host: string;
    port: number;
    password?: string;
    db?: number;
    lazyConnect?: boolean;
    retryStrategy?: (times: number) => number;
    reconnectOnError?: (err: Error) => boolean;
}
declare class RedisClientManager {
    private client;
    private config;
    private connectionPromise;
    constructor();
    /**
     * Get Redis client instance (lazy-initialized)
     */
    getInstance(): Promise<Redis>;
    /**
     * Establish Redis connection with event handlers
     */
    private connect;
    /**
     * Get sync client (for non-async contexts, use with caution)
     */
    getSync(): Redis;
    /**
     * Health check
     */
    ping(): Promise<boolean>;
    /**
     * Get connection statistics
     */
    getStatus(): Promise<{
        connected: boolean;
        status?: string;
        mode?: string;
        error?: string;
    }>;
    /**
     * Graceful shutdown
     */
    disconnect(): Promise<void>;
    /**
     * Get raw client info (for advanced use)
     */
    getClient(): Redis | null;
}
export declare const redisClientManager: RedisClientManager;
/**
 * Helper for concurrent operations
 */
export declare function withRedis<T>(callback: (redis: Redis) => Promise<T>): Promise<T>;
/**
 * Get the singleton instance
 */
export declare function getRedisClient(): Promise<Redis>;
/**
 * Create a new Redis connection specifically for BullMQ workers.
 * BullMQ requires maxRetriesPerRequest: null for blocking commands.
 * Each worker should call this to get its own dedicated connection.
 */
export declare function createBullMQConnection(): Redis;
export { Redis, RedisConfig };
//# sourceMappingURL=redisClient.d.ts.map