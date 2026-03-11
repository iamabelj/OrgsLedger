// ============================================================
// OrgsLedger API — Queue Backpressure Protection
// Prevents system collapse under extreme load
// ============================================================
//
// Architecture:
//   - Check queue depth before accepting new jobs
//   - Reject jobs if queue exceeds threshold
//   - Return SYSTEM_OVERLOADED error with retry hint
//   - Emit Prometheus metrics for alerting
//
// Thresholds:
//   - transcript-events: 10,000 max waiting
//   - translation-jobs: 20,000 max waiting
//   - broadcast-events: 5,000 max waiting
//   - minutes-generation: 5,000 max waiting
//
// ============================================================

import { EventEmitter } from 'events';
import * as client from 'prom-client';
import { logger } from '../logger';
import { 
  queueManager, 
  SHARDED_QUEUE_TYPES, 
  getShardStats,
  QUEUE_SHARDS,
  ShardedQueueType,
} from '../queues/queue-manager';

// ── Configuration ───────────────────────────────────────────

export interface BackpressureThreshold {
  queueType: ShardedQueueType;
  maxWaiting: number;
  maxActive: number;
  /** Waiting jobs above this activates THROTTLE (default: 60% of maxWaiting) */
  throttleWaiting: number;
  retryAfterSeconds: number;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

const BACKPRESSURE_CONFIG: Record<ShardedQueueType, BackpressureThreshold> = {
  [SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS]: {
    queueType: SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS,
    maxWaiting: envInt('BP_TRANSCRIPT_MAX_WAITING', 10000),
    throttleWaiting: envInt('BP_TRANSCRIPT_THROTTLE_WAITING', 6000),
    maxActive: envInt('BP_TRANSCRIPT_MAX_ACTIVE', 5000),
    retryAfterSeconds: envInt('BP_TRANSCRIPT_RETRY_AFTER', 10),
  },
  [SHARDED_QUEUE_TYPES.TRANSLATION_JOBS]: {
    queueType: SHARDED_QUEUE_TYPES.TRANSLATION_JOBS,
    maxWaiting: envInt('BP_TRANSLATION_MAX_WAITING', 20000),
    throttleWaiting: envInt('BP_TRANSLATION_THROTTLE_WAITING', 12000),
    maxActive: envInt('BP_TRANSLATION_MAX_ACTIVE', 10000),
    retryAfterSeconds: envInt('BP_TRANSLATION_RETRY_AFTER', 15),
  },
  [SHARDED_QUEUE_TYPES.BROADCAST_EVENTS]: {
    queueType: SHARDED_QUEUE_TYPES.BROADCAST_EVENTS,
    maxWaiting: envInt('BP_BROADCAST_MAX_WAITING', 5000),
    throttleWaiting: envInt('BP_BROADCAST_THROTTLE_WAITING', 3000),
    maxActive: envInt('BP_BROADCAST_MAX_ACTIVE', 2000),
    retryAfterSeconds: envInt('BP_BROADCAST_RETRY_AFTER', 5),
  },
  [SHARDED_QUEUE_TYPES.MINUTES_GENERATION]: {
    queueType: SHARDED_QUEUE_TYPES.MINUTES_GENERATION,
    maxWaiting: envInt('BP_MINUTES_MAX_WAITING', 5000),
    throttleWaiting: envInt('BP_MINUTES_THROTTLE_WAITING', 3000),
    maxActive: envInt('BP_MINUTES_MAX_ACTIVE', 1000),
    retryAfterSeconds: envInt('BP_MINUTES_RETRY_AFTER', 30),
  },
};

// Cache durations
const CACHE_TTL_MS = 1000; // Cache queue stats for 1 second to reduce Redis calls

// ── Types ───────────────────────────────────────────────────

// ── Three-Tier Decision ─────────────────────────────────────

export type ThrottleDecision = 'ALLOW' | 'THROTTLE' | 'REJECT';

export interface ThrottleResult {
  decision: ThrottleDecision;
  queueType: ShardedQueueType;
  currentWaiting: number;
  currentActive: number;
  utilizationPercent: number;
  retryAfter?: number;
  /** Degradation actions the caller should apply when decision is THROTTLE */
  degradationActions: DegradationAction[];
}

export type DegradationAction =
  | 'SLOW_INGESTION'
  | 'DROP_LOW_PRIORITY'
  | 'REDUCE_TRANSLATION_LANGUAGES'
  | 'DISABLE_MINUTES_GENERATION';

export interface BackpressureCheckResult {
  allowed: boolean;
  queueType: ShardedQueueType;
  currentWaiting: number;
  currentActive: number;
  maxWaiting: number;
  maxActive: number;
  retryAfter?: number;
  utilizationPercent: number;
}

export interface SystemOverloadedError {
  error: 'SYSTEM_OVERLOADED';
  message: string;
  retryAfter: number;
  queueType: string;
  currentLoad: number;
  maxLoad: number;
}

export class BackpressureError extends Error {
  public readonly code = 'SYSTEM_OVERLOADED';
  public readonly retryAfter: number;
  public readonly queueType: ShardedQueueType;
  public readonly currentLoad: number;
  public readonly maxLoad: number;

