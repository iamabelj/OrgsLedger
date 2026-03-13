export type MeetingEventType = 'transcript_received' | 'translation_completed' | 'caption_broadcast' | 'meeting_ended' | 'minutes_generated';
export interface MeetingEvent {
    id: string;
    meetingId: string;
    eventType: MeetingEventType;
    payload: Record<string, any>;
    createdAt: Date;
    processed: boolean;
    processedAt?: Date;
    processingError?: string;
    retryCount: number;
}
export interface StoreEventInput {
    meetingId: string;
    eventType: MeetingEventType;
    payload: Record<string, any>;
    /** Optional custom event ID for idempotency */
    eventId?: string;
}
export interface BatchEventResult {
    stored: number;
    failed: number;
    eventIds: string[];
}
declare class EventStore {
    private initialized;
    private initPromise;
    private metricsInterval;
    /**
     * Initialize the event store (create table if not exists).
     * Safe to call multiple times — uses singleton pattern.
     */
    initialize(): Promise<void>;
    private _initialize;
    /**
     * Store a single event in the PostgreSQL event store.
     * Returns the event ID for tracking.
     */
    storeEvent(input: StoreEventInput): Promise<string>;
    /**
     * Store multiple events in a single transaction.
     * More efficient for batch operations.
     */
    storeEventsBatch(inputs: StoreEventInput[]): Promise<BatchEventResult>;
    /**
     * Mark an event as successfully processed.
     */
    markEventProcessed(eventId: string): Promise<void>;
    /**
     * Mark multiple events as processed in a single transaction.
     */
    markEventsProcessed(eventIds: string[]): Promise<number>;
    /**
     * Mark an event as failed with error message.
     * Increments retry count for backoff.
     */
    markEventFailed(eventId: string, error: string): Promise<void>;
    /**
     * Get unprocessed events for replay.
     * Returns oldest events first, with retry count < maxRetries.
     */
    getUnprocessedEvents(limit?: number, maxRetries?: number): Promise<MeetingEvent[]>;
    /**
     * Get unprocessed events for a specific meeting.
     */
    getUnprocessedEventsForMeeting(meetingId: string, limit?: number): Promise<MeetingEvent[]>;
    /**
     * Get event by ID.
     */
    getEvent(eventId: string): Promise<MeetingEvent | null>;
    /**
     * Check if an event has already been processed (for idempotency).
     */
    isEventProcessed(eventId: string): Promise<boolean>;
    /**
     * Get event store statistics.
     */
    getStats(): Promise<{
        total: number;
        processed: number;
        pending: number;
        failed: number;
        byEventType: Record<string, {
            total: number;
            pending: number;
        }>;
    }>;
    /**
     * Delete old processed events (cleanup job).
     * Keeps events for specified retention period.
     */
    cleanupOldEvents(retentionDays?: number): Promise<number>;
    private ensureInitialized;
    private startMetricsCollection;
    /**
     * Shutdown the event store (stop metrics collection).
     */
    shutdown(): void;
}
export declare const eventStore: EventStore;
export declare function initializeEventStore(): Promise<void>;
export declare function storeEvent(input: StoreEventInput): Promise<string>;
export declare function markEventProcessed(eventId: string): Promise<void>;
export declare function getUnprocessedEvents(limit?: number, maxRetries?: number): Promise<MeetingEvent[]>;
export declare function isEventProcessed(eventId: string): Promise<boolean>;
export default eventStore;
//# sourceMappingURL=event-store.d.ts.map