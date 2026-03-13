import * as client from 'prom-client';
import { EventEmitter } from 'events';
import { Job } from 'bullmq';
interface QueueLagConfig {
    /** Warning threshold in milliseconds */
    lagWarningMs: number;
    /** Critical threshold in milliseconds */
    lagCriticalMs: number;
    /** How many recent samples to keep for averaging */
    sampleWindowSize: number;
    /** Minimum samples before alerting */
    minSamplesForAlert: number;
    /** Alert cooldown in milliseconds */
    alertCooldownMs: number;
}
export interface QueueLagAlert {
    level: 'warning' | 'critical';
    queueName: string;
    avgLatencyMs: number;
    threshold: number;
    sampleCount: number;
    timestamp: Date;
}
export interface QueueLagStats {
    queueName: string;
    sampleCount: number;
    avgWaitingMs: number;
    avgProcessingMs: number;
    avgTotalMs: number;
    p50TotalMs: number;
    p95TotalMs: number;
    p99TotalMs: number;
    maxTotalMs: number;
}
export declare const queueWaitingLatencyHistogram: client.Histogram<"queue">;
export declare const queueProcessingLatencyHistogram: client.Histogram<"queue">;
export declare const queueTotalLatencyHistogram: client.Histogram<"queue">;
export declare const queueLagGauge: client.Gauge<"queue">;
export declare const queueLagAlertsCounter: client.Counter<"level" | "queue">;
declare class QueueLagMonitor extends EventEmitter {
    private config;
    private samples;
    private lastAlertTime;
    private isRunning;
    constructor(config?: Partial<QueueLagConfig>);
    /**
     * Record a job's latency when it starts processing.
     * Call this at the beginning of your worker processor.
     */
    recordJobStart(job: Job, queueName: string): {
        startTime: number;
        waitingMs: number;
    };
    /**
     * Record a job's complete latency.
     * Call this at the end of your worker processor.
     */
    recordJobComplete(job: Job, queueName: string, startTime: number, waitingMs: number): void;
    /**
     * Add a sample to the rolling window.
     */
    private addSample;
    /**
     * Check if we need to fire alerts for a queue.
     */
    private checkAlerts;
    /**
     * Fire an alert.
     */
    private fireAlert;
    /**
     * Get stats for a specific queue.
     */
    getQueueStats(queueName: string): QueueLagStats | null;
    /**
     * Get stats for all queues.
     */
    getAllQueueStats(): QueueLagStats[];
    /**
     * Calculate percentile from sorted array.
     */
    private percentile;
    /**
     * Reset all samples (useful for testing).
     */
    reset(): void;
}
export declare const queueLagMonitor: QueueLagMonitor;
/**
 * Wraps a BullMQ worker processor to automatically track latency.
 *
 * Usage:
 * ```ts
 * const processor = withLagTracking('transcript', async (job) => {
 *   // your processing logic
 * });
 * new Worker('transcript', processor, { connection });
 * ```
 */
export declare function withLagTracking<T, R>(queueName: string, processor: (job: Job<T>) => Promise<R>): (job: Job<T>) => Promise<R>;
export declare function onQueueLagAlert(callback: (alert: QueueLagAlert) => void): () => void;
export declare function getQueueLagStats(queueName: string): QueueLagStats | null;
export declare function getAllQueueLagStats(): QueueLagStats[];
export {};
//# sourceMappingURL=queue-lag.monitor.d.ts.map