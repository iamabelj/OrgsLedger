// ============================================================
// OrgsLedger API — Per-Meeting AI Cost Protection
// Prevents runaway AI costs for individual meetings
// ============================================================
//
// Architecture:
//   - Redis-based token tracking per meeting
//   - Configurable token limits per meeting
//   - Auto-disable minutes generation when limit reached
//   - Prometheus metrics for cost monitoring
//   - PostgreSQL persistence for billing
//
// Limits:
//   - Max 100k tokens per meeting (default)
//   - Minutes generation disabled when exceeded
//
// ============================================================

import * as client from 'prom-client';
import { logger } from '../logger';
import { createBullMQConnection } from '../infrastructure/redisClient';
import { db } from '../db';
import type Redis from 'ioredis';

// ── Configuration ───────────────────────────────────────────

interface AICostConfig {
  /** Max tokens per meeting (default: 100k) */
  maxTokensPerMeeting: number;
  /** Warning threshold percentage (default: 80%) */
  warningThresholdPercent: number;
  /** Token costs in USD per 1M tokens */
  costPer1MTokens: {
    input: number;
    output: number;
  };
  /** Whether to persist usage to database */
  persistUsage: boolean;
  /** Persistence batch size */
  persistBatchSize: number;
  /** Persistence interval in ms */
  persistIntervalMs: number;
}

const AI_COST_CONFIG: AICostConfig = {
  maxTokensPerMeeting: parseInt(process.env.AI_MAX_TOKENS_PER_MEETING || '100000', 10),
  warningThresholdPercent: parseInt(process.env.AI_WARNING_THRESHOLD_PERCENT || '80', 10),
  costPer1MTokens: {
    input: parseFloat(process.env.AI_COST_INPUT_PER_1M || '0.15'),
    output: parseFloat(process.env.AI_COST_OUTPUT_PER_1M || '0.60'),
  },
  persistUsage: process.env.AI_PERSIST_USAGE !== 'false',
  persistBatchSize: parseInt(process.env.AI_PERSIST_BATCH_SIZE || '100', 10),
  persistIntervalMs: parseInt(process.env.AI_PERSIST_INTERVAL_MS || '60000', 10),
};

// ── Types ───────────────────────────────────────────────────

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface MeetingAIUsage extends AIUsage {
  meetingId: string;
  limitReached: boolean;
  percentUsed: number;
  remainingTokens: number;
}

export interface AIUsageCheckResult {
  allowed: boolean;
  usage: MeetingAIUsage;
  reason?: string;
}

interface UsageBatch {
  meetingId: string;
  organizationId?: string;
  inputTokens: number;
  outputTokens: number;
  timestamp: Date;
}

// ── Prometheus Metrics ──────────────────────────────────────

const PREFIX = 'orgsledger_';

export const aiCostLimitHitsCounter = new client.Counter({
  name: `${PREFIX}ai_cost_limit_hits_total`,
  help: 'Number of AI cost limit hits',
});

export const aiTokensUsedGauge = new client.Gauge({
  name: `${PREFIX}ai_tokens_used_per_meeting`,
  help: 'AI tokens used per meeting',
  labelNames: ['meeting_id'],
});

export const aiCostUsedGauge = new client.Gauge({
  name: `${PREFIX}ai_cost_usd_per_meeting`,
  help: 'Estimated AI cost in USD per meeting',
  labelNames: ['meeting_id'],
});

export const aiMinutesDisabledGauge = new client.Gauge({
  name: `${PREFIX}ai_minutes_disabled`,
  help: 'Whether minutes generation is disabled (1=disabled)',
  labelNames: ['meeting_id'],
});

// ── Redis Keys ──────────────────────────────────────────────

function getTokensKey(meetingId: string): string {
  return `meeting:${meetingId}:ai_tokens`;
}

function getInputTokensKey(meetingId: string): string {
  return `meeting:${meetingId}:ai_input_tokens`;
}

function getOutputTokensKey(meetingId: string): string {
  return `meeting:${meetingId}:ai_output_tokens`;
}

function getDisabledKey(meetingId: string): string {
  return `meeting:${meetingId}:ai_disabled`;
}

// ── AI Cost Protector Class ─────────────────────────────────

class MeetingAICostProtector {
  private redis: Redis | null = null;
  private initialized = false;
  private usageBatch: UsageBatch[] = [];
  private persistInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize Redis connection.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.redis = createBullMQConnection() as unknown as Redis;
      this.initialized = true;

