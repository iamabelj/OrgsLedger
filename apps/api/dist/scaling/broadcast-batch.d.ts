export interface CaptionEvent {
    meetingId: string;
    organizationId?: string;
    speakerId: string;
    originalText: string;
    translatedText?: string;
    language: string;
    sourceLanguage?: string;
    timestamp: number;
    speaker?: string;
    isFinal?: boolean;
}
export interface BatchedCaptionPayload {
    type: 'meeting:captions';
    meetingId: string;
    organizationId?: string;
    timestamp: number;
    captions: CaptionEvent[];
}
export interface TranscriptEvent {
    meetingId: string;
    organizationId?: string;
    speakerId?: string;
    speaker?: string;
    text: string;
    timestamp: number;
    isFinal?: boolean;
    confidence?: number;
    language?: string;
}
export interface BatchedTranscriptPayload {
    type: 'meeting:transcripts';
    meetingId: string;
    organizationId?: string;
    timestamp: number;
    transcripts: TranscriptEvent[];
}
export type BatchedPayload = BatchedCaptionPayload | BatchedTranscriptPayload;
type PublishCallback = (payload: BatchedPayload) => Promise<void>;
declare class BroadcastBatchManager {
    /** Pending caption events per meeting: Map<meetingId, CaptionEvent[]> */
    private captionBatches;
    /** Pending transcript events per meeting: Map<meetingId, TranscriptEvent[]> */
    private transcriptBatches;
    /** Organization ID cache: Map<meetingId, organizationId> */
    private orgCache;
    /** Flush timer */
    private flushTimer;
    /** Callback for publishing batched events */
    private publishCallback;
    /** Statistics */
    private stats;
    /**
     * Initialize the batch manager with a publish callback.
     */
    initialize(publishCallback: PublishCallback): void;
    /**
     * Queue a caption event for batching.
     */
    queueCaption(event: CaptionEvent): void;
    /**
     * Queue a transcript event for batching.
     */
    queueTranscript(event: TranscriptEvent): void;
    /**
     * Flush all pending batches for a specific meeting.
     */
    private flushMeeting;
    /**
     * Flush all pending batches.
     */
    flushAll(): Promise<void>;
    /**
     * Start the periodic flush timer.
     */
    private startFlushTimer;
    /**
     * Stop the batch manager.
     */
    shutdown(): Promise<void>;
    /**
     * Get current statistics.
     */
    getStats(): {
        pendingCaptionMeetings: number;
        pendingTranscriptMeetings: number;
        pendingCaptions: number;
        pendingTranscripts: number;
        captionsQueued: number;
        transcriptsQueued: number;
        batchesFlushed: number;
        eventsPublished: number;
        lastFlushAt: number;
    };
    /**
     * Clean up data for a specific meeting (call on meeting end).
     */
    cleanupMeeting(meetingId: string): void;
}
export declare const broadcastBatchManager: BroadcastBatchManager;
export declare function initializeBroadcastBatching(publishCallback: PublishCallback): void;
export declare function queueCaptionForBroadcast(event: CaptionEvent): void;
export declare function queueTranscriptForBroadcast(event: TranscriptEvent): void;
export declare function getBroadcastBatchStats(): {
    pendingCaptionMeetings: number;
    pendingTranscriptMeetings: number;
    pendingCaptions: number;
    pendingTranscripts: number;
    captionsQueued: number;
    transcriptsQueued: number;
    batchesFlushed: number;
    eventsPublished: number;
    lastFlushAt: number;
};
export declare function shutdownBroadcastBatching(): Promise<void>;
export declare function cleanupMeetingBroadcastBatch(meetingId: string): void;
export {};
//# sourceMappingURL=broadcast-batch.d.ts.map