import { Queue } from 'bullmq';
export interface MinutesJobData {
    meetingId: string;
    organizationId: string;
}
declare class MinutesQueueManager {
    private queue;
    private initialized;
    /**
     * Initialize minutes queue
     */
    initialize(): Promise<Queue<MinutesJobData>>;
    /**
     * Get queue instance
     */
    getQueue(): Queue<MinutesJobData> | null;
    /**
     * Check if queue is initialized
     */
    isInitialized(): boolean;
}
/**
 * Initialize and return the minutes queue
 */
export declare function initializeMinutesQueue(): Promise<Queue<MinutesJobData>>;
/**
 * Submit a minutes generation job to the queue
 */
export declare function submitMinutesJob(data: MinutesJobData): Promise<string>;
/**
 * Get minutes queue manager
 */
export declare function getMinutesQueueManager(): MinutesQueueManager;
export {};
//# sourceMappingURL=minutes.queue.d.ts.map