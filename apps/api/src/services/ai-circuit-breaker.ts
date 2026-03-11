// ============================================================
// OrgsLedger API — AI Circuit Breaker Service
// Protects against slow/failing AI providers
// ============================================================
//
// Protects:
//   - OpenAI (minutes generation, AI summaries)
//   - Deepgram (live transcription)
//
// Tracking:
//   - Request latency (rolling window)
//   - Error rate (rolling window)
//
// Rules:
//   - Open circuit if error rate > 20% over last 50 requests
//   - Open circuit if avg latency > 3 seconds
//   - Stay open for 60 seconds, then half-open
//
// States:
//   CLOSED   → Normal operation
//   OPEN     → Reject immediately, return fallback
//   HALF_OPEN → Allow 1 test request
//
// ============================================================

import * as client from 'prom-client';
import { EventEmitter } from 'events';
import { logger } from '../logger';

// ── Configuration ───────────────────────────────────────────

export interface AICircuitBreakerConfig {
  /** Window size for tracking (number of requests) */
  windowSize: number;
  /** Error rate threshold to open circuit (0-1) */
  errorRateThreshold: number;
  /** Average latency threshold to open circuit (ms) */
  latencyThresholdMs: number;
  /** How long circuit stays open before half-open (ms) */
  openDurationMs: number;
  /** Number of successful requests in half-open to close */
  halfOpenSuccessThreshold: number;
}

const DEFAULT_CONFIG: AICircuitBreakerConfig = {
  windowSize: parseInt(process.env.AI_CIRCUIT_WINDOW_SIZE || '50', 10),
  errorRateThreshold: parseFloat(process.env.AI_CIRCUIT_ERROR_THRESHOLD || '0.20'),
  latencyThresholdMs: parseInt(process.env.AI_CIRCUIT_LATENCY_THRESHOLD_MS || '3000', 10),
  openDurationMs: parseInt(process.env.AI_CIRCUIT_OPEN_DURATION_MS || '60000', 10),
  halfOpenSuccessThreshold: parseInt(process.env.AI_CIRCUIT_HALF_OPEN_SUCCESS || '3', 10),
};

// ── Types ───────────────────────────────────────────────────

export type AIProvider = 'openai' | 'deepgram';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface RequestRecord {
  timestamp: number;
  latencyMs: number;
  success: boolean;
  error?: string;
}

export interface CircuitBreakerStats {
  provider: AIProvider;
  state: CircuitState;
  requestCount: number;
  errorCount: number;
  errorRate: number;
  avgLatencyMs: number;
  lastError?: string;
  lastSuccess?: Date;
  openedAt?: Date;
  halfOpenSuccesses: number;
}

export interface CircuitBreakerEvent {
  type: 'state_change' | 'request_rejected' | 'fallback_used';
  provider: AIProvider;
  previousState?: CircuitState;
  newState?: CircuitState;
  reason?: string;
  timestamp: Date;
}

// ── Prometheus Metrics ──────────────────────────────────────

const PREFIX = 'orgsledger_ai_circuit_breaker_';

export const aiCircuitBreakerStateGauge = new client.Gauge({
  name: `${PREFIX}state`,
  help: 'Circuit breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)',
  labelNames: ['provider'],
});

export const aiCircuitBreakerFailuresCounter = new client.Counter({
  name: `${PREFIX}failures_total`,
  help: 'Total failures recorded by circuit breaker',
  labelNames: ['provider'],
});

export const aiCircuitBreakerSuccessesCounter = new client.Counter({
  name: `${PREFIX}successes_total`,
  help: 'Total successes recorded by circuit breaker',
  labelNames: ['provider'],
});

export const aiCircuitBreakerRejectsCounter = new client.Counter({
  name: `${PREFIX}rejects_total`,
  help: 'Requests rejected while circuit is open',
  labelNames: ['provider'],
});

export const aiCircuitBreakerFallbackCounter = new client.Counter({
  name: `${PREFIX}fallback_total`,
  help: 'Fallback responses returned',
  labelNames: ['provider'],
});

export const aiCircuitBreakerLatencyHistogram = new client.Histogram({
  name: `${PREFIX}latency_seconds`,
  help: 'Request latency through circuit breaker',
  labelNames: ['provider', 'success'],
  buckets: [0.1, 0.5, 1, 2, 3, 5, 10, 30],
});

