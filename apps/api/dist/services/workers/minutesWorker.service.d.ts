/**
 * Service that processes AI minutes generation jobs from the queue
 */
export declare class MinutesWorkerService {
    private io;
    constructor(io?: any);
    /**
     * Process a minutes generation job
     * Handles transcription, summarization, storage, and notifications
     */
    processMinutes(meetingId: string, organizationId: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    /**
     * Transcribe audio using Google Speech-to-Text
     */
    private transcribeAudio;
    /**
     * Get transcripts from database
     */
    private getTranscriptsFromDB;
    /**
     * Generate structured minutes using OpenAI
     */
    private generateMinutes;
}
//# sourceMappingURL=minutesWorker.service.d.ts.map