import { RedisClientType } from 'redis';
export interface SocketRedisClients {
    pubClient: RedisClientType;
    subClient: RedisClientType;
}
export interface SocketRedisHealth {
    connected: boolean;
    pubConnected: boolean;
    subConnected: boolean;
    latencyMs: number | null;
    lastReconnectAttempt: Date | null;
    reconnectAttempts: number;
}
declare const WORKER_ID: string;
/**
 * Initialize Redis pub/sub clients for Socket.IO adapter.
 * Must be called before attaching adapter to Socket.IO server.
 */
export declare function initializeSocketRedis(): Promise<SocketRedisClients>;
/**
 * Check health of Socket.IO Redis connections.
 */
export declare function getSocketRedisHealth(): Promise<SocketRedisHealth>;
/**
 * Get the publisher client (throws if not initialized).
 */
export declare function getPublisher(): RedisClientType;
/**
 * Get the subscriber client (throws if not initialized).
 */
export declare function getSubscriber(): RedisClientType;
/**
 * Check if Socket.IO Redis is initialized.
 */
export declare function isSocketRedisInitialized(): boolean;
/**
 * Gracefully shut down Redis connections.
 */
export declare function shutdownSocketRedis(): Promise<void>;
export { WORKER_ID };
//# sourceMappingURL=socket-redis.d.ts.map