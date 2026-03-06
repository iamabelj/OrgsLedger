"use strict";
// ============================================================
// OrgsLedger API — Transcript Service
// Manages meeting transcript storage and retrieval
// Stores final translations to database
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.transcriptService = exports.TranscriptService = void 0;
const logger_1 = require("../logger");
const db_1 = require("../db");
/**
 * Service for managing meeting transcripts
 */
class TranscriptService {
    /**
     * Add transcript entry to meeting
     */
    async addTranscriptEntry(meetingId, entry) {
        try {
            // Insert transcript segment
            await (0, db_1.db)('meeting_transcripts').insert({
                meeting_id: meetingId,
                speaker_id: entry.speakerId,
                original_text: entry.originalText,
                source_language: entry.sourceLanguage,
                translations: JSON.stringify(entry.translations),
                is_final: entry.isFinal,
                created_at: new Date(),
            });
            logger_1.logger.debug('Transcript entry stored', {
                meetingId,
                speakerId: entry.speakerId,
                textLength: entry.originalText.length,
            });
        }
        catch (err) {
            logger_1.logger.error('Failed to store transcript entry', {
                meetingId,
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    }
    /**
     * Get transcript for a meeting
     */
    async getTranscript(meetingId) {
        try {
            const rows = await (0, db_1.db)('meeting_transcripts')
                .where({ meeting_id: meetingId })
                .select('*')
                .orderBy('created_at', 'asc');
            if (!rows || rows.length === 0) {
                return null;
            }
            return rows.map((row) => ({
                speakerId: row.speaker_id,
                originalText: row.original_text,
                sourceLanguage: row.source_language,
                translations: typeof row.translations === 'string' ? JSON.parse(row.translations) : row.translations,
                isFinal: row.is_final,
            }));
        }
        catch (err) {
            logger_1.logger.error('Failed to get transcript', {
                meetingId,
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    }
    /**
     * Export transcript in text format
     */
    async exportTranscriptAsText(meetingId) {
        try {
            const meeting = await (0, db_1.db)('meetings')
                .where({ id: meetingId })
                .select('title', 'created_at')
                .first();
            const rows = await (0, db_1.db)('meeting_transcripts')
                .where({ meeting_id: meetingId })
                .select('*')
                .orderBy('created_at', 'asc');
            let text = '';
            // Add header
            if (meeting) {
                text += `Meeting: ${meeting.title}\n`;
                text += `Date: ${new Date(meeting.created_at).toISOString()}\n`;
                text += '\n---\n\n';
            }
            // Add segments
            for (const row of rows) {
                const translations = typeof row.translations === 'string' ? JSON.parse(row.translations) : row.translations;
                text += `[${row.speaker_id}]: ${row.original_text}\n`;
                for (const [lang, translation] of Object.entries(translations)) {
                    if (translation) {
                        text += `  [${lang}]: ${translation}\n`;
                    }
                }
                text += '\n';
            }
            return text;
        }
        catch (err) {
            logger_1.logger.error('Failed to export transcript', {
                meetingId,
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    }
    /**
     * Delete transcript
     */
    async deleteTranscript(meetingId) {
        try {
            await (0, db_1.db)('meeting_transcripts').where({ meeting_id: meetingId }).delete();
            logger_1.logger.debug('Transcript deleted', { meetingId });
        }
        catch (err) {
            logger_1.logger.error('Failed to delete transcript', {
                meetingId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    /**
     * Clear all segments from a transcript (keep metadata)
     */
    async clearTranscriptSegments(meetingId) {
        try {
            await (0, db_1.db)('meeting_transcripts').where({ meeting_id: meetingId }).delete();
            logger_1.logger.debug('Transcript segments cleared', { meetingId });
        }
        catch (err) {
            logger_1.logger.error('Failed to clear transcript segments', {
                meetingId,
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    }
}
exports.TranscriptService = TranscriptService;
// Export singleton instance
exports.transcriptService = new TranscriptService();
//# sourceMappingURL=transcript.service.js.map