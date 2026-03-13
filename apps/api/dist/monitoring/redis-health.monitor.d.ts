import * as client from 'prom-client';
import { EventEmitter } from 'events';
interface RedisHealthConfig {
    /** Check interval in milliseconds */
    checkIntervalMs: number;
    /** Memory usage warning threshold (0-1) */
    memoryWarningThreshold: number;
    /** Memory usage critical threshold (0-1) */
    memoryCriticalThreshold: number;
    /** Fragmentation ratio warning threshold */
    fragmentationWarningThreshold: number;
    /** Enable eviction alerts */
    alertOnEviction: boolean;
}
export interface RedisMemoryInfo {
    usedMemory: number;
    usedMemoryHuman: string;
    usedMemoryPeak: number;
    usedMemoryPeakHuman: string;
    maxMemory: number;
    maxMemoryHuman: string;
    memoryUsagePercent: number;
    fragmentationRatio: number;
    evictedKeys: number;
}
export interface RedisClientInfo {
    connectedClients: number;
    blockedClients: number;
    clientRecentMaxInputBuffer: number;
    clientRecentMaxOutputBuffer: number;
}
export interface RedisStatsInfo {
    totalConnectionsReceived: number;
    totalCommandsProcessed: number;
    instantaneousOpsPerSec: number;
    keyspaceHits: number;
    keyspaceMisses: number;
    hitRate: number;
}
export interface RedisHealthReport {
    timestamp: Date;
    status: 'healthy' | 'warning' | 'critical';
    memory: RedisMemoryInfo;
    clients: RedisClientInfo;
    stats: RedisStatsInfo;
    alerts: RedisHealthAlert[];
}
export interface RedisHealthAlert {
    level: 'warning' | 'critical';
    type: 'memory_pressure' | 'eviction' | 'fragmentation' | 'blocked_clients';
    message: string;
    value: number;
    threshold: number;
}
export declare const redisMemoryUsedGauge: client.Gauge<string>;
export declare const redisMemoryMaxGauge: client.Gauge<string>;
export declare const redisMemoryUsageGauge: client.Gauge<string>;
export declare const redisEvictedKeysGauge: client.Gauge<string>;
export declare const redisFragmentationGauge: client.Gauge<string>;
export declare const redisConnectedClientsGauge: client.Gauge<string>;
export declare const redisBlockedClientsGauge: client.Gauge<string>;
export declare const redisOpsPerSecGauge: client.Gauge<string>;
export declare const redisHitRateGauge: client.Gauge<string>;
export declare const redisHealthAlertsCounter: client.Counter<"level" | "type">;
declare class RedisHealthMonitor extends EventEmitter {
    private config;
    private redis;
    private checkInterval;
    private lastReport;
    private previousEvictedKeys;
    private isRunning;
    constructor(config?: Partial<RedisHealthConfig>);
    /**
     * Initialize and start monitoring.
     */
    start(): Promise<void>;
    /**
     * Stop monitoring.
     */
    stop(): void;
    /**
     * Run a single health check.
     */
    runHealthCheck(): Promise<RedisHealthReport>;
    /**
     * Get memory information from Redis INFO.
     */
    private getMemoryInfo;
    /**
     * Get client information from Redis INFO.
     */
    private getClientsInfo;
    /**
     * Get stats information from Redis INFO.
     */
    private getStatsInfo;
    /**
     * Evaluate alerts based on metrics.
     */
    private evaluateAlerts;
    /**
     * Update Prometheus metrics.
     */
    private updateMetrics;
    /**
     * Parse Redis INFO response into key-value object.
     */
    private parseRedisInfo;
    /**
     * Format bytes to human-readable string.
     */
    private formatBytes;
    /**
     * Get the last health report.
     */
    getLastReport(): RedisHealthReport | null;
    /**
     * Check if monitor is running.
     */
    isMonitorRunning(): boolean;
}
export declare const redisHealthMonitor: RedisHealthMonitor;
export declare function startRedisHealthMonitor(): Promise<void>;
export declare function stopRedisHealthMonitor(): void;
export declare function getRedisHealthReport(): Promise<RedisHealthReport>;
export declare function getLastRedisHealthReport(): RedisHealthReport | null;
export declare function onRedisHealthAlert(callback: (alert: RedisHealthAlert) => void): () => void;
export {};
//# sourceMappingURL=redis-health.monitor.d.ts.map