export const aiCircuitBreakerErrorRateGauge = new client.Gauge({
  name: `${PREFIX}error_rate`,
  help: 'Current error rate (0-1)',
  labelNames: ['provider'],
});

export const aiCircuitBreakerAvgLatencyGauge = new client.Gauge({
  name: `${PREFIX}avg_latency_ms`,
  help: 'Current average latency in ms',
  labelNames: ['provider'],
});

// ── Errors ──────────────────────────────────────────────────

export class CircuitOpenError extends Error {
  constructor(
    public readonly provider: AIProvider,
    public readonly retryAfterMs: number
  ) {
    super(`Circuit breaker OPEN for ${provider}`);
    this.name = 'CircuitOpenError';
  }
}

// ── Provider Circuit Breaker ────────────────────────────────

class ProviderCircuitBreaker extends EventEmitter {
  private provider: AIProvider;
  private config: AICircuitBreakerConfig;
  private state: CircuitState = 'CLOSED';
  private records: RequestRecord[] = [];
  private halfOpenSuccesses = 0;
  private openedAt?: Date;
  private lastSuccess?: Date;
  private lastError?: string;
  private resetTimer?: NodeJS.Timeout;

  constructor(provider: AIProvider, config: AICircuitBreakerConfig) {
    super();
    this.provider = provider;
    this.config = config;
    aiCircuitBreakerStateGauge.set({ provider }, 0); // CLOSED
  }

  /**
   * Execute a function through the circuit breaker.
   */
  async execute<T>(
    fn: () => Promise<T>,
    fallback?: () => T | Promise<T>
  ): Promise<T> {
    // Check if circuit is open
    if (this.state === 'OPEN') {
      const retryAfter = this.openedAt
        ? this.config.openDurationMs - (Date.now() - this.openedAt.getTime())
        : this.config.openDurationMs;

      aiCircuitBreakerRejectsCounter.inc({ provider: this.provider });

      if (fallback) {
        aiCircuitBreakerFallbackCounter.inc({ provider: this.provider });
        logger.info(`[AI_CIRCUIT] ${this.provider}: Returning fallback (circuit OPEN)`);
        return fallback();
      }

      throw new CircuitOpenError(this.provider, Math.max(0, retryAfter));
    }

    // Half-open: only allow one test request at a time
    if (this.state === 'HALF_OPEN') {
      // Allow the test request through
      logger.info(`[AI_CIRCUIT] ${this.provider}: Allowing test request (HALF_OPEN)`);
    }

    const startTime = Date.now();
    let success = false;
    let error: Error | undefined;

    try {
      const result = await fn();
      success = true;
      this.lastSuccess = new Date();
      return result;

    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
      this.lastError = error.message;
      throw err;

    } finally {
      const latencyMs = Date.now() - startTime;
      this.recordRequest(latencyMs, success, error?.message);
    }
  }

  /**
   * Record a request result.
   */
  private recordRequest(latencyMs: number, success: boolean, errorMsg?: string): void {
    const record: RequestRecord = {
      timestamp: Date.now(),
      latencyMs,
      success,
      error: errorMsg,
    };

    this.records.push(record);

    // Trim to window size
    while (this.records.length > this.config.windowSize) {
      this.records.shift();
    }

    // Update Prometheus metrics
    aiCircuitBreakerLatencyHistogram.observe(
      { provider: this.provider, success: success ? 'true' : 'false' },
      latencyMs / 1000
    );

    if (success) {
      aiCircuitBreakerSuccessesCounter.inc({ provider: this.provider });
    } else {
      aiCircuitBreakerFailuresCounter.inc({ provider: this.provider });
    }

    // Update state based on new record
    this.evaluateState(success);
  }