  constructor(result: BackpressureCheckResult) {
    super(`System overloaded: ${result.queueType} queue at ${result.utilizationPercent.toFixed(1)}% capacity`);
    this.name = 'BackpressureError';
    this.retryAfter = BACKPRESSURE_CONFIG[result.queueType].retryAfterSeconds;
    this.queueType = result.queueType;
    this.currentLoad = result.currentWaiting;
    this.maxLoad = result.maxWaiting;
  }

  toJSON(): SystemOverloadedError {
    return {
      error: 'SYSTEM_OVERLOADED',
      message: this.message,
      retryAfter: this.retryAfter,
      queueType: this.queueType,
      currentLoad: this.currentLoad,
      maxLoad: this.maxLoad,
    };
  }
}

// ── Prometheus Metrics ──────────────────────────────────────

const register = client.register;

export const backpressureTriggeredCounter = new client.Counter({
  name: 'orgsledger_queue_backpressure_triggered',
  help: 'Number of times backpressure was triggered (jobs rejected)',
  labelNames: ['queue'] as const,
  registers: [register],
});

export const backpressureUtilizationGauge = new client.Gauge({
  name: 'orgsledger_queue_backpressure_utilization',
  help: 'Queue utilization percentage (waiting / max)',
  labelNames: ['queue'] as const,
  registers: [register],
});

export const backpressureAllowedGauge = new client.Gauge({
  name: 'orgsledger_queue_backpressure_allowed',
  help: 'Whether queue is accepting new jobs (1 = yes, 0 = no)',
  labelNames: ['queue'] as const,
  registers: [register],
});

export const backpressureThrottledGauge = new client.Gauge({
  name: 'orgsledger_queue_backpressure_throttled',
  help: 'Whether queue is in throttle mode (1 = throttled, 0 = normal)',
  labelNames: ['queue'] as const,
  registers: [register],
});

export const backpressureDegradationGauge = new client.Gauge({
  name: 'orgsledger_queue_backpressure_degradation_active',
  help: 'Active degradation actions (1 = active, 0 = inactive)',
  labelNames: ['queue', 'action'] as const,
  registers: [register],
});

// ── Backpressure Manager Class ──────────────────────────────

class BackpressureManager extends EventEmitter {
  // Cache for queue stats to reduce Redis calls
  private statsCache: Map<ShardedQueueType, {
    waiting: number;
    active: number;
    timestamp: number;
  }> = new Map();

  // Track consecutive overload states for hysteresis
  private overloadState: Map<ShardedQueueType, boolean> = new Map();

  // Track throttle state for alert dedup
  private throttleState: Map<ShardedQueueType, ThrottleDecision> = new Map();

