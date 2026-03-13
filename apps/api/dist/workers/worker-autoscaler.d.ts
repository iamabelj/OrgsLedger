import { ChildProcess } from 'child_process';
import * as client from 'prom-client';
import { ShardedQueueType } from '../queues/queue-manager';
interface AutoscalerConfig {
    /** Check interval in milliseconds */
    checkIntervalMs: number;
    /** High watermark - spawn workers when waiting jobs exceed this */
    highWatermark: number;
    /** Low watermark - scale down when waiting jobs drop below this */
    lowWatermark: number;
    /** Number of consecutive low readings before scale down */
    scaleDownChecks: number;
    /** Minimum workers per worker type */
    minWorkersPerType: number;
    /** Maximum workers per worker type */
    maxWorkersPerType: number;
    /** Cooldown after spawn (ms) - prevent rapid scaling */
    spawnCooldownMs: number;
    /** Worker startup timeout (ms) */
    workerStartupTimeoutMs: number;
}
interface WorkerInfo {
    id: string;
    workerType: ShardedQueueType;
    shardIndex: number;
    process: ChildProcess;
    startedAt: Date;
    status: 'starting' | 'running' | 'stopping' | 'stopped';
    lastHealthCheck: Date;
    processedJobs: number;
    failedJobs: number;
}
export declare const autoscalerWorkersGauge: client.Gauge<"status" | "worker_type">;
export declare const autoscalerScaleEventsCounter: client.Counter<"action" | "worker_type">;
export declare const autoscalerQueueDepthGauge: client.Gauge<"queue_type">;
export declare const autoscalerQueueLagGauge: client.Gauge<"queue_type">;
declare class WorkerAutoscaler {
    private config;
    private workers;
    private lowWatermarkCounts;
    private lastSpawnTime;
    private checkInterval;
    private isRunning;
    private initialized;
    constructor(config?: Partial<AutoscalerConfig>);
    /**
     * Initialize the autoscaler and start workers.
     */
    initialize(): Promise<void>;
    /**
     * Spawn minimum required workers for each queue type.
     */
    private spawnMinimumWorkers;
    /**
     * Start the autoscaler loop.
     */
    start(): void;
    /**
     * Stop the autoscaler and gracefully terminate workers.
     */
    stop(): Promise<void>;
    /**
     * Run a single scaling check across all queue types.
     */
    private runScalingCheck;
    /**
     * Get snapshots of all queue depths.
     */
    private getQueueSnapshots;
    /**
     * Make a scaling decision based on queue snapshot.
     */
    private makeScalingDecision;
    /**
     * Execute a scaling decision.
     */
    private executeScalingDecision;
    /**
     * Spawn a new worker process.
     */
    spawnWorker(queueType: ShardedQueueType, shardIndex: number): Promise<void>;
    /**
     * Stop a worker process gracefully.
     */
    stopWorker(workerId: string): Promise<void>;
    /**
     * Handle messages from worker processes.
     */
    private handleWorkerMessage;
    /**
     * Handle worker process exit.
     */
    private handleWorkerExit;
    /**
     * Get worker count for a specific queue type.
     */
    private getWorkerCountForType;
    /**
     * Find an available shard for spawning a new worker.
     */
    private findAvailableShard;
    /**
     * Find a worker to stop (prefer workers with highest shard duplication).
     */
    private findWorkerToStop;
    /**
     * Generate unique worker key for tracking.
     */
    private getWorkerKey;
    /**
     * Update Prometheus metrics for worker counts.
     */
    private updateWorkerMetrics;
    /**
     * Get autoscaler status.
     */
    getStatus(): {
        isRunning: boolean;
        workers: Array<Omit<WorkerInfo, 'process'>>;
        config: AutoscalerConfig;
    };
    /**
     * Get worker count summary.
     */
    getWorkerCounts(): Record<ShardedQueueType, number>;
}
export declare const workerAutoscaler: WorkerAutoscaler;
export declare function initializeAutoscaler(): Promise<void>;
export declare function startAutoscaler(): void;
export declare function stopAutoscaler(): Promise<void>;
export declare function getAutoscalerStatus(): ReturnType<WorkerAutoscaler['getStatus']>;
export declare function getWorkerCounts(): ReturnType<WorkerAutoscaler['getWorkerCounts']>;
export {};
//# sourceMappingURL=worker-autoscaler.d.ts.map