import { Queue } from 'bullmq';
export interface TranscriptJobData {
    meetingId: string;
    speakerId: string;
    speakerName: string;
    originalText: string;
    language: string;
    confidence: number;
    timestamp: Date;
    isFinal: boolean;
}
declare class TranscriptQueueManager {
    private queue;
    private initialized;
    /**
     * Initialize transcript queue
     */
    initialize(): Promise<Queue<TranscriptJobData>>;
    /**
     * Add transcript job to queue
     */
    add(data: TranscriptJobData): Promise<void>;
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
     * Clear all jobs (use with caution)
     */
    clear(): Promise<void>;
    /**
     * Close queue connection
     */
    close(): Promise<void>;
    /**
     * Get queue instance
     */
    getQueue(): Queue<TranscriptJobData> | null;
    /**
     * Check if initialized
     */
    isInitialized(): boolean;
}
export declare const transcriptQueueManager: TranscriptQueueManager;
/**
 * Helper to ensure queue is initialized
 */
export declare function ensureTranscriptQueue(): Promise<Queue<TranscriptJobData>>;
export {};
//# sourceMappingURL=transcript.queue.d.ts.map