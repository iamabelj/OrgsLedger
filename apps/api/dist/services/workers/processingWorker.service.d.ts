export interface ProcessingWorker {
    processTranslation(meetingId: string, speakerId: string, originalText: string, sourceLanguage: string, targetLanguages: string[], isFinal: boolean, organizationId?: string): Promise<{
        finalTranslations?: Record<string, string>;
        error?: string;
    }>;
}
/**
 * Service that processes translation jobs from the queue
 */
export declare class ProcessingWorkerService implements ProcessingWorker {
    private bufferTimeout;
    constructor();
    /**
     * Process a single translation job
     * Handles both interim ("in-progress") and final translations
     */
    processTranslation(meetingId: string, speakerId: string, originalText: string, sourceLanguage: string, targetLanguages: string[], isFinal: boolean, organizationId?: string): Promise<{
        finalTranslations?: Record<string, string>;
        error?: string;
    }>;
    /**
     * Handle speaker left meeting - flush any buffered segments for speaker
     */
    handleSpeakerDisconnect(meetingId: string, speakerId: string): Promise<void>;
    /**
     * Cleanup processing worker resources
     */
    cleanup(): Promise<void>;
}
//# sourceMappingURL=processingWorker.service.d.ts.map