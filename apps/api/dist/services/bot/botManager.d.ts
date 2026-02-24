import { LivekitBot } from './livekitBot';
export interface BotManagerDeps {
    /** Socket.IO server instance for broadcasting */
    io: any;
    /** Shared in-memory language prefs map from socket.ts */
    meetingLanguages?: Map<string, Map<string, {
        language: string;
        name: string;
        receiveVoice: boolean;
    }>>;
}
export declare class BotManager {
    private bots;
    private readonly io;
    private readonly meetingLanguages?;
    constructor(deps: BotManagerDeps);
    /**
     * Start a transcription bot for a meeting.
     * Looks up the meeting's organization and room name, then
     * creates and connects a LivekitBot.
     *
     * Idempotent — calling this for a meeting that already has
     * a bot does nothing.
     */
    startMeetingBot(meetingId: string): Promise<void>;
    /**
     * Stop and disconnect the bot for a meeting.
     * Cleans up all RealtimeSessions and the LiveKit connection.
     */
    stopMeetingBot(meetingId: string): Promise<void>;
    /**
     * Get the bot instance for a meeting (if running).
     */
    getBot(meetingId: string): LivekitBot | undefined;
    /**
     * Check if a bot is running for a meeting.
     */
    hasBot(meetingId: string): boolean;
    /**
     * Get status info for all running bots.
     */
    getStatus(): Array<{
        meetingId: string;
        activeSessions: number;
    }>;
    /**
     * Stop all bots. Called during graceful shutdown.
     */
    shutdownAll(): Promise<void>;
}
/**
 * Initialize the BotManager singleton.
 * Call once during server startup (index.ts).
 */
export declare function initBotManager(deps: BotManagerDeps): BotManager;
/**
 * Get the BotManager singleton.
 * Throws if not yet initialized.
 */
export declare function getBotManager(): BotManager;
//# sourceMappingURL=botManager.d.ts.map