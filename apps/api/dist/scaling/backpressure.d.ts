import { EventEmitter } from 'events';
import * as client from 'prom-client';
import { ShardedQueueType } from '../queues/queue-manager';
export interface BackpressureThreshold {
    queueType: ShardedQueueType;
    maxWaiting: number;
    maxActive: number;
    /** Waiting jobs above this activates THROTTLE (default: 60% of maxWaiting) */
    throttleWaiting: number;
    retryAfterSeconds: number;
}
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
export type DegradationAction = 'SLOW_INGESTION' | 'DROP_LOW_PRIORITY' | 'REDUCE_TRANSLATION_LANGUAGES' | 'DISABLE_MINUTES_GENERATION';
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
export declare class BackpressureError extends Error {
    readonly code = "SYSTEM_OVERLOADED";
    readonly retryAfter: number;
    readonly queueType: ShardedQueueType;
    readonly currentLoad: number;
    readonly maxLoad: number;
    constructor(result: BackpressureCheckResult);
    toJSON(): SystemOverloadedError;
}
export declare const backpressureTriggeredCounter: client.Counter<"queue">;
export declare const backpressureUtilizationGauge: client.Gauge<"queue">;
export declare const backpressureAllowedGauge: client.Gauge<"queue">;
export declare const backpressureThrottledGauge: client.Gauge<"queue">;
export declare const backpressureDegradationGauge: client.Gauge<"action" | "queue">;
declare class BackpressureManager extends EventEmitter {
    private statsCache;
    private overloadState;
    private throttleState;
    constructor();
    /**
     * Evaluate queue pressure and return a 3-tier decision:
     *   ALLOW    — queue healthy, process normally
     *   THROTTLE — queue under pressure, apply degradation actions
     *   REJECT   — queue overloaded, refuse new work
     */
    shouldThrottle(queueType: ShardedQueueType): Promise<ThrottleResult>;
    /**
     * Check if a queue can accept new jobs
     * Returns true if allowed, false if backpressure should be applied
     */
    checkBackpressure(queueType: ShardedQueueType): Promise<BackpressureCheckResult>;
    /**
     * Check with hysteresis to prevent flapping
     * Once overloaded, stay overloaded until 80% of threshold
     */
    private checkOverloadWithHysteresis;
    /**
     * Get queue stats with caching
     */
    private getQueueStats;
    /**
     * Assert that a queue can accept new jobs
     * Throws BackpressureError if overloaded
     */
    assertCanAccept(queueType: ShardedQueueType): Promise<void>;
    /**
     * Get current backpressure status for all queues
     */
    getAllBackpressureStatus(): Promise<Record<ShardedQueueType, BackpressureCheckResult>>;
    /**
     * Update thresholds at runtime (for dynamic scaling)
     */
    updateThreshold(queueType: ShardedQueueType, updates: Partial<Omit<BackpressureThreshold, 'queueType'>>): void;
    /**
     * Clear cache (for testing)
     */
    clearCache(): void;
    /**
     * Get current thresholds
     */
    getThresholds(): Record<ShardedQueueType, BackpressureThreshold>;
    /**
     * Get the current throttle state for all queues without querying Redis.
     */
    getThrottleStates(): Record<ShardedQueueType, ThrottleDecision>;
}
declare const backpressureManager: BackpressureManager;
export { backpressureManager };
/**
 * Check if transcript queue can accept new jobs
 */
export declare function checkTranscriptBackpressure(): Promise<BackpressureCheckResult>;
/**
 * Check if translation queue can accept new jobs
 */
export declare function checkTranslationBackpressure(): Promise<BackpressureCheckResult>;
/**
 * Check if broadcast queue can accept new jobs
 */
export declare function checkBroadcastBackpressure(): Promise<BackpressureCheckResult>;
/**
 * Check if minutes queue can accept new jobs
 */
export declare function checkMinutesBackpressure(): Promise<BackpressureCheckResult>;
/**
 * Assert transcript queue can accept new jobs (throws on overload)
 */
