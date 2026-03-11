// ============================================================
// OrgsLedger API — AI Circuit Breaker
// Protects against slow/failing AI providers (OpenAI, Deepgram, etc.)
// ============================================================
//
// Circuit Breaker States:
//   CLOSED  → Normal operation, tracking failures
//   OPEN    → Reject immediately, return fallback
//   HALF_OPEN → Test if service recovered
//
// Services Protected:
//   - openai (minutes generation, AI summaries)
//   - deepgram (live transcription)
//   - translation (Google/DeepL)
//
// Configuration per service:
//   - Failure threshold to open circuit
//   - Timeout per request
//   - Reset timeout before half-open
//   - Success threshold to close circuit
//
// ============================================================

import * as client from 'prom-client';
import { EventEmitter } from 'events';
import { logger } from '../logger';

// ── Configuration ───────────────────────────────────────────

export type AIService = 'openai' | 'deepgram' | 'translation';

export type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerConfig {
  /** Failures before opening circuit */
  failureThreshold: number;
  /** Successes in half-open before closing */
  successThreshold: number;
  /** Request timeout in ms */
  timeoutMs: number;
  /** Time before half-open test (ms) */
  resetTimeoutMs: number;
  /** Max half-open concurrent tests */
  halfOpenMaxConcurrent: number;
  /** Sliding window for failure rate (ms) */
  windowMs: number;
  /** Enable fallback responses */
  enableFallback: boolean;
}

const DEFAULT_CONFIGS: Record<AIService, CircuitBreakerConfig> = {
  openai: {
    failureThreshold: parseInt(process.env.CIRCUIT_OPENAI_FAILURE_THRESHOLD || '5', 10),
    successThreshold: parseInt(process.env.CIRCUIT_OPENAI_SUCCESS_THRESHOLD || '3', 10),
    timeoutMs: parseInt(process.env.CIRCUIT_OPENAI_TIMEOUT_MS || '30000', 10),
    resetTimeoutMs: parseInt(process.env.CIRCUIT_OPENAI_RESET_MS || '60000', 10),
    halfOpenMaxConcurrent: 2,
    windowMs: 60000,
    enableFallback: process.env.CIRCUIT_OPENAI_FALLBACK !== 'false',
  },
  deepgram: {
    failureThreshold: parseInt(process.env.CIRCUIT_DEEPGRAM_FAILURE_THRESHOLD || '3', 10),
    successThreshold: parseInt(process.env.CIRCUIT_DEEPGRAM_SUCCESS_THRESHOLD || '2', 10),
    timeoutMs: parseInt(process.env.CIRCUIT_DEEPGRAM_TIMEOUT_MS || '10000', 10),
    resetTimeoutMs: parseInt(process.env.CIRCUIT_DEEPGRAM_RESET_MS || '30000', 10),
    halfOpenMaxConcurrent: 1,
    windowMs: 30000,
    enableFallback: process.env.CIRCUIT_DEEPGRAM_FALLBACK !== 'false',
  },
  translation: {
    failureThreshold: parseInt(process.env.CIRCUIT_TRANSLATION_FAILURE_THRESHOLD || '5', 10),
    successThreshold: parseInt(process.env.CIRCUIT_TRANSLATION_SUCCESS_THRESHOLD || '3', 10),
    timeoutMs: parseInt(process.env.CIRCUIT_TRANSLATION_TIMEOUT_MS || '15000', 10),
    resetTimeoutMs: parseInt(process.env.CIRCUIT_TRANSLATION_RESET_MS || '45000', 10),
    halfOpenMaxConcurrent: 2,
    windowMs: 60000,
    enableFallback: process.env.CIRCUIT_TRANSLATION_FALLBACK !== 'false',
  },
};

// ── Prometheus Metrics ──────────────────────────────────────

const PREFIX = 'orgsledger_circuit_breaker_';

export const circuitStateGauge = new client.Gauge({
  name: `${PREFIX}state`,
  help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
  labelNames: ['service'],
});

