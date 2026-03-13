export interface MeetingMinutes {
    meetingId: string;
    organizationId: string;
    generatedAt: string;
    summary: string;
    keyTopics: string[];
    decisions: string[];
    actionItems: Array<{
        task: string;
        owner?: string;
        deadline?: string;
    }>;
    participants: string[];
    wordCount: number;
    chunksProcessed: number;
}
declare class MinutesWorker {
    private workers;
    private isRunning;
    private processedCount;
    private skippedCount;
    private failedCount;
    initialize(): Promise<void>;
    /**
     * Set up worker event handlers for a shard.
     */
    private setupWorkerEventHandlers;
    /**
     * Process a minutes generation job with idempotency check
     */
    private processMinutesJob;
    /**
     * Check if minutes already exist for this meeting (idempotency)
     */
    private checkExistingMinutes;
    /**
     * Store minutes in database with conflict handling
     */
    private storeMinutes;
    /**
     * Broadcast minutes completion event
     */
    private broadcastCompletion;
    /**
     * Get worker stats
     */
    getStats(): {
        running: boolean;
        processed: number;
        skipped: number;
        failed: number;
        workerId: string;
        workerCount: number;
    };
    /**
     * Gracefully stop all shard workers
     */
    stop(): Promise<void>;
}
export declare function startMinutesWorker(): Promise<void>;
export declare function stopMinutesWorker(): Promise<void>;
export declare function getMinutesWorker(): MinutesWorker | null;
export {};
//# sourceMappingURL=minutes.worker.d.ts.map