import { Queue } from 'bullmq';
export interface ProcessingJobData {
    meetingId: string;
    speakerId: string;
    originalText: string;
    sourceLanguage: string;
    targetLanguages: string[];
    isFinal: boolean;
    organizationId?: string;
    chunkIndex?: number;
}
declare class ProcessingQueueManager {
    private queue;
    private initialized;
    /**
     * Initialize processing queue
     */
    initialize(): Promise<Queue<ProcessingJobData>>;
    /**
     * Add processing job to queue
     */
    add(data: ProcessingJobData): Promise<string>;
    /**
     * Bulk add processing jobs
     */
    addBulk(dataArray: ProcessingJobData[]): Promise<string[]>;
    /**
     * Get queue status
     */
    getStatus(): Promise<{
        size: number;
        activeCount: number;
        waitingCount: number;
        failedCount: number;
        delayedCount: number;
    }>;
    /**
     * Clear all jobs
     */
    clear(): Promise<void>;
    /**
     * Close queue connection
     */
    close(): Promise<void>;
    /**
     * Get queue instance
     */
    getQueue(): Queue<ProcessingJobData> | null;
    /**
     * Check if initialized
     */
    isInitialized(): boolean;
}
export declare const processingQueueManager: ProcessingQueueManager;
/**
 * Helper to ensure queue is initialized
 */
export declare function ensureProcessingQueue(): Promise<Queue<ProcessingJobData>>;
/**
 * Convenience function to add a processing job
 */
export declare function submitProcessingJob(data: ProcessingJobData): Promise<string>;
export {};
//# sourceMappingURL=processing.queue.d.ts.map