export interface TranscriptEntry {
    speakerId: string;
    originalText: string;
    sourceLanguage: string;
    translations: Record<string, string>;
    isFinal: boolean;
}
/**
 * Service for managing meeting transcripts
 */
export declare class TranscriptService {
    /**
     * Add transcript entry to meeting
     */
    addTranscriptEntry(meetingId: string, entry: TranscriptEntry): Promise<void>;
    /**
     * Get transcript for a meeting
     */
    getTranscript(meetingId: string): Promise<TranscriptEntry[] | null>;
    /**
     * Export transcript in text format
     */
    exportTranscriptAsText(meetingId: string): Promise<string>;
    /**
     * Delete transcript
     */
    deleteTranscript(meetingId: string): Promise<void>;
    /**
     * Clear all segments from a transcript (keep metadata)
     */
    clearTranscriptSegments(meetingId: string): Promise<void>;
}
export declare const transcriptService: TranscriptService;
//# sourceMappingURL=transcript.service.d.ts.map