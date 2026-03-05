// ============================================================
// OrgsLedger API — Transcript Service
// Manages meeting transcript storage and retrieval
// Stores final translations to database
// ============================================================

import { logger } from '../logger';
import { db } from '../db';

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
export class TranscriptService {
  /**
   * Add transcript entry to meeting
   */
  async addTranscriptEntry(meetingId: string, entry: TranscriptEntry): Promise<void> {
    try {
      // Insert transcript segment
      await db('meeting_transcripts').insert({
        meeting_id: meetingId,
        speaker_id: entry.speakerId,
        original_text: entry.originalText,
        source_language: entry.sourceLanguage,
        translations: JSON.stringify(entry.translations),
        is_final: entry.isFinal,
        created_at: new Date(),
      });

      logger.debug('Transcript entry stored', {
        meetingId,
        speakerId: entry.speakerId,
        textLength: entry.originalText.length,
      });
    } catch (err) {
      logger.error('Failed to store transcript entry', {
        meetingId,
        error: err instanceof Error ? err.message : String(err),
      });

      throw err;
    }
  }

  /**
   * Get transcript for a meeting
   */
  async getTranscript(meetingId: string): Promise<TranscriptEntry[] | null> {
    try {
      const rows = await db('meeting_transcripts')
        .where({ meeting_id: meetingId })
        .select('*')
        .orderBy('created_at', 'asc');

      if (!rows || rows.length === 0) {
        return null;
      }

      return rows.map((row: any) => ({
        speakerId: row.speaker_id,
        originalText: row.original_text,
        sourceLanguage: row.source_language,
        translations: typeof row.translations === 'string' ? JSON.parse(row.translations) : row.translations,
        isFinal: row.is_final,
      }));
    } catch (err) {
      logger.error('Failed to get transcript', {
        meetingId,
        error: err instanceof Error ? err.message : String(err),
      });

      throw err;
    }
  }

  /**
   * Export transcript in text format
   */
  async exportTranscriptAsText(meetingId: string): Promise<string> {
    try {
      const meeting = await db('meetings')
        .where({ id: meetingId })
        .select('title', 'created_at')
        .first();

      const rows = await db('meeting_transcripts')
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
    } catch (err) {
      logger.error('Failed to export transcript', {
        meetingId,
        error: err instanceof Error ? err.message : String(err),
      });

      throw err;
    }
  }

  /**
   * Delete transcript
   */
  async deleteTranscript(meetingId: string): Promise<void> {
    try {
      await db('meeting_transcripts').where({ meeting_id: meetingId }).delete();
      logger.debug('Transcript deleted', { meetingId });
    } catch (err) {
      logger.error('Failed to delete transcript', {
        meetingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Clear all segments from a transcript (keep metadata)
   */
  async clearTranscriptSegments(meetingId: string): Promise<void> {
    try {
      await db('meeting_transcripts').where({ meeting_id: meetingId }).delete();
      logger.debug('Transcript segments cleared', { meetingId });
    } catch (err) {
      logger.error('Failed to clear transcript segments', {
        meetingId,
        error: err instanceof Error ? err.message : String(err),
      });

      throw err;
    }
  }
}

// Export singleton instance
export const transcriptService = new TranscriptService();
