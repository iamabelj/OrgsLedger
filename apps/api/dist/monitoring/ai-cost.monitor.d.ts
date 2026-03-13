import { EventEmitter } from 'events';
import { OpenAIModel } from '../config/ai-pricing';
interface AIUsageMetricRow {
    id?: string;
    timestamp: Date;
    deepgram_minutes: number;
    openai_input_tokens: number;
    openai_output_tokens: number;
    translation_characters: number;
    translation_requests: number;
    estimated_cost_usd: number;
    deepgram_cost_usd: number;
    openai_input_cost_usd: number;
    openai_output_cost_usd: number;
    translation_cost_usd: number;
    interval_type: 'snapshot' | 'daily' | 'monthly';
}
interface DeepgramMetrics {
    totalMinutes: number;
    requestCount: number;
    lastUsageAt: number | null;
}
interface OpenAIMetrics {
    totalInputTokens: number;
    totalOutputTokens: number;
    requestCount: number;
    lastUsageAt: number | null;
    byModel: Record<string, {
        inputTokens: number;
        outputTokens: number;
        requests: number;
    }>;
}
interface TranslationMetrics {
    totalCharacters: number;
    requestCount: number;
    lastUsageAt: number | null;
    byLanguage: Record<string, {
        characters: number;
        requests: number;
    }>;
}
interface CostBreakdown {
    deepgramCostUSD: number;
    openaiInputCostUSD: number;
    openaiOutputCostUSD: number;
    translationCostUSD: number;
    totalCostUSD: number;
}
interface AICostMetrics {
    timestamp: string;
    periodStartedAt: string;
    deepgram: DeepgramMetrics;
    openai: OpenAIMetrics;
    translation: TranslationMetrics;
    costs: CostBreakdown;
    alerts: AICostAlert[];
}
export interface AICostAlert {
    type: 'DAILY_COST_LIMIT' | 'TRANSLATION_CHAR_LIMIT' | 'DEEPGRAM_MINUTE_LIMIT' | 'OPENAI_TOKEN_LIMIT';
    severity: 'WARNING' | 'CRITICAL';
    message: string;
    currentValue: number;
    threshold: number;
    timestamp: string;
}
declare class AICostMonitorClass extends EventEmitter {
    private intervalId;
    private isRunning;
    private periodStartedAt;
    private deepgramMinutes;
    private deepgramRequestCount;
    private deepgramLastUsageAt;
    private openaiInputTokens;
    private openaiOutputTokens;
    private openaiRequestCount;
    private openaiLastUsageAt;
    private openaiByModel;
    private translationCharacters;
    private translationRequestCount;
    private translationLastUsageAt;
    private translationByLanguage;
    private activeAlerts;
    private metricsBuffer;
    private lastFlushAt;
    private retentionCleanupIntervalId;
    constructor();
    /**
     * Record Deepgram transcription usage
     * @param durationSeconds - Audio duration in seconds
     * @param meetingId - Optional meeting ID for tracking
     */
    recordDeepgramUsage(durationSeconds: number, meetingId?: string): void;
    /**
     * Record OpenAI API usage
     * @param inputTokens - Number of input/prompt tokens
     * @param outputTokens - Number of output/completion tokens
     * @param model - OpenAI model used (defaults to config default)
     * @param meetingId - Optional meeting ID for tracking
     */
    recordOpenAIUsage(inputTokens: number, outputTokens: number, model?: OpenAIModel, meetingId?: string): void;
    /**
     * Record translation service usage
     * @param textLength - Length of source text in characters
     * @param languageCount - Number of target languages
     * @param targetLanguages - Optional array of target language codes
     * @param meetingId - Optional meeting ID for tracking
     */
    recordTranslationUsage(textLength: number, languageCount: number, targetLanguages?: string[], meetingId?: string): void;
    /**
     * Calculate current cost breakdown
     */
    calculateCost(): CostBreakdown;
    private checkDeepgramLimits;
    private checkOpenAILimits;
    private checkTranslationLimits;
    private checkDailyCostLimit;
    private addAlert;
    /**
     * Get current AI cost metrics
     */
    getMetrics(): AICostMetrics;
    /**
     * Get metrics formatted for health endpoint
     */
    getHealthMetrics(): {
        deepgramMinutes: number;
        openaiInputTokens: number;
        openaiOutputTokens: number;
        translationCharacters: number;
        translationRequests: number;
        estimatedCostUSD: number;
        alerts: AICostAlert[];
    };
    /**
     * Log current metrics to console
     */
    logMetrics(): void;
    /**
     * Queue metrics for batched persistence to PostgreSQL
     * Non-blocking - never fails the pipeline
     */
    private queueMetricsForPersistence;
    /**
     * Flush the metrics buffer to PostgreSQL
     * Uses batched insert for efficiency
     */
    private flushMetricsBuffer;
    /**
     * Run retention cleanup - delete records older than retention period
     */
    private runRetentionCleanup;
    /**
     * Reset all metrics (call at start of new period)
     */
    resetMetrics(): void;
    /**
     * Start the cost monitoring loop
     */
    start(): void;
    private lastResetDate;
    private checkMidnightReset;
    /**
     * Stop the cost monitoring loop
     */
    stop(): void;
    /**
     * Check if monitor is running
     */
    isActive(): boolean;
}
declare const aiCostMonitor: AICostMonitorClass;
/**
 * Start the AI cost monitor
 */
