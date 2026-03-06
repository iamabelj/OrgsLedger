declare class EmailWorker {
    private worker;
    private isRunning;
    private processedCount;
    private failedCount;
    initialize(): Promise<void>;
    private processEmailJob;
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
export declare function startEmailWorker(): Promise<void>;
export declare function stopEmailWorker(): Promise<void>;
export declare function getEmailWorker(): EmailWorker;
export {};
//# sourceMappingURL=email.worker.d.ts.map