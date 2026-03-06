declare class AuditWorker {
    private worker;
    private isRunning;
    private processedCount;
    private failedCount;
    initialize(): Promise<void>;
    private processAuditJob;
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
export declare function startAuditWorker(): Promise<void>;
export declare function stopAuditWorker(): Promise<void>;
export declare function getAuditWorker(): AuditWorker;
export {};
//# sourceMappingURL=audit.worker.d.ts.map