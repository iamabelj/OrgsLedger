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
     * Configure OpenAI Realtime for transcription-only mode.
     * Key design decisions:
     *  - modalities: ['text'] — no audio output
     *  - instructions: stay silent, never respond
     *  - input_audio_transcription: whisper-1 (the ONLY transcript source)
     *  - turn_detection: server_vad for automatic speech segmentation
     *  - max_response_output_tokens: 1 — minimise wasted model tokens
     */
    private configureSession;
    private sendAudio;
    private handleMessage;
    private persistAndBroadcast;
    private handleDisconnect;
    private startTimers;
    private resetSilenceTimer;
    private send;
}
//# sourceMappingURL=realtimeSession.d.ts.map