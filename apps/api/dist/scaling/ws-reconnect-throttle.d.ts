import * as client from 'prom-client';
import { EventEmitter } from 'events';
interface ReconnectThrottleConfig {
    /** Max connections per second per IP */
    maxConnectionsPerSecond: number;
    /** Max connections per second globally */
    maxGlobalConnectionsPerSecond: number;
    /** Window size in milliseconds */
    windowMs: number;
    /** Block duration when rate exceeded */
    blockDurationMs: number;
    /** Enable graceful shutdown support */
    gracefulShutdown: boolean;
}
export declare const wsConnectionAttemptsCounter: client.Counter<string>;
export declare const wsConnectionsAcceptedCounter: client.Counter<string>;
export declare const wsConnectionsThrottledCounter: client.Counter<"reason">;
export declare const wsConnectionRateGauge: client.Gauge<string>;
export declare const wsActiveConnectionsGauge: client.Gauge<string>;
export declare const wsGracefulDisconnectCounter: client.Counter<string>;
export interface ThrottleResult {
    allowed: boolean;
    reason?: 'ip_rate_limit' | 'global_rate_limit' | 'ip_blocked' | 'server_draining';
    retryAfterMs?: number;
}
declare class ReconnectThrottle extends EventEmitter {
    private config;
    private ipWindows;
    private globalTimestamps;
    private isDraining;
    private activeConnections;
    private cleanupInterval;
    constructor(config?: Partial<ReconnectThrottleConfig>);
    /**
     * Start the throttle cleanup loop.
     */
    start(): void;
    /**
     * Stop the throttle.
     */
    stop(): void;
    /**
     * Check if a connection from the given IP should be allowed.
     */
    checkConnection(ip: string): ThrottleResult;
    /**
     * Record a connection being established.
     */
    connectionEstablished(): void;
    /**
     * Record a connection being closed.
     */
    connectionClosed(): void;
    /**
     * Start graceful drain (for server shutdown).
     * Sends disconnect messages to all clients with retry hints.
     */
    startDrain(io: any): Promise<void>;
    /**
     * Stop draining.
     */
    stopDrain(): void;
    /**
     * Clean up old entries.
     */
    private cleanup;
    /**
     * Get current stats.
     */
    getStats(): {
        activeConnections: number;
        connectionRate: number;
        blockedIPs: number;
        isDraining: boolean;
    };
}
export declare const reconnectThrottle: ReconnectThrottle;
/**
 * Socket.IO middleware to throttle connections.
 *
 * Usage:
 * ```ts
 * import { createThrottleMiddleware } from './scaling/ws-reconnect-throttle';
 * io.use(createThrottleMiddleware());
 * ```
 */
export declare function createThrottleMiddleware(): (socket: any, next: (err?: Error) => void) => void;
/**
 * Recommended client Socket.IO configuration.
 * Export this for documentation or client-side usage.
 */
export declare const RECOMMENDED_CLIENT_CONFIG: {
    reconnectionDelay: number;
    reconnectionDelayMax: number;
    randomizationFactor: number;
    timeout: number;
    reconnectionAttempts: number;
    transports: string[];
};
export declare function startReconnectThrottle(): void;
export declare function stopReconnectThrottle(): void;
export declare function checkConnection(ip: string): ThrottleResult;
export declare function startGracefulDrain(io: any): Promise<void>;
export declare function getReconnectThrottleStats(): {
    activeConnections: number;
    connectionRate: number;
    blockedIPs: number;
    isDraining: boolean;
};
export {};
//# sourceMappingURL=ws-reconnect-throttle.d.ts.map