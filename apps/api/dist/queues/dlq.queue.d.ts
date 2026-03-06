import { Queue } from 'bullmq';
export interface DeadLetterJobData {
    originalQueue: string;
    jobId: string;
    data: any;
    lastError: string;
    failedAt: string;
    attempts: number;
    maxAttempts: number;
}
declare class DeadLetterQueueManager {
    private queue;
    private initialized;
    initialize(): Promise<Queue<DeadLetterJobData>>;
    getQueue(): Queue<DeadLetterJobData> | null;
    isInitialized(): boolean;
}
export declare function initializeDeadLetterQueue(): Promise<Queue<DeadLetterJobData>>;
/**
 * Send a failed job to the dead letter queue
 */
export declare function sendToDeadLetterQueue(originalQueue: string, jobId: string, jobData: any, lastError: string, attempts: number, maxAttempts: number): Promise<void>;
/**
 * Get dead letter jobs for a specific queue
 */
export declare function getDeadLetterJobs(originalQueue?: string): Promise<DeadLetterJobData[]>;
/**
 * Replay a dead letter job back to its original queue
 */
export declare function replayDeadLetterJob(dlqJobId: string, targetQueue: Queue<any>): Promise<boolean>;
export declare function getDeadLetterQueueManager(): DeadLetterQueueManager;
export {};
//# sourceMappingURL=dlq.queue.d.ts.map