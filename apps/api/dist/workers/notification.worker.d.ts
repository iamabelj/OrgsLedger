declare class NotificationWorker {
    private worker;
    private isRunning;
    private processedCount;
    private failedCount;
    initialize(): Promise<void>;
    private processNotificationJob;
    stop(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    getStatus(): Promise<{
        running: boolean;
        processed: number;
        failed: number;
    }>;
    isHealthy(): boolean;
}
export declare function startNotificationWorker(): Promise<void>;
export declare function stopNotificationWorker(): Promise<void>;
export declare function getNotificationWorker(): NotificationWorker;
export {};
//# sourceMappingURL=notification.worker.d.ts.map