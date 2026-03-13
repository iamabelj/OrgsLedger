import * as client from 'prom-client';
interface RateLimitConfig {
    /** Max events per window */
    maxEvents: number;
    /** Window size in seconds */
    windowSeconds: number;
    /** Action when limit exceeded: 'drop' or 'delay' */
    action: 'drop' | 'delay';
    /** Max delay in milliseconds (for 'delay' action) */
    maxDelayMs?: number;
}
export type JobType = 'transcript' | 'translation' | 'minutes' | 'broadcast';
export interface RateLimitResult {
    allowed: boolean;
    currentCount: number;
    limit: number;
    windowSeconds: number;
    retryAfterMs?: number;
    action: 'allow' | 'drop' | 'delay';
    delayMs?: number;
}
export interface MeetingRateLimitStats {
    meetingId: string;
    transcript: {
        current: number;
        limit: number;
        windowSeconds: number;
    };
    translation: {
        current: number;
        limit: number;
        windowSeconds: number;
    };
    minutes: {
        current: number;
        limit: number;
        windowSeconds: number;
    };
    broadcast: {
        current: number;
        limit: number;
        windowSeconds: number;
    };
}
export declare const rateLimitHitsCounter: client.Counter<"action" | "job_type">;
export declare const rateLimitCurrentGauge: client.Gauge<"job_type">;
export declare const rateLimitExceededCounter: client.Counter<"job_type">;
declare class MeetingRateLimiter {
    private redis;
    private initialized;
    /**
     * Initialize Redis connection for rate limiting.
     */
    initialize(): Promise<void>;
    /**
     * Check if a job can be processed for a meeting.
     * Uses sliding window rate limiting with Redis INCR + EXPIRE.
     */
    checkRateLimit(meetingId: string, jobType: JobType): Promise<RateLimitResult>;
    /**
     * Check and consume a rate limit token.
     * Returns true if allowed, false if rate limited.
     */
    consume(meetingId: string, jobType: JobType): Promise<boolean>;
    /**
     * Get current rate limit stats for a meeting.
     */
    getStats(meetingId: string): Promise<MeetingRateLimitStats>;
    /**
     * Reset rate limit counters for a meeting.
     * Useful when a meeting ends.
     */
    reset(meetingId: string): Promise<void>;
    /**
     * Get Redis connection, initializing if needed.
     */
    private getRedis;
    /**
     * Get configuration for a job type.
     */
    getConfig(jobType: JobType): RateLimitConfig | undefined;
}
export declare const meetingRateLimiter: MeetingRateLimiter;
export declare function initializeMeetingRateLimiter(): Promise<void>;
export declare function checkMeetingRateLimit(meetingId: string, jobType: JobType): Promise<RateLimitResult>;
export declare function consumeMeetingRateLimit(meetingId: string, jobType: JobType): Promise<boolean>;
export declare function getMeetingRateLimitStats(meetingId: string): Promise<MeetingRateLimitStats>;
export declare function resetMeetingRateLimits(meetingId: string): Promise<void>;
export {};
//# sourceMappingURL=meeting-rate-limiter.d.ts.map