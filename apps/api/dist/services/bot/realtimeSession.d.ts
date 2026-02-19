export interface RealtimeSessionOptions {
    meetingId: string;
    organizationId: string;
    speakerId: string;
    speakerName: string;
    /** Source language BCP-47 code for transcript metadata */
    sourceLang?: string;
    /** Callback after a transcript row is saved */
    onTranscript?: (transcript: TranscriptRow) => void | Promise<void>;
}
export interface TranscriptRow {
    meetingId: string;
    organizationId: string;
    speakerId: string;
    speakerName: string;
    text: string;
    sourceLang: string;
    timestamp: number;
}
export declare class RealtimeSession {
    private ws;
    private audioProcessor;
    private closed;
    private reconnectAttempts;
    private silenceTimer;
    private maxDurationTimer;
    private lastTranscriptAt;
    private audioChunksSent;
    private transcriptsReceived;
    private transcriptsPersisted;
    private sessionOpenedAt;
    private readonly AUDIO_LOG_INTERVAL;
    private readonly meetingId;
    private readonly organizationId;
    private readonly speakerId;
    private readonly speakerName;
    private readonly sourceLang;
    private readonly onTranscript?;
    constructor(opts: RealtimeSessionOptions);
    /** Open WebSocket to OpenAI Realtime and configure the session. */
    connect(): Promise<void>;
    /**
     * Feed audio data from LiveKit track into this session.
     * Accepts Float32 (standard LiveKit) or raw PCM16 Buffer.
     */
    pushAudio(audio: Float32Array | Buffer): void;
    /** Gracefully close the session and free all resources. */
    close(): void;
    get isClosed(): boolean;
    /**
     * Send session.update to configure OpenAI Realtime for
     * transcription-only mode with server-side VAD.
     */
    private configureSession;
    /** Send a base64-encoded PCM16 audio chunk to OpenAI. */
    private sendAudio;
    /** Parse incoming OpenAI Realtime events. */
    private handleMessage;
    /**
     * Save a final transcript segment to DB and trigger the
     * translation/broadcast callback.
     */
    private handleTranscript;
    private handleDisconnect;
    private startTimers;
    private resetSilenceTimer;
    private sendEvent;
}
//# sourceMappingURL=realtimeSession.d.ts.map