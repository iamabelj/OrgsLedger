// ============================================================
// OrgsLedger API — Transcript Service
// Manages meeting transcript storage and retrieval
// Stores final translations to database
// ============================================================

import { logger } from '../logger';
import { db } from '../db';

export interface TranscriptEntry {
  speakerId: string;
  speakerName?: string;
  originalText: string;
  sourceLanguage: string;
  translations: Record<string, string>;
  isFinal: boolean;
  organizationId?: string;
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
      // Resolve organization_id — required NOT NULL column
      let orgId = entry.organizationId;
      if (!orgId) {
        const meeting = await db('meetings').where({ id: meetingId }).select('organization_id').first();
        orgId = meeting?.organization_id;
      }
      if (!orgId) {
        logger.warn('[TRANSCRIPT] Cannot store transcript — organization_id could not be resolved', { meetingId });
        return;
      }

      // Resolve speaker_name — required NOT NULL column
      let speakerName = entry.speakerName || '';
      if (!speakerName) {
        const user = await db('users').where({ id: entry.speakerId }).select('first_name', 'last_name').first();
        speakerName = user ? `${user.first_name} ${user.last_name}`.trim() : 'Unknown';
      }

      // Insert transcript segment — use correct column names matching migration 021
      await db('meeting_transcripts').insert({
        meeting_id: meetingId,
        organization_id: orgId,
        speaker_id: entry.speakerId,
        speaker_name: speakerName,
        original_text: entry.originalText,
        source_lang: entry.sourceLanguage,
        translations: JSON.stringify(entry.translations),
        spoken_at: Date.now(),
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
        speakerName: row.speaker_name,
        originalText: row.original_text,
        sourceLanguage: row.source_lang,
        translations: typeof row.translations === 'string' ? JSON.parse(row.translations) : row.translations,
        isFinal: true,
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
