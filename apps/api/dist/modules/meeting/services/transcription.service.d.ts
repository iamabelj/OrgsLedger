import { EventEmitter } from 'events';
export interface TranscriptionConfig {
    meetingId: string;
    language?: string;
    model?: string;
    punctuate?: boolean;
    diarize?: boolean;
    smartFormat?: boolean;
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
export declare class TranscriptionSession extends EventEmitter {
    private ws;
    private config;
    private isConnected;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private keepAliveInterval;
    private speakerMap;
    private totalAudioBytes;
    constructor(cfg: TranscriptionConfig);
    /**
     * Connect to Deepgram WebSocket
     */
    connect(): Promise<void>;
    /**
     * Handle incoming Deepgram message
     */
    private handleMessage;
    /**
     * Handle transcript result from Deepgram
     */
    private handleTranscriptResult;
    /**
     * Extract speaker identifier from Deepgram response
     */
    private extractSpeaker;
    /**
     * Send audio data to Deepgram
     */
    sendAudio(audioData: Buffer): void;
    /**
     * Start keep-alive heartbeat
     */
    private startKeepAlive;
    /**
     * Stop keep-alive heartbeat
     */
    private stopKeepAlive;
    /**
     * Handle reconnection with exponential backoff
     */
    private handleReconnect;
    /**
     * Gracefully close the connection
     */
    close(): Promise<void>;
    /**
     * Check if connected
     */
    isActive(): boolean;
    /**
     * Map speaker number to user ID
     */
    setSpeakerMapping(speakerNum: number, userId: string): void;
}
/**
 * Create a new transcription session for a meeting
 */
export declare function createTranscriptionSession(cfg: TranscriptionConfig): Promise<TranscriptionSession>;
/**
 * Get existing transcription session
 */
export declare function getTranscriptionSession(meetingId: string): TranscriptionSession | undefined;
/**
 * Close and remove transcription session
 */
export declare function closeTranscriptionSession(meetingId: string): Promise<void>;
/**
 * Get count of active sessions
 */
export declare function getActiveSessionCount(): number;
//# sourceMappingURL=transcription.service.d.ts.map