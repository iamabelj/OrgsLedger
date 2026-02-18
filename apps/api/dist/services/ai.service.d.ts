export declare class AIService {
    private io;
    constructor(io?: any);
    /**
     * Process meeting audio into structured minutes.
     * 1. Transcribe audio via Google Speech-to-Text
     * 2. Summarize & structure via OpenAI
     * 3. Store results
     * 4. Deduct AI credits
     */
    processMinutes(meetingId: string, organizationId: string): Promise<void>;
    /**
     * Transcribe audio using Google Cloud Speech-to-Text.
     * When AI_PROXY_URL is configured, routes through the OrgsLedger AI Gateway
     * so clients never need Google credentials locally.
     */
    private transcribeAudio;
    /**
     * Generate structured minutes using OpenAI.
     * When AI_PROXY_URL is configured, routes through the OrgsLedger AI Gateway
     * so clients never need an OpenAI key locally.
     */
    private generateMinutes;
    private formatTime;
    private getMockTranscript;
    /**
     * Get transcripts from the meeting_transcripts table (live translation data).
     * Falls back to mock if table doesn't exist or is empty.
     */
    private getTranscriptsFromDB;
    private getMockMinutes;
}
//# sourceMappingURL=ai.service.d.ts.map