      // Start persistence interval
      if (AI_COST_CONFIG.persistUsage) {
        this.startPersistenceInterval();
      }

      logger.info('[AI_COST] Initialized', {
        maxTokensPerMeeting: AI_COST_CONFIG.maxTokensPerMeeting,
        warningThreshold: AI_COST_CONFIG.warningThresholdPercent,
        costPer1MTokens: AI_COST_CONFIG.costPer1MTokens,
      });
    } catch (err) {
      logger.error('[AI_COST] Failed to initialize', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Check if AI usage is allowed for a meeting.
   * Call this before making any AI API calls.
   */
  async checkUsage(meetingId: string, estimatedTokens?: number): Promise<AIUsageCheckResult> {
    const usage = await this.getUsage(meetingId);

    // Check if already disabled
    if (usage.limitReached) {
      return {
        allowed: false,
        usage,
        reason: 'AI_COST_LIMIT_REACHED',
      };
    }

    // Check if this request would exceed the limit
    if (estimatedTokens) {
      const projectedTotal = usage.totalTokens + estimatedTokens;
      if (projectedTotal > AI_COST_CONFIG.maxTokensPerMeeting) {
        logger.warn('[AI_COST] AI_COST_LIMIT_REACHED (projected)', {
          meetingId,
          currentTokens: usage.totalTokens,
          estimatedTokens,
          projectedTotal,
          limit: AI_COST_CONFIG.maxTokensPerMeeting,
        });

        // Disable minutes generation
        await this.disableMinutes(meetingId);

        return {
          allowed: false,
          usage: { ...usage, limitReached: true },
          reason: 'AI_COST_LIMIT_REACHED',
        };
      }
    }

    // Check warning threshold
    if (usage.percentUsed >= AI_COST_CONFIG.warningThresholdPercent) {
      logger.warn('[AI_COST] Approaching token limit', {
        meetingId,
        percentUsed: usage.percentUsed,
        remainingTokens: usage.remainingTokens,
      });
    }

    return {
      allowed: true,
      usage,
    };
  }

  /**
   * Record AI token usage for a meeting.
   */
  async recordUsage(
    meetingId: string,
    inputTokens: number,
    outputTokens: number,
    organizationId?: string
  ): Promise<MeetingAIUsage> {
    const redis = this.getRedis();
    const totalTokens = inputTokens + outputTokens;

    try {
      // Atomically increment token counters
      const pipeline = redis.pipeline();
      pipeline.incrby(getTokensKey(meetingId), totalTokens);
      pipeline.incrby(getInputTokensKey(meetingId), inputTokens);
      pipeline.incrby(getOutputTokensKey(meetingId), outputTokens);
      // Set TTL of 24 hours
      pipeline.expire(getTokensKey(meetingId), 86400);
      pipeline.expire(getInputTokensKey(meetingId), 86400);
      pipeline.expire(getOutputTokensKey(meetingId), 86400);

      const results = await pipeline.exec();
      const newTotalTokens = results?.[0]?.[1] as number || totalTokens;

      // Calculate usage
      const usage = this.calculateUsage(meetingId, newTotalTokens, inputTokens, outputTokens);

      // Update metrics
      aiTokensUsedGauge.set({ meeting_id: meetingId }, newTotalTokens);
      aiCostUsedGauge.set({ meeting_id: meetingId }, usage.estimatedCostUsd);

      // Check if limit reached
      if (newTotalTokens >= AI_COST_CONFIG.maxTokensPerMeeting) {
        logger.warn('[AI_COST] AI_COST_LIMIT_REACHED', {
          meetingId,
          totalTokens: newTotalTokens,
          limit: AI_COST_CONFIG.maxTokensPerMeeting,
        });

        await this.disableMinutes(meetingId);
        aiCostLimitHitsCounter.inc();
        aiMinutesDisabledGauge.set({ meeting_id: meetingId }, 1);

        return { ...usage, limitReached: true };
      }

      // Add to persistence batch
      if (AI_COST_CONFIG.persistUsage) {
        this.usageBatch.push({
          meetingId,
          organizationId,
          inputTokens,
          outputTokens,
          timestamp: new Date(),
        });

        if (this.usageBatch.length >= AI_COST_CONFIG.persistBatchSize) {
          this.flushUsageBatch().catch((err) => {
            logger.error('[AI_COST] Failed to flush batch', { error: err });
          });
        }
      }

      return usage;

    } catch (err) {
      logger.error('[AI_COST] Failed to record usage', {
        meetingId,
        inputTokens,
        outputTokens,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Get current AI usage for a meeting.
   */
  async getUsage(meetingId: string): Promise<MeetingAIUsage> {
    const redis = this.getRedis();

    try {
      const pipeline = redis.pipeline();
      pipeline.get(getTokensKey(meetingId));
      pipeline.get(getInputTokensKey(meetingId));
      pipeline.get(getOutputTokensKey(meetingId));
      pipeline.exists(getDisabledKey(meetingId));

      const results = await pipeline.exec();
      const totalTokens = parseInt(results?.[0]?.[1] as string || '0', 10);
      const inputTokens = parseInt(results?.[1]?.[1] as string || '0', 10);
      const outputTokens = parseInt(results?.[2]?.[1] as string || '0', 10);
      const isDisabled = (results?.[3]?.[1] as number) === 1;

      return this.calculateUsage(meetingId, totalTokens, inputTokens, outputTokens, isDisabled);

    } catch (err) {
      logger.error('[AI_COST] Failed to get usage', {
        meetingId,
        error: err instanceof Error ? err.message : String(err),
      });

      // Return empty usage on error
      return {
        meetingId,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        limitReached: false,
        percentUsed: 0,
        remainingTokens: AI_COST_CONFIG.maxTokensPerMeeting,
      };
    }
  }

  /**
   * Disable minutes generation for a meeting.
   */
  async disableMinutes(meetingId: string): Promise<void> {
    const redis = this.getRedis();
    await redis.setex(getDisabledKey(meetingId), 86400, '1');
    aiMinutesDisabledGauge.set({ meeting_id: meetingId }, 1);

    logger.warn('[AI_COST] Minutes generation disabled for meeting', {
      meetingId,
      reason: 'AI_COST_LIMIT_REACHED',
    });
  }

  /**
   * Re-enable minutes generation for a meeting (admin action).
   */
  async enableMinutes(meetingId: string): Promise<void> {
    const redis = this.getRedis();
    await redis.del(getDisabledKey(meetingId));
    aiMinutesDisabledGauge.set({ meeting_id: meetingId }, 0);

    logger.info('[AI_COST] Minutes generation re-enabled', { meetingId });
  }

  /**
   * Check if minutes generation is disabled.
   */
  async isMinutesDisabled(meetingId: string): Promise<boolean> {
    const redis = this.getRedis();
    const disabled = await redis.exists(getDisabledKey(meetingId));
    return disabled === 1;
  }

  /**
   * Reset AI usage for a meeting (use when meeting ends for cleanup).
   */
  async reset(meetingId: string): Promise<void> {
    const redis = this.getRedis();

    try {
      await redis.del(
        getTokensKey(meetingId),
        getInputTokensKey(meetingId),
        getOutputTokensKey(meetingId),
        getDisabledKey(meetingId)
      );

      // Clear metrics
      aiTokensUsedGauge.remove({ meeting_id: meetingId });
      aiCostUsedGauge.remove({ meeting_id: meetingId });
      aiMinutesDisabledGauge.remove({ meeting_id: meetingId });

      logger.debug('[AI_COST] Reset AI usage', { meetingId });

    } catch (err) {
      logger.error('[AI_COST] Failed to reset', {
        meetingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Get configuration.
   */
  getConfig(): AICostConfig {
    return { ...AI_COST_CONFIG };
  }

  // ── Private Methods ─────────────────────────────────────────

  /**
   * Calculate usage metrics from token counts.
   */
  private calculateUsage(
    meetingId: string,
    totalTokens: number,
    inputTokens: number,
    outputTokens: number,
    isDisabled?: boolean
  ): MeetingAIUsage {
    const { maxTokensPerMeeting, costPer1MTokens } = AI_COST_CONFIG;

    const inputCost = (inputTokens / 1_000_000) * costPer1MTokens.input;
    const outputCost = (outputTokens / 1_000_000) * costPer1MTokens.output;

    return {
      meetingId,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd: inputCost + outputCost,
      limitReached: isDisabled ?? totalTokens >= maxTokensPerMeeting,
      percentUsed: Math.round((totalTokens / maxTokensPerMeeting) * 100),
      remainingTokens: Math.max(0, maxTokensPerMeeting - totalTokens),
    };
  }

  /**
   * Get Redis connection.
   */
  private getRedis(): Redis {
    if (!this.redis) {
      throw new Error('MeetingAICostProtector not initialized');
    }
    return this.redis;
  }

  /**
   * Start persistence interval.
   */
  private startPersistenceInterval(): void {
    this.persistInterval = setInterval(() => {
      if (this.usageBatch.length > 0) {
        this.flushUsageBatch().catch((err) => {
          logger.error('[AI_COST] Failed to flush batch', { error: err });
        });
      }
    }, AI_COST_CONFIG.persistIntervalMs);

    this.persistInterval.unref();
  }

  /**
   * Flush usage batch to database.
   */
  private async flushUsageBatch(): Promise<void> {
    if (this.usageBatch.length === 0) return;

    const batch = [...this.usageBatch];
    this.usageBatch = [];

    try {
      // Aggregate by meeting
      const aggregated = new Map<string, UsageBatch>();
      for (const usage of batch) {
        const existing = aggregated.get(usage.meetingId);
        if (existing) {
          existing.inputTokens += usage.inputTokens;
          existing.outputTokens += usage.outputTokens;
        } else {
          aggregated.set(usage.meetingId, { ...usage });
        }
      }

      // Insert or update database
      const values = Array.from(aggregated.values());
      
      // Using raw query for upsert
      for (const usage of values) {
        await db.raw(`
          INSERT INTO meeting_ai_usage (meeting_id, organization_id, input_tokens, output_tokens, updated_at)
          VALUES (?, ?, ?, ?, NOW())
          ON CONFLICT (meeting_id) DO UPDATE SET
            input_tokens = meeting_ai_usage.input_tokens + EXCLUDED.input_tokens,
            output_tokens = meeting_ai_usage.output_tokens + EXCLUDED.output_tokens,
            updated_at = NOW()
        `, [usage.meetingId, usage.organizationId || null, usage.inputTokens, usage.outputTokens]);
      }

      logger.debug('[AI_COST] Flushed usage batch', {
        meetings: values.length,
        totalInput: values.reduce((sum, v) => sum + v.inputTokens, 0),
        totalOutput: values.reduce((sum, v) => sum + v.outputTokens, 0),
      });

    } catch (err) {
      logger.error('[AI_COST] Failed to persist usage', {
        error: err instanceof Error ? err.message : String(err),
        batchSize: batch.length,
      });
      // Put batch back for retry
      this.usageBatch = [...batch, ...this.usageBatch];
    }
  }

  /**
   * Shutdown and cleanup.
   */
  async shutdown(): Promise<void> {
    if (this.persistInterval) {
      clearInterval(this.persistInterval);
      this.persistInterval = null;
    }

    // Final flush
    if (this.usageBatch.length > 0) {
      await this.flushUsageBatch();
    }

    logger.info('[AI_COST] Shutdown complete');
  }
}

// ── Singleton ───────────────────────────────────────────────

export const meetingAICostProtector = new MeetingAICostProtector();

// ── Exports ─────────────────────────────────────────────────

export async function initializeMeetingAICostProtector(): Promise<void> {
  await meetingAICostProtector.initialize();
}

export async function checkAIUsage(
  meetingId: string,
  estimatedTokens?: number
): Promise<AIUsageCheckResult> {
  return meetingAICostProtector.checkUsage(meetingId, estimatedTokens);
}

export async function recordAIUsage(
  meetingId: string,
  inputTokens: number,
  outputTokens: number,
  organizationId?: string
): Promise<MeetingAIUsage> {
  return meetingAICostProtector.recordUsage(meetingId, inputTokens, outputTokens, organizationId);
}

export async function getMeetingAIUsage(meetingId: string): Promise<MeetingAIUsage> {
  return meetingAICostProtector.getUsage(meetingId);
}

export async function isMinutesGenerationDisabled(meetingId: string): Promise<boolean> {
  return meetingAICostProtector.isMinutesDisabled(meetingId);
}

export async function resetMeetingAIUsage(meetingId: string): Promise<void> {
  return meetingAICostProtector.reset(meetingId);
}

export function getAICostConfig(): AICostConfig {
  return meetingAICostProtector.getConfig();
}
