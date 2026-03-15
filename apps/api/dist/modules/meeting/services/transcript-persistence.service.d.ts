import { TranscriptEntry } from '../models';
/**
 * Transcript persistence service - handles archival to PostgreSQL
 */
declare class TranscriptPersistenceService {
    /**
     * Persist transcript entries from Redis to PostgreSQL.
     * Called when a meeting ends to archive transcripts for permanent storage.
     */
    persistMeetingTranscript(meetingId: string, organizationId: string): Promise<{
        success: boolean;
        wordCount: number;
        speakerCount: number;
    }>;
    /**
     * Get persisted transcript from PostgreSQL.
     * Use this for historical access after meeting has ended.
     */
    getPersistedTranscript(meetingId: string): Promise<{
        entries: TranscriptEntry[];
        wordCount: number;
        speakerCount: number;
        durationSeconds: number;
        createdAt: string;
    } | null>;
    /**
     * Get transcript for a meeting - from Redis if active, PostgreSQL if ended.
     */
    getTranscript(meetingId: string): Promise<TranscriptEntry[]>;
    /**
     * Get transcript stats for an organization's meetings.
     */
    getOrganizationTranscriptStats(organizationId: string): Promise<{
        totalTranscripts: number;
        totalWordCount: number;
        totalDurationSeconds: number;
        averageWordCount: number;
        averageDurationSeconds: number;
    }>;
}
export declare const transcriptPersistenceService: TranscriptPersistenceService;
export {};
//# sourceMappingURL=transcript-persistence.service.d.ts.map