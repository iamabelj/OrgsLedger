import { MinutesWorkerService } from '../services/workers/minutesWorker.service';
declare class MinutesWorker {
    private worker;
    private minutesService;
    private isRunning;
    private processedCount;
    private failedCount;
    /**
     * Initialize minutes worker
     */
    initialize(minutesService: MinutesWorkerService): Promise<void>;
    /**
     * Process a single minutes job
     */
    private processMinutesJob;
    /**
     * Stop the worker
     */
    stop(): Promise<void>;
    /**
     * Pause the worker (stop accepting new jobs but finish current ones)
     */
    pause(): Promise<void>;
    /**
     * Resume the worker (start accepting new jobs again)
     */
    resume(): Promise<void>;
    /**
     * Get worker health status
     */
    getStatus(): Promise<{
        running: boolean;
        processed: number;
        failed: number;
    }>;
    /**
     * Check if worker is healthy
     */
    isHealthy(): boolean;
}
/**
 * Start the minutes worker
 */
export declare function startMinutesWorker(minutesService: MinutesWorkerService): Promise<void>;
/**
 * Stop the minutes worker
 */
export declare function stopMinutesWorker(): Promise<void>;
/**
 * Get minutes worker instance
 */
export declare function getMinutesWorker(): MinutesWorker;
export {};
//# sourceMappingURL=minutes.worker.d.ts.map