// ============================================================
// OrgsLedger API — Minutes Worker Service
// Core business logic for processing AI meeting minutes
// Handles transcription, summarization, and wallet deduction
// ============================================================

import { logger } from '../../logger';
import { broadcastToQueue } from '../../queues/broadcast.queue';
import db from '../../db';
import { config } from '../../config';
import { writeAuditLog } from '../../middleware/audit';
import { sendMeetingMinutesEmail } from '../email.service';
import { sendPushToOrg } from '../push.service';
import { deductAiWallet, getAiWallet } from '../subscription.service';

interface TranscriptSegment {
  speakerId?: string;
  speakerName: string;
  text: string;
  startTime: number;
  endTime: number;
  language?: string;
}

interface ProcessedMinutes {
  transcript: TranscriptSegment[];
  summary: string;
  decisions: string[];
  motions: Array<{
    text: string;
    movedBy?: string;
    secondedBy?: string;
    result?: string;
  }>;
  actionItems: Array<{
    description: string;
    assigneeName?: string;
    dueDate?: string;
    priority?: string;
    status: string;
  }>;
  contributions: Array<{
    userName: string;
    speakingTimeSeconds: number;
    keyPoints: string[];
  }>;
}

/**
 * Service that processes AI minutes generation jobs from the queue
 */
export class MinutesWorkerService {
  private io: any;

  constructor(io?: any) {
    this.io = io;
  }

