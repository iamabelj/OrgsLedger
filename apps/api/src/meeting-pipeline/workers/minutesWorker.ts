// ============================================================
// OrgsLedger — Minutes Worker
// Triggered on meeting end event
// Generates final meeting minutes with action items
// ============================================================

import { Worker, Job, Queue } from 'bullmq';
import { createBullMQConnection, getRedisClient } from '../../infrastructure/redisClient';
import { logger } from '../../logger';
import { MeetingMinutes, ActionItem, Attendee, TranscriptSegment } from '../types';
import { meetingStateManager } from '../meetingState';
import { summaryWorkerManager } from './summaryWorker';
import { db } from '../../db';
import OpenAI from 'openai';
import { AIService } from '../../services/ai.service';
import { services } from '../../services/registry';

const QUEUE_NAME = 'meeting-minutes';
const WORKER_NAME = 'minutes-worker';
const CONCURRENCY = 5;
const MINUTES_KEY = (id: string) => `meeting:minutes:${id}`;
const MINUTES_TTL = 604800; // 7 days

interface MeetingEndJob {
  meetingId: string;
  endedAt: string;
  endedBy?: string;
}

class MinutesWorkerManager {
  private worker: Worker<MeetingEndJob> | null = null;
  private queue: Queue<MeetingEndJob> | null = null;
  private openai: OpenAI | null = null;
  private isRunning = false;
  private minutesCount = 0;