  /**
   * Evaluate whether to change state.
   */
  private evaluateState(lastSuccess: boolean): void {
    const { errorRate, avgLatency } = this.calculateMetrics();

    // Update metric gauges
    aiCircuitBreakerErrorRateGauge.set({ provider: this.provider }, errorRate);
    aiCircuitBreakerAvgLatencyGauge.set({ provider: this.provider }, avgLatency);

    switch (this.state) {
      case 'CLOSED':
        // Check if we should open
        if (this.records.length >= 10) { // Need minimum requests before opening
          if (errorRate > this.config.errorRateThreshold) {
            this.transitionTo('OPEN', `error_rate_${(errorRate * 100).toFixed(1)}%`);
          } else if (avgLatency > this.config.latencyThresholdMs) {
            this.transitionTo('OPEN', `avg_latency_${avgLatency.toFixed(0)}ms`);
          }
        }
        break;

      case 'HALF_OPEN':
        if (lastSuccess) {
          this.halfOpenSuccesses++;
          if (this.halfOpenSuccesses >= this.config.halfOpenSuccessThreshold) {
            this.transitionTo('CLOSED', 'recovery_confirmed');
          }
        } else {
          // Any failure in half-open reopens the circuit
          this.transitionTo('OPEN', 'half_open_failure');
        }
        break;

      case 'OPEN':
        // Should not receive requests in OPEN state
        break;
    }
  }

  /**
   * Calculate error rate and average latency.
   */
  private calculateMetrics(): { errorRate: number; avgLatency: number } {
    if (this.records.length === 0) {
      return { errorRate: 0, avgLatency: 0 };
    }

    const errorCount = this.records.filter(r => !r.success).length;
    const errorRate = errorCount / this.records.length;

    const totalLatency = this.records.reduce((sum, r) => sum + r.latencyMs, 0);
    const avgLatency = totalLatency / this.records.length;

    return { errorRate, avgLatency };
  }

  /**
   * Transition to a new state.
   */
  private transitionTo(newState: CircuitState, reason: string): void {
    const previousState = this.state;
    this.state = newState;

    logger.warn(`[AI_CIRCUIT] ${this.provider}: ${previousState} → ${newState}`, {
      reason,
      errorRate: this.calculateMetrics().errorRate,
      avgLatency: this.calculateMetrics().avgLatency,
    });

    // Update metric
    const stateValue = newState === 'CLOSED' ? 0 : newState === 'OPEN' ? 1 : 2;
    aiCircuitBreakerStateGauge.set({ provider: this.provider }, stateValue);

    // Clear reset timer
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }

    switch (newState) {
      case 'OPEN':
        this.openedAt = new Date();
        this.halfOpenSuccesses = 0;

        // Schedule transition to half-open
        this.resetTimer = setTimeout(() => {
          this.transitionTo('HALF_OPEN', 'timeout_expired');
        }, this.config.openDurationMs);
        this.resetTimer.unref();
        break;

      case 'HALF_OPEN':
        this.halfOpenSuccesses = 0;
        break;

      case 'CLOSED':
        this.records = []; // Clear history on close
        this.openedAt = undefined;
        break;
    }

    // Emit event
    this.emit('state_change', {
      type: 'state_change',
      provider: this.provider,
      previousState,
      newState,
      reason,
      timestamp: new Date(),
    } as CircuitBreakerEvent);
  }

  /**
   * Get current stats.
   */
  getStats(): CircuitBreakerStats {
    const { errorRate, avgLatency } = this.calculateMetrics();

    return {
      provider: this.provider,
      state: this.state,
      requestCount: this.records.length,
      errorCount: this.records.filter(r => !r.success).length,
      errorRate,
      avgLatencyMs: avgLatency,
      lastError: this.lastError,
      lastSuccess: this.lastSuccess,
      openedAt: this.openedAt,
      halfOpenSuccesses: this.halfOpenSuccesses,
    };
  }

  /**
   * Get current state.
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Force state (for testing/admin).
   */
  forceState(state: CircuitState): void {
    this.transitionTo(state, 'forced');
  }

  /**
   * Reset the circuit breaker.
   */
  reset(): void {
    this.records = [];
    this.halfOpenSuccesses = 0;
    this.openedAt = undefined;
    this.lastError = undefined;
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }
    this.transitionTo('CLOSED', 'manual_reset');
  }
}

// ── AI Circuit Breaker Service ──────────────────────────────

class AICircuitBreakerService extends EventEmitter {
  private breakers: Map<AIProvider, ProviderCircuitBreaker> = new Map();
  private config: AICircuitBreakerConfig;

  constructor(config: Partial<AICircuitBreakerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize breakers for each provider
    for (const provider of ['openai', 'deepgram'] as AIProvider[]) {
      const breaker = new ProviderCircuitBreaker(provider, this.config);

      // Forward events
      breaker.on('state_change', (event: CircuitBreakerEvent) => {
        this.emit('state_change', event);
      });

      this.breakers.set(provider, breaker);
    }

    logger.info('[AI_CIRCUIT] Service initialized', {
      providers: Array.from(this.breakers.keys()),
      config: this.config,
    });
  }

  /**
   * Execute a function through the specified provider's circuit breaker.
   */
  async execute<T>(
    provider: AIProvider,
    fn: () => Promise<T>,
    fallback?: () => T | Promise<T>
  ): Promise<T> {
    const breaker = this.breakers.get(provider);
    if (!breaker) {
      throw new Error(`Unknown AI provider: ${provider}`);
    }
    return breaker.execute(fn, fallback);
  }

  /**
   * Get stats for a provider.
   */
  getStats(provider: AIProvider): CircuitBreakerStats | null {
    return this.breakers.get(provider)?.getStats() || null;
  }

  /**
   * Get stats for all providers.
   */
  getAllStats(): CircuitBreakerStats[] {
    return Array.from(this.breakers.values()).map(b => b.getStats());
  }

  /**
   * Get state for a provider.
   */
  getState(provider: AIProvider): CircuitState | null {
    return this.breakers.get(provider)?.getState() || null;
  }

  /**
   * Check if a provider is available (not OPEN).
   */
  isAvailable(provider: AIProvider): boolean {
    const state = this.getState(provider);
    return state !== 'OPEN';
  }

  /**
   * Force a provider's state.
   */
  forceState(provider: AIProvider, state: CircuitState): void {
    this.breakers.get(provider)?.forceState(state);
  }

  /**
   * Reset a provider's circuit breaker.
   */
  reset(provider: AIProvider): void {
    this.breakers.get(provider)?.reset();
  }

  /**
   * Reset all circuit breakers.
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}

// ── Singleton ───────────────────────────────────────────────

export const aiCircuitBreakerService = new AICircuitBreakerService();

// ── Convenient Wrappers ─────────────────────────────────────

/**
 * Execute an OpenAI request through the circuit breaker.
 */
export async function executeOpenAI<T>(
  fn: () => Promise<T>,
  fallback?: () => T | Promise<T>
): Promise<T> {
  return aiCircuitBreakerService.execute('openai', fn, fallback);
}

/**
 * Execute a Deepgram request through the circuit breaker.
 */
export async function executeDeepgram<T>(
  fn: () => Promise<T>,
  fallback?: () => T | Promise<T>
): Promise<T> {
  return aiCircuitBreakerService.execute('deepgram', fn, fallback);
}

/**
 * Check if OpenAI is available.
 */
export function isOpenAIAvailable(): boolean {
  return aiCircuitBreakerService.isAvailable('openai');
}

/**
 * Check if Deepgram is available.
 */
export function isDeepgramAvailable(): boolean {
  return aiCircuitBreakerService.isAvailable('deepgram');
}

// ── Exports ─────────────────────────────────────────────────

export function getAICircuitBreakerStats(provider: AIProvider): CircuitBreakerStats | null {
  return aiCircuitBreakerService.getStats(provider);
}

export function getAllAICircuitBreakerStats(): CircuitBreakerStats[] {
  return aiCircuitBreakerService.getAllStats();
}

export function getAICircuitBreakerState(provider: AIProvider): CircuitState | null {
  return aiCircuitBreakerService.getState(provider);
}

export function forceAICircuitBreakerState(provider: AIProvider, state: CircuitState): void {
  aiCircuitBreakerService.forceState(provider, state);
}

export function resetAICircuitBreaker(provider: AIProvider): void {
  aiCircuitBreakerService.reset(provider);
}

export function resetAllAICircuitBreakers(): void {
  aiCircuitBreakerService.resetAll();
}

export function onAICircuitBreakerStateChange(
  callback: (event: CircuitBreakerEvent) => void
): () => void {
  aiCircuitBreakerService.on('state_change', callback);
  return () => aiCircuitBreakerService.off('state_change', callback);
}
