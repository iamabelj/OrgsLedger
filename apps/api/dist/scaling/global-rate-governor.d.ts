import { RequestHandler } from 'express';
import * as client from 'prom-client';
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
export declare const globalRateLimitHitsCounter: client.Counter<"type">;
export declare const globalRateLimitCurrentGauge: client.Gauge<"type">;
export declare const globalRateLimitAllowedCounter: client.Counter<"type">;
declare class GlobalRateGovernor {
    private config;
    private redis;
    private scriptSha;
    private isRunning;
    constructor(config?: Partial<RateGovernorConfig>);
    /**
     * Initialize the rate governor.
     */
    start(): Promise<void>;
    /**
     * Stop the rate governor.
     */
    stop(): void;
    /**
     * Get current window ID based on time.
     */
    private getCurrentWindowId;
    /**
     * Get seconds until window reset.
     */
    private getResetInSeconds;
    /**
     * Check rate limit using Lua script.
     */
    private checkLimit;
    /**
     * Check meeting creation rate limit.
     */
    checkMeetingCreationLimit(): Promise<RateLimitResult>;
    /**
     * Check transcript events rate limit.
     */
    checkTranscriptRate(count?: number): Promise<RateLimitResult>;
    /**
     * Check AI requests rate limit.
     */
    checkAIRate(): Promise<RateLimitResult>;
    /**
     * Get current stats for all limit types.
     */
    getStats(): Promise<RateGovernorStats>;
    /**
     * Check if governor is running.
     */
    isGovernorRunning(): boolean;
}
export declare const globalRateGovernor: GlobalRateGovernor;
/**
 * Create middleware for meeting creation rate limiting.
 */
export declare function createMeetingCreationRateLimitMiddleware(): RequestHandler;
/**
 * Create middleware for AI request rate limiting.
 */
export declare function createAIRateLimitMiddleware(): RequestHandler;
export declare function startRateGovernor(): Promise<void>;
export declare function stopRateGovernor(): void;
export declare function checkMeetingCreationLimit(): Promise<RateLimitResult>;
export declare function checkTranscriptRate(count?: number): Promise<RateLimitResult>;
export declare function checkAIRate(): Promise<RateLimitResult>;
export declare function getRateGovernorStats(): Promise<RateGovernorStats>;
export {};
//# sourceMappingURL=global-rate-governor.d.ts.map