// ============================================================
// OrgsLedger API — AI Meeting Minutes Service
// Google Speech-to-Text + OpenAI Summarization
// ============================================================

import db from '../db';
import { config } from '../config';
import { logger } from '../logger';
import { writeAuditLog } from '../middleware/audit';
import { sendMeetingMinutesEmail } from './email.service';
import { sendPushToOrg } from './push.service';
import { deductAiWallet, getAiWallet } from './subscription.service';

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
    status: string;
  }>;
  contributions: Array<{
    userName: string;
    speakingTimeSeconds: number;
    keyPoints: string[];
  }>;
}

export class AIService {
  private io: any;

  constructor(io?: any) {
    this.io = io;
  }

  /**
   * Process meeting audio into structured minutes.
   * 1. Transcribe audio via Google Speech-to-Text
   * 2. Summarize & structure via OpenAI
   * 3. Store results
   * 4. Deduct AI credits
   */
  async processMinutes(meetingId: string, organizationId: string): Promise<void> {
    const startTime = Date.now();

    try {
      logger.info(`Starting AI minutes processing for meeting ${meetingId}`);

      const meeting = await db('meetings').where({ id: meetingId }).first();
      if (!meeting) throw new Error('Meeting not found');

      // Check AI wallet balance (use new wallet system)
      const wallet = await getAiWallet(organizationId);
      const balance = parseFloat(wallet.balance_minutes);
      if (balance <= 0) {
        logger.warn('[AI] Insufficient wallet balance', { meetingId, organizationId, available: balance });
        throw new Error('Insufficient AI wallet balance');
      }

      // Calculate meeting duration in minutes (actual, not rounded up to hours)
      const meetingDurationMinutes = meeting.actual_start && meeting.actual_end
        ? Math.max(1, Math.ceil(
            (new Date(meeting.actual_end).getTime() - new Date(meeting.actual_start).getTime()) /
              (1000 * 60)
          ))
        : 60; // default 60 minutes

      // Verify sufficient balance for the meeting duration
      if (balance < meetingDurationMinutes) {
        logger.warn('[AI] Insufficient wallet minutes for meeting duration', {
          meetingId, organizationId, required: meetingDurationMinutes, available: balance,
        });
        throw new Error(`Insufficient AI wallet balance. Need ${meetingDurationMinutes} min, have ${balance.toFixed(1)} min`);
      }

      // Deduct wallet BEFORE processing to prevent free usage on crash
      const deduction = await deductAiWallet(
        organizationId,
        meetingDurationMinutes,
        `AI minutes for "${meeting.title}" (${meetingDurationMinutes} min)`
      );
      if (!deduction.success) {
        throw new Error(deduction.error || 'Wallet deduction failed');
      }

      // Step 1: Transcribe audio OR use live transcripts
      const transcriptStart = Date.now();
      let transcript: TranscriptSegment[];

      if (meeting.audio_storage_url) {
        // Prefer uploaded audio for transcription
        transcript = await this.transcribeAudio(meeting.audio_storage_url);
        logger.info('[AI] Audio transcription complete', { meetingId, durationMs: Date.now() - transcriptStart, segments: transcript.length });
      } else {
        // Fall back to live translation transcripts stored in DB
        transcript = await this.getTranscriptsFromDB(meetingId);
        logger.info('[AI] Using live transcripts from DB', { meetingId, segments: transcript.length });
      }

      // Step 2: Generate structured minutes
      const summarizeStart = Date.now();
      const minutes = await this.generateMinutes(transcript, meeting);
      logger.info('[AI] Summarization complete', { meetingId, durationMs: Date.now() - summarizeStart });

      // Calculate duration in credits (1 credit = 1 hour, rounded up)
      // NOTE: Credits already deducted before processing via deductAiWallet()
      const meetingDurationCredits = meetingDurationMinutes;

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
          ai_credits_used: meetingDurationCredits,
          status: 'completed',
          generated_at: db.fn.now(),
        });

      logger.info('[AI] Minutes processed and stored', {
        meetingId,
        organizationId,
        creditsUsed: meetingDurationCredits,
        totalDurationMs: Date.now() - startTime,
        meetingTitle: meeting.title,
      });

      // Step 5: Notify
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
      await db('notifications').insert(notifications);

      // Emit socket event
      if (this.io) {
        this.io.to(`org:${organizationId}`).emit('meeting:minutes:ready', {
          meetingId,
          title: meeting.title,
        });
      }

