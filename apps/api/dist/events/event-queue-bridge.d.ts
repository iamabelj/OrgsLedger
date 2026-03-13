import { TranscriptEventData, TranslationJobData, BroadcastEventData, MinutesJobData } from '../queues/queue-manager';
export interface DurableEventResult {
    eventId: string;
    jobId?: string;
    queued: boolean;
    error?: string;
}
export interface TranscriptEventInput extends TranscriptEventData {
    eventId?: string;
}
export interface TranslationEventInput extends TranslationJobData {
    eventId?: string;
}
export interface BroadcastEventInput extends BroadcastEventData {
    eventId?: string;
}
export interface MinutesEventInput extends MinutesJobData {
    eventId?: string;
}
declare class EventQueueBridge {
    private initialized;
    private initPromise;
    /**
     * Initialize both the event store and queue manager.
     */
    initialize(): Promise<void>;
    private _initialize;
    private ensureInitialized;
    /**
     * Durably submit a transcript event.
     * 1. Persist to event store
     * 2. Submit to BullMQ queue
     * 3. Mark processed on queue success
     */
    submitTranscript(input: TranscriptEventInput): Promise<DurableEventResult>;
    /**
     * Durably submit a translation job.
     */
    submitTranslation(input: TranslationEventInput): Promise<DurableEventResult>;
    /**
     * Durably submit a broadcast event.
     */
    submitBroadcast(input: BroadcastEventInput): Promise<DurableEventResult>;
    /**
     * Durably submit a minutes generation job.
     */
    submitMinutes(input: MinutesEventInput): Promise<DurableEventResult>;
    /**
     * Store a meeting ended event (triggers minutes generation).
     */
    submitMeetingEnded(meetingId: string, organizationId: string, eventId?: string): Promise<DurableEventResult>;
    /**
     * Replay a single event from the event store to the queue.
     * Used by the replay worker.
     */
    replayEvent(eventId: string): Promise<DurableEventResult>;
    private replayTranscript;
    private replayTranslation;
    private replayBroadcast;
    private replayMinutes;
}
export declare const eventQueueBridge: EventQueueBridge;
export declare function initializeEventBridge(): Promise<void>;
export declare function durableSubmitTranscript(input: TranscriptEventInput): Promise<DurableEventResult>;
export declare function durableSubmitTranslation(input: TranslationEventInput): Promise<DurableEventResult>;
export declare function durableSubmitBroadcast(input: BroadcastEventInput): Promise<DurableEventResult>;
export declare function durableSubmitMinutes(input: MinutesEventInput): Promise<DurableEventResult>;
export declare function durableSubmitMeetingEnded(meetingId: string, organizationId: string, eventId?: string): Promise<DurableEventResult>;
export declare function replayEvent(eventId: string): Promise<DurableEventResult>;
export default eventQueueBridge;
//# sourceMappingURL=event-queue-bridge.d.ts.map