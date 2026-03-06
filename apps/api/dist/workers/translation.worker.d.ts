declare class TranslationWorker {
    private worker;
    private isRunning;
    /**
     * Initialize translation worker
     */
    initialize(): Promise<void>;
    /**
     * Process a single transcript job
     */
    private processTranscript;
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
     * Pause worker (stop processing new jobs)
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
     * Check if worker is running
     */
    isHealthy(): boolean;
}
export declare const translationWorker: TranslationWorker;
/**
 * Initialize and start translation worker
 */
export declare function startTranslationWorker(): Promise<void>;
/**
 * Gracefully shutdown translation worker
 */
export declare function stopTranslationWorker(): Promise<void>;
export {};
//# sourceMappingURL=translation.worker.d.ts.map