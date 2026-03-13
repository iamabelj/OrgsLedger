export interface IdempotencyCheckResult {
    isDuplicate: boolean;
    previouslyProcessedAt?: Date;
}
/**
 * Generate a unique idempotency key for transcript events.
 * Combines meeting ID, speaker ID, timestamp, and a hash of the text.
 */
export declare function getTranscriptIdempotencyKey(meetingId: string, speakerId: string | undefined, timestamp: string | number, text: string): string;
/**
 * Generate idempotency key for translation events.
 */
export declare function getTranslationIdempotencyKey(meetingId: string, speakerId: string, timestamp: string | number, targetLanguage: string): string;
/**
 * Generate idempotency key for broadcast events.
 */
export declare function getBroadcastIdempotencyKey(meetingId: string, eventType: string, dataHash: string): string;
/**
 * Generate idempotency key for minutes events.
 */
export declare function getMinutesIdempotencyKey(meetingId: string): string;
/**
 * Generate idempotency key from event ID.
 * Use this when you have a pre-assigned event ID.
 */
export declare function getEventIdempotencyKey(eventId: string): string;
/**
 * Generate a hash from an object (for data payloads).
 */
export declare function hashObject(obj: Record<string, any>): string;
/**
 * Check if an event has already been processed.
 * If not, marks it as processed atomically (using SETNX).
 *
 * @param key - Unique idempotency key
 * @param workerName - Worker name for metrics
 * @returns true if this is a duplicate (already processed)
 */
export declare function checkAndMarkProcessed(key: string, workerName?: string): Promise<boolean>;
/**
 * Check if an event was already processed (read-only check).
 * Does NOT mark as processed.
 */
export declare function isProcessed(key: string): Promise<boolean>;
/**
 * Manually mark an event as processed.
 * Use this when processing happens outside the normal flow.
 */
export declare function markProcessed(key: string): Promise<void>;
/**
 * Remove idempotency record (for testing or manual retry).
 */
export declare function clearIdempotencyKey(key: string): Promise<void>;
/**
 * Batch check multiple keys for duplicates.
 * Returns a map of key -> isDuplicate.
 */
export declare function batchCheckDuplicates(keys: string[]): Promise<Map<string, boolean>>;
/**
 * Check if a BullMQ job has already been processed.
 * Uses the job ID as the idempotency key.
 */
export declare function isJobProcessed(jobId: string, queueName: string): Promise<boolean>;
/**
 * Mark a BullMQ job as processed.
 */
export declare function markJobProcessed(jobId: string, queueName: string): Promise<void>;
/**
 * Check and mark a job as processed atomically.
 * Returns true if already processed (duplicate).
 */
export declare function checkAndMarkJobProcessed(jobId: string, queueName: string, workerName: string): Promise<boolean>;
declare const _default: {
    checkAndMarkProcessed: typeof checkAndMarkProcessed;
    isProcessed: typeof isProcessed;
    markProcessed: typeof markProcessed;
    clearIdempotencyKey: typeof clearIdempotencyKey;
    batchCheckDuplicates: typeof batchCheckDuplicates;
    getTranscriptIdempotencyKey: typeof getTranscriptIdempotencyKey;
    getTranslationIdempotencyKey: typeof getTranslationIdempotencyKey;
    getBroadcastIdempotencyKey: typeof getBroadcastIdempotencyKey;
    getMinutesIdempotencyKey: typeof getMinutesIdempotencyKey;
    getEventIdempotencyKey: typeof getEventIdempotencyKey;
    hashObject: typeof hashObject;
    isJobProcessed: typeof isJobProcessed;
    markJobProcessed: typeof markJobProcessed;
    checkAndMarkJobProcessed: typeof checkAndMarkJobProcessed;
};
export default _default;
//# sourceMappingURL=idempotency.d.ts.map