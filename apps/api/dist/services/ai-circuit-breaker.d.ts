import * as client from 'prom-client';
import { EventEmitter } from 'events';
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
export declare const aiCircuitBreakerStateGauge: client.Gauge<"provider">;
export declare const aiCircuitBreakerFailuresCounter: client.Counter<"provider">;
export declare const aiCircuitBreakerSuccessesCounter: client.Counter<"provider">;
export declare const aiCircuitBreakerRejectsCounter: client.Counter<"provider">;
export declare const aiCircuitBreakerFallbackCounter: client.Counter<"provider">;
export declare const aiCircuitBreakerLatencyHistogram: client.Histogram<"success" | "provider">;
export declare const aiCircuitBreakerErrorRateGauge: client.Gauge<"provider">;
export declare const aiCircuitBreakerAvgLatencyGauge: client.Gauge<"provider">;
export declare class CircuitOpenError extends Error {
    readonly provider: AIProvider;
    readonly retryAfterMs: number;
    constructor(provider: AIProvider, retryAfterMs: number);
}
declare class AICircuitBreakerService extends EventEmitter {
    private breakers;
    private config;
    constructor(config?: Partial<AICircuitBreakerConfig>);
    /**
     * Execute a function through the specified provider's circuit breaker.
     */
    execute<T>(provider: AIProvider, fn: () => Promise<T>, fallback?: () => T | Promise<T>): Promise<T>;
    /**
     * Get stats for a provider.
     */
    getStats(provider: AIProvider): CircuitBreakerStats | null;
    /**
     * Get stats for all providers.
     */
    getAllStats(): CircuitBreakerStats[];
    /**
     * Get state for a provider.
     */
    getState(provider: AIProvider): CircuitState | null;
    /**
     * Check if a provider is available (not OPEN).
     */
    isAvailable(provider: AIProvider): boolean;
    /**
     * Force a provider's state.
     */
    forceState(provider: AIProvider, state: CircuitState): void;
    /**
     * Reset a provider's circuit breaker.
     */
    reset(provider: AIProvider): void;
    /**
     * Reset all circuit breakers.
     */
    resetAll(): void;
}
export declare const aiCircuitBreakerService: AICircuitBreakerService;
/**
 * Execute an OpenAI request through the circuit breaker.
 */
export declare function executeOpenAI<T>(fn: () => Promise<T>, fallback?: () => T | Promise<T>): Promise<T>;
/**
 * Execute a Deepgram request through the circuit breaker.
 */
export declare function executeDeepgram<T>(fn: () => Promise<T>, fallback?: () => T | Promise<T>): Promise<T>;
/**
 * Check if OpenAI is available.
 */
export declare function isOpenAIAvailable(): boolean;
/**
 * Check if Deepgram is available.
 */
export declare function isDeepgramAvailable(): boolean;
export declare function getAICircuitBreakerStats(provider: AIProvider): CircuitBreakerStats | null;
export declare function getAllAICircuitBreakerStats(): CircuitBreakerStats[];
export declare function getAICircuitBreakerState(provider: AIProvider): CircuitState | null;
export declare function forceAICircuitBreakerState(provider: AIProvider, state: CircuitState): void;
export declare function resetAICircuitBreaker(provider: AIProvider): void;
export declare function resetAllAICircuitBreakers(): void;
export declare function onAICircuitBreakerStateChange(callback: (event: CircuitBreakerEvent) => void): () => void;
export {};
//# sourceMappingURL=ai-circuit-breaker.d.ts.map