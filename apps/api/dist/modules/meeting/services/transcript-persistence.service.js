"use strict";
// ============================================================
// OrgsLedger API — Transcript Persistence Service
// Handles persisting transcripts from Redis to PostgreSQL.
// Called when a meeting ends to archive the full transcript.
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.transcriptPersistenceService = void 0;
const db_1 = __importDefault(require("../../../db"));
const logger_1 = require("../../../logger");
const transcript_worker_1 = require("../../../workers/transcript.worker");
/**
 * Transcript persistence service - handles archival to PostgreSQL
 */
class TranscriptPersistenceService {
    /**
     * Persist transcript entries from Redis to PostgreSQL.
     * Called when a meeting ends to archive transcripts for permanent storage.
     */
    async persistMeetingTranscript(meetingId, organizationId) {
        try {
            // 1. Get transcripts from Redis
            const transcripts = await (0, transcript_worker_1.getMeetingTranscripts)(meetingId);
            if (transcripts.length === 0) {
                logger_1.logger.info('[TRANSCRIPT_PERSISTENCE] No transcripts to persist', {
                    meetingId,
                });
                return { success: true, wordCount: 0, speakerCount: 0 };
            }
            // 2. Calculate stats
            const wordCount = transcripts.reduce((count, t) => {
                return count + (t.text?.split(/\s+/).length || 0);
            }, 0);
            const uniqueSpeakers = new Set(transcripts.map(t => t.speaker || 'unknown'));
            const speakerCount = uniqueSpeakers.size;
            // 3. Calculate duration (first to last timestamp)
            const timestamps = transcripts
                .map(t => new Date(t.timestamp).getTime())
                .sort((a, b) => a - b);
            const durationSeconds = timestamps.length > 1
                ? Math.floor((timestamps[timestamps.length - 1] - timestamps[0]) / 1000)
                : 0;
            // 4. Transform to TranscriptEntry[] format
            const fullTranscript = transcripts.map((t, index) => ({
                id: `${meetingId}-${t.timestamp}`,
                meetingId,
                speakerId: t.speakerId || '',
                speakerName: t.speaker || 'Unknown',
                text: t.text,
                timestamp: t.timestamp,
                confidence: t.confidence,
                language: t.language,
                isFinal: true,
                sequence: index + 1,
            }));
            // 5. Insert or update in PostgreSQL
            await (0, db_1.default)('meeting_transcripts')
                .insert({
                meeting_id: meetingId,
                organization_id: organizationId,
                full_transcript: JSON.stringify(fullTranscript),
                word_count: wordCount,
                duration_seconds: durationSeconds,
                speaker_count: speakerCount,
            })
                .onConflict('meeting_id')
                .merge({
                full_transcript: JSON.stringify(fullTranscript),
                word_count: wordCount,
                duration_seconds: durationSeconds,
                speaker_count: speakerCount,
                updated_at: db_1.default.fn.now(),
            });
            logger_1.logger.info('[TRANSCRIPT_PERSISTENCE] Transcript persisted', {
                meetingId,
                organizationId,
                entryCount: transcripts.length,
                wordCount,
                speakerCount,
                durationSeconds,
            });
            return { success: true, wordCount, speakerCount };
        }
        catch (err) {
            logger_1.logger.error('[TRANSCRIPT_PERSISTENCE] Failed to persist', {
                meetingId,
                error: err.message,
            });
            throw err;
        }
    }
    /**
     * Get persisted transcript from PostgreSQL.
     * Use this for historical access after meeting has ended.
     */
    async getPersistedTranscript(meetingId) {
        try {
            const row = await (0, db_1.default)('meeting_transcripts')
                .where('meeting_id', meetingId)
                .first();
            if (!row) {
                return null;
            }
            let entries = [];
            try {
                entries = typeof row.full_transcript === 'string'
                    ? JSON.parse(row.full_transcript)
                    : row.full_transcript || [];
            }
            catch {
                entries = [];
            }
            return {
                entries,
                wordCount: row.word_count || 0,
                speakerCount: row.speaker_count || 0,
                durationSeconds: row.duration_seconds || 0,
                createdAt: row.created_at?.toISOString() || '',
            };
        }
        catch (err) {
            logger_1.logger.error('[TRANSCRIPT_PERSISTENCE] Failed to get transcript', {
                meetingId,
                error: err.message,
            });
            throw err;
        }
    }
    /**
     * Get transcript for a meeting - from Redis if active, PostgreSQL if ended.
     */
    async getTranscript(meetingId) {
        // Try Redis first (active meetings)
        const redisTranscripts = await (0, transcript_worker_1.getMeetingTranscripts)(meetingId);
        if (redisTranscripts.length > 0) {
            // Transform Redis format to TranscriptEntry
            return redisTranscripts.map((t, index) => ({
                id: `${meetingId}-${t.timestamp}`,
                meetingId,
                speakerId: t.speakerId || '',
                speakerName: t.speaker || 'Unknown',
                text: t.text,
                timestamp: t.timestamp,
                confidence: t.confidence,
                language: t.language,
                isFinal: true,
                sequence: index + 1,
            }));
        }
        // Fall back to PostgreSQL (ended meetings)
        const persisted = await this.getPersistedTranscript(meetingId);
        return persisted?.entries || [];
    }
    /**
     * Get transcript stats for an organization's meetings.
     */
    async getOrganizationTranscriptStats(organizationId) {
        try {
            const result = await (0, db_1.default)('meeting_transcripts')
                .where('organization_id', organizationId)
                .select(db_1.default.raw('COUNT(*) as total_transcripts'), db_1.default.raw('COALESCE(SUM(word_count), 0) as total_word_count'), db_1.default.raw('COALESCE(SUM(duration_seconds), 0) as total_duration_seconds'), db_1.default.raw('COALESCE(AVG(word_count), 0) as avg_word_count'), db_1.default.raw('COALESCE(AVG(duration_seconds), 0) as avg_duration_seconds'))
                .first();
            return {
                totalTranscripts: parseInt(result?.total_transcripts || '0', 10),
                totalWordCount: parseInt(result?.total_word_count || '0', 10),
                totalDurationSeconds: parseInt(result?.total_duration_seconds || '0', 10),
                averageWordCount: Math.round(parseFloat(result?.avg_word_count || '0')),
                averageDurationSeconds: Math.round(parseFloat(result?.avg_duration_seconds || '0')),
            };
        }
        catch (err) {
            logger_1.logger.error('[TRANSCRIPT_PERSISTENCE] Failed to get org stats', {
                organizationId,
                error: err.message,
            });
            throw err;
        }
    }
}
// ── Singleton Export ────────────────────────────────────────
exports.transcriptPersistenceService = new TranscriptPersistenceService();
//# sourceMappingURL=transcript-persistence.service.js.map