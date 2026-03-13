declare class TranscriptWorker {
    private workers;
    private isRunning;
    private processedCount;
    private failedCount;
    private redis;
    initialize(): Promise<void>;
    /**
     * Process a transcript event
     */
    private processTranscriptEvent;
    /**
     * Store transcript in Redis with sliding window.
     * Uses LPUSH + LTRIM to maintain only the last N entries.
     * This prevents Redis memory explosion at scale.
     */
    private storeTranscript;
    /**
     * Get worker stats
     */
    getStats(): {
        running: boolean;
        processed: number;
        failed: number;
        workerId: string;
        workerCount: number;
    };
    /**
     * Gracefully stop all shard workers
     */
    stop(): Promise<void>;
}
export declare function startTranscriptWorker(): Promise<void>;
export declare function stopTranscriptWorker(): Promise<void>;
export declare function getTranscriptWorker(): TranscriptWorker | null;
/**
 * Get all transcripts for a meeting from Redis.
 * Returns in chronological order (oldest first).
 *
 * Note: Transcripts are stored with LPUSH (newest first),
 * so we reverse the order for chronological retrieval.
 */
export declare function getMeetingTranscripts(meetingId: string): Promise<Array<{
    speaker: string;
    speakerId?: string;
    text: string;
    timestamp: string;
    confidence?: number;
    language?: string;
}>>;
export {};
//# sourceMappingURL=transcript.worker.d.ts.map