export interface WorkerStatus {
    name: string;
    running: boolean;
    processed: number;
    failed: number;
    paused: boolean;
    healthy: boolean;
}
export interface WorkerManagerStatus {
    initialized: boolean;
    workers: WorkerStatus[];
}
declare class WorkerManager {
    private isInitialized;
    private shutdownPromise;
    /**
     * Initialize all workers and queues.
     */
    initialize(): Promise<void>;
    /**
     * Get status of all workers.
     */
    getStatus(): Promise<WorkerManagerStatus>;
    /**
     * Check if all workers are healthy.
     */
    isHealthy(): Promise<boolean>;
    /**
     * Gracefully shutdown all workers.
     */
    shutdown(): Promise<void>;
    private doShutdown;
}
export declare const workerManager: WorkerManager;
export { workerAutoscaler, initializeAutoscaler, startAutoscaler, stopAutoscaler, getAutoscalerStatus, getWorkerCounts, autoscalerWorkersGauge, autoscalerScaleEventsCounter, autoscalerQueueDepthGauge, autoscalerQueueLagGauge, } from './worker-autoscaler';
//# sourceMappingURL=index.d.ts.map