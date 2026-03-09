// ============================================================
// OrgsLedger API — Circuit Breaker
// Protects against cascading failures from external services
// (AI APIs, payment gateways, email, etc.)
// ============================================================

import { logger } from '../logger';

export enum CircuitState {
  CLOSED = 'closed',     // Normal operation
  OPEN = 'open',         // Failing — all calls rejected
  HALF_OPEN = 'half_open', // Testing if service recovered
}

interface CircuitBreakerOptions {
  /** Name of the service (for logging) */
  name: string;
  /** Number of failures before opening the circuit */
  failureThreshold?: number;
  /** Time in ms to wait before trying again (half-open) */
  resetTimeout?: number;
  /** Time window in ms for counting failures */
  failureWindow?: number;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number[] = [];
  private lastFailureTime = 0;
  private successCount = 0;

  readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly failureWindow: number;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeout = options.resetTimeout ?? 30_000;    // 30 seconds
    this.failureWindow = options.failureWindow ?? 60_000;  // 1 minute
  }

  /**
   * Execute a function with circuit breaker protection.
   * @param fn - The async function to call
   * @param fallback - Optional fallback value if circuit is open
   */
  async execute<T>(fn: () => Promise<T>, fallback?: T): Promise<T> {
    // Check if circuit should transition from OPEN to HALF_OPEN
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        logger.info(`[CIRCUIT] ${this.name}: transitioning to HALF_OPEN`);
      } else {
        logger.debug(`[CIRCUIT] ${this.name}: circuit OPEN — rejecting call`);
        if (fallback !== undefined) return fallback;
        throw new Error(`Circuit breaker open for ${this.name}`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      if (fallback !== undefined) return fallback;
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      // Require 2 successive successes to close
      if (this.successCount >= 2) {
        this.state = CircuitState.CLOSED;
        this.failures = [];
        logger.info(`[CIRCUIT] ${this.name}: circuit CLOSED (recovered)`);
      }
    } else {
      // In closed state, clear old failures
      this.pruneFailures();
    }
  }

  private onFailure(): void {
    const now = Date.now();
    this.failures.push(now);
    this.lastFailureTime = now;
    this.pruneFailures();

    if (this.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open → back to open
      this.state = CircuitState.OPEN;
      logger.warn(`[CIRCUIT] ${this.name}: circuit OPEN (half-open test failed)`);
    } else if (this.failures.length >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      logger.warn(`[CIRCUIT] ${this.name}: circuit OPEN (${this.failures.length} failures in window)`);
    }
  }

  private pruneFailures(): void {
    const cutoff = Date.now() - this.failureWindow;
    this.failures = this.failures.filter(t => t > cutoff);
  }

  /** Get current circuit state */
  getState(): CircuitState {
    return this.state;
  }

  /** Get stats for observability */
  getStats(): { name: string; state: CircuitState; failureCount: number; lastFailure: number } {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failures.length,
      lastFailure: this.lastFailureTime,
    };
  }

  /** Reset circuit (used in tests) */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = [];
    this.lastFailureTime = 0;
    this.successCount = 0;
  }
}

// ── Pre-built circuits for external services ──
export const circuits = {
  ai: new CircuitBreaker({ name: 'AI/OpenAI', failureThreshold: 3, resetTimeout: 60_000 }),
  email: new CircuitBreaker({ name: 'Email/SMTP', failureThreshold: 5, resetTimeout: 30_000 }),
  stripe: new CircuitBreaker({ name: 'Stripe', failureThreshold: 3, resetTimeout: 30_000 }),
  paystack: new CircuitBreaker({ name: 'Paystack', failureThreshold: 3, resetTimeout: 30_000 }),
};
