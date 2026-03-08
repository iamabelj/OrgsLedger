// ============================================================
// OrgsLedger — Summary Worker
// Consumes transcript-events, generates incremental summaries
// Updates every N segments using GPT-4o-mini
// ============================================================

import { Worker, Job } from 'bullmq';
import { createBullMQConnection, getRedisClient } from '../../infrastructure/redisClient';
import { logger } from '../../logger';
import { TranscriptSegment, IncrementalSummary } from '../types';
import { meetingStateManager } from '../meetingState';
import { broadcastWorkerManager } from './broadcastWorker';
import OpenAI from 'openai';

const QUEUE_NAME = 'summary-events';
const WORKER_NAME = 'summary-worker';
const CONCURRENCY = 3;
const SUMMARY_INTERVAL = 10; // Generate summary every N final segments
const SUMMARY_KEY = (id: string) => `meeting:summary:${id}`;
const SUMMARY_TTL = 86400;

class SummaryWorkerManager {
  private worker: Worker<TranscriptSegment> | null = null;
  private openai: OpenAI | null = null;
  private isRunning = false;
  private summaryCount = 0;

  // Track segment counts per meeting
  private segmentCounts = new Map<string, number>();

  /**
   * Initialize the summary worker
   */
  async initialize(): Promise<void> {
    if (this.worker) {
      logger.warn('[SUMMARY_WORKER] Already initialized');
      return;
    }

    try {
      if (process.env.OPENAI_API_KEY) {
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      } else {
        logger.warn('[SUMMARY_WORKER] OPENAI_API_KEY not set - summaries disabled');
      }

      const redis = createBullMQConnection();

      this.worker = new Worker<TranscriptSegment>(
        QUEUE_NAME,
        async (job: Job<TranscriptSegment>) => {
          await this.processSegment(job.data);
        },
        {
          connection: redis as any,
          concurrency: CONCURRENCY,
          name: WORKER_NAME,
          lockDuration: 120000, // 2 min lock for AI calls
          lockRenewTime: 60000,
        }
      );

      this.worker.on('ready', () => {
        this.isRunning = true;
        logger.info('[SUMMARY_WORKER] Ready', { concurrency: CONCURRENCY });
      });

      this.worker.on('error', (err) => {
        logger.error('[SUMMARY_WORKER] Error', err);
      });

      logger.info('[SUMMARY_WORKER] Initialized');
    } catch (err) {
      logger.error('[SUMMARY_WORKER] Failed to initialize', err);
      throw err;
    }
  }

  /**
   * Process a transcript segment
   */
  private async processSegment(segment: TranscriptSegment): Promise<void> {
    // Only process final segments for summary
    if (!segment.isFinal) return;

    // Track segment count for this meeting
    const currentCount = (this.segmentCounts.get(segment.meetingId) || 0) + 1;
    this.segmentCounts.set(segment.meetingId, currentCount);

    // Generate summary every N segments
    if (currentCount % SUMMARY_INTERVAL !== 0) return;

    try {
      // Get recent segments from meeting state
      const meeting = await meetingStateManager.getMeeting(segment.meetingId);
      if (!meeting) return;

      const segments = await meetingStateManager.getSegmentsSince(
        segment.meetingId,
        meeting.lastSummarySegment
      );

      if (segments.length < 3) return; // Need minimum context

      // Generate summary
      const summary = await this.generateSummary(segment.meetingId, segments);
      if (!summary) return;

      // Update last summary segment
      await meetingStateManager.updateLastSummarySegment(
        segment.meetingId,
        segment.segmentIndex
      );

      // Broadcast to clients
      broadcastWorkerManager.broadcastSummary(segment.meetingId, {
        summary: summary.summary,
        keyPoints: summary.keyPoints,
        actionItems: summary.actionItems,
      });

      this.summaryCount++;

      logger.debug('[SUMMARY_WORKER] Summary generated', {
        meetingId: segment.meetingId,
        version: summary.version,
        keyPoints: summary.keyPoints.length,
      });
    } catch (err) {
      logger.error('[SUMMARY_WORKER] Failed to generate summary', {
        meetingId: segment.meetingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Generate incremental summary using GPT-4o-mini
   */
  private async generateSummary(
    meetingId: string,
    segments: TranscriptSegment[]
  ): Promise<IncrementalSummary | null> {
    if (!this.openai) return null;

    const redis = await getRedisClient();

    // Get existing summary
    const existingJson = await redis.get(SUMMARY_KEY(meetingId));
    const existing: IncrementalSummary | null = existingJson
      ? JSON.parse(existingJson)
      : null;

    // Build context from segments
    const context = segments
      .map((s) => `[${s.speakerName}]: ${s.text}`)
      .join('\n');

    const prompt = `You are updating a meeting summary incrementally.

${existing ? `Current Summary:\n${existing.summary}\n\nCurrent Key Points:\n${existing.keyPoints.join('\n')}\n\nCurrent Action Items:\n${existing.actionItems.join('\n')}` : 'No summary yet.'}

New Transcript Segments:
${context}

Instructions:
1. Update the summary to incorporate the new content
2. Add any new key discussion points
3. Extract action items (WHO will do WHAT by WHEN)
4. Keep summary concise (max 3 paragraphs)
5. Return JSON only

Return format:
{
  "summary": "Updated summary...",
  "keyPoints": ["Point 1", "Point 2"],
  "actionItems": ["Action 1", "Action 2"]
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a meeting assistant that generates concise summaries. Always respond with valid JSON only.',
          },
          { role: 'user', content: prompt },
        ],
        max_tokens: 1000,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);

      const newSummary: IncrementalSummary = {
        meetingId,
        summary: parsed.summary || existing?.summary || '',
        keyPoints: parsed.keyPoints || existing?.keyPoints || [],
        actionItems: parsed.actionItems || existing?.actionItems || [],
        lastSegmentIndex: segments[segments.length - 1]?.segmentIndex || 0,
        version: (existing?.version || 0) + 1,
        updatedAt: new Date().toISOString(),
      };

      // Store in Redis
      await redis.setex(SUMMARY_KEY(meetingId), SUMMARY_TTL, JSON.stringify(newSummary));

      return newSummary;
    } catch (err) {
      logger.error('[SUMMARY_WORKER] OpenAI call failed', err);
      return null;
    }
  }

  /**
   * Get current summary for a meeting
   */
  async getSummary(meetingId: string): Promise<IncrementalSummary | null> {
    const redis = await getRedisClient();
    const data = await redis.get(SUMMARY_KEY(meetingId));
    return data ? JSON.parse(data) : null;
  }

  /**
   * Get worker status
   */
  getStatus(): { running: boolean; summaryCount: number } {
    return {
      running: this.isRunning,
      summaryCount: this.summaryCount,
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
    this.isRunning = false;
    logger.info('[SUMMARY_WORKER] Shut down');
  }
}

export const summaryWorkerManager = new SummaryWorkerManager();
