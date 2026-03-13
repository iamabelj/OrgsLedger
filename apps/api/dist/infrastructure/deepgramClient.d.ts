import { EventEmitter } from 'events';
import { CircuitState } from '../services/circuit-breaker';
export interface DeepgramStreamOptions {
    meetingId: string;
    language?: string;
    model?: string;
    punctuate?: boolean;
    diarize?: boolean;
    smartFormat?: boolean;
}
export interface StreamHandle {
    /** Unique identifier for this stream */
    readonly streamId: string;
    /** Send raw audio bytes to Deepgram */
    sendAudio(data: Buffer): void;
    /** Gracefully close the stream */
    close(): Promise<void>;
    /** Subscribe to transcript events */
    on(event: 'transcript', fn: (result: TranscriptResult) => void): this;
    on(event: 'utteranceEnd', fn: () => void): this;
    on(event: 'speechStarted', fn: () => void): this;
    on(event: 'error', fn: (err: Error) => void): this;
    on(event: 'closed', fn: () => void): this;
    on(event: string, fn: (...args: any[]) => void): this;
}
export interface TranscriptResult {
    transcript: string;
    speaker: number | string;
    timestamp: number;
    duration: number;
    isFinal: boolean;
    confidence: number;
    words?: Array<{
        word: string;
        start: number;
        end: number;
        confidence: number;
        speaker?: number;
    }>;
}
declare class DeepgramConnectionPool extends EventEmitter {
    private slots;
    private streams;
    private circuitBreaker;
    private streamCounter;
    private initialized;
    private errorTimestamps;
    private successTimestamps;
    private readonly errorWindowMs;
    constructor();
    /**
     * Open a new streaming transcription session.
     * Returns a `StreamHandle` that the caller uses to send audio and
     * receive transcript events.
     *
     * Throws if the circuit is open or no capacity is available.
     */
    openStream(opts: DeepgramStreamOptions): Promise<StreamHandle>;
    getStatus(): {
        activeConnections: number;
        activeStreams: number;
        circuitState: CircuitState;
        errorRate: number;
        capacity: number;
        poolSlots: Array<{
            id: number;
            state: string;
            streams: number;
        }>;
    };
    healthCheck(): Promise<{
        healthy: boolean;
        activeConnections: number;
        activeStreams: number;
        circuitState: string;
        errorRate: number;
    }>;
    shutdown(): Promise<void>;
    /**
     * Find a READY slot with spare stream capacity, or lazily open a
     * new connection in an IDLE slot.
     */
    private acquireSlot;
    /**
     * Open a WebSocket on a given slot, wrapped in the circuit breaker.
     */
    private connectSlot;
    private rawConnect;
    /**
     * When a slot disconnects unexpectedly, attempt to reconnect and
     * re-attach active streams. Streams receive an error event so they
     * can buffer audio in the meantime.
     */
    private handleSlotDisconnect;
    private reconnectSlot;
    private evictSlotStreams;
    private startKeepAlive;
    private stopKeepAlive;
    /**
     * Deepgram sends one message stream per connection, so we
     * broadcast to all streams attached to the slot, filtering by
     * active meeting context on the client side.
     */
    private dispatchMessage;
    private parseTranscriptResult;
    private extractSpeaker;
    private buildHandle;
    private releaseStream;
    private closeSlot;
    private recordError;
    private recordSuccess;
    private pruneRateWindow;
    private computeErrorRate;
    private syncCircuitMetric;
    private nextStreamId;
}
export declare const deepgramPool: DeepgramConnectionPool;
export declare function openDeepgramStream(opts: DeepgramStreamOptions): Promise<StreamHandle>;
export declare function deepgramHealthCheck(): Promise<{
    healthy: boolean;
    activeConnections: number;
    activeStreams: number;
    circuitState: string;
    errorRate: number;
}>;
export declare function getDeepgramPoolStatus(): {
    activeConnections: number;
    activeStreams: number;
    circuitState: CircuitState;
    errorRate: number;
    capacity: number;
    poolSlots: Array<{
        id: number;
        state: string;
        streams: number;
    }>;
};
export declare function shutdownDeepgramPool(): Promise<void>;
export {};
//# sourceMappingURL=deepgramClient.d.ts.map