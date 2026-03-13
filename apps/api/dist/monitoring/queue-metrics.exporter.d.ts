import * as client from 'prom-client';
import { ShardedQueueType, QueueManagerStats } from '../queues/queue-manager';
export declare const queueWaitingJobsSharded: client.Gauge<"queue" | "shard">;
export declare const queueActiveJobsSharded: client.Gauge<"queue" | "shard">;
export declare const queueCompletedJobsSharded: client.Gauge<"queue" | "shard">;
export declare const queueFailedJobsSharded: client.Gauge<"queue" | "shard">;
export declare const queueDelayedJobsSharded: client.Gauge<"queue" | "shard">;
export declare const queueCollectionDurationMs: client.Histogram<string>;
export declare const queueCollectionErrorsTotal: client.Counter<"queue">;
export declare class QueueMetricsExporter {
    private collectionInterval;
    private isCollecting;
    private lastCollectionTime;
    private lastStats;
    /**
     * Start periodic metrics collection
     */
    start(): void;
    /**
     * Stop periodic metrics collection
     */
    stop(): void;
    /**
     * Collect metrics from all sharded queues
     */
    collectMetrics(): Promise<void>;
    /**
     * Collect metrics for a single queue type
     */
    private collectQueueTypeMetrics;
    /**
     * Get last collected stats for all queue types
     */
    getLastStats(): Map<ShardedQueueType, QueueManagerStats>;
    /**
     * Get aggregated stats summary
     */
    getStatsSummary(): {
        byQueue: Record<string, {
            waiting: number;
            active: number;
            failed: number;
            delayed: number;
        }>;
        totals: {
            waiting: number;
            active: number;
            failed: number;
            delayed: number;
        };
        lastCollectionTime: number;
    };
    /**
     * Force immediate collection (for testing/debugging)
     */
    forceCollection(): Promise<void>;
    /**
     * Check if exporter is running
     */
    isRunning(): boolean;
    /**
     * Get detailed stats for a specific queue type
     */
    getQueueStats(queueType: ShardedQueueType): QueueManagerStats | undefined;
}
/**
 * Get or create the queue metrics exporter singleton
 */
export declare function getQueueMetricsExporter(): QueueMetricsExporter;
/**
 * Start the queue metrics exporter
 */
export declare function startQueueMetricsExporter(): QueueMetricsExporter;
/**
 * Stop the queue metrics exporter
 */
export declare function stopQueueMetricsExporter(): void;
import { Router } from 'express';
/**
 * Create Express router for queue metrics API endpoint
 * GET /api/system/queue-metrics - Get queue stats summary
 */
export declare function createQueueMetricsRouter(): Router;
declare const _default: {
    QueueMetricsExporter: typeof QueueMetricsExporter;
    getQueueMetricsExporter: typeof getQueueMetricsExporter;
    startQueueMetricsExporter: typeof startQueueMetricsExporter;
    stopQueueMetricsExporter: typeof stopQueueMetricsExporter;
    createQueueMetricsRouter: typeof createQueueMetricsRouter;
};
export default _default;
//# sourceMappingURL=queue-metrics.exporter.d.ts.map