      // Send email notification with minutes summary
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
        logger.warn('Failed to send minutes email (non-fatal)', emailErr);
      }

      // Push notification for minutes ready
      sendPushToOrg(organizationId, {
        title: 'Meeting Minutes Ready',
        body: `AI-generated minutes for "${meeting.title}" are now available.`,
        data: { meetingId, type: 'minutes_ready' },
      }).catch(err => logger.warn('Push notification failed (minutes ready)', err));

      await writeAuditLog({
        organizationId,
        userId: meeting.created_by,
        action: 'ai_usage',
        entityType: 'meeting_minutes',
        entityId: meetingId,
        newValue: {
          creditsUsed: meetingDurationCredits,
          processingTimeMs: Date.now() - startTime,
        },
      });

      logger.info(
        `AI minutes completed for meeting ${meetingId} in ${Date.now() - startTime}ms`
      );
    } catch (err: any) {
      logger.error(`AI minutes processing failed for meeting ${meetingId}`, err);

      await db('meeting_minutes')
        .where({ meeting_id: meetingId })
        .update({
          status: 'failed',
          error_message: err.message,
        });

      if (this.io) {
        this.io.to(`org:${organizationId}`).emit('meeting:minutes:failed', {
          meetingId,
          error: err.message,
        });
      }
    }
  }

  /**
   * Transcribe audio using Google Cloud Speech-to-Text.
   * When AI_PROXY_URL is configured, routes through the OrgsLedger AI Gateway
   * so clients never need Google credentials locally.
   */
  private async transcribeAudio(audioUrl: string): Promise<TranscriptSegment[]> {
    // ── Proxy mode: forward to AI Gateway ──────────────
    if (config.aiProxy.url && config.aiProxy.apiKey) {
      try {
        logger.info('Transcribing via AI Gateway proxy');
        const res = await fetch(`${config.aiProxy.url}/api/ai/transcribe`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': config.aiProxy.apiKey,
          },
          body: JSON.stringify({ audioUri: audioUrl }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as any).error || `Proxy returned ${res.status}`);
        }
        const data = await res.json() as any;
        return data.transcript || [];
      } catch (err) {
        logger.error('AI Gateway transcription failed, falling back to mock', err);
        return this.getMockTranscript();
      }
    }

    // ── Direct mode: call Google API directly ──────────
    if (!config.ai.googleCredentials) {
      logger.warn('Google credentials not configured, returning mock transcript');
      return this.getMockTranscript();
    }

    try {
      // Dynamic import for Google Speech
      const speech = await import('@google-cloud/speech');
      const client = new speech.SpeechClient();

      const request = {
        config: {
          encoding: 'LINEAR16' as any,
          sampleRateHertz: 16000,
          languageCode: 'en-US',
          enableAutomaticPunctuation: true,
          enableSpeakerDiarization: true,
          diarizationSpeakerCount: 10,
          model: 'latest_long',
          alternativeLanguageCodes: ['es-ES', 'fr-FR', 'pt-BR', 'sw-KE'],
        },
        audio: {
          uri: audioUrl, // GCS URI like gs://bucket/file.wav
        },
      };

      const [operation] = await client.longRunningRecognize(request);
      const [response] = await operation.promise();

      const segments: TranscriptSegment[] = [];
      let currentTime = 0;

      if (response.results) {
        for (const result of response.results) {
          const alt = result.alternatives?.[0];
          if (alt?.transcript) {
            const words = alt.words || [];
            const startTime = words[0]?.startTime
              ? Number(words[0].startTime.seconds || 0)
              : currentTime;
            const endTime = words[words.length - 1]?.endTime
              ? Number(words[words.length - 1]!.endTime!.seconds || 0)
              : startTime + 5;
            const speakerTag = words[0]?.speakerTag || 0;

            segments.push({
              speakerName: `Speaker ${speakerTag}`,
              text: alt.transcript,
              startTime,
              endTime,
              language: result.languageCode || 'en-US',
            });

            currentTime = endTime;
          }
        }
      }

      return segments;
    } catch (err) {
      logger.error('Google Speech-to-Text failed, falling back to mock', err);
      return this.getMockTranscript();
    }
  }

  /**
   * Generate structured minutes using OpenAI.
   * When AI_PROXY_URL is configured, routes through the OrgsLedger AI Gateway
   * so clients never need an OpenAI key locally.
   */
  private async generateMinutes(
    transcript: TranscriptSegment[],
    meeting: any
  ): Promise<ProcessedMinutes> {
    // ── Proxy mode: forward to AI Gateway ──────────────
    if (config.aiProxy.url && config.aiProxy.apiKey) {
      try {
        logger.info('Generating minutes via AI Gateway proxy');

        const transcriptText = transcript
          .map((s) => `[${s.speakerName}] (${this.formatTime(s.startTime)}): ${s.text}`)
          .join('\n');

        const agendaItems = await db('agenda_items')
          .where({ meeting_id: meeting.id })
          .orderBy('order');

        const res = await fetch(`${config.aiProxy.url}/api/ai/summarize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': config.aiProxy.apiKey,
          },
          body: JSON.stringify({
            transcript: transcriptText,
            meetingTitle: meeting.title,
            meetingDescription: meeting.description || '',
            agenda: agendaItems.map((a: any) => `${a.order}. ${a.title}`),
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as any).error || `Proxy returned ${res.status}`);
        }

        const data = await res.json() as any;
        return {
          transcript,
          summary: data.summary || '',
          decisions: data.decisions || [],
          motions: data.motions || [],
          actionItems: (data.actionItems || []).map((item: any) => ({
            ...item,
            status: item.status || 'pending',
          })),
          contributions: data.contributions || [],
        };
      } catch (err) {
        logger.error('AI Gateway summarization failed, falling back to mock', err);
        return this.getMockMinutes(transcript);
      }
    }

    // ── Direct mode: call OpenAI directly ──────────────
    if (!config.ai.openaiApiKey) {
      logger.warn('OpenAI API key not configured, returning mock minutes');
      return this.getMockMinutes(transcript);
    }

    try {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey: config.ai.openaiApiKey });

      const transcriptText = transcript
        .map((s) => `[${s.speakerName}] (${this.formatTime(s.startTime)}): ${s.text}`)
        .join('\n');

      const agendaItems = await db('agenda_items')
        .where({ meeting_id: meeting.id })
        .orderBy('order');
      const agendaText = agendaItems
        .map((a: any) => `${a.order}. ${a.title}${a.description ? ': ' + a.description : ''}`)
        .join('\n');

      const prompt = `You are a professional meeting secretary. Analyze the following meeting transcript and generate structured meeting minutes.

Meeting: "${meeting.title}"
${meeting.description ? `Description: ${meeting.description}` : ''}
${agendaText ? `\nAgenda:\n${agendaText}` : ''}

Transcript:
${transcriptText}

Generate the following in JSON format:
{
  "summary": "A concise executive summary of the meeting (2-4 paragraphs)",
  "decisions": ["List of decisions made during the meeting"],
  "motions": [{"text": "Motion text", "movedBy": "Speaker name", "secondedBy": "Speaker name", "result": "passed|failed|tabled"}],
  "actionItems": [{"description": "Action item", "assigneeName": "Person responsible", "dueDate": "YYYY-MM-DD or null", "status": "pending"}],
  "contributions": [{"userName": "Speaker name", "speakingTimeSeconds": 120, "keyPoints": ["Key point 1", "Key point 2"]}]
}

Be thorough and accurate. Identify all decisions, motions, and action items.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 4000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('Empty response from OpenAI');

      const parsed = JSON.parse(content);

      return {
        transcript,
        summary: parsed.summary || '',
        decisions: parsed.decisions || [],
        motions: parsed.motions || [],
        actionItems: (parsed.actionItems || []).map((item: any) => ({
          ...item,
          status: item.status || 'pending',
        })),
        contributions: parsed.contributions || [],
      };
    } catch (err) {
      logger.error('OpenAI processing failed, falling back to mock', err);
      return this.getMockMinutes(transcript);
    }
  }

  private formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  private getMockTranscript(): TranscriptSegment[] {
    return [
      {
        speakerName: 'Speaker 1',
        text: 'Meeting transcript will appear here when Google Speech-to-Text credentials are configured.',
        startTime: 0,
        endTime: 10,
        language: 'en-US',
      },
    ];
  }

  /**
   * Get transcripts from the meeting_transcripts table (live translation data).
   * Falls back to mock if table doesn't exist or is empty.
   */
  private async getTranscriptsFromDB(meetingId: string): Promise<TranscriptSegment[]> {
    try {
      const hasTable = await db.schema.hasTable('meeting_transcripts');
      if (!hasTable) {
        logger.warn('[AI] meeting_transcripts table does not exist');
        return this.getMockTranscript();
      }

      const rows = await db('meeting_transcripts')
        .where({ meeting_id: meetingId })
        .orderBy('spoken_at', 'asc')
        .select('*');

      if (rows.length === 0) {
        logger.warn('[AI] No live transcripts found for meeting', { meetingId });
        return this.getMockTranscript();
      }

      // Convert to TranscriptSegment format
      let prevEndTime = 0;
      return rows.map((row: any) => {
        const startTime = prevEndTime;
        const estimatedDuration = Math.max(3, Math.ceil(row.original_text.length / 15)); // ~15 chars/sec speech
        const endTime = startTime + estimatedDuration;
        prevEndTime = endTime;
        return {
          speakerId: row.speaker_id,
          speakerName: row.speaker_name,
          text: row.original_text,
          startTime,
          endTime,
          language: row.source_lang || 'en',
        };
      });
    } catch (err) {
      logger.error('[AI] Failed to get transcripts from DB', err);
      return this.getMockTranscript();
    }
  }

  private getMockMinutes(transcript: TranscriptSegment[]): ProcessedMinutes {
    return {
      transcript,
      summary: 'Meeting minutes will be generated when OpenAI API key is configured.',
      decisions: [],
      motions: [],
      actionItems: [],
      contributions: [],
    };
  }
}
