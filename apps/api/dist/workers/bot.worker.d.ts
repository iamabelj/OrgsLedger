declare class BotWorker {
    private worker;
    private isRunning;
    private processedCount;
    private failedCount;
    initialize(): Promise<void>;
    private processBotJob;
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
export declare function startBotWorker(): Promise<void>;
export declare function stopBotWorker(): Promise<void>;
export declare function getBotWorker(): BotWorker;
export {};
//# sourceMappingURL=bot.worker.d.ts.map