// ============================================================
// OrgsLedger API — Summary Worker
// Generates incremental summaries during active meetings
// Part of AI processing path - does not block real-time captions
// Maintains rolling summary cache for real-time context
// ============================================================

import { Worker, Job } from 'bullmq';
import { createBullMQConnection, getRedisClient } from '../infrastructure/redisClient';
import { logger } from '../logger';
import { SummaryEventData, IncrementalSummary } from '../queues/summaryEvents.queue';
import OpenAI from 'openai';

// ── Configuration ─────────────────────────────────────────────

const WORKER_CONCURRENCY = parseInt(process.env.SUMMARY_WORKER_CONCURRENCY || '3', 10);
const SUMMARY_CACHE_TTL = parseInt(process.env.SUMMARY_CACHE_TTL || '7200', 10); // 2 hours
const MAX_CONTEXT_TOKENS = parseInt(process.env.SUMMARY_MAX_CONTEXT || '4000', 10);
const OPENAI_MODEL = process.env.SUMMARY_MODEL || 'gpt-4o-mini';

// ── Redis Keys ────────────────────────────────────────────────

const SUMMARY_KEY = (meetingId: string) => `summary:incremental:${meetingId}`;
const CONTEXT_KEY = (meetingId: string) => `summary:context:${meetingId}`;

// ── OpenAI Client ─────────────────────────────────────────────

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openai;
}

// ── Summary Worker Class ──────────────────────────────────────

class SummaryWorkerManager {
  private worker: Worker<SummaryEventData> | null = null;
  private isRunning = false;
  private processedCount = 0;
  private failedCount = 0;

  /**
   * Initialize summary worker
   */
  async initialize(): Promise<void> {
    try {
      const redis = createBullMQConnection();

      this.worker = new Worker<SummaryEventData>(
        'summary-events',
        async (job: Job<SummaryEventData>) => {
          return this.processSummaryUpdate(job);
        },
        {
          connection: redis as any,
          concurrency: WORKER_CONCURRENCY,
          maxStalledCount: 2,
          stalledInterval: 60000, // 1 min stalled check
          lockDuration: 120000, // 2 min lock (AI calls can be slow)
        }
      );

      this.worker.on('ready', () => {
        logger.info('[SUMMARY_WORKER] Ready');
        this.isRunning = true;
      });

      this.worker.on('error', (err: Error) => {
        logger.error('[SUMMARY_WORKER] Error', err);
      });

      this.worker.on('failed', (job, err) => {
        this.failedCount++;
        logger.warn('[SUMMARY_WORKER] Job failed', {
          jobId: job?.id,
          meetingId: job?.data.meetingId,
          error: err.message,
        });
      });

      this.worker.on('completed', (job) => {
        this.processedCount++;
        logger.debug('[SUMMARY_WORKER] Job completed', {
          jobId: job.id,
          meetingId: job.data.meetingId,
        });
      });

      logger.info('[SUMMARY_WORKER] Initialized', {
        concurrency: WORKER_CONCURRENCY,
        model: OPENAI_MODEL,
      });
    } catch (err) {
      logger.error('[SUMMARY_WORKER] Failed to initialize', err);
      throw err;
    }
  }