  constructor() {
    super();
    // Initialize all queues as not overloaded
    for (const queueType of Object.values(SHARDED_QUEUE_TYPES)) {
      this.overloadState.set(queueType, false);
      this.throttleState.set(queueType, 'ALLOW');
    }
  }

  // ── Three-Tier shouldThrottle ──────────────────────────────

  /**
   * Evaluate queue pressure and return a 3-tier decision:
   *   ALLOW    — queue healthy, process normally
   *   THROTTLE — queue under pressure, apply degradation actions
   *   REJECT   — queue overloaded, refuse new work
   */
  async shouldThrottle(queueType: ShardedQueueType): Promise<ThrottleResult> {
    const config = BACKPRESSURE_CONFIG[queueType];
    if (!config) {
      return {
        decision: 'ALLOW',
        queueType,
        currentWaiting: 0,
        currentActive: 0,
        utilizationPercent: 0,
        degradationActions: [],
      };
    }

    try {
      const { waiting, active } = await this.getQueueStats(queueType);
      const utilizationPercent = (waiting / config.maxWaiting) * 100;

      let decision: ThrottleDecision;
      const degradationActions: DegradationAction[] = [];

      const wasOverloaded = this.overloadState.get(queueType) || false;
      const recoveryThreshold = config.maxWaiting * 0.8;
      const throttleRecovery = config.throttleWaiting * 0.8;
      const prevDecision = this.throttleState.get(queueType) || 'ALLOW';

      // ── REJECT tier ──
      if (wasOverloaded
        ? (waiting >= recoveryThreshold || active >= config.maxActive)
        : (waiting >= config.maxWaiting || active >= config.maxActive)
      ) {
        decision = 'REJECT';
        this.overloadState.set(queueType, true);
      }
      // ── THROTTLE tier ──
      else if (
        prevDecision === 'THROTTLE'
          ? (waiting >= throttleRecovery)
          : (waiting >= config.throttleWaiting)
      ) {
        decision = 'THROTTLE';
        this.overloadState.set(queueType, false);

        // Graduated degradation actions based on utilization
        degradationActions.push('SLOW_INGESTION');
        degradationActions.push('DROP_LOW_PRIORITY');

        if (utilizationPercent >= 70) {
          degradationActions.push('REDUCE_TRANSLATION_LANGUAGES');
        }
        if (utilizationPercent >= 80) {
          degradationActions.push('DISABLE_MINUTES_GENERATION');
        }
      }
      // ── ALLOW tier ──
      else {
        decision = 'ALLOW';
        this.overloadState.set(queueType, false);
      }

      // Update Prometheus
      backpressureUtilizationGauge.labels(queueType).set(utilizationPercent);
      backpressureAllowedGauge.labels(queueType).set(decision === 'REJECT' ? 0 : 1);
      backpressureThrottledGauge.labels(queueType).set(decision === 'THROTTLE' ? 1 : 0);

      for (const action of ['SLOW_INGESTION', 'DROP_LOW_PRIORITY', 'REDUCE_TRANSLATION_LANGUAGES', 'DISABLE_MINUTES_GENERATION'] as DegradationAction[]) {
        backpressureDegradationGauge.labels(queueType, action).set(
          degradationActions.includes(action) ? 1 : 0
        );
      }

      if (decision === 'REJECT') {
        backpressureTriggeredCounter.labels(queueType).inc();
      }

      // Emit alerts on state transitions
      if (decision !== prevDecision) {
        this.throttleState.set(queueType, decision);

        if (decision === 'THROTTLE') {
          const alert = {
            type: 'BACKPRESSURE_THROTTLE' as const,
            queueType,
            waiting,
            active,
            utilizationPercent,
            degradationActions,
            timestamp: new Date().toISOString(),
          };
          this.emit('throttle', alert);
          logger.warn('[BACKPRESSURE] Throttle activated', alert);
        } else if (decision === 'REJECT') {
          const alert = {
            type: 'BACKPRESSURE_REJECT' as const,
            queueType,
            waiting,
            active,
            utilizationPercent,
            timestamp: new Date().toISOString(),
          };
          this.emit('reject', alert);
          logger.error('[BACKPRESSURE] Reject activated — queue overloaded', alert);
        } else {
          const alert = {
            type: 'BACKPRESSURE_RECOVERED' as const,
            queueType,
            waiting,
            active,
            utilizationPercent,
            timestamp: new Date().toISOString(),
          };
          this.emit('recovered', alert);
          logger.info('[BACKPRESSURE] Recovered to ALLOW', alert);
        }
      }

      const result: ThrottleResult = {
        decision,
        queueType,
        currentWaiting: waiting,
        currentActive: active,
        utilizationPercent,
        degradationActions,
      };

      if (decision === 'REJECT') {
        result.retryAfter = config.retryAfterSeconds;
      }

      return result;
    } catch (err) {
      // Fail-open
      logger.error('[BACKPRESSURE] shouldThrottle check failed', { queueType, error: err });
      return {
        decision: 'ALLOW',
        queueType,
        currentWaiting: 0,
        currentActive: 0,
        utilizationPercent: 0,
        degradationActions: [],
      };
    }
  }