  /**
   * Process a minutes generation job
   * Handles transcription, summarization, storage, and notifications
   */
  async processMinutes(
    meetingId: string,
    organizationId: string
  ): Promise<{ success: boolean; error?: string }> {
    const startTime = Date.now();
    let meetingDurationMinutes = 0;

    try {
      logger.info('[MINUTES_WORKER] Processing AI minutes', {
        meetingId,
        organizationId,
      });

      const meeting = await db('meetings').where({ id: meetingId }).first();
      if (!meeting) {
        throw new Error('Meeting not found');
      }

      // Check AI wallet balance
      const wallet = await getAiWallet(organizationId);
      const balance = parseFloat(wallet.balance_minutes);
      if (balance <= 0) {
        logger.warn('[MINUTES_WORKER] Insufficient wallet balance', {
          meetingId,
          organizationId,
          balance,
        });
        throw new Error('Insufficient AI wallet balance');
      }

      // Calculate meeting duration
      meetingDurationMinutes = meeting.actual_start && meeting.actual_end
        ? Math.max(1, Math.ceil(
            (new Date(meeting.actual_end).getTime() - new Date(meeting.actual_start).getTime()) /
              (1000 * 60)
          ))
        : 60;

      if (balance < meetingDurationMinutes) {
        logger.warn('[MINUTES_WORKER] Insufficient wallet minutes for duration', {
          meetingId,
          organizationId,
          required: meetingDurationMinutes,
          available: balance,
        });
        throw new Error(`Insufficient AI wallet balance. Need ${meetingDurationMinutes} min, have ${balance.toFixed(1)} min`);
      }

      // Deduct wallet BEFORE processing
      const deduction = await deductAiWallet(
        organizationId,
        meetingDurationMinutes,
        `AI minutes for "${meeting.title}" (${meetingDurationMinutes} min)`
      );
      if (!deduction.success) {
        throw new Error(deduction.error || 'Wallet deduction failed');
      }

      // Step 1: Get transcript (either from audio or DB)
      const transcriptStart = Date.now();
      let transcript: TranscriptSegment[];

      if (meeting.audio_storage_url) {
        // Use uploaded audio for transcription
        transcript = await this.transcribeAudio(meeting.audio_storage_url);
        logger.info('[MINUTES_WORKER] Audio transcribed', {
          meetingId,
          durationMs: Date.now() - transcriptStart,
          segments: transcript.length,
        });
      } else {
        // Fall back to live transcripts from DB
        transcript = await this.getTranscriptsFromDB(meetingId);
        logger.info('[MINUTES_WORKER] Live transcripts retrieved', {
          meetingId,
          segments: transcript.length,
        });
      }

      // Step 2: Generate structured minutes
      const summarizeStart = Date.now();
      const minutes = await this.generateMinutes(transcript, meeting);
      logger.info('[MINUTES_WORKER] Minutes generated', {
        meetingId,
        durationMs: Date.now() - summarizeStart,
      });

      // Step 3: Store results
      await db('meeting_minutes')
        .where({ meeting_id: meetingId })
        .update({
          transcript: JSON.stringify(minutes.transcript),
          summary: minutes.summary,
          decisions: JSON.stringify(minutes.decisions),
          motions: JSON.stringify(minutes.motions),
          action_items: JSON.stringify(minutes.actionItems),
          contributions: JSON.stringify(minutes.contributions),
          ai_credits_used: meetingDurationMinutes,
          status: 'completed',
          generated_at: db.fn.now(),
        });

      const storedMinutes = await db('meeting_minutes')
        .where({ meeting_id: meetingId })
        .select('id', 'status', 'ai_credits_used')
        .first();

      logger.info('[MINUTES_WORKER] Minutes stored successfully', {
        meetingId,
        organizationId,
        minutesId: storedMinutes?.id,
        creditsUsed: meetingDurationMinutes,
        totalDurationMs: Date.now() - startTime,
      });

      // Step 4: Notify organization
      const members = await db('memberships')
        .where({ organization_id: organizationId, is_active: true })
        .pluck('user_id');

      const notifications = members.map((userId: string) => ({
        user_id: userId,
        organization_id: organizationId,
        type: 'minutes_ready',
        title: 'Meeting Minutes Ready',
        body: `AI-generated minutes for "${meeting.title}" are now available.`,
        data: JSON.stringify({ meetingId }),
      }));

      if (notifications.length > 0) {
        await db('notifications').insert(notifications);
      }

      // Emit socket events
      if (this.io) {
        this.io.to(`org:${organizationId}`).emit('meeting:minutes:ready', {
          meetingId,
          title: meeting.title,
        });
        this.io.to(`meeting:${meetingId}`).emit('meeting:minutes:ready', {
          meetingId,
          title: meeting.title,
        });
      }

      // Send email notification
      try {
        const memberEmails = await db('memberships')
          .join('users', 'memberships.user_id', 'users.id')
          .where({ 'memberships.organization_id': organizationId, 'memberships.is_active': true })
          .pluck('users.email');

        if (memberEmails.length > 0) {
          await sendMeetingMinutesEmail(
            meeting.title,
            minutes.summary,
            memberEmails
          );
        }
      } catch (emailErr) {
        logger.warn('[MINUTES_WORKER] Email notification failed (non-fatal)', emailErr);
      }

      // Send push notification
      sendPushToOrg(organizationId, {
        title: 'Meeting Minutes Ready',
        body: `AI-generated minutes for "${meeting.title}" are now available.`,
        data: { meetingId, type: 'minutes_ready' },
      }).catch(err => logger.warn('[MINUTES_WORKER] Push notification failed', err));

      // Audit log
      await writeAuditLog({
        organizationId,
        userId: meeting.created_by,
        action: 'ai_usage',
        entityType: 'meeting_minutes',
        entityId: meetingId,
        newValue: {
          creditsUsed: meetingDurationMinutes,
          processingTimeMs: Date.now() - startTime,
        },
      });

      logger.info('[MINUTES_WORKER] Minutes processing completed', {
        meetingId,
        organizationId,
        durationMs: Date.now() - startTime,
      });

      return { success: true };
    } catch (err: any) {
      logger.error('[MINUTES_WORKER] Processing failed', {
        meetingId,
        organizationId,
        error: err instanceof Error ? err.message : String(err),
      });

      // Refund wallet on failure
      try {
        const minutesRow = await db('meeting_minutes')
          .where({ meeting_id: meetingId })
          .select('ai_credits_used')
          .first();
        const deductedMinutes = minutesRow?.ai_credits_used || meetingDurationMinutes;

        if (deductedMinutes > 0) {
          await deductAiWallet(
            organizationId,
            -deductedMinutes,
            `Refund: AI minutes failed for meeting ${meetingId}`
          );
          logger.info('[MINUTES_WORKER] Wallet refunded', {
            meetingId,
            organizationId,
            refundMinutes: deductedMinutes,
          });
        }
      } catch (refundErr) {
        logger.error('[MINUTES_WORKER] Wallet refund failed', {
          meetingId,
          error: refundErr instanceof Error ? refundErr.message : String(refundErr),
        });
      }

      // Emit error event
      if (this.io) {
        this.io.to(`meeting:${meetingId}`).emit('meeting:minutes:failed', {
          meetingId,
          error: 'Minutes generation failed. Please try again later.',
        });
      }

      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  /**
   * Transcribe audio using Google Speech-to-Text
   */
  private async transcribeAudio(audioUrl: string): Promise<TranscriptSegment[]> {
    // This is a stub - actual implementation from ai.service.ts
    // in production, this would call Google Cloud Speech-to-Text API
    logger.debug('[MINUTES_WORKER] Transcribing audio', { audioUrl });
    return [];
  }

  /**
   * Get transcripts from database
   */
  private async getTranscriptsFromDB(meetingId: string): Promise<TranscriptSegment[]> {
    try {
      const rows = await db('meeting_transcripts')
        .where({ meeting_id: meetingId })
        .orderBy('created_at', 'asc');

      return rows.map((row: any) => ({
        speakerId: row.speaker_id,
        speakerName: row.speaker_name || 'Unknown',
        text: row.original_text,
        startTime: new Date(row.created_at).getTime(),
        endTime: new Date(row.created_at).getTime() + 1000, // Placeholder
        language: row.source_language,
      }));
    } catch (err) {
      logger.error('[MINUTES_WORKER] Failed to get transcripts from DB', err);
      return [];
    }
  }

  /**
   * Generate structured minutes using OpenAI
   */
  private async generateMinutes(
    transcript: TranscriptSegment[],
    meeting: any
  ): Promise<ProcessedMinutes> {
    // This is a stub - actual implementation from ai.service.ts
    // in production, this would call OpenAI GPT API
    logger.debug('[MINUTES_WORKER] Generating minutes', {
      transcriptSegments: transcript.length,
      meetingTitle: meeting.title,
    });

    return {
      transcript,
      summary: 'Minutes generation in progress...',
      decisions: [],
      motions: [],
      actionItems: [],
      contributions: [],
    };
  }
}
