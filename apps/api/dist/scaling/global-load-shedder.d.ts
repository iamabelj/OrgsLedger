import { RequestHandler } from 'express';
import * as client from 'prom-client';
export interface LoadShedderConfig {
    /** Maximum active meetings before shedding */
    maxActiveMeetings: number;
    /** Maximum queue latency in ms before shedding */
    maxQueueLatencyMs: number;
    /** Maximum WebSocket connections before shedding */
    maxWsConnections: number;
    /** Maximum Redis memory usage (0-1) before shedding */
    maxRedisMemoryUsage: number;
    /** How often to refresh metrics (ms) */
    refreshIntervalMs: number;
    /** Enable load shedding */
    enabled: boolean;
    /** Paths to protect (regex patterns) */
    protectedPaths: RegExp[];
}
export interface SystemPressure {
    activeMeetings: number;
    queueLatencyMs: number;
    wsConnections: number;
    redisMemoryUsage: number;
    timestamp: Date;
}
export interface LoadShedderStatus {
    shedding: boolean;
    reason?: string;
    pressure: SystemPressure;
    thresholds: {
        maxActiveMeetings: number;
        maxQueueLatencyMs: number;
        maxWsConnections: number;
        maxRedisMemoryUsage: number;
    };
}
export declare const loadShedderRejectionsCounter: client.Counter<"path" | "reason">;
export declare const loadShedderSheddingGauge: client.Gauge<string>;
export declare const loadShedderActiveMeetingsGauge: client.Gauge<string>;
export declare const loadShedderQueueLatencyGauge: client.Gauge<string>;
export declare const loadShedderWsConnectionsGauge: client.Gauge<string>;
export declare const loadShedderRedisMemoryGauge: client.Gauge<string>;
declare class GlobalLoadShedder {
    private config;
    private redis;
    private pressure;
    private refreshInterval;
    private isRunning;
    constructor(config?: Partial<LoadShedderConfig>);
    /**
     * Initialize and start the load shedder.
     */
    start(): Promise<void>;
    /**
     * Stop the load shedder.
     */
    stop(): void;
    /**
     * Refresh system pressure metrics.
     */
    private refreshPressure;
    /**
     * Parse Redis memory usage from INFO memory response.
     */
    private parseRedisMemoryUsage;
    /**
     * Check if any pressure threshold is exceeded.
     */
    private checkPressure;
    /**
     * Check if a request should be shed.
     */
    shouldShed(path: string, method: string): {
        shed: boolean;
        reason?: string;
    };
    /**
     * Get current status.
     */
    getStatus(): LoadShedderStatus;
    /**
     * Report WebSocket connection count (called by socket.ts).
     */
    reportWsConnections(count: number): Promise<void>;
    /**
     * Report queue latency (called by queue-lag.monitor).
     */
    reportQueueLatency(latencyMs: number): Promise<void>;
}
export declare const globalLoadShedder: GlobalLoadShedder;
/**
 * Create Express middleware for load shedding.
 *
 * Usage:
 * ```ts
 * import { createLoadShedderMiddleware } from './scaling/global-load-shedder';
 * app.use(createLoadShedderMiddleware());
 * ```
 */
export declare function createLoadShedderMiddleware(): RequestHandler;
export declare function startLoadShedder(): Promise<void>;
export declare function stopLoadShedder(): void;
export declare function getLoadShedderStatus(): LoadShedderStatus;
export declare function reportWsConnections(count: number): Promise<void>;
export declare function reportQueueLatency(latencyMs: number): Promise<void>;
export {};
//# sourceMappingURL=global-load-shedder.d.ts.map