  /**
   * Check if a queue can accept new jobs
   * Returns true if allowed, false if backpressure should be applied
   */
  async checkBackpressure(queueType: ShardedQueueType): Promise<BackpressureCheckResult> {
    const config = BACKPRESSURE_CONFIG[queueType];
    if (!config) {
      logger.warn('[BACKPRESSURE] Unknown queue type', { queueType });
      return {
        allowed: true,
        queueType,
        currentWaiting: 0,
        currentActive: 0,
        maxWaiting: 10000,
        maxActive: 5000,
        utilizationPercent: 0,
      };
    }

    try {
      // Get cached or fresh stats
      const { waiting, active } = await this.getQueueStats(queueType);

      // Calculate utilization
      const utilizationPercent = (waiting / config.maxWaiting) * 100;

      // Update Prometheus gauges
      backpressureUtilizationGauge.labels(queueType).set(utilizationPercent);

      // Check if overloaded (with hysteresis to prevent flapping)
      const isOverloaded = this.checkOverloadWithHysteresis(
        queueType,
        waiting,
        active,
        config
      );

      const allowed = !isOverloaded;

      // Update allowed gauge
      backpressureAllowedGauge.labels(queueType).set(allowed ? 1 : 0);

      const result: BackpressureCheckResult = {
        allowed,
        queueType,
        currentWaiting: waiting,
        currentActive: active,
        maxWaiting: config.maxWaiting,
        maxActive: config.maxActive,
        utilizationPercent,
      };

      if (!allowed) {
        result.retryAfter = config.retryAfterSeconds;
        
        // Increment counter
        backpressureTriggeredCounter.labels(queueType).inc();
        
        logger.warn('[BACKPRESSURE] Queue overloaded, rejecting job', {
          queueType,
          waiting,
          active,
          maxWaiting: config.maxWaiting,
          utilizationPercent: utilizationPercent.toFixed(1),
        });
      }

      return result;

    } catch (err) {
      // On error, allow the job (fail-open for availability)
      logger.error('[BACKPRESSURE] Failed to check queue stats', { queueType, error: err });
      return {
        allowed: true,
        queueType,
        currentWaiting: 0,
        currentActive: 0,
        maxWaiting: config.maxWaiting,
        maxActive: config.maxActive,
        utilizationPercent: 0,
      };
    }
  }

