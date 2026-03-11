// ============================================================
// OrgsLedger API — Global Rate Governor
// System-wide rate limiting using Redis sliding window
// ============================================================
//
// Limits:
//   MEETING_CREATION_LIMIT = 1000 per minute
//   TRANSCRIPT_EVENTS_LIMIT = 50000 per minute
//   AI_REQUEST_LIMIT = 2000 per minute
//
// Implementation:
//   Redis sliding window counters with INCR + EXPIRE
//
// Returns:
//   HTTP 429 when limit exceeded
//
// ============================================================

import { Request, Response, NextFunction, RequestHandler } from 'express';
import * as client from 'prom-client';
import Redis from 'ioredis';
import { createBullMQConnection } from '../infrastructure/redisClient';
import { logger } from '../logger';

// ── Configuration ───────────────────────────────────────────

export interface RateGovernorConfig {
  /** Meeting creation limit per minute */
  meetingCreationLimit: number;
  /** Transcript events limit per minute */
  transcriptEventsLimit: number;
  /** AI requests limit per minute */
  aiRequestLimit: number;
  /** Sliding window size in seconds */
  windowSizeSeconds: number;
  /** Enable rate governing */
  enabled: boolean;
}

const DEFAULT_CONFIG: RateGovernorConfig = {
  meetingCreationLimit: parseInt(process.env.RATE_GOVERNOR_MEETING_LIMIT || '1000', 10),
  transcriptEventsLimit: parseInt(process.env.RATE_GOVERNOR_TRANSCRIPT_LIMIT || '50000', 10),
  aiRequestLimit: parseInt(process.env.RATE_GOVERNOR_AI_LIMIT || '2000', 10),
  windowSizeSeconds: parseInt(process.env.RATE_GOVERNOR_WINDOW_SEC || '60', 10),
  enabled: process.env.RATE_GOVERNOR_ENABLED !== 'false',
};

// ── Types ───────────────────────────────────────────────────

export type RateLimitType = 'meeting_creation' | 'transcript_events' | 'ai_requests';

export interface RateLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
  resetInSeconds: number;
}

export interface RateGovernorStats {
  meetingCreation: RateLimitResult;
  transcriptEvents: RateLimitResult;
  aiRequests: RateLimitResult;
}

// ── Prometheus Metrics ──────────────────────────────────────

const PREFIX = 'orgsledger_global_rate_limit_';

export const globalRateLimitHitsCounter = new client.Counter({
  name: `${PREFIX}hits_total`,
  help: 'Total requests blocked by global rate limiter',
  labelNames: ['type'],
});

export const globalRateLimitCurrentGauge = new client.Gauge({
  name: `${PREFIX}current`,
  help: 'Current rate for each limit type',
  labelNames: ['type'],
});

export const globalRateLimitAllowedCounter = new client.Counter({
  name: `${PREFIX}allowed_total`,
  help: 'Total requests allowed through rate limiter',
  labelNames: ['type'],
});

// ── Redis Keys ──────────────────────────────────────────────

const REDIS_KEY_PREFIX = 'rate_governor';

function getRedisKey(type: RateLimitType, windowId: number): string {
  return `${REDIS_KEY_PREFIX}:${type}:${windowId}`;
}

// ── Lua Script for Atomic Increment with Limit Check ────────

const CHECK_AND_INCREMENT_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local increment = tonumber(ARGV[3]) or 1

local current = redis.call('INCR', key)

-- Set TTL on first increment
if current == increment then
  redis.call('EXPIRE', key, ttl)
end

if current > limit then
  -- Exceeded limit, decrement back
  redis.call('DECR', key)
  return {0, current - 1, limit}
end

