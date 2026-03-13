import { Queue } from 'bullmq';
export interface NotificationJobData {
    organizationId: string;
    userId?: string;
    title: string;
    body: string;
    data?: Record<string, string | number>;
    priority?: 'high' | 'normal' | 'low';
}
declare class NotificationQueueManager {
    private queue;
    private initialized;
    initialize(): Promise<Queue<NotificationJobData>>;
    getQueue(): Queue<NotificationJobData> | null;
    isInitialized(): boolean;
}
export declare function initializeNotificationQueue(): Promise<Queue<NotificationJobData>>;
export declare function submitNotificationJob(data: NotificationJobData): Promise<string>;
export declare function getNotificationQueueManager(): NotificationQueueManager;
export {};
//# sourceMappingURL=notification.queue.d.ts.map