  /**
   * Initialize the minutes worker
   */
  async initialize(): Promise<void> {
    if (this.worker) {
      logger.warn('[MINUTES_WORKER] Already initialized');
      return;
    }

    try {
      if (process.env.OPENAI_API_KEY) {
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      } else {
        logger.warn('[MINUTES_WORKER] OPENAI_API_KEY not set - minutes generation limited');
      }

      const redis = createBullMQConnection();

      // Queue for meeting end events
      this.queue = new Queue<MeetingEndJob>(QUEUE_NAME, {
        connection: redis as any,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 10000 },
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 200 },
        },
      });

      this.worker = new Worker<MeetingEndJob>(
        QUEUE_NAME,
        async (job: Job<MeetingEndJob>) => {
          await this.generateMinutes(job.data);
        },
        {
          connection: redis as any,
          concurrency: CONCURRENCY,
          name: WORKER_NAME,
          lockDuration: 300000, // 5 min lock for full minutes
          lockRenewTime: 120000,
        }
      );

      this.worker.on('ready', () => {
        this.isRunning = true;
        logger.info('[MINUTES_WORKER] Ready', { concurrency: CONCURRENCY });
      });

      this.worker.on('error', (err) => {
        logger.error('[MINUTES_WORKER] Error', err);
      });

      logger.info('[MINUTES_WORKER] Initialized');
    } catch (err) {
      logger.error('[MINUTES_WORKER] Failed to initialize', err);
      throw err;
    }
  }

  /**
   * Trigger minutes generation for a meeting
   */
  async triggerMinutesGeneration(meetingId: string): Promise<void> {
    if (!this.queue) {
      throw new Error('Minutes worker not initialized');
    }

    await this.queue.add(
      'generate-minutes',
      { meetingId, endedAt: new Date().toISOString() },
      { jobId: `minutes-${meetingId}` }
    );

    logger.info('[MINUTES_WORKER] Minutes generation triggered', { meetingId });
  }

  /**
   * Generate final meeting minutes
   */
  private async generateMinutes(job: MeetingEndJob): Promise<void> {
    const { meetingId } = job;
    const startTime = Date.now();

    try {
      logger.info('[MINUTES_WORKER] Starting minutes generation (delegating to AIService)', { meetingId });

      const meeting = await db('meetings').where({ id: meetingId }).select('organization_id').first();
      const organizationId = meeting?.organization_id;
      if (!organizationId) {
        logger.warn('[MINUTES_WORKER] Missing organization_id for meeting; cannot generate minutes', { meetingId });
        return;
      }

      const aiService = services.getOptional('aiService') || new AIService();
      await aiService.processMinutes(meetingId, organizationId);

      this.minutesCount++;
      logger.info('[MINUTES_WORKER] Minutes generation completed', {
        meetingId,
        duration: Date.now() - startTime,
      });
    } catch (err) {
      logger.error('[MINUTES_WORKER] Failed to generate minutes', {
        meetingId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Get full transcript from database + Redis
   */
  private async getFullTranscript(meetingId: string): Promise<TranscriptSegment[]> {
    try {
      // Try database first
      const dbSegments = await db('meeting_transcripts')
        .where({ meeting_id: meetingId })
        .orderBy('spoken_at', 'asc')
        .select('*');

      if (dbSegments.length > 0) {
        return dbSegments.map((row) => ({
          meetingId: row.meeting_id,
          segmentIndex: 0,
          text: row.original_text,
          speakerId: row.speaker_id,
          speakerName: row.speaker_name,
          timestamp: new Date(parseInt(row.spoken_at)).toISOString(),
          isFinal: true,
          language: row.source_lang,
          confidence: 1.0,
        }));
      }

      // Fall back to Redis
      return meetingStateManager.getSegmentsSince(meetingId, 0);
    } catch (err) {
      logger.error('[MINUTES_WORKER] Failed to get transcript', err);
      return [];
    }
  }

  /**
   * Get meeting metadata from database
   */
  private async getMeetingMetadata(meetingId: string): Promise<{
    title?: string;
    attendees: Attendee[];
    startTime?: string;
    endTime?: string;
  }> {
    try {
      const meeting = await db('meetings')
        .where({ id: meetingId })
        .first();

      const participants = await db('meeting_participants')
        .where({ meeting_id: meetingId })
        .select('user_id', 'name', 'role');

      return {
        title: meeting?.title,
        startTime: meeting?.start_time,
        endTime: meeting?.end_time,
        attendees: participants.map((p) => ({
          userId: p.user_id,
          name: p.name || 'Unknown',
          role: p.role,
        })),
      };
    } catch (err) {
      logger.error('[MINUTES_WORKER] Failed to get meeting metadata', err);
      return { attendees: [] };
    }
  }

  /**
   * Generate comprehensive minutes using GPT-4o
   */
  private async generateComprehensiveMinutes(
    meetingId: string,
    segments: TranscriptSegment[],
    existingSummary: any,
    metadata: { title?: string; attendees: Attendee[]; startTime?: string; endTime?: string }
  ): Promise<MeetingMinutes | null> {
    if (!this.openai) {
      // Fallback: basic minutes without AI
      return this.generateBasicMinutes(meetingId, segments, metadata);
    }

    // Build full transcript with speaker labels
    const transcript = segments
      .map((s) => `[${s.speakerName || 'Unknown'}]: ${s.text}`)
      .join('\n');

    // Truncate if too long (keep most recent + beginning)
    const maxContext = 12000;
    let context = transcript;
    if (context.length > maxContext) {
      const start = transcript.slice(0, maxContext / 3);
      const end = transcript.slice(-(maxContext * 2) / 3);
      context = `${start}\n\n[... middle portion omitted ...]\n\n${end}`;
    }

    const prompt = `Generate comprehensive meeting minutes.

Meeting Title: ${metadata.title || 'Meeting'}
Attendees: ${metadata.attendees.map((a) => a.name).join(', ') || 'Unknown'}
Date: ${metadata.startTime || new Date().toISOString()}

${existingSummary ? `Incremental Summary (for context):\n${existingSummary.summary}\n\nKey Points:\n${existingSummary.keyPoints?.join('\n') || 'None'}` : ''}

Full Transcript:
${context}

Generate meeting minutes including:
1. Executive Summary (2-3 sentences)
2. Key Discussion Points (bullet points)
3. Decisions Made
4. Action Items (WHO, WHAT, DEADLINE)
5. Next Steps

Return as JSON:
{
  "summary": "Executive summary...",
  "keyTopics": ["Topic 1", "Topic 2"],
  "decisions": ["Decision 1", "Decision 2"],
  "actionItems": [
    {
      "id": "1",
      "description": "Task description",
      "assignee": "Person name",
      "dueDate": "ISO date or null",
      "priority": "high|medium|low",
      "status": "pending"
    }
  ],
  "nextSteps": ["Step 1", "Step 2"]
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a professional meeting minutes generator. Create clear, structured, and actionable meeting summaries. Always respond with valid JSON only.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 2000,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);

      const minutes: MeetingMinutes = {
        meetingId,
        summary: parsed.summary || 'Meeting summary unavailable',
        keyTopics: parsed.keyTopics || [],
        decisions: parsed.decisions || [],
        actionItems: (parsed.actionItems || []).map((item: any) => ({
          id: item.id || crypto.randomUUID(),
          description: item.description,
          assignee: item.assignee,
          dueDate: item.dueDate,
          priority: item.priority || 'medium',
          status: item.status || 'pending',
        })),
        attendees: metadata.attendees,
        startTime: metadata.startTime || segments[0]?.timestamp,
        endTime: metadata.endTime || segments[segments.length - 1]?.timestamp,
        generatedAt: new Date().toISOString(),
      };

      return minutes;
    } catch (err) {
      logger.error('[MINUTES_WORKER] OpenAI call failed', err);
      return this.generateBasicMinutes(meetingId, segments, metadata);
    }
  }

  /**
   * Generate basic minutes without AI
   */
  private generateBasicMinutes(
    meetingId: string,
    segments: TranscriptSegment[],
    metadata: { title?: string; attendees: Attendee[]; startTime?: string; endTime?: string }
  ): MeetingMinutes {
    // Extract unique speakers as topics proxy
    const speakers = [...new Set(segments.map((s) => s.speakerName).filter(Boolean))];

    return {
      meetingId,
      summary: `Meeting with ${segments.length} transcript segments from ${speakers.length} participants.`,
      keyTopics: speakers.map((s) => `Contributions by ${s}`),
      decisions: [],
      actionItems: [],
      attendees: metadata.attendees,
      startTime: metadata.startTime || segments[0]?.timestamp,
      endTime: metadata.endTime || segments[segments.length - 1]?.timestamp,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Store minutes in Redis and database
   */
  private async storeMinutes(minutes: MeetingMinutes): Promise<void> {
    const redis = await getRedisClient();

    // Store in Redis for fast access
    await redis.setex(MINUTES_KEY(minutes.meetingId), MINUTES_TTL, JSON.stringify(minutes));

    // Store in database for persistence
    try {
      await db('meeting_minutes')
        .insert({
          meeting_id: minutes.meetingId,
          summary: minutes.summary,
          key_topics: JSON.stringify(minutes.keyTopics),
          decisions: JSON.stringify(minutes.decisions || []),
          action_items: JSON.stringify(minutes.actionItems),
          attendees: JSON.stringify(minutes.attendees),
          start_time: minutes.startTime,
          end_time: minutes.endTime,
          generated_at: minutes.generatedAt,
        })
        .onConflict('meeting_id')
        .merge();

      logger.debug('[MINUTES_WORKER] Minutes stored in database', {
        meetingId: minutes.meetingId,
      });
    } catch (err) {
      logger.error('[MINUTES_WORKER] Failed to store minutes in DB', err);
      // Redis storage succeeded, so this is non-fatal
    }
  }

  /**
   * Get minutes for a meeting
   */
  async getMinutes(meetingId: string): Promise<MeetingMinutes | null> {
    // Try Redis first
    const redis = await getRedisClient();
    const cached = await redis.get(MINUTES_KEY(meetingId));
    if (cached) {
      return JSON.parse(cached);
    }

    // Fall back to database
    try {
      const row = await db('meeting_minutes')
        .where({ meeting_id: meetingId })
        .first();

      if (!row) return null;

      // AIService stores meeting_minutes using the unified schema (jsonb columns)
      const parsedDecisions = (() => {
        try {
          if (Array.isArray(row.decisions)) return row.decisions;
          return row.decisions ? JSON.parse(row.decisions) : [];
        } catch {
          return [];
        }
      })();

      const parsedActionItems = (() => {
        try {
          if (Array.isArray(row.action_items)) return row.action_items;
          return row.action_items ? JSON.parse(row.action_items) : [];
        } catch {
          return [];
        }
      })();

      return {
        meetingId: row.meeting_id,
        organizationId: row.organization_id,
        title: undefined,
        summary: row.summary || '',
        keyTopics: [],
        decisions: parsedDecisions,
        actionItems: (parsedActionItems || []).map((ai: any) => ({
          description: ai?.description || ai?.text || String(ai || ''),
          assignee: ai?.assigneeName || ai?.assignee || undefined,
          dueDate: ai?.dueDate || undefined,
          priority: ai?.priority || undefined,
          status: ai?.status || 'pending',
        })) as ActionItem[],
        attendees: [],
        startTime: undefined,
        endTime: undefined,
        generatedAt: row.generated_at instanceof Date ? row.generated_at.toISOString() : String(row.generated_at || new Date().toISOString()),
      };
    } catch (err) {
      logger.error('[MINUTES_WORKER] Failed to get minutes from DB', err);
      return null;
    }
  }

  /**
   * Get worker status
   */
  getStatus(): { running: boolean; minutesCount: number } {
    return {
      running: this.isRunning,
      minutesCount: this.minutesCount,
    };
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
    this.isRunning = false;
    logger.info('[MINUTES_WORKER] Shut down');
  }
}

export const minutesWorkerManager = new MinutesWorkerManager();