export declare function startAICostMonitor(): void;
/**
 * Stop the AI cost monitor
 */
export declare function stopAICostMonitor(): void;
/**
 * Record Deepgram transcription usage
 */
export declare function recordDeepgramUsage(durationSeconds: number, meetingId?: string): void;
/**
 * Record OpenAI API usage
 */
export declare function recordOpenAIUsage(inputTokens: number, outputTokens: number, model?: OpenAIModel, meetingId?: string): void;
/**
 * Record translation service usage
 */
export declare function recordTranslationUsage(textLength: number, languageCount: number, targetLanguages?: string[], meetingId?: string): void;
/**
 * Get current AI cost metrics
 */
export declare function getAICostMetrics(): AICostMetrics;
/**
 * Get metrics formatted for health endpoint
 */
export declare function getAICostHealthMetrics(): ReturnType<AICostMonitorClass['getHealthMetrics']>;
/**
 * Reset all metrics (for testing or manual reset)
 */
export declare function resetAICostMetrics(): void;
/**
 * Get the monitor instance for event subscriptions
 */
export declare function getAICostMonitor(): AICostMonitorClass;
export interface DailyCostSummary {
    date: string;
    deepgramMinutes: number;
    openaiInputTokens: number;
    openaiOutputTokens: number;
    translationCharacters: number;
    translationRequests: number;
    totalCostUSD: number;
    snapshotCount: number;
}
export interface MonthlyCostSummary {
    year: number;
    month: number;
    deepgramMinutes: number;
    openaiInputTokens: number;
    openaiOutputTokens: number;
    translationCharacters: number;
    translationRequests: number;
    totalCostUSD: number;
    dailyAvgCostUSD: number;
    snapshotCount: number;
}
/**
 * Get daily cost summary for a date range
 * @param startDate - Start date (inclusive)
 * @param endDate - End date (inclusive)
 * @returns Array of daily summaries
 */
export declare function getDailyCostSummary(startDate?: Date, endDate?: Date): Promise<DailyCostSummary[]>;
/**
 * Get monthly cost summary
 * @param monthsBack - Number of months to look back (default: 12)
 * @returns Array of monthly summaries
 */
export declare function getMonthlyCostSummary(monthsBack?: number): Promise<MonthlyCostSummary[]>;
/**
 * Get the most recent N hours of cost metrics
 * @param hours - Number of hours to look back (default: 24)
 * @returns Array of metrics snapshots
 */
export declare function getRecentCostMetrics(hours?: number): Promise<AIUsageMetricRow[]>;
/**
 * Get total accumulated costs for a specific date
 * @param date - The date to query (defaults to today)
 * @returns Cost breakdown or null if no data
 */
export declare function getDayCost(date?: Date): Promise<CostBreakdown | null>;
export default aiCostMonitor;
//# sourceMappingURL=ai-cost.monitor.d.ts.map