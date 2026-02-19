export interface LivekitBotOptions {
    meetingId: string;
    organizationId: string;
    roomName: string;
    /** Socket.IO server instance for broadcasting */
    io: any;
    /** In-memory language prefs map from socket.ts */
    meetingLanguages?: Map<string, Map<string, {
        language: string;
        name: string;
        receiveVoice: boolean;
    }>>;
}
export declare class LivekitBot {
    private room;
    private sessions;
    private audioStreams;
    private closed;
    private readonly meetingId;
    private readonly organizationId;
    private readonly roomName;
    private readonly io;
    private readonly meetingLanguages?;
    constructor(opts: LivekitBotOptions);
    /** Connect to the LiveKit room and start subscribing to audio tracks. */
    connect(): Promise<void>;
    /** Disconnect from the room and close all sessions. */
    disconnect(): Promise<void>;
    get activeSessionCount(): number;
    get isClosed(): boolean;
    private setupEventHandlers;
    /**
     * Create a RealtimeSession for the speaker and pipe audio
     * from the LiveKit AudioStream into it.
     */
    private onTrackSubscribed;
    /**
     * Async iterator over AudioStream frames → push into RealtimeSession.
     * Runs until the stream or session ends.
     */
    private pipeAudioFrames;
    /** Close and remove a session for a specific speaker. */
    private closeSession;
    /**
     * After a transcript is persisted by the RealtimeSession,
     * translate to all target languages and broadcast via Socket.IO.
     * Mirrors the translation:speech handler in socket.ts.
     */
    private translateAndBroadcast;
}
//# sourceMappingURL=livekitBot.d.ts.map