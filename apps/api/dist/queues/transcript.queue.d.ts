import { queueManager, TranscriptEventData as ShardedTranscriptEventData, TranslationJobData as ShardedTranslationJobData, BroadcastEventData as ShardedBroadcastEventData, MinutesJobData as ShardedMinutesJobData } from './queue-manager';
export type TranscriptEventData = ShardedTranscriptEventData;
export type TranslationJobData = ShardedTranslationJobData;
export type BroadcastEventData = ShardedBroadcastEventData;
export type MinutesJobData = ShardedMinutesJobData;
export declare const QUEUE_NAMES: {
    readonly TRANSCRIPT_EVENTS: "transcript-events";
    readonly TRANSLATION_JOBS: "translation-jobs";
    readonly BROADCAST_EVENTS: "broadcast-events";
    readonly MINUTES_GENERATION: "minutes-generation";
};
/**
 * Initialize transcript queues (delegates to sharded queue-manager)
 */
export declare function initializeTranscriptQueues(): Promise<void>;
/**
 * Submit a transcript event to the sharded queue
 * Deterministically routes to a shard based on meetingId
 */
export declare function submitTranscriptEvent(data: TranscriptEventData): Promise<string>;
/**
 * Submit a translation job to the sharded queue
 * Deterministically routes to a shard based on meetingId
 */
export declare function submitTranslationJob(data: TranslationJobData): Promise<string>;
/**
 * Submit a broadcast event to the sharded queue
 * Deterministically routes to a shard based on meetingId
 */
export declare function submitBroadcastEvent(data: BroadcastEventData): Promise<string>;
/**
 * Submit a minutes generation job to the sharded queue
 * Deterministically routes to a shard based on meetingId
 */
export declare function submitMinutesJob(data: MinutesJobData, options?: {
    delay?: number;
}): Promise<string>;
/**
 * Get queue accessors for external use
 * Each accessor requires meetingId for deterministic shard routing
 */
export declare function getTranscriptQueues(): {
    getTranscriptQueue: (meetingId: string) => ReturnType<typeof queueManager.getTranscriptQueue>;
    getTranslationQueue: (meetingId: string) => ReturnType<typeof queueManager.getTranslationQueue>;
    getBroadcastQueue: (meetingId: string) => ReturnType<typeof queueManager.getBroadcastQueue>;
    getMinutesQueue: (meetingId: string) => ReturnType<typeof queueManager.getMinutesQueue>;
};
//# sourceMappingURL=transcript.queue.d.ts.map