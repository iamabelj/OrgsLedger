import { EventEmitter } from 'events';
export interface AudioBotConfig {
    meetingId: string;
    organizationId: string;
    language?: string;
}
export declare class LiveKitAudioBot extends EventEmitter {
    private transcriptionSession;
    private config;
    private isRunning;
    private ws;
    constructor(cfg: AudioBotConfig);
    /**
     * Start the audio bot
     * Note: In production, use LiveKit Egress API for reliable audio capture
     */
    start(): Promise<void>;
    /**
     * Set up transcription event forwarding
     */
    private setupTranscriptionEvents;
    /**
     * Send audio data to transcription service
     * Called by external audio stream handler
     */
    sendAudio(audioData: Buffer): void;
    /**
     * Stop the audio bot
     */
    stop(): Promise<void>;
    /**
     * Check if bot is running
     */
    getIsRunning(): boolean;
}
/**
 * Start an audio bot for a meeting
 */
export declare function startAudioBot(cfg: AudioBotConfig): Promise<LiveKitAudioBot>;
/**
 * Stop an audio bot
 */
export declare function stopAudioBot(meetingId: string): Promise<void>;
/**
 * Get active bot for a meeting
 */
export declare function getAudioBot(meetingId: string): LiveKitAudioBot | undefined;
/**
 * Get count of active bots
 */
export declare function getActiveBotCount(): number;
/**
 * Stop all active bots (for graceful shutdown)
 */
export declare function stopAllBots(): Promise<void>;
//# sourceMappingURL=livekit-audio-bot.service.d.ts.map