  /**
   * Process incremental summary update
   */
  private async processSummaryUpdate(job: Job<SummaryEventData>): Promise<IncrementalSummary> {
    const data = job.data;
    const startTime = Date.now();

    try {
      const redis = await getRedisClient();

      // Get current summary and context
      const [currentSummaryJson, currentContextJson] = await Promise.all([
        redis.get(SUMMARY_KEY(data.meetingId)),
        redis.get(CONTEXT_KEY(data.meetingId)),
      ]);

      const currentSummary: IncrementalSummary = currentSummaryJson
        ? JSON.parse(currentSummaryJson)
        : {
            meetingId: data.meetingId,
            version: 0,
            summary: '',
            keyPoints: [],
            actionItems: [],
            lastSegmentIndex: -1,
            updatedAt: new Date().toISOString(),
          };

      // Get recent context (last N segments for context)
      const recentContext: string[] = currentContextJson
        ? JSON.parse(currentContextJson)
        : [];

      // Add new segment to context
      if (data.text) {
        recentContext.push(`[${data.speakerName}]: ${data.text}`);
        // Keep last 50 segments for context
        while (recentContext.length > 50) {
          recentContext.shift();
        }
      }

      // Generate updated summary using AI
      const updatedSummary = await this.generateIncrementalSummary(
        currentSummary,
        recentContext,
        data
      );

      // Store updated summary and context
      await Promise.all([
        redis.setex(
          SUMMARY_KEY(data.meetingId),
          SUMMARY_CACHE_TTL,
          JSON.stringify(updatedSummary)
        ),
        redis.setex(
          CONTEXT_KEY(data.meetingId),
          SUMMARY_CACHE_TTL,
          JSON.stringify(recentContext)
        ),
      ]);

      const latencyMs = Date.now() - startTime;

      logger.debug('[SUMMARY_WORKER] Summary updated', {
        meetingId: data.meetingId,
        version: updatedSummary.version,
        keyPoints: updatedSummary.keyPoints.length,
        actionItems: updatedSummary.actionItems.length,
        latencyMs,
      });

      return updatedSummary;
    } catch (err) {
      logger.error('[SUMMARY_WORKER] Failed to update summary', {
        meetingId: data.meetingId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Generate incremental summary using OpenAI
   */
  private async generateIncrementalSummary(
    currentSummary: IncrementalSummary,
    recentContext: string[],
    newData: SummaryEventData
  ): Promise<IncrementalSummary> {
    const client = getOpenAI();

    const contextText = recentContext.join('\n');
    const currentKeyPoints = currentSummary.keyPoints.join('\n- ');
    const currentActionItems = currentSummary.actionItems.join('\n- ');

    const prompt = `You are updating a meeting summary incrementally. 

Current Summary:
${currentSummary.summary || 'No summary yet.'}

Current Key Points:
${currentKeyPoints || 'None yet.'}

Current Action Items:
${currentActionItems || 'None yet.'}

Recent Meeting Transcript:
${contextText}

Instructions:
1. Update the summary to incorporate the new content
2. Add any new key discussion points
3. Extract any action items mentioned (WHO will do WHAT by WHEN)
4. Keep the summary concise (max 3 paragraphs)
5. Return JSON only

Return format:
{
  "summary": "Updated meeting summary...",
  "keyPoints": ["Point 1", "Point 2"],
  "actionItems": ["Action 1", "Action 2"]
}`;

    try {
      const response = await client.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a meeting assistant that generates concise incremental summaries. Always respond with valid JSON only.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 1000,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);

      return {
        meetingId: newData.meetingId,
        version: currentSummary.version + 1,
        summary: parsed.summary || currentSummary.summary,
        keyPoints: parsed.keyPoints || currentSummary.keyPoints,
        actionItems: parsed.actionItems || currentSummary.actionItems,
        lastSegmentIndex: newData.segmentIndex,
        updatedAt: new Date().toISOString(),
      };
    } catch (err) {
      logger.error('[SUMMARY_WORKER] OpenAI call failed', err);
      // Return current summary on failure
      return {
        ...currentSummary,
        version: currentSummary.version + 1,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Get current summary for a meeting (from cache)
   */
  async getSummary(meetingId: string): Promise<IncrementalSummary | null> {
    try {
      const redis = await getRedisClient();
      const summaryJson = await redis.get(SUMMARY_KEY(meetingId));
      return summaryJson ? JSON.parse(summaryJson) : null;
    } catch (err) {
      logger.error('[SUMMARY_WORKER] Failed to get summary', err);
      return null;
    }
  }

  /**
   * Clear summary cache for a meeting (on meeting end)
   */
  async clearSummary(meetingId: string): Promise<void> {
    try {
      const redis = await getRedisClient();
      await Promise.all([
        redis.del(SUMMARY_KEY(meetingId)),
        redis.del(CONTEXT_KEY(meetingId)),
      ]);
      logger.info('[SUMMARY_WORKER] Summary cache cleared', { meetingId });
    } catch (err) {
      logger.error('[SUMMARY_WORKER] Failed to clear summary', err);
    }
  }

  /**
   * Get worker status
   */
  getStatus(): {
    running: boolean;
    processed: number;
    failed: number;
  } {
    return {
      running: this.isRunning,
      processed: this.processedCount,
      failed: this.failedCount,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
    }
    logger.info('[SUMMARY_WORKER] Shut down', {
      processed: this.processedCount,
    });
  }
}

// ── Singleton Export ──────────────────────────────────────────

export const summaryWorker = new SummaryWorkerManager();

export async function startSummaryWorker(): Promise<void> {
  return summaryWorker.initialize();
}

export function getSummaryWorker(): SummaryWorkerManager {
  return summaryWorker;
}