  /**
   * Check with hysteresis to prevent flapping
   * Once overloaded, stay overloaded until 80% of threshold
   */
  private checkOverloadWithHysteresis(
    queueType: ShardedQueueType,
    waiting: number,
    active: number,
    config: BackpressureThreshold
  ): boolean {
    const wasOverloaded = this.overloadState.get(queueType) || false;
    
    // Recovery threshold (80% of max)
    const recoveryThreshold = config.maxWaiting * 0.8;
    
    let isOverloaded: boolean;
    
    if (wasOverloaded) {
      // If previously overloaded, only recover when below 80%
      isOverloaded = waiting >= recoveryThreshold || active >= config.maxActive;
    } else {
      // If not overloaded, trigger at 100%
      isOverloaded = waiting >= config.maxWaiting || active >= config.maxActive;
    }
    
    // Update state
    this.overloadState.set(queueType, isOverloaded);
    
    return isOverloaded;
  }

  /**
   * Get queue stats with caching
   */
  private async getQueueStats(queueType: ShardedQueueType): Promise<{
    waiting: number;
    active: number;
  }> {
    const now = Date.now();
    const cached = this.statsCache.get(queueType);
    
    // Return cached if fresh
    if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
      return { waiting: cached.waiting, active: cached.active };
    }

    // Fetch fresh stats
    const stats = await getShardStats(queueType);
    const result = {
      waiting: stats.totals.waiting,
      active: stats.totals.active,
    };

    // Update cache
    this.statsCache.set(queueType, {
      ...result,
      timestamp: now,
    });

    return result;
  }

  /**
   * Assert that a queue can accept new jobs
   * Throws BackpressureError if overloaded
   */
  async assertCanAccept(queueType: ShardedQueueType): Promise<void> {
    const result = await this.checkBackpressure(queueType);
    if (!result.allowed) {
      throw new BackpressureError(result);
    }
  }

  /**
   * Get current backpressure status for all queues
   */
  async getAllBackpressureStatus(): Promise<Record<ShardedQueueType, BackpressureCheckResult>> {
    const results: Partial<Record<ShardedQueueType, BackpressureCheckResult>> = {};
    
    // Check all queues in parallel
    const checks = await Promise.all(
      Object.values(SHARDED_QUEUE_TYPES).map(async (queueType) => ({
        queueType,
        result: await this.checkBackpressure(queueType),
      }))
    );

    for (const { queueType, result } of checks) {
      results[queueType] = result;
    }

    return results as Record<ShardedQueueType, BackpressureCheckResult>;
  }

  /**
   * Update thresholds at runtime (for dynamic scaling)
   */
  updateThreshold(
    queueType: ShardedQueueType,
    updates: Partial<Omit<BackpressureThreshold, 'queueType'>>
  ): void {
    const current = BACKPRESSURE_CONFIG[queueType];
    if (current) {
      Object.assign(current, updates);
      logger.info('[BACKPRESSURE] Threshold updated', { queueType, updates });
    }
  }

  /**
   * Clear cache (for testing)
   */
  clearCache(): void {
    this.statsCache.clear();
  }

  /**
   * Get current thresholds
   */
  getThresholds(): Record<ShardedQueueType, BackpressureThreshold> {
    return { ...BACKPRESSURE_CONFIG };
  }

  /**
   * Get the current throttle state for all queues without querying Redis.
   */
  getThrottleStates(): Record<ShardedQueueType, ThrottleDecision> {
    const result: Partial<Record<ShardedQueueType, ThrottleDecision>> = {};
    for (const qt of Object.values(SHARDED_QUEUE_TYPES)) {
      result[qt] = this.throttleState.get(qt) || 'ALLOW';
    }
    return result as Record<ShardedQueueType, ThrottleDecision>;
  }
}

// ── Singleton Instance ──────────────────────────────────────

const backpressureManager = new BackpressureManager();

// ── Exported Functions ──────────────────────────────────────

export { backpressureManager };

/**
 * Check if transcript queue can accept new jobs
 */
export async function checkTranscriptBackpressure(): Promise<BackpressureCheckResult> {
  return backpressureManager.checkBackpressure(SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS);
}

/**
 * Check if translation queue can accept new jobs
 */