export declare function assertTranscriptCanAccept(): Promise<void>;
/**
 * Assert translation queue can accept new jobs (throws on overload)
 */
export declare function assertTranslationCanAccept(): Promise<void>;
/**
 * Assert broadcast queue can accept new jobs (throws on overload)
 */
export declare function assertBroadcastCanAccept(): Promise<void>;
/**
 * Assert minutes queue can accept new jobs (throws on overload)
 */
export declare function assertMinutesCanAccept(): Promise<void>;
/**
 * Get backpressure status for all queues
 */
export declare function getAllBackpressureStatus(): Promise<Record<ShardedQueueType, BackpressureCheckResult>>;
/**
 * Check backpressure for a specific queue type
 */
export declare function checkBackpressure(queueType: ShardedQueueType): Promise<BackpressureCheckResult>;
/**
 * Assert queue can accept new jobs (throws BackpressureError on overload)
 */
export declare function assertCanAccept(queueType: ShardedQueueType): Promise<void>;
/**
 * Evaluate queue pressure and return ALLOW | THROTTLE | REJECT.
 *
 * ALLOW    — queue healthy, process normally.
 * THROTTLE — queue under pressure. Caller should apply the returned
 *            `degradationActions` (slow ingestion, drop low-priority
 *            tasks, reduce translation languages, disable minutes).
 * REJECT   — queue overloaded, refuse the work entirely.
 */
export declare function shouldThrottle(queueType: ShardedQueueType): Promise<ThrottleResult>;
/**
 * Evaluate all queues at once.
 */
export declare function shouldThrottleAll(): Promise<Record<ShardedQueueType, ThrottleResult>>;
/**
 * Quick check: is any queue currently throttled or rejected?
 */
export declare function isAnyBackpressureActive(): boolean;
/**
 * Wrap a function to check backpressure before execution
 * Throws BackpressureError if queue is overloaded
 */
export declare function withBackpressure<T extends (...args: any[]) => Promise<any>>(queueType: ShardedQueueType, fn: T): T;
/**
 * Decorator-style backpressure check for class methods
 */
export declare function BackpressureGuard(queueType: ShardedQueueType): (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) => PropertyDescriptor;
import { Request, Response, NextFunction } from 'express';
/**
 * Express middleware to check backpressure before processing request
 */
export declare function backpressureMiddleware(queueType: ShardedQueueType): (req: Request, res: Response, next: NextFunction) => Promise<Response<any, Record<string, any>> | undefined>;
/**
 * Check if an error is a BackpressureError
 */
export declare function isBackpressureError(err: unknown): err is BackpressureError;
/**
 * Format error for API response
 */
export declare function formatBackpressureError(err: BackpressureError): SystemOverloadedError;
import { TranscriptEventData, TranslationJobData, BroadcastEventData, MinutesJobData } from '../queues/queue-manager';
import type { Job } from 'bullmq';
/**
 * Submit a transcript event with backpressure protection
 * Throws BackpressureError if queue is overloaded
 */
export declare function submitTranscriptWithBackpressure(data: TranscriptEventData, options?: {
    priority?: number;
}): Promise<Job<TranscriptEventData>>;
/**
 * Submit a translation job with backpressure protection
 * Throws BackpressureError if queue is overloaded
 */
export declare function submitTranslationWithBackpressure(data: TranslationJobData, options?: {
    delay?: number;
}): Promise<Job<TranslationJobData>>;
/**
 * Submit a broadcast event with backpressure protection
 * Throws BackpressureError if queue is overloaded
 */
export declare function submitBroadcastWithBackpressure(data: BroadcastEventData): Promise<Job<BroadcastEventData>>;
/**
 * Submit a minutes generation job with backpressure protection
 * Throws BackpressureError if queue is overloaded
 */
export declare function submitMinutesWithBackpressure(data: MinutesJobData, options?: {
    delay?: number;
}): Promise<Job<MinutesJobData>>;
//# sourceMappingURL=backpressure.d.ts.map