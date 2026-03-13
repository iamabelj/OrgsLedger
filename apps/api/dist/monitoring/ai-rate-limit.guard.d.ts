import * as client from 'prom-client';
import { EventEmitter } from 'events';
/**
 * Rate limit thresholds per minute
 * These represent the max requests/units we can sustain before hitting provider limits
 */
declare const AI_RATE_LIMITS: {
    deepgram: {
        requestsPerMinute: number;
        minutesPerMinute: number;
    };
    openai: {
        requestsPerMinute: number;
        tokensPerMinute: number;
    };
    translate: {
        requestsPerMinute: number;
        charactersPerMinute: number;
    };
};
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
export declare const aiRateLimitUtilizationGauge: client.Gauge<"service" | "metric">;
export declare const aiRateLimitWarningCounter: client.Counter<"service">;
export declare const aiRateLimitBackpressureCounter: client.Counter<"service">;
export declare const aiRateLimitDegradedGauge: client.Gauge<"service">;
declare class AIRateLimitGuard extends EventEmitter {
    private redis;
    private isInitialized;
    private backpressureState;
    private activeDegradations;
    private warningCount;
    private criticalCount;
    private readonly HYSTERESIS_THRESHOLD;
    constructor();
    private initializeCounters;
    /**
     * Initialize Redis connection
     */
    initialize(): Promise<void>;
    /**
     * Get Redis key for a service
     */
    private getRedisKey;
    /**
     * Record usage for a service
     */
    recordUsage(service: AIService, metric: 'requests' | 'tokens' | 'characters' | 'minutes', amount?: number): Promise<RateLimitStatus>;
    /**
     * Check rate limit status without recording usage
     */
    checkStatus(service: AIService, metric?: 'requests' | 'tokens' | 'characters' | 'minutes'): Promise<RateLimitStatus>;
    /**
     * Check if a request should be allowed
     */
    checkAndRecord(service: AIService, metric?: 'requests' | 'tokens' | 'characters' | 'minutes', amount?: number): Promise<RateLimitCheckResult>;
    /**
     * Get current rate limit for a metric
     */
    private getLimit;
    /**
     * Calculate rate limit status
     */
    private calculateStatus;
    /**
     * Calculate when to retry based on utilization
     */
    private calculateRetryAfter;
    /**
     * Create default status for fail-open scenarios
     */
    private createDefaultStatus;
    /**
     * Handle warning state (80% utilization)
     */
    private handleWarning;
    /**
     * Handle critical state (95% utilization)
     */
    private handleCritical;
    /**
     * Check if we can recover from backpressure
     */
    private checkRecovery;
    /**
     * Create degradation strategy for a service
     */
    private createDegradationStrategy;
    /**
     * Get degradation strategy for a service
     */
    getDegradationStrategy(service: AIService): DegradationStrategy | undefined;
    /**
     * Check if any service has backpressure active
     */
    isAnyBackpressureActive(): boolean;
    /**
     * Check if a specific service has backpressure active
     */
    isBackpressureActive(service: AIService): boolean;
    /**
     * Get all rate limit metrics
     */
    getAllMetrics(): Promise<AIRateLimitMetrics>;
    /**
     * Manually reset backpressure for a service (for admin use)
     */
    resetBackpressure(service: AIService): void;
    /**
     * Update rate limits at runtime
     */
    updateRateLimits(service: AIService, limits: {
        requestsPerMinute?: number;
        tokensPerMinute?: number;
        charactersPerMinute?: number;
        minutesPerMinute?: number;
    }): void;
    /**
     * Get current rate limits
     */
    getRateLimits(): typeof AI_RATE_LIMITS;
    /**
     * Shutdown
     */
    shutdown(): Promise<void>;
}
declare const aiRateLimitGuard: AIRateLimitGuard;
export { aiRateLimitGuard };
/**
 * Initialize the rate limit guard
 */
export declare function initializeAIRateLimit(): Promise<void>;
/**
 * Record Deepgram usage and check rate limit
 */
export declare function checkDeepgramRateLimit(audioMinutes?: number): Promise<RateLimitCheckResult>;
/**
 * Record OpenAI usage and check rate limit
 */
export declare function checkOpenAIRateLimit(tokens?: number): Promise<RateLimitCheckResult>;
/**
 * Record translation usage and check rate limit
 */
export declare function checkTranslationRateLimit(characters?: number): Promise<RateLimitCheckResult>;
/**
 * Check if Deepgram is rate limited (without recording)
 */
export declare function isDeepgramRateLimited(): Promise<boolean>;
/**
 * Check if OpenAI is rate limited (without recording)
 */
export declare function isOpenAIRateLimited(): Promise<boolean>;
/**
 * Check if Translation is rate limited (without recording)
 */
export declare function isTranslationRateLimited(): Promise<boolean>;
/**
 * Get degradation strategy for a service
 */
export declare function getAIDegradationStrategy(service: AIService): DegradationStrategy | undefined;
/**
 * Get all rate limit metrics
 */
export declare function getAIRateLimitMetrics(): Promise<AIRateLimitMetrics>;
/**
 * Check if any AI service has backpressure active
 */
export declare function isAnyAIBackpressureActive(): boolean;
/**
 * Subscribe to rate limit events
 */
export declare function onAIRateLimitEvent(event: 'warning' | 'backpressure' | 'recovered' | 'reset', listener: (data: {
    service: AIService;
    status?: RateLimitStatus;
    strategy?: DegradationStrategy;
}) => void): void;
/**
 * Shutdown rate limit guard
 */
export declare function shutdownAIRateLimit(): Promise<void>;
/**
 * Guard for Deepgram transcription requests
 * Returns true if request should proceed, false if should be skipped/degraded
 */
export declare function guardDeepgramRequest(isFinal?: boolean): Promise<{
    proceed: boolean;
    skipReason?: string;
}>;
/**
 * Guard for OpenAI requests (minutes generation)
 * Returns delay in ms if should be delayed, 0 if should proceed immediately
 */
export declare function guardOpenAIRequest(estimatedTokens?: number): Promise<{
    proceed: boolean;
    delayMs: number;
    skipReason?: string;
}>;
/**
 * Guard for translation requests
 * Returns true if should proceed, false if translation should be skipped
 */
export declare function guardTranslationRequest(characterCount: number): Promise<{
    proceed: boolean;
    skipReason?: string;
}>;
//# sourceMappingURL=ai-rate-limit.guard.d.ts.map