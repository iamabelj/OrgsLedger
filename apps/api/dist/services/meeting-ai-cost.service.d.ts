import * as client from 'prom-client';
interface AICostConfig {
    /** Max tokens per meeting (default: 100k) */
    maxTokensPerMeeting: number;
    /** Warning threshold percentage (default: 80%) */
    warningThresholdPercent: number;
    /** Token costs in USD per 1M tokens */
    costPer1MTokens: {
        input: number;
        output: number;
    };
    /** Whether to persist usage to database */
    persistUsage: boolean;
    /** Persistence batch size */
    persistBatchSize: number;
    /** Persistence interval in ms */
    persistIntervalMs: number;
}
export interface AIUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
}
export interface MeetingAIUsage extends AIUsage {
    meetingId: string;
    limitReached: boolean;
    percentUsed: number;
    remainingTokens: number;
}
export interface AIUsageCheckResult {
    allowed: boolean;
    usage: MeetingAIUsage;
    reason?: string;
}
export declare const aiCostLimitHitsCounter: client.Counter<string>;
export declare const aiTokensUsedGauge: client.Gauge<"meeting_id">;
export declare const aiCostUsedGauge: client.Gauge<"meeting_id">;
export declare const aiMinutesDisabledGauge: client.Gauge<"meeting_id">;
declare class MeetingAICostProtector {
    private redis;
    private initialized;
    private usageBatch;
    private persistInterval;
    /**
     * Initialize Redis connection.
     */
    initialize(): Promise<void>;
    /**
     * Check if AI usage is allowed for a meeting.
     * Call this before making any AI API calls.
     */
    checkUsage(meetingId: string, estimatedTokens?: number): Promise<AIUsageCheckResult>;
    /**
     * Record AI token usage for a meeting.
     */
    recordUsage(meetingId: string, inputTokens: number, outputTokens: number, organizationId?: string): Promise<MeetingAIUsage>;
    /**
     * Get current AI usage for a meeting.
     */
    getUsage(meetingId: string): Promise<MeetingAIUsage>;
    /**
     * Disable minutes generation for a meeting.
     */
    disableMinutes(meetingId: string): Promise<void>;
    /**
     * Re-enable minutes generation for a meeting (admin action).
     */
    enableMinutes(meetingId: string): Promise<void>;
    /**
     * Check if minutes generation is disabled.
     */
    isMinutesDisabled(meetingId: string): Promise<boolean>;
    /**
     * Reset AI usage for a meeting (use when meeting ends for cleanup).
     */
    reset(meetingId: string): Promise<void>;
    /**
     * Get configuration.
     */
    getConfig(): AICostConfig;
    /**
     * Calculate usage metrics from token counts.
     */
    private calculateUsage;
    /**
     * Get Redis connection.
     */
    private getRedis;
    /**
     * Start persistence interval.
     */
    private startPersistenceInterval;
    /**
     * Flush usage batch to database.
     */
    private flushUsageBatch;
    /**
     * Shutdown and cleanup.
     */
    shutdown(): Promise<void>;
}
export declare const meetingAICostProtector: MeetingAICostProtector;
export declare function initializeMeetingAICostProtector(): Promise<void>;
export declare function checkAIUsage(meetingId: string, estimatedTokens?: number): Promise<AIUsageCheckResult>;
export declare function recordAIUsage(meetingId: string, inputTokens: number, outputTokens: number, organizationId?: string): Promise<MeetingAIUsage>;
export declare function getMeetingAIUsage(meetingId: string): Promise<MeetingAIUsage>;
export declare function isMinutesGenerationDisabled(meetingId: string): Promise<boolean>;
export declare function resetMeetingAIUsage(meetingId: string): Promise<void>;
export declare function getAICostConfig(): AICostConfig;
export {};
//# sourceMappingURL=meeting-ai-cost.service.d.ts.map