return {1, current, limit}
`;

// ── Global Rate Governor Class ──────────────────────────────

class GlobalRateGovernor {
  private config: RateGovernorConfig;
  private redis: Redis | null = null;
  private scriptSha: string | null = null;
  private isRunning = false;

  constructor(config: Partial<RateGovernorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the rate governor.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[RATE_GOVERNOR] Already running');
      return;
    }

    if (!this.config.enabled) {
      logger.info('[RATE_GOVERNOR] Disabled via configuration');
      return;
    }

    try {
      this.redis = createBullMQConnection() as unknown as Redis;

      // Load Lua script
      this.scriptSha = await this.redis.script('LOAD', CHECK_AND_INCREMENT_SCRIPT) as string;

      this.isRunning = true;

      logger.info('[RATE_GOVERNOR] Started', {
        meetingCreationLimit: this.config.meetingCreationLimit,
        transcriptEventsLimit: this.config.transcriptEventsLimit,
        aiRequestLimit: this.config.aiRequestLimit,
        windowSizeSeconds: this.config.windowSizeSeconds,
      });

    } catch (err) {
      logger.error('[RATE_GOVERNOR] Failed to start', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Stop the rate governor.
   */
  stop(): void {
    this.isRunning = false;
    logger.info('[RATE_GOVERNOR] Stopped');
  }

  /**
   * Get current window ID based on time.
   */
  private getCurrentWindowId(): number {
    return Math.floor(Date.now() / (this.config.windowSizeSeconds * 1000));
  }

  /**
   * Get seconds until window reset.
   */
  private getResetInSeconds(): number {
    const windowMs = this.config.windowSizeSeconds * 1000;
    const currentMs = Date.now();
    const windowStart = Math.floor(currentMs / windowMs) * windowMs;
    const windowEnd = windowStart + windowMs;
    return Math.ceil((windowEnd - currentMs) / 1000);
  }

  /**
   * Check rate limit using Lua script.
   */
  private async checkLimit(
    type: RateLimitType,
    limit: number,
    increment: number = 1
  ): Promise<RateLimitResult> {
    if (!this.redis || !this.scriptSha || !this.isRunning) {
      // Not running, allow everything
      return {
        allowed: true,
        current: 0,
        limit,
        remaining: limit,
        resetInSeconds: this.config.windowSizeSeconds,
      };
    }

    const windowId = this.getCurrentWindowId();
    const key = getRedisKey(type, windowId);
    const ttl = this.config.windowSizeSeconds + 1; // Extra second for safety

    try {
      const result = await this.redis.evalsha(
        this.scriptSha,
        1,
        key,
        limit.toString(),
        ttl.toString(),
        increment.toString()
      ) as [number, number, number];

      const [allowed, current, limitVal] = result;
      const remaining = Math.max(0, limitVal - current);
      const resetInSeconds = this.getResetInSeconds();

      // Update metrics
      globalRateLimitCurrentGauge.set({ type }, current);

      if (allowed) {
        globalRateLimitAllowedCounter.inc({ type });
      } else {
        globalRateLimitHitsCounter.inc({ type });
        logger.warn(`[RATE_GOVERNOR] Rate limit exceeded for ${type}`, {
          current,
          limit: limitVal,
        });
      }

      return {
        allowed: allowed === 1,
        current,
        limit: limitVal,
        remaining,
        resetInSeconds,
      };

    } catch (err) {
      logger.error('[RATE_GOVERNOR] Check failed, allowing request', {
        type,
        error: err instanceof Error ? err.message : String(err),
      });

      // Fail open - allow the request
      return {
        allowed: true,
        current: 0,
        limit,
        remaining: limit,
        resetInSeconds: this.config.windowSizeSeconds,
      };
    }
  }

  /**
   * Check meeting creation rate limit.
   */
  async checkMeetingCreationLimit(): Promise<RateLimitResult> {
    return this.checkLimit('meeting_creation', this.config.meetingCreationLimit);
  }

  /**
   * Check transcript events rate limit.
   */
  async checkTranscriptRate(count: number = 1): Promise<RateLimitResult> {
    return this.checkLimit('transcript_events', this.config.transcriptEventsLimit, count);
  }

  /**
   * Check AI requests rate limit.
   */
  async checkAIRate(): Promise<RateLimitResult> {
    return this.checkLimit('ai_requests', this.config.aiRequestLimit);
  }

  /**
   * Get current stats for all limit types.
   */
  async getStats(): Promise<RateGovernorStats> {
    if (!this.redis || !this.isRunning) {
      return {
        meetingCreation: { allowed: true, current: 0, limit: this.config.meetingCreationLimit, remaining: this.config.meetingCreationLimit, resetInSeconds: this.config.windowSizeSeconds },
        transcriptEvents: { allowed: true, current: 0, limit: this.config.transcriptEventsLimit, remaining: this.config.transcriptEventsLimit, resetInSeconds: this.config.windowSizeSeconds },
        aiRequests: { allowed: true, current: 0, limit: this.config.aiRequestLimit, remaining: this.config.aiRequestLimit, resetInSeconds: this.config.windowSizeSeconds },
      };
    }

    const windowId = this.getCurrentWindowId();
    const resetInSeconds = this.getResetInSeconds();

    // Get current counts
    const [meetingCount, transcriptCount, aiCount] = await Promise.all([
      this.redis.get(getRedisKey('meeting_creation', windowId)),
      this.redis.get(getRedisKey('transcript_events', windowId)),
      this.redis.get(getRedisKey('ai_requests', windowId)),
    ]);

    const meetingCurrent = parseInt(meetingCount || '0', 10);
    const transcriptCurrent = parseInt(transcriptCount || '0', 10);
    const aiCurrent = parseInt(aiCount || '0', 10);

    return {
      meetingCreation: {
        allowed: meetingCurrent < this.config.meetingCreationLimit,
        current: meetingCurrent,
        limit: this.config.meetingCreationLimit,
        remaining: Math.max(0, this.config.meetingCreationLimit - meetingCurrent),
        resetInSeconds,
      },
      transcriptEvents: {
        allowed: transcriptCurrent < this.config.transcriptEventsLimit,
        current: transcriptCurrent,
        limit: this.config.transcriptEventsLimit,
        remaining: Math.max(0, this.config.transcriptEventsLimit - transcriptCurrent),
        resetInSeconds,
      },
      aiRequests: {
        allowed: aiCurrent < this.config.aiRequestLimit,
        current: aiCurrent,
        limit: this.config.aiRequestLimit,
        remaining: Math.max(0, this.config.aiRequestLimit - aiCurrent),
        resetInSeconds,
      },
    };
  }

  /**
   * Check if governor is running.
   */
  isGovernorRunning(): boolean {
    return this.isRunning;
  }
}

// ── Singleton ───────────────────────────────────────────────

export const globalRateGovernor = new GlobalRateGovernor();

// ── Express Middleware ──────────────────────────────────────

/**
 * Create middleware for meeting creation rate limiting.
 */
export function createMeetingCreationRateLimitMiddleware(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await globalRateGovernor.checkMeetingCreationLimit();

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', result.limit);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', result.resetInSeconds);

      if (!result.allowed) {
        res.status(429).json({
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Meeting creation rate limit exceeded. Please try again later.',
          limit: result.limit,
          current: result.current,
          retryAfter: result.resetInSeconds,
        });
        return;
      }

      next();
    } catch (err) {
      // Fail open
      logger.error('[RATE_GOVERNOR] Middleware error', {
        error: err instanceof Error ? err.message : String(err),
      });
      next();
    }
  };
}

/**
 * Create middleware for AI request rate limiting.
 */
export function createAIRateLimitMiddleware(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await globalRateGovernor.checkAIRate();

      res.setHeader('X-RateLimit-Limit', result.limit);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', result.resetInSeconds);

      if (!result.allowed) {
        res.status(429).json({
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'AI request rate limit exceeded. Please try again later.',
          limit: result.limit,
          current: result.current,
          retryAfter: result.resetInSeconds,
        });
        return;
      }

      next();
    } catch (err) {
      logger.error('[RATE_GOVERNOR] AI middleware error', {
        error: err instanceof Error ? err.message : String(err),
      });
      next();
    }
  };
}

// ── Exports ─────────────────────────────────────────────────

export async function startRateGovernor(): Promise<void> {
  await globalRateGovernor.start();
}

export function stopRateGovernor(): void {
  globalRateGovernor.stop();
}

export async function checkMeetingCreationLimit(): Promise<RateLimitResult> {
  return globalRateGovernor.checkMeetingCreationLimit();
}

export async function checkTranscriptRate(count?: number): Promise<RateLimitResult> {
  return globalRateGovernor.checkTranscriptRate(count);
}

export async function checkAIRate(): Promise<RateLimitResult> {
  return globalRateGovernor.checkAIRate();
}

export async function getRateGovernorStats(): Promise<RateGovernorStats> {
  return globalRateGovernor.getStats();
}
