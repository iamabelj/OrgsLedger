import { Queue } from 'bullmq';
export interface BroadcastJobData {
    meetingId: string;
    speakerId: string;
    speakerName: string;
    originalText: string;
    sourceLanguage: string;
    translations: Record<string, string>;
    timestamp: string;
    isFinal: boolean;
}
declare class BroadcastQueueManager {
    private queue;
    private initialized;
    /**
     * Initialize broadcast queue
     */
    initialize(): Promise<Queue<BroadcastJobData>>;
    /**
     * Add broadcast job to queue
     */
    add(data: BroadcastJobData): Promise<void>;
    /**
     * Bulk add broadcast jobs
     */
    addBulk(dataArray: BroadcastJobData[]): Promise<void>;
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
    getQueue(): Queue<BroadcastJobData> | null;
    /**
     * Check if initialized
     */
    isInitialized(): boolean;
}
export declare const broadcastQueueManager: BroadcastQueueManager;
/**
 * Helper to ensure queue is initialized
 */
export declare function ensureBroadcastQueue(): Promise<Queue<BroadcastJobData>>;
/**
 * Convenience function to add a broadcast job
 */
export declare function broadcastToQueue(data: BroadcastJobData): Promise<void>;
export {};
//# sourceMappingURL=broadcast.queue.d.ts.map