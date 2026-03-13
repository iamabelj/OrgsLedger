import { Job } from 'bullmq';
import { BroadcastEventData } from '../queues/queue-manager';
/**
 * Caption payload structure sent to Socket.IO clients.
 */
export interface CaptionPayload {
    meetingId: string;
    speakerId: string;
    originalText: string;
    translatedText: string;
    language: string;
    sourceLanguage?: string;
    timestamp: number;
    speaker?: string;
}
declare class BroadcastWorker {
    private workers;
    private isRunning;
    private processedCount;
    private failedCount;
    private broadcastCount;
    private disconnectCount;
    /**
     * Initialize all broadcast shard workers.
     */
    initialize(): Promise<void>;
    /**
     * Set up worker event handlers for a shard.
     */
    private setupWorkerEventHandlers;
    /**
     * Process a broadcast event with retry logic.
     */
    private processBroadcastEvent;
    /**
     * Map internal event type to Socket.IO event name.
     * For Stage 4, translations are broadcast as 'meeting:caption'.
     */
    private mapEventType;
    /**
     * Broadcast event to Socket.IO clients via Redis PubSub.
     */
    private broadcastToClients;
    /**
     * Check if error is a WebSocket disconnect error.
     */
    private isDisconnectError;
    /**
     * Sleep utility for retry backoff.
     */
    private sleep;
    /**
     * Get worker statistics.
     */
    getStats(): {
        running: boolean;
        processed: number;
        failed: number;
        broadcasts: number;
        disconnects: number;
        workerId: string;
        workerCount: number;
    };
    /**
     * Gracefully stop all shard workers.
     */
    stop(): Promise<void>;
}
export declare function startBroadcastWorker(): Promise<void>;
export declare function stopBroadcastWorker(): Promise<void>;
export declare function getBroadcastWorker(): BroadcastWorker | null;
/**
 * Submit a test caption broadcast for development/debugging.
 */
export declare function submitTestCaption(meetingId: string, speakerId: string, text: string, language?: string): Promise<Job<BroadcastEventData>>;
export {};
//# sourceMappingURL=broadcast.worker.d.ts.map