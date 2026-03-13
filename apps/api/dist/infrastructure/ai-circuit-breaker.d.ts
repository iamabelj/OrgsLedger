import * as client from 'prom-client';
import { EventEmitter } from 'events';
export type AIService = 'openai' | 'deepgram' | 'translation';
export type CircuitState = 'closed' | 'open' | 'half-open';
export declare const circuitStateGauge: client.Gauge<"service">;
export declare const circuitFailuresCounter: client.Counter<"service">;
export declare const circuitSuccessesCounter: client.Counter<"service">;
export declare const circuitRejectedCounter: client.Counter<"service">;
export declare const circuitFallbackCounter: client.Counter<"service">;
export declare const circuitTimeoutsCounter: client.Counter<"service">;
export declare const circuitLatencyHistogram: client.Histogram<"service" | "outcome">;
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
export declare class CircuitOpenError extends Error {
    readonly service: AIService;
    readonly retryAfterMs: number;
    constructor(service: AIService, retryAfterMs: number);
}
export declare class CircuitTimeoutError extends Error {
    readonly service: AIService;
    readonly timeoutMs: number;
    constructor(service: AIService, timeoutMs: number);
}
declare class AICircuitBreakerManager extends EventEmitter {
    private breakers;
    constructor();
    /**
     * Execute a function through a service's circuit breaker.
     */
    execute<T>(service: AIService, fn: (signal: AbortSignal) => Promise<T>, fallback?: () => T): Promise<T>;
    /**
     * Get stats for a service.
     */
    getStats(service: AIService): CircuitStats | null;
    /**
     * Get stats for all services.
     */
    getAllStats(): CircuitStats[];
    /**
     * Get current state for a service.
     */
    getState(service: AIService): CircuitState | null;
    /**
     * Check if a service is available (not open).
     */
    isAvailable(service: AIService): boolean;
    /**
     * Force a service to a specific state.
     */
    forceState(service: AIService, state: CircuitState): void;
    /**
     * Reset all breakers to closed.
     */
    resetAll(): void;
}
export declare const aiCircuitBreaker: AICircuitBreakerManager;
/**
 * Execute an OpenAI request through the circuit breaker.
 */
export declare function withOpenAICircuitBreaker<T>(fn: (signal: AbortSignal) => Promise<T>, fallback?: () => T): Promise<T>;
/**
 * Execute a Deepgram request through the circuit breaker.
 */
export declare function withDeepgramCircuitBreaker<T>(fn: (signal: AbortSignal) => Promise<T>, fallback?: () => T): Promise<T>;
/**
 * Execute a translation request through the circuit breaker.
 */
export declare function withTranslationCircuitBreaker<T>(fn: (signal: AbortSignal) => Promise<T>, fallback?: () => T): Promise<T>;
export declare function getCircuitBreakerStats(service: AIService): CircuitStats | null;
export declare function getAllCircuitBreakerStats(): CircuitStats[];
export declare function isServiceAvailable(service: AIService): boolean;
export declare function forceCircuitState(service: AIService, state: CircuitState): void;
export declare function resetAllCircuits(): void;
export {};
//# sourceMappingURL=ai-circuit-breaker.d.ts.map