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
    priority?: string;
    status: string;
  }>;
  contributions: Array<{
    userName: string;
    speakingTimeSeconds: number;
    keyPoints: string[];
  }>;
}

// Singleton OpenAI client (avoid re-instantiating per call)
let openaiSingleton: any = null;
function getOpenAI() {
  if (!openaiSingleton && config.ai.openaiApiKey) {
    const OpenAI = require('openai').default;
    openaiSingleton = new OpenAI({ apiKey: config.ai.openaiApiKey });
  }
  return openaiSingleton;
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
    let meetingDurationMinutes = 0; // Track for refund on failure

    try {
      logger.info(`[MINUTES_PIPELINE] Starting AI minutes processing for meeting ${meetingId}`);

      const meeting = await db('meetings').where({ id: meetingId }).first();
      if (!meeting) throw new Error('Meeting not found');

      // Check AI wallet balance (use new wallet system)
      const wallet = await getAiWallet(organizationId);
      const balance = parseFloat(wallet.balance_minutes);
      if (balance <= 0) {
        logger.warn('[MINUTES_PIPELINE] Insufficient wallet balance', { meetingId, organizationId, available: balance });
        throw new Error('Insufficient AI wallet balance');
      }

      // Calculate meeting duration in minutes (actual, not rounded up to hours)
      meetingDurationMinutes = meeting.actual_start && meeting.actual_end
        ? Math.max(1, Math.ceil(
            (new Date(meeting.actual_end).getTime() - new Date(meeting.actual_start).getTime()) /
              (1000 * 60)
          ))
        : 60; // default 60 minutes

      // Verify sufficient balance for the meeting duration
      if (balance < meetingDurationMinutes) {
        logger.warn('[MINUTES_PIPELINE] Insufficient wallet minutes for meeting duration', {
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
        logger.info('[MINUTES_PIPELINE] Audio transcription complete', { meetingId, durationMs: Date.now() - transcriptStart, segments: transcript.length });
      } else {
        // Fall back to live translation transcripts stored in DB
        transcript = await this.getTranscriptsFromDB(meetingId);
        // ── LAYER 9 — Confirm transcript rows exist ─────
        logger.info('[MINUTES_PIPELINE] Using live transcripts from DB', { meetingId, segments: transcript.length });
        if (transcript.length === 0) {
          logger.warn('[MINUTES_PIPELINE] No transcripts found in DB — minutes will be empty', { meetingId });
        }
      }

      // Step 2: Generate structured minutes
      const summarizeStart = Date.now();
      const minutes = await this.generateMinutes(transcript, meeting);
      logger.info('[MINUTES_PIPELINE] Summarization COMPLETE', { meetingId, durationMs: Date.now() - summarizeStart });

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

      // ── LAYER 9 — Confirm meeting_minutes row created ──
      const storedMinutes = await db('meeting_minutes').where({ meeting_id: meetingId }).select('id', 'status', 'ai_credits_used').first();
      logger.info('[MINUTES_PIPELINE] Minutes STORED successfully', {
        meetingId,
        organizationId,
        minutesId: storedMinutes?.id,
        status: storedMinutes?.status,
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

      // Emit socket event to both org and meeting rooms
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
        `[MINUTES_PIPELINE] AI minutes COMPLETED for meeting ${meetingId} in ${Date.now() - startTime}ms`
      );
    } catch (err: any) {
      logger.error(`[MINUTES_PIPELINE] Processing FAILED for meeting ${meetingId}`, err);

      // Refund wallet on processing failure (credits were deducted upfront)
      try {
        const minutesRow = await db('meeting_minutes').where({ meeting_id: meetingId }).select('ai_credits_used').first();
        const deductedMinutes = minutesRow?.ai_credits_used || meetingDurationMinutes;
        if (deductedMinutes > 0) {
          // Negative deduction = refund
          await deductAiWallet(
            organizationId,
            -deductedMinutes,
            `Refund: AI minutes failed for meeting ${meetingId}`
          );
          logger.info(`[AI] Wallet refunded ${deductedMinutes} minutes for failed processing`, { meetingId });
        }
      } catch (refundErr) {
        logger.error('[AI] Failed to refund wallet after processing failure', refundErr);
      }

      await db('meeting_minutes')
        .where({ meeting_id: meetingId })
        .update({
          status: 'failed',
          error_message: err.message,
        });

      if (this.io) {
        // Emit to both org and meeting rooms for consistency
        this.io.to(`org:${organizationId}`).emit('meeting:minutes:failed', {
          meetingId,
          error: err.message,
        });
        this.io.to(`meeting:${meetingId}`).emit('meeting:minutes:failed', {
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
        logger.error('AI Gateway transcription failed', err);
        throw new Error('Audio transcription failed via AI Gateway');
      }
    }

    // ── Direct mode: call Google API directly ──────────
    if (!config.ai.googleCredentials) {
      logger.warn('Google credentials not configured');
      throw new Error('No transcription service configured (no AI proxy, no Google credentials)');
    }

    try {
      // Dynamic import for Google Speech
      const speech = await import('@google-cloud/speech');
      const client = new speech.SpeechClient();

      const request = {
        config: {
          encoding: 'LINEAR16' as any,
          sampleRateHertz: 16000,
          // Google STT requires a valid BCP-47 code; 'auto' is not valid.
          // Use 'en-US' as primary with broad alternativeLanguageCodes for
          // 100+ language auto-detection.
          languageCode: 'en-US',
          alternativeLanguageCodes: [
            'fr-FR', 'es-ES', 'de-DE', 'pt-BR', 'it-IT', 'nl-NL',
            'ar-SA', 'zh-CN', 'ja-JP', 'ko-KR', 'hi-IN', 'ru-RU',
            'tr-TR', 'pl-PL', 'sv-SE', 'da-DK', 'fi-FI', 'no-NO',
            'uk-UA', 'ro-RO', 'cs-CZ', 'el-GR', 'he-IL', 'th-TH',
            'vi-VN', 'id-ID', 'ms-MY', 'sw-KE', 'af-ZA', 'zu-ZA',
          ],
          enableAutomaticPunctuation: true,
          enableSpeakerDiarization: true,
          diarizationSpeakerCount: 10,
          model: 'latest_long',
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
      logger.error('Google Speech-to-Text failed', err);
      throw new Error('Audio transcription failed via Google Speech-to-Text');
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
        logger.error('AI Gateway summarization failed', err);
        throw new Error('Minutes generation failed via AI Gateway');
      }
    }

    // ── Direct mode: call OpenAI directly ──────────────
    const openai = getOpenAI();
    if (!openai) {
      logger.warn('OpenAI API key not configured');
      throw new Error('OpenAI API key not configured — cannot generate minutes');
    }

    try {

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
  "actionItems": [{"description": "Action item", "assigneeName": "Person responsible", "dueDate": "YYYY-MM-DD or null", "priority": "critical|high|medium|low", "status": "pending"}],
  "contributions": [{"userName": "Speaker name", "speakingTimeSeconds": 120, "keyPoints": ["Key point 1", "Key point 2"]}]
}

For action items:
- Priority levels: Use "critical" for items blocking other work or time-sensitive, "high" for important but not blocking, "medium" for nice-to-have, "low" for minor items
- Due dates: Extract from meeting context (e.g., "by EOW", "next week", explicit dates). Use YYYY-MM-DD format or null if not specified.

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
          priority: item.priority || 'medium',
        })),
        contributions: parsed.contributions || [],
      };
    } catch (err) {
      logger.error('OpenAI processing failed', err);
      throw new Error('Minutes generation failed via OpenAI');
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

      // Convert to TranscriptSegment format using real spoken_at timestamps
      const baseTime = rows[0]?.spoken_at ? Number(rows[0].spoken_at) : 0;
      return rows.map((row: any, idx: number) => {
        const spokenAt = row.spoken_at ? Number(row.spoken_at) : 0;
        // Use real timestamps relative to first segment (convert ms → seconds)
        const startTime = baseTime ? Math.max(0, (spokenAt - baseTime) / 1000) : idx * 5;
        const estimatedDuration = Math.max(3, Math.ceil(row.original_text.length / 15));
        const endTime = startTime + estimatedDuration;
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
