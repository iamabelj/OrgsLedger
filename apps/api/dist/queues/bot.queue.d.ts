import { Queue } from 'bullmq';
export interface BotJobData {
    meetingId: string;
    organizationId: string;
    action: 'start' | 'stop' | 'reconnect' | 'check_health';
}
declare class BotQueueManager {
    private queue;
    private initialized;
    initialize(): Promise<Queue<BotJobData>>;
    getQueue(): Queue<BotJobData> | null;
    isInitialized(): boolean;
}
export declare function initializeBotQueue(): Promise<Queue<BotJobData>>;
export declare function submitBotJob(data: BotJobData): Promise<string>;
export declare function getBotQueueManager(): BotQueueManager;
export {};
//# sourceMappingURL=bot.queue.d.ts.map