export async function checkTranslationBackpressure(): Promise<BackpressureCheckResult> {
  return backpressureManager.checkBackpressure(SHARDED_QUEUE_TYPES.TRANSLATION_JOBS);
}

/**
 * Check if broadcast queue can accept new jobs
 */
export async function checkBroadcastBackpressure(): Promise<BackpressureCheckResult> {
  return backpressureManager.checkBackpressure(SHARDED_QUEUE_TYPES.BROADCAST_EVENTS);
}

/**
 * Check if minutes queue can accept new jobs
 */
export async function checkMinutesBackpressure(): Promise<BackpressureCheckResult> {
  return backpressureManager.checkBackpressure(SHARDED_QUEUE_TYPES.MINUTES_GENERATION);
}

/**
 * Assert transcript queue can accept new jobs (throws on overload)
 */
export async function assertTranscriptCanAccept(): Promise<void> {
  return backpressureManager.assertCanAccept(SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS);
}

/**
 * Assert translation queue can accept new jobs (throws on overload)
 */
export async function assertTranslationCanAccept(): Promise<void> {
  return backpressureManager.assertCanAccept(SHARDED_QUEUE_TYPES.TRANSLATION_JOBS);
}

/**
 * Assert broadcast queue can accept new jobs (throws on overload)
 */
export async function assertBroadcastCanAccept(): Promise<void> {
  return backpressureManager.assertCanAccept(SHARDED_QUEUE_TYPES.BROADCAST_EVENTS);
}

/**
 * Assert minutes queue can accept new jobs (throws on overload)
 */
export async function assertMinutesCanAccept(): Promise<void> {
  return backpressureManager.assertCanAccept(SHARDED_QUEUE_TYPES.MINUTES_GENERATION);
}

/**
 * Get backpressure status for all queues
 */
export async function getAllBackpressureStatus(): Promise<Record<ShardedQueueType, BackpressureCheckResult>> {
  return backpressureManager.getAllBackpressureStatus();
}

/**
 * Check backpressure for a specific queue type
 */
export async function checkBackpressure(queueType: ShardedQueueType): Promise<BackpressureCheckResult> {
  return backpressureManager.checkBackpressure(queueType);
}

/**
 * Assert queue can accept new jobs (throws BackpressureError on overload)
 */
export async function assertCanAccept(queueType: ShardedQueueType): Promise<void> {
  return backpressureManager.assertCanAccept(queueType);
}

// ── Three-Tier shouldThrottle API ───────────────────────────

/**
 * Evaluate queue pressure and return ALLOW | THROTTLE | REJECT.
 *
 * ALLOW    — queue healthy, process normally.
 * THROTTLE — queue under pressure. Caller should apply the returned
 *            `degradationActions` (slow ingestion, drop low-priority
 *            tasks, reduce translation languages, disable minutes).
 * REJECT   — queue overloaded, refuse the work entirely.
 */
export async function shouldThrottle(queueType: ShardedQueueType): Promise<ThrottleResult> {
  return backpressureManager.shouldThrottle(queueType);
}

/**
 * Evaluate all queues at once.
 */
export async function shouldThrottleAll(): Promise<Record<ShardedQueueType, ThrottleResult>> {
  const results: Partial<Record<ShardedQueueType, ThrottleResult>> = {};
  const checks = await Promise.all(
    Object.values(SHARDED_QUEUE_TYPES).map(async (qt) => ({
      qt,
      result: await backpressureManager.shouldThrottle(qt),
    }))
  );
  for (const { qt, result } of checks) {
    results[qt] = result;
  }
  return results as Record<ShardedQueueType, ThrottleResult>;
}

/**
 * Quick check: is any queue currently throttled or rejected?
 */
export function isAnyBackpressureActive(): boolean {
  const states = backpressureManager.getThrottleStates();
  return Object.values(states).some(s => s !== 'ALLOW');
}

