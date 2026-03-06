import { ProcessingWorker as IProcessingWorkerService } from '../services/workers/processingWorker.service';
declare class ProcessingWorker {
    private worker;
    private processingService;
    private isRunning;
    /**
     * Initialize processing worker
     */
    initialize(processingService: IProcessingWorkerService): Promise<void>;
    /**
     * Process translation job
     */
    private processTranslation;
    /**
     * Get worker status
     */
    getStatus(): Promise<{
        running: boolean;
        processed: number;
        failed: number;
        paused: boolean;
    }>;
    /**
     * Pause worker
     */
    pause(): Promise<void>;
    /**
     * Resume worker
     */
    resume(): Promise<void>;
    /**
     * Close worker gracefully
     */
    close(): Promise<void>;
    /**
     * Check if worker is healthy
     */
    isHealthy(): boolean;
}
export declare const processingWorker: ProcessingWorker;
/**
 * Initialize and start processing worker
 */
export declare function startProcessingWorker(processingService: IProcessingWorkerService): Promise<void>;
/**
 * Gracefully shutdown processing worker
 */
export declare function stopProcessingWorker(): Promise<void>;
export {};
//# sourceMappingURL=processing.worker.d.ts.map