export const circuitFailuresCounter = new client.Counter({
  name: `${PREFIX}failures_total`,
  help: 'Total failures per service',
  labelNames: ['service'],
});

export const circuitSuccessesCounter = new client.Counter({
  name: `${PREFIX}successes_total`,
  help: 'Total successes per service',
  labelNames: ['service'],
});

export const circuitRejectedCounter = new client.Counter({
  name: `${PREFIX}rejected_total`,
  help: 'Requests rejected (circuit open)',
  labelNames: ['service'],
});

export const circuitFallbackCounter = new client.Counter({
  name: `${PREFIX}fallback_total`,
  help: 'Fallback responses returned',
  labelNames: ['service'],
});

export const circuitTimeoutsCounter = new client.Counter({
  name: `${PREFIX}timeouts_total`,
  help: 'Request timeouts',
  labelNames: ['service'],
});

export const circuitLatencyHistogram = new client.Histogram({
  name: `${PREFIX}latency_seconds`,
  help: 'Request latency through circuit breaker',
  labelNames: ['service', 'outcome'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
});

// ── Types ───────────────────────────────────────────────────

export interface CircuitStats {
  service: AIService;
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure?: Date;
  lastSuccess?: Date;
  openedAt?: Date;
  halfOpenTests: number;
}

export interface CircuitBreakerEvent {
  type: 'state_change' | 'failure' | 'timeout' | 'fallback';
  service: AIService;
  previousState?: CircuitState;
  newState?: CircuitState;
  error?: Error;
  timestamp: Date;
}

export class CircuitOpenError extends Error {
  constructor(
    public readonly service: AIService,
    public readonly retryAfterMs: number
  ) {
    super(`Circuit breaker open for ${service}`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitTimeoutError extends Error {
  constructor(
    public readonly service: AIService,
    public readonly timeoutMs: number
  ) {
    super(`Request to ${service} timed out after ${timeoutMs}ms`);
    this.name = 'CircuitTimeoutError';
  }
}

// ── Circuit Breaker Implementation ──────────────────────────

interface FailureRecord {
  timestamp: number;
  error: string;
}

class ServiceCircuitBreaker {
  private service: AIService;
  private config: CircuitBreakerConfig;
  private state: CircuitState = 'closed';
  private failures: FailureRecord[] = [];
  private successCount = 0;
  private halfOpenTests = 0;
  private lastFailure?: Date;
  private lastSuccess?: Date;
  private openedAt?: Date;
  private resetTimer?: NodeJS.Timeout;

  constructor(service: AIService, config: CircuitBreakerConfig) {
    this.service = service;
    this.config = config;
    circuitStateGauge.set({ service }, 0); // closed
  }

  /**
   * Execute a function through the circuit breaker.
   */
  async execute<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    fallback?: () => T
  ): Promise<T> {
    // Check if circuit is open
    if (this.state === 'open') {
      if (this.config.enableFallback && fallback) {
        circuitFallbackCounter.inc({ service: this.service });
        circuitRejectedCounter.inc({ service: this.service });
        return fallback();
      }

      const retryAfter = this.openedAt
        ? this.config.resetTimeoutMs - (Date.now() - this.openedAt.getTime())
        : this.config.resetTimeoutMs;

      circuitRejectedCounter.inc({ service: this.service });
      throw new CircuitOpenError(this.service, Math.max(0, retryAfter));
    }

    // Half-open: limit concurrent tests
    if (this.state === 'half-open') {
      if (this.halfOpenTests >= this.config.halfOpenMaxConcurrent) {
        if (this.config.enableFallback && fallback) {
          circuitFallbackCounter.inc({ service: this.service });
          return fallback();
        }
        throw new CircuitOpenError(this.service, 5000);
      }
      this.halfOpenTests++;
    }

    // Execute with timeout
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs);

    try {
      const result = await fn(controller.signal);
      clearTimeout(timeoutId);

      const latency = (Date.now() - startTime) / 1000;
      circuitLatencyHistogram.observe({ service: this.service, outcome: 'success' }, latency);

      this.recordSuccess();
      return result;

    } catch (err) {
      clearTimeout(timeoutId);

      const latency = (Date.now() - startTime) / 1000;
      const isTimeout = controller.signal.aborted || 
        (err instanceof Error && err.name === 'AbortError');

      if (isTimeout) {
        circuitTimeoutsCounter.inc({ service: this.service });
        circuitLatencyHistogram.observe({ service: this.service, outcome: 'timeout' }, latency);
        this.recordFailure(new CircuitTimeoutError(this.service, this.config.timeoutMs));

        if (this.config.enableFallback && fallback) {
          circuitFallbackCounter.inc({ service: this.service });
          return fallback();
        }
        throw new CircuitTimeoutError(this.service, this.config.timeoutMs);
      }

      circuitLatencyHistogram.observe({ service: this.service, outcome: 'error' }, latency);
      this.recordFailure(err instanceof Error ? err : new Error(String(err)));

      // Return fallback on failure if available
      if (this.config.enableFallback && fallback) {
        circuitFallbackCounter.inc({ service: this.service });
        return fallback();
      }

      throw err;

    } finally {
      if (this.state === 'half-open') {
        this.halfOpenTests = Math.max(0, this.halfOpenTests - 1);
      }
    }
  }

  /**
   * Record a successful request.
   */
  private recordSuccess(): void {
    this.lastSuccess = new Date();
    circuitSuccessesCounter.inc({ service: this.service });

    if (this.state === 'half-open') {
      this.successCount++;

      if (this.successCount >= this.config.successThreshold) {
        this.transitionTo('closed');
      }
    } else if (this.state === 'closed') {
      // Clear old failures outside window
      this.pruneFailures();
    }
  }

  /**
   * Record a failed request.
   */
  private recordFailure(error: Error): void {
    this.lastFailure = new Date();
    circuitFailuresCounter.inc({ service: this.service });

    this.failures.push({
      timestamp: Date.now(),
      error: error.message,
    });

    // Prune old failures
    this.pruneFailures();

    logger.warn(`[CIRCUIT_BREAKER] Failure recorded for ${this.service}`, {
      error: error.message,
      failures: this.failures.length,
      threshold: this.config.failureThreshold,
      state: this.state,
    });

    if (this.state === 'half-open') {
      // Any failure in half-open reopens the circuit
      this.transitionTo('open');
    } else if (this.state === 'closed') {
      // Check if we hit threshold
      if (this.failures.length >= this.config.failureThreshold) {
        this.transitionTo('open');
      }
    }
  }

  /**
   * Prune failures outside the sliding window.
   */
  private pruneFailures(): void {
    const cutoff = Date.now() - this.config.windowMs;
    this.failures = this.failures.filter(f => f.timestamp > cutoff);
  }

  /**
   * Transition to a new state.
   */
  private transitionTo(newState: CircuitState): void {
    const previousState = this.state;
    this.state = newState;

    logger.info(`[CIRCUIT_BREAKER] ${this.service}: ${previousState} → ${newState}`);

    // Update metrics
    const stateValue = newState === 'closed' ? 0 : newState === 'open' ? 1 : 2;
    circuitStateGauge.set({ service: this.service }, stateValue);

    // Clear any existing reset timer
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }

    switch (newState) {
      case 'open':
        this.openedAt = new Date();
        this.successCount = 0;
        this.halfOpenTests = 0;

        // Schedule transition to half-open
        this.resetTimer = setTimeout(() => {
          this.transitionTo('half-open');
        }, this.config.resetTimeoutMs);
        this.resetTimer.unref();
        break;

      case 'half-open':
        this.successCount = 0;
        this.halfOpenTests = 0;
        break;

      case 'closed':
        this.failures = [];
        this.successCount = 0;
        this.openedAt = undefined;
        break;
    }
  }

  /**
   * Get current stats.
   */
  getStats(): CircuitStats {
    this.pruneFailures();

    return {
      service: this.service,
      state: this.state,
      failures: this.failures.length,
      successes: this.successCount,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      openedAt: this.openedAt,
      halfOpenTests: this.halfOpenTests,
    };
  }

  /**
   * Force circuit state (for testing/admin).
   */
  forceState(state: CircuitState): void {
    logger.warn(`[CIRCUIT_BREAKER] Force ${this.service} to ${state}`);
    this.transitionTo(state);
  }

  /**
   * Get current state.
   */
  getState(): CircuitState {
    return this.state;
  }
}

// ── Circuit Breaker Manager ─────────────────────────────────

class AICircuitBreakerManager extends EventEmitter {
  private breakers: Map<AIService, ServiceCircuitBreaker> = new Map();

  constructor() {
    super();

    // Initialize all service breakers
    for (const service of ['openai', 'deepgram', 'translation'] as AIService[]) {
      this.breakers.set(
        service,
        new ServiceCircuitBreaker(service, DEFAULT_CONFIGS[service])
      );
    }

    logger.info('[CIRCUIT_BREAKER] Initialized', {
      services: Array.from(this.breakers.keys()),
    });
  }

  /**
   * Execute a function through a service's circuit breaker.
   */
  async execute<T>(
    service: AIService,
    fn: (signal: AbortSignal) => Promise<T>,
    fallback?: () => T
  ): Promise<T> {
    const breaker = this.breakers.get(service);
    if (!breaker) {
      throw new Error(`Unknown service: ${service}`);
    }
    return breaker.execute(fn, fallback);
  }

  /**
   * Get stats for a service.
   */
  getStats(service: AIService): CircuitStats | null {
    return this.breakers.get(service)?.getStats() || null;
  }

  /**
   * Get stats for all services.
   */
  getAllStats(): CircuitStats[] {
    return Array.from(this.breakers.values()).map(b => b.getStats());
  }

  /**
   * Get current state for a service.
   */
  getState(service: AIService): CircuitState | null {
    return this.breakers.get(service)?.getState() || null;
  }

  /**
   * Check if a service is available (not open).
   */
  isAvailable(service: AIService): boolean {
    const state = this.getState(service);
    return state !== 'open';
  }

  /**
   * Force a service to a specific state.
   */
  forceState(service: AIService, state: CircuitState): void {
    this.breakers.get(service)?.forceState(state);
  }

  /**
   * Reset all breakers to closed.
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.forceState('closed');
    }
  }
}

// ── Singleton ───────────────────────────────────────────────

export const aiCircuitBreaker = new AICircuitBreakerManager();

// ── Convenient Wrappers ─────────────────────────────────────

/**
 * Execute an OpenAI request through the circuit breaker.
 */
export async function withOpenAICircuitBreaker<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  fallback?: () => T
): Promise<T> {
  return aiCircuitBreaker.execute('openai', fn, fallback);
}

/**
 * Execute a Deepgram request through the circuit breaker.
 */
export async function withDeepgramCircuitBreaker<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  fallback?: () => T
): Promise<T> {
  return aiCircuitBreaker.execute('deepgram', fn, fallback);
}

/**
 * Execute a translation request through the circuit breaker.
 */
export async function withTranslationCircuitBreaker<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  fallback?: () => T
): Promise<T> {
  return aiCircuitBreaker.execute('translation', fn, fallback);
}

// ── Exports ─────────────────────────────────────────────────

export function getCircuitBreakerStats(service: AIService): CircuitStats | null {
  return aiCircuitBreaker.getStats(service);
}

export function getAllCircuitBreakerStats(): CircuitStats[] {
  return aiCircuitBreaker.getAllStats();
}

export function isServiceAvailable(service: AIService): boolean {
  return aiCircuitBreaker.isAvailable(service);
}

export function forceCircuitState(service: AIService, state: CircuitState): void {
  aiCircuitBreaker.forceState(service, state);
}

export function resetAllCircuits(): void {
  aiCircuitBreaker.resetAll();
}