// ── Higher-Order Function for Service Methods ──────────────

/**
 * Wrap a function to check backpressure before execution
 * Throws BackpressureError if queue is overloaded
 */
export function withBackpressure<T extends (...args: any[]) => Promise<any>>(
  queueType: ShardedQueueType,
  fn: T
): T {
  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    await backpressureManager.assertCanAccept(queueType);
    return fn(...args);
  }) as T;
}

/**
 * Decorator-style backpressure check for class methods
 */
export function BackpressureGuard(queueType: ShardedQueueType) {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      await backpressureManager.assertCanAccept(queueType);
      return originalMethod.apply(this, args);
    };
    
    return descriptor;
  };
}

// ── Express Middleware ──────────────────────────────────────

import { Request, Response, NextFunction } from 'express';

/**
 * Express middleware to check backpressure before processing request
 */
export function backpressureMiddleware(queueType: ShardedQueueType) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await backpressureManager.checkBackpressure(queueType);
      
      if (!result.allowed) {
        const error = new BackpressureError(result);
        res.setHeader('Retry-After', error.retryAfter.toString());
        return res.status(503).json(error.toJSON());
      }
      
      next();
    } catch (err) {
      // Fail-open: don't block on backpressure check failure
      logger.error('[BACKPRESSURE_MIDDLEWARE] Check failed', { error: err });
      next();
    }
  };
}

// ── Utility Functions ───────────────────────────────────────

/**
 * Check if an error is a BackpressureError
 */
export function isBackpressureError(err: unknown): err is BackpressureError {
  return err instanceof BackpressureError || 
    (err instanceof Error && (err as any).code === 'SYSTEM_OVERLOADED');
}

/**
 * Format error for API response
 */
export function formatBackpressureError(err: BackpressureError): SystemOverloadedError {
  return err.toJSON();
}

// ── Backpressure-Protected Submit Functions ─────────────────

import {
  submitTranscript as submitTranscriptRaw,
  submitTranslation as submitTranslationRaw,
  submitBroadcast as submitBroadcastRaw,
  submitMinutes as submitMinutesRaw,
  TranscriptEventData,
  TranslationJobData,
  BroadcastEventData,
  MinutesJobData,
} from '../queues/queue-manager';
import type { Job } from 'bullmq';

/**
 * Submit a transcript event with backpressure protection
 * Throws BackpressureError if queue is overloaded
 */
export async function submitTranscriptWithBackpressure(
  data: TranscriptEventData,
  options?: { priority?: number }
): Promise<Job<TranscriptEventData>> {
  await backpressureManager.assertCanAccept(SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS);
  return submitTranscriptRaw(data, options);
}

/**
 * Submit a translation job with backpressure protection
 * Throws BackpressureError if queue is overloaded
 */
export async function submitTranslationWithBackpressure(
  data: TranslationJobData,
  options?: { delay?: number }
): Promise<Job<TranslationJobData>> {
  await backpressureManager.assertCanAccept(SHARDED_QUEUE_TYPES.TRANSLATION_JOBS);
  return submitTranslationRaw(data, options);
}

/**
 * Submit a broadcast event with backpressure protection
 * Throws BackpressureError if queue is overloaded
 */
export async function submitBroadcastWithBackpressure(
  data: BroadcastEventData
): Promise<Job<BroadcastEventData>> {
  await backpressureManager.assertCanAccept(SHARDED_QUEUE_TYPES.BROADCAST_EVENTS);
  return submitBroadcastRaw(data);
}

/**
 * Submit a minutes generation job with backpressure protection
 * Throws BackpressureError if queue is overloaded
 */
export async function submitMinutesWithBackpressure(
  data: MinutesJobData,
  options?: { delay?: number }
): Promise<Job<MinutesJobData>> {
  await backpressureManager.assertCanAccept(SHARDED_QUEUE_TYPES.MINUTES_GENERATION);
  return submitMinutesRaw(data, options);
}
