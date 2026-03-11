// ============================================================
// OrgsLedger API — AI Rate Limit Guard
// Production-grade rate limiting for AI services
// ============================================================
//
// Features:
//   - Sliding window counters in Redis
//   - Warning at 80% utilization
//   - Backpressure at 95% utilization
//   - Graceful degradation strategies
//   - Prometheus metrics export
//
// Tracked Services:
//   - Deepgram (transcription)
//   - OpenAI (minutes generation)
//   - Google Translate (translations)
//
// Redis Keys:
//   - ai:rate:deepgram:{minute} — Deepgram requests per minute
//   - ai:rate:openai:{minute} — OpenAI requests per minute
//   - ai:rate:translate:{minute} — Translate requests per minute
//
// ============================================================

import * as client from 'prom-client';
import { EventEmitter } from 'events';
import Redis from 'ioredis';
import { logger } from '../logger';
import { AI_COST_LIMITS } from '../config/ai-pricing';

// ── Configuration ───────────────────────────────────────────

/**
 * Rate limit thresholds per minute
 * These represent the max requests/units we can sustain before hitting provider limits
 */
const AI_RATE_LIMITS = {
  deepgram: {
    // Deepgram concurrent streams / requests per minute
    requestsPerMinute: parseInt(process.env.DEEPGRAM_RATE_LIMIT_RPM || '200', 10),
    // Audio minutes processed per minute (for sliding window)
    minutesPerMinute: parseInt(process.env.DEEPGRAM_RATE_LIMIT_MPM || '1000', 10),
  },
  openai: {
    // OpenAI requests per minute (varies by tier)
    requestsPerMinute: parseInt(process.env.OPENAI_RATE_LIMIT_RPM || '500', 10),
    // Tokens per minute (varies by tier)
    tokensPerMinute: parseInt(process.env.OPENAI_RATE_LIMIT_TPM || '200000', 10),
  },
  translate: {
    // Translation API requests per minute
    requestsPerMinute: parseInt(process.env.TRANSLATE_RATE_LIMIT_RPM || '1000', 10),
    // Characters per minute
    charactersPerMinute: parseInt(process.env.TRANSLATE_RATE_LIMIT_CPM || '1000000', 10),
  },
};

// Threshold percentages
const THRESHOLDS = {
  warning: 0.80,   // 80% - emit warning
  critical: 0.95,  // 95% - activate backpressure
};

// Sliding window size (minutes)
const WINDOW_SIZE_MINUTES = 1;
const KEY_TTL_SECONDS = 120; // Keep keys for 2 minutes for sliding window

// Redis key prefixes
const REDIS_PREFIX = 'ai:rate';

// ── Types ───────────────────────────────────────────────────

export type AIService = 'deepgram' | 'openai' | 'translate';

export interface RateLimitStatus {
  service: AIService;
  utilizationPercent: number;
  currentUsage: number;
  limit: number;
  isWarning: boolean;
  isCritical: boolean;
  backpressureActive: boolean;
  retryAfterSeconds?: number;
}

export interface DegradationStrategy {
  service: AIService;
  action: 'skip' | 'delay' | 'reduce_frequency' | 'queue';
  delayMs?: number;
  skipPercent?: number;
  reason: string;
}

export interface AIRateLimitMetrics {
  deepgram: RateLimitStatus;
  openai: RateLimitStatus;
  translate: RateLimitStatus;
  anyBackpressureActive: boolean;
  degradationStrategies: DegradationStrategy[];
}

export interface RateLimitCheckResult {
  allowed: boolean;
  status: RateLimitStatus;
  degradation?: DegradationStrategy;
}

// ── Prometheus Metrics ──────────────────────────────────────

const register = client.register;

export const aiRateLimitUtilizationGauge = new client.Gauge({
  name: 'orgsledger_ai_rate_limit_utilization',
  help: 'AI service rate limit utilization percentage (0-100)',
  labelNames: ['service', 'metric'] as const,
  registers: [register],
});

export const aiRateLimitWarningCounter = new client.Counter({
  name: 'orgsledger_ai_rate_limit_warning',
  help: 'Number of times AI rate limit warning (80%) was triggered',
  labelNames: ['service'] as const,
  registers: [register],
});

export const aiRateLimitBackpressureCounter = new client.Counter({
  name: 'orgsledger_ai_rate_limit_backpressure',
  help: 'Number of times AI rate limit backpressure (95%) was activated',
  labelNames: ['service'] as const,
  registers: [register],
});

export const aiRateLimitDegradedGauge = new client.Gauge({
  name: 'orgsledger_ai_rate_limit_degraded',
  help: 'Whether service is in degraded mode (1=degraded, 0=normal)',
  labelNames: ['service'] as const,
  registers: [register],
});

// ── AI Rate Limit Guard Class ───────────────────────────────

class AIRateLimitGuard extends EventEmitter {
  private redis: Redis | null = null;
  private isInitialized = false;
  
  // Track backpressure state per service
  private backpressureState: Map<AIService, boolean> = new Map([
    ['deepgram', false],
    ['openai', false],
    ['translate', false],
  ]);

  // Track degradation strategies
  private activeDegradations: Map<AIService, DegradationStrategy> = new Map();

  // Hysteresis counters to prevent flapping
  private warningCount: Map<AIService, number> = new Map();
  private criticalCount: Map<AIService, number> = new Map();
  
  private readonly HYSTERESIS_THRESHOLD = 3; // 3 consecutive violations before triggering

  constructor() {
    super();
    this.initializeCounters();
  }

  private initializeCounters(): void {
    const services: AIService[] = ['deepgram', 'openai', 'translate'];
    for (const service of services) {
      this.warningCount.set(service, 0);
      this.criticalCount.set(service, 0);
    }
  }

  /**
   * Initialize Redis connection
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      const host = process.env.REDIS_HOST || 'localhost';
      const port = parseInt(process.env.REDIS_PORT || '6379', 10);
      const password = process.env.REDIS_PASSWORD;

      this.redis = new Redis({
        host,
        port,
        password,
        db: parseInt(process.env.REDIS_DB || '0', 10),
        lazyConnect: false,
        retryStrategy: (times) => {
          const delay = Math.min(1000 * Math.pow(2, times - 1), 30000);
          return delay;
        },
      });

      this.redis.on('ready', () => {
        logger.info('[AI_RATE_LIMIT] Redis connected');
        this.isInitialized = true;
      });

      this.redis.on('error', (err) => {
        logger.error('[AI_RATE_LIMIT] Redis error', { error: err.message });
      });

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Redis connection timeout'));
        }, 10000);

        this.redis!.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.redis!.once('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      this.isInitialized = true;
      logger.info('[AI_RATE_LIMIT] Initialized');
    } catch (err: any) {
      logger.error('[AI_RATE_LIMIT] Failed to initialize', { error: err.message });
      // Don't throw - fail-open for availability
      this.isInitialized = true;
    }
  }

  /**
   * Get Redis key for a service
   */
  private getRedisKey(service: AIService, metric: string): string {
    const minute = Math.floor(Date.now() / 60000);
    return `${REDIS_PREFIX}:${service}:${metric}:${minute}`;
  }

  /**
   * Record usage for a service
   */
  async recordUsage(
    service: AIService,
    metric: 'requests' | 'tokens' | 'characters' | 'minutes',
    amount: number = 1
  ): Promise<RateLimitStatus> {
    if (!this.redis) {
      // Fail-open: return normal status
      return this.createDefaultStatus(service);
    }

    try {
      const key = this.getRedisKey(service, metric);
      
      // Increment and set TTL atomically using MULTI
      const pipeline = this.redis.multi();
      pipeline.incrby(key, amount);
      pipeline.expire(key, KEY_TTL_SECONDS);
      const results = await pipeline.exec();

      // Get the new value
      const currentUsage = results?.[0]?.[1] as number || 0;

      // Calculate limit based on service and metric
      const limit = this.getLimit(service, metric);
      
      // Calculate utilization
      const status = this.calculateStatus(service, currentUsage, limit);

      // Update Prometheus metrics
      aiRateLimitUtilizationGauge
        .labels(service, metric)
        .set(status.utilizationPercent);

      // Handle warning state
      if (status.isWarning && !status.isCritical) {
        this.handleWarning(service, status);
      }

      // Handle critical state (backpressure)
      if (status.isCritical) {
        this.handleCritical(service, status);
      } else if (this.backpressureState.get(service)) {
        // Check if we can recover from backpressure
        this.checkRecovery(service, status);
      }

      return status;
    } catch (err: any) {
      logger.error('[AI_RATE_LIMIT] Failed to record usage', { 
        service, 
        metric, 
        error: err.message 
      });
      // Fail-open
      return this.createDefaultStatus(service);
    }
  }

  /**
   * Check rate limit status without recording usage
   */
  async checkStatus(
    service: AIService,
    metric: 'requests' | 'tokens' | 'characters' | 'minutes' = 'requests'
  ): Promise<RateLimitStatus> {
    if (!this.redis) {
      return this.createDefaultStatus(service);
    }

    try {
      const key = this.getRedisKey(service, metric);
      const currentUsage = parseInt(await this.redis.get(key) || '0', 10);
      const limit = this.getLimit(service, metric);

      return this.calculateStatus(service, currentUsage, limit);
    } catch (err: any) {
      logger.error('[AI_RATE_LIMIT] Failed to check status', { 
        service, 
        error: err.message 
      });
      return this.createDefaultStatus(service);
    }
  }

  /**
   * Check if a request should be allowed
   */
  async checkAndRecord(
    service: AIService,
    metric: 'requests' | 'tokens' | 'characters' | 'minutes' = 'requests',
    amount: number = 1
  ): Promise<RateLimitCheckResult> {
    // First check current status
    const status = await this.checkStatus(service, metric);

    // If backpressure active, apply degradation strategy
    if (status.backpressureActive) {
      const degradation = this.getDegradationStrategy(service);
      return {
        allowed: false,
        status,
        degradation,
      };
    }

    // Record the usage
    const newStatus = await this.recordUsage(service, metric, amount);

    // Check if we just hit backpressure
    if (newStatus.backpressureActive) {
      const degradation = this.getDegradationStrategy(service);
      return {
        allowed: false,
        status: newStatus,
        degradation,
      };
    }

    return {
      allowed: true,
      status: newStatus,
    };
  }

  /**
   * Get current rate limit for a metric
   */
  private getLimit(service: AIService, metric: string): number {
    switch (service) {
      case 'deepgram':
        if (metric === 'minutes') return AI_RATE_LIMITS.deepgram.minutesPerMinute;
        return AI_RATE_LIMITS.deepgram.requestsPerMinute;
      case 'openai':
        if (metric === 'tokens') return AI_RATE_LIMITS.openai.tokensPerMinute;
        return AI_RATE_LIMITS.openai.requestsPerMinute;
      case 'translate':
        if (metric === 'characters') return AI_RATE_LIMITS.translate.charactersPerMinute;
        return AI_RATE_LIMITS.translate.requestsPerMinute;
      default:
        return 1000;
    }
  }

  /**
   * Calculate rate limit status
   */
  private calculateStatus(
    service: AIService,
    currentUsage: number,
    limit: number
  ): RateLimitStatus {
    const utilizationPercent = (currentUsage / limit) * 100;
    const isWarning = utilizationPercent >= THRESHOLDS.warning * 100;
    const isCritical = utilizationPercent >= THRESHOLDS.critical * 100;
    const backpressureActive = this.backpressureState.get(service) || false;

    return {
      service,
      utilizationPercent,
      currentUsage,
      limit,
      isWarning,
      isCritical,
      backpressureActive,
      retryAfterSeconds: backpressureActive ? this.calculateRetryAfter(utilizationPercent) : undefined,
    };
  }

  /**
   * Calculate when to retry based on utilization
   */
  private calculateRetryAfter(utilization: number): number {
    // Higher utilization = longer wait
    if (utilization >= 100) return 60; // Wait full minute
    if (utilization >= 95) return 30;
    if (utilization >= 90) return 15;
    return 10;
  }

  /**
   * Create default status for fail-open scenarios
   */
  private createDefaultStatus(service: AIService): RateLimitStatus {
    return {
      service,
      utilizationPercent: 0,
      currentUsage: 0,
      limit: this.getLimit(service, 'requests'),
      isWarning: false,
      isCritical: false,
      backpressureActive: false,
    };
  }

  /**
   * Handle warning state (80% utilization)
   */
  private handleWarning(service: AIService, status: RateLimitStatus): void {
    const count = (this.warningCount.get(service) || 0) + 1;
    this.warningCount.set(service, count);

    if (count >= this.HYSTERESIS_THRESHOLD) {
      // Emit warning metric
      aiRateLimitWarningCounter.labels(service).inc();
      
      logger.warn('[AI_RATE_LIMIT] Warning threshold reached', {
        service,
        utilizationPercent: status.utilizationPercent.toFixed(1),
        currentUsage: status.currentUsage,
        limit: status.limit,
      });

      this.emit('warning', { service, status });
    }
  }

  /**
   * Handle critical state (95% utilization)
   */
  private handleCritical(service: AIService, status: RateLimitStatus): void {
    const count = (this.criticalCount.get(service) || 0) + 1;
    this.criticalCount.set(service, count);

    if (count >= this.HYSTERESIS_THRESHOLD && !this.backpressureState.get(service)) {
      // Activate backpressure
      this.backpressureState.set(service, true);
      
      // Set up degradation strategy
      const strategy = this.createDegradationStrategy(service);
      this.activeDegradations.set(service, strategy);

      // Update metrics
      aiRateLimitBackpressureCounter.labels(service).inc();
      aiRateLimitDegradedGauge.labels(service).set(1);

      logger.error('[AI_RATE_LIMIT] Backpressure activated', {
        service,
        utilizationPercent: status.utilizationPercent.toFixed(1),
        strategy: strategy.action,
      });

      this.emit('backpressure', { service, status, strategy });
    }
  }

  /**
   * Check if we can recover from backpressure
   */
  private checkRecovery(service: AIService, status: RateLimitStatus): void {
    // Recover at 70% utilization (below warning threshold)
    if (status.utilizationPercent < THRESHOLDS.warning * 100 * 0.875) {
      this.backpressureState.set(service, false);
      this.activeDegradations.delete(service);
      this.criticalCount.set(service, 0);
      this.warningCount.set(service, 0);

      aiRateLimitDegradedGauge.labels(service).set(0);

      logger.info('[AI_RATE_LIMIT] Recovered from backpressure', {
        service,
        utilizationPercent: status.utilizationPercent.toFixed(1),
      });

      this.emit('recovered', { service, status });
    }
  }

  /**
   * Create degradation strategy for a service
   */
  private createDegradationStrategy(service: AIService): DegradationStrategy {
    switch (service) {
      case 'deepgram':
        return {
          service: 'deepgram',
          action: 'reduce_frequency',
          skipPercent: 50, // Skip 50% of interim transcripts
          reason: 'Deepgram rate limit approaching - reducing transcription frequency',
        };

      case 'openai':
        return {
          service: 'openai',
          action: 'queue',
          delayMs: 30000, // Delay 30 seconds
          reason: 'OpenAI rate limit approaching - queueing minutes generation',
        };

      case 'translate':
        return {
          service: 'translate',
          action: 'skip',
          reason: 'Translation rate limit approaching - temporarily disabling translation',
        };

      default:
        return {
          service,
          action: 'skip',
          reason: 'Rate limit reached',
        };
    }
  }

  /**
   * Get degradation strategy for a service
   */
  getDegradationStrategy(service: AIService): DegradationStrategy | undefined {
    return this.activeDegradations.get(service);
  }

  /**
   * Check if any service has backpressure active
   */
  isAnyBackpressureActive(): boolean {
    for (const active of this.backpressureState.values()) {
      if (active) return true;
    }
    return false;
  }

  /**
   * Check if a specific service has backpressure active
   */
  isBackpressureActive(service: AIService): boolean {
    return this.backpressureState.get(service) || false;
  }

  /**
   * Get all rate limit metrics
   */
  async getAllMetrics(): Promise<AIRateLimitMetrics> {
    const [deepgram, openai, translate] = await Promise.all([
      this.checkStatus('deepgram', 'requests'),
      this.checkStatus('openai', 'requests'),
      this.checkStatus('translate', 'requests'),
    ]);

    return {
      deepgram,
      openai,
      translate,
      anyBackpressureActive: this.isAnyBackpressureActive(),
      degradationStrategies: Array.from(this.activeDegradations.values()),
    };
  }

  /**
   * Manually reset backpressure for a service (for admin use)
   */
  resetBackpressure(service: AIService): void {
    this.backpressureState.set(service, false);
    this.activeDegradations.delete(service);
    this.criticalCount.set(service, 0);
    this.warningCount.set(service, 0);
    aiRateLimitDegradedGauge.labels(service).set(0);

    logger.info('[AI_RATE_LIMIT] Backpressure manually reset', { service });
    this.emit('reset', { service });
  }

  /**
   * Update rate limits at runtime
   */
  updateRateLimits(
    service: AIService,
    limits: { requestsPerMinute?: number; tokensPerMinute?: number; charactersPerMinute?: number; minutesPerMinute?: number }
  ): void {
    if (service === 'deepgram') {
      if (limits.requestsPerMinute) AI_RATE_LIMITS.deepgram.requestsPerMinute = limits.requestsPerMinute;
      if (limits.minutesPerMinute) AI_RATE_LIMITS.deepgram.minutesPerMinute = limits.minutesPerMinute;
    } else if (service === 'openai') {
      if (limits.requestsPerMinute) AI_RATE_LIMITS.openai.requestsPerMinute = limits.requestsPerMinute;
      if (limits.tokensPerMinute) AI_RATE_LIMITS.openai.tokensPerMinute = limits.tokensPerMinute;
    } else if (service === 'translate') {
      if (limits.requestsPerMinute) AI_RATE_LIMITS.translate.requestsPerMinute = limits.requestsPerMinute;
      if (limits.charactersPerMinute) AI_RATE_LIMITS.translate.charactersPerMinute = limits.charactersPerMinute;
    }

    logger.info('[AI_RATE_LIMIT] Rate limits updated', { service, limits });
  }

  /**
   * Get current rate limits
   */
  getRateLimits(): typeof AI_RATE_LIMITS {
    return { ...AI_RATE_LIMITS };
  }

  /**
   * Shutdown
   */
  async shutdown(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
    this.isInitialized = false;
    logger.info('[AI_RATE_LIMIT] Shutdown complete');
  }
}

// ── Singleton Instance ──────────────────────────────────────

const aiRateLimitGuard = new AIRateLimitGuard();

// ── Exported Functions ──────────────────────────────────────

export { aiRateLimitGuard };

/**
 * Initialize the rate limit guard
 */
export async function initializeAIRateLimit(): Promise<void> {
  return aiRateLimitGuard.initialize();
}

/**
 * Record Deepgram usage and check rate limit
 */
export async function checkDeepgramRateLimit(
  audioMinutes: number = 0
): Promise<RateLimitCheckResult> {
  // Record both requests and audio minutes
  if (audioMinutes > 0) {
    await aiRateLimitGuard.recordUsage('deepgram', 'minutes', Math.ceil(audioMinutes));
  }
  return aiRateLimitGuard.checkAndRecord('deepgram', 'requests', 1);
}

/**
 * Record OpenAI usage and check rate limit
 */
export async function checkOpenAIRateLimit(
  tokens: number = 0
): Promise<RateLimitCheckResult> {
  if (tokens > 0) {
    await aiRateLimitGuard.recordUsage('openai', 'tokens', tokens);
  }
  return aiRateLimitGuard.checkAndRecord('openai', 'requests', 1);
}

/**
 * Record translation usage and check rate limit
 */
export async function checkTranslationRateLimit(
  characters: number = 0
): Promise<RateLimitCheckResult> {
  if (characters > 0) {
    await aiRateLimitGuard.recordUsage('translate', 'characters', characters);
  }
  return aiRateLimitGuard.checkAndRecord('translate', 'requests', 1);
}

/**
 * Check if Deepgram is rate limited (without recording)
 */
export async function isDeepgramRateLimited(): Promise<boolean> {
  const status = await aiRateLimitGuard.checkStatus('deepgram', 'requests');
  return status.backpressureActive;
}

/**
 * Check if OpenAI is rate limited (without recording)
 */
export async function isOpenAIRateLimited(): Promise<boolean> {
  const status = await aiRateLimitGuard.checkStatus('openai', 'requests');
  return status.backpressureActive;
}

/**
 * Check if Translation is rate limited (without recording)
 */
export async function isTranslationRateLimited(): Promise<boolean> {
  const status = await aiRateLimitGuard.checkStatus('translate', 'requests');
  return status.backpressureActive;
}

/**
 * Get degradation strategy for a service
 */
export function getAIDegradationStrategy(service: AIService): DegradationStrategy | undefined {
  return aiRateLimitGuard.getDegradationStrategy(service);
}

/**
 * Get all rate limit metrics
 */
export async function getAIRateLimitMetrics(): Promise<AIRateLimitMetrics> {
  return aiRateLimitGuard.getAllMetrics();
}

/**
 * Check if any AI service has backpressure active
 */
export function isAnyAIBackpressureActive(): boolean {
  return aiRateLimitGuard.isAnyBackpressureActive();
}

/**
 * Subscribe to rate limit events
 */
export function onAIRateLimitEvent(
  event: 'warning' | 'backpressure' | 'recovered' | 'reset',
  listener: (data: { service: AIService; status?: RateLimitStatus; strategy?: DegradationStrategy }) => void
): void {
  aiRateLimitGuard.on(event, listener);
}

/**
 * Shutdown rate limit guard
 */
export async function shutdownAIRateLimit(): Promise<void> {
  return aiRateLimitGuard.shutdown();
}

// ── Service Integration Helpers ─────────────────────────────

/**
 * Guard for Deepgram transcription requests
 * Returns true if request should proceed, false if should be skipped/degraded
 */
export async function guardDeepgramRequest(
  isFinal: boolean = true
): Promise<{ proceed: boolean; skipReason?: string }> {
  const result = await checkDeepgramRateLimit();

  if (!result.allowed) {
    const degradation = result.degradation;

    // For interim transcripts with reduce_frequency strategy
    if (!isFinal && degradation?.action === 'reduce_frequency') {
      const skipPercent = degradation.skipPercent || 50;
      // Skip based on percentage
      if (Math.random() * 100 < skipPercent) {
        return {
          proceed: false,
          skipReason: `Rate limited: skipping ${skipPercent}% of interim transcripts`,
        };
      }
    }

    // For final transcripts, we try to proceed anyway but log
    if (isFinal) {
      logger.warn('[AI_RATE_LIMIT] Deepgram rate limited but proceeding with final transcript', {
        utilization: result.status.utilizationPercent.toFixed(1),
      });
      return { proceed: true };
    }

    return {
      proceed: false,
      skipReason: degradation?.reason || 'Rate limit exceeded',
    };
  }

  return { proceed: true };
}

/**
 * Guard for OpenAI requests (minutes generation)
 * Returns delay in ms if should be delayed, 0 if should proceed immediately
 */
export async function guardOpenAIRequest(
  estimatedTokens: number = 1000
): Promise<{ proceed: boolean; delayMs: number; skipReason?: string }> {
  const result = await checkOpenAIRateLimit(estimatedTokens);

  if (!result.allowed) {
    const degradation = result.degradation;

    if (degradation?.action === 'queue' && degradation.delayMs) {
      return {
        proceed: false,
        delayMs: degradation.delayMs,
        skipReason: degradation.reason,
      };
    }

    return {
      proceed: false,
      delayMs: result.status.retryAfterSeconds ? result.status.retryAfterSeconds * 1000 : 30000,
      skipReason: degradation?.reason || 'Rate limit exceeded',
    };
  }

  return { proceed: true, delayMs: 0 };
}

/**
 * Guard for translation requests
 * Returns true if should proceed, false if translation should be skipped
 */
export async function guardTranslationRequest(
  characterCount: number
): Promise<{ proceed: boolean; skipReason?: string }> {
  const result = await checkTranslationRateLimit(characterCount);

  if (!result.allowed) {
    const degradation = result.degradation;

    return {
      proceed: false,
      skipReason: degradation?.reason || 'Translation temporarily disabled due to rate limiting',
    };
  }

  return { proceed: true };
}
