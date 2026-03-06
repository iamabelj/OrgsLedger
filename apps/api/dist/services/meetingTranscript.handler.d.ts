interface MeetingTranscriptContext {
    meetingId: string;
    participantId: string;
    participantName: string;
    io: any;
    currentLanguage: string;
}
interface BroadcastPayload {
    speakerId: string;
    speakerName: string;
    originalText: string;
    sourceLanguage: string;
    translations: Record<string, string>;
    timestamp: Date;
}
declare class MeetingTranscriptHandler {
    private contexts;
    private pendingTranscripts;
    /**
     * Initialize transcript handling for a participant in a meeting
     */
    initializeParticipantTranscript(context: MeetingTranscriptContext): Promise<string | null>;
    /**
     * Handle interim (real-time) transcript
     * Broadcast for live subtitles - KEEP EXISTING EVENT NAME
     */
    private handleInterimTranscript;
    /**
     * Handle final transcript
     * Store in DB and broadcast - KEEP EXISTING EVENT NAMES
     */
    private handleFinalTranscript;
    /**
     * Handle language detection
     */
    private handleLanguageDetected;
    /**
     * Handle stream errors with fallback
     */
    private handleStreamError;
    /**
     * Reinitialize a failed stream
     */
    private reinitializeStream;
    /**
     * Stop transcript handling for a participant
     */
    stopParticipantTranscript(contextId: string): Promise<boolean>;
    /**
     * Stop all transcripts for a meeting
     */
    stopMeetingTranscripts(meetingId: string): Promise<void>;
    /**
     * Get pending transcripts for a meeting (for minutes generation)
     */
    getPendingMeetingTranscripts(meetingId: string): string[];
    /**
     * Clear pending transcripts after processing
     */
    clearPendingTranscripts(meetingId: string): void;
    /**
     * Get active transcripts in the system
     */
    getActiveTranscriptCount(): number;
    /**
     * Get transcripts for a specific meeting
     */
    getActiveMeetingTranscriptCount(meetingId: string): number;
    /**
     * Get health status
     */
    getStatus(): {
        isHealthy: boolean;
        activeTranscripts: number;
        deepgramConfigured: boolean;
        liveKitConfigured: boolean;
    };
}
export declare const meetingTranscriptHandler: MeetingTranscriptHandler;
export type { MeetingTranscriptContext, BroadcastPayload };
//# sourceMappingURL=meetingTranscript.handler.d.ts.map