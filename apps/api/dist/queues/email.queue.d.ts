import { Queue } from 'bullmq';
export interface EmailJobData {
    recipientEmail: string;
    recipientName?: string;
    emailType: 'reminder' | 'alert' | 'subscription' | 'transactional';
    subject: string;
    htmlBody: string;
    textBody?: string;
    organizationId?: string;
    retries?: number;
}
declare class EmailQueueManager {
    private queue;
    private initialized;
    initialize(): Promise<Queue<EmailJobData>>;
    getQueue(): Queue<EmailJobData> | null;
    isInitialized(): boolean;
}
export declare function initializeEmailQueue(): Promise<Queue<EmailJobData>>;
export declare function submitEmailJob(data: EmailJobData): Promise<string>;
export declare function getEmailQueueManager(): EmailQueueManager;
export {};
//# sourceMappingURL=email.queue.d.ts.map