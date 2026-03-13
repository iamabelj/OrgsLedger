"use strict";
// ============================================================
// OrgsLedger API — AI Cost Monitor
// Production-grade cost tracking for AI services
// ============================================================
//
// Tracks usage and estimates costs for:
//   - Deepgram transcription (streaming)
//   - OpenAI minutes generation (GPT-4.1-mini)
//   - Translation services
//
// Features:
//   - Real-time cost estimation
//   - Configurable pricing (via config/ai-pricing.ts)
//   - Safety alerts for cost thresholds
//   - Non-blocking operation (never blocks meeting pipeline)
//   - PostgreSQL persistence with batched inserts
//   - 30-day retention with automatic cleanup
//
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.startAICostMonitor = startAICostMonitor;
exports.stopAICostMonitor = stopAICostMonitor;
exports.recordDeepgramUsage = recordDeepgramUsage;
exports.recordOpenAIUsage = recordOpenAIUsage;
exports.recordTranslationUsage = recordTranslationUsage;
exports.getAICostMetrics = getAICostMetrics;
exports.getAICostHealthMetrics = getAICostHealthMetrics;
exports.resetAICostMetrics = resetAICostMetrics;
exports.getAICostMonitor = getAICostMonitor;
exports.getDailyCostSummary = getDailyCostSummary;
exports.getMonthlyCostSummary = getMonthlyCostSummary;
exports.getRecentCostMetrics = getRecentCostMetrics;
exports.getDayCost = getDayCost;
const events_1 = require("events");
const logger_1 = require("../logger");
const db_1 = require("../db");
const ai_pricing_1 = require("../config/ai-pricing");
// ── Configuration ───────────────────────────────────────────
const COST_MONITOR_CONFIG = {
    // Log metrics every 60 seconds
    logIntervalMs: 60000,
    // Reset daily metrics at midnight UTC
    resetAtMidnight: true,
    // Persistence settings
    persistence: {
        // Enable PostgreSQL persistence
        enabled: true,
        // Batch size before flushing to DB
        batchSize: 10,
        // Maximum time to hold a batch before flushing (ms)
        batchTimeoutMs: 300000, // 5 minutes
        // Retention period in days
        retentionDays: 30,
        // Run retention cleanup every N hours
        retentionCleanupIntervalHours: 24,
    },
};
// ── AI Cost Monitor Class ───────────────────────────────────
class AICostMonitorClass extends events_1.EventEmitter {
    intervalId = null;
    isRunning = false;
    periodStartedAt;
    // Deepgram metrics
    deepgramMinutes = 0;
    deepgramRequestCount = 0;
    deepgramLastUsageAt = null;
    // OpenAI metrics
    openaiInputTokens = 0;
    openaiOutputTokens = 0;
    openaiRequestCount = 0;
    openaiLastUsageAt = null;
    openaiByModel = {};
    // Translation metrics
    translationCharacters = 0;
    translationRequestCount = 0;
    translationLastUsageAt = null;
    translationByLanguage = {};
    // Active alerts
    activeAlerts = [];
    // Persistence
    metricsBuffer = [];
    lastFlushAt = Date.now();
    retentionCleanupIntervalId = null;
    constructor() {
        super();
        this.periodStartedAt = new Date();
    }
    // ── Usage Recording Methods ─────────────────────────────────
    /**
     * Record Deepgram transcription usage
     * @param durationSeconds - Audio duration in seconds
     * @param meetingId - Optional meeting ID for tracking
     */
    recordDeepgramUsage(durationSeconds, meetingId) {
        try {
            const minutes = durationSeconds / 60;
            this.deepgramMinutes += minutes;
            this.deepgramRequestCount++;
            this.deepgramLastUsageAt = Date.now();
            logger_1.logger.debug('[AI_COST] Deepgram usage recorded', {
                durationSeconds,
                minutes,
                totalMinutes: this.deepgramMinutes,
                meetingId,
            });
            // Check limits after recording
            this.checkDeepgramLimits();
        }
        catch (err) {
            // Never block the pipeline - just log the error
            logger_1.logger.error('[AI_COST] Failed to record Deepgram usage', err);
        }
    }
    /**
     * Record OpenAI API usage
     * @param inputTokens - Number of input/prompt tokens
     * @param outputTokens - Number of output/completion tokens
     * @param model - OpenAI model used (defaults to config default)
     * @param meetingId - Optional meeting ID for tracking
     */
    recordOpenAIUsage(inputTokens, outputTokens, model, meetingId) {
        try {
            const modelName = model || ai_pricing_1.AI_PRICING.openai.defaultModel;
            this.openaiInputTokens += inputTokens;
            this.openaiOutputTokens += outputTokens;
            this.openaiRequestCount++;
            this.openaiLastUsageAt = Date.now();
            // Track by model
            if (!this.openaiByModel[modelName]) {
                this.openaiByModel[modelName] = { inputTokens: 0, outputTokens: 0, requests: 0 };
            }
            this.openaiByModel[modelName].inputTokens += inputTokens;
            this.openaiByModel[modelName].outputTokens += outputTokens;
            this.openaiByModel[modelName].requests++;
            logger_1.logger.debug('[AI_COST] OpenAI usage recorded', {
                inputTokens,
                outputTokens,
                model: modelName,
                totalInputTokens: this.openaiInputTokens,
                totalOutputTokens: this.openaiOutputTokens,
                meetingId,
            });
            // Check limits after recording
            this.checkOpenAILimits();
        }
        catch (err) {
            logger_1.logger.error('[AI_COST] Failed to record OpenAI usage', err);
        }
    }
    /**
     * Record translation service usage
     * @param textLength - Length of source text in characters
     * @param languageCount - Number of target languages
     * @param targetLanguages - Optional array of target language codes
     * @param meetingId - Optional meeting ID for tracking
     */
    recordTranslationUsage(textLength, languageCount, targetLanguages, meetingId) {
        try {
            const totalCharacters = textLength * languageCount;
            this.translationCharacters += totalCharacters;
            this.translationRequestCount++;
            this.translationLastUsageAt = Date.now();
            // Track by language
            if (targetLanguages) {
                for (const lang of targetLanguages) {
                    if (!this.translationByLanguage[lang]) {
                        this.translationByLanguage[lang] = { characters: 0, requests: 0 };
                    }
                    this.translationByLanguage[lang].characters += textLength;
                    this.translationByLanguage[lang].requests++;
                }
            }
            logger_1.logger.debug('[AI_COST] Translation usage recorded', {
                textLength,
                languageCount,
                totalCharacters,
                cumulativeCharacters: this.translationCharacters,
                targetLanguages,
                meetingId,
            });
            // Check limits after recording
            this.checkTranslationLimits();
        }
        catch (err) {
            logger_1.logger.error('[AI_COST] Failed to record translation usage', err);
        }
    }
    // ── Cost Calculation ────────────────────────────────────────
    /**
     * Calculate current cost breakdown
     */
    calculateCost() {
        const model = ai_pricing_1.AI_PRICING.openai.defaultModel;
        const modelPricing = ai_pricing_1.AI_PRICING.openai.models[model];
        // Deepgram cost
        const deepgramCostUSD = this.deepgramMinutes * ai_pricing_1.AI_PRICING.deepgram.streaming_per_minute;
        // OpenAI cost
        const openaiInputCostUSD = (this.openaiInputTokens / 1_000_000) * modelPricing.input_per_million_tokens;
        const openaiOutputCostUSD = (this.openaiOutputTokens / 1_000_000) * modelPricing.output_per_million_tokens;
        // Translation cost
        const translationCostUSD = this.translationCharacters * ai_pricing_1.AI_PRICING.translation.per_character;
        // Total
        const totalCostUSD = deepgramCostUSD + openaiInputCostUSD + openaiOutputCostUSD + translationCostUSD;
        return {
            deepgramCostUSD: Math.round(deepgramCostUSD * 10000) / 10000,
            openaiInputCostUSD: Math.round(openaiInputCostUSD * 10000) / 10000,
            openaiOutputCostUSD: Math.round(openaiOutputCostUSD * 10000) / 10000,
            translationCostUSD: Math.round(translationCostUSD * 10000) / 10000,
            totalCostUSD: Math.round(totalCostUSD * 10000) / 10000,
        };
    }
    // ── Limit Checking ──────────────────────────────────────────
    checkDeepgramLimits() {
        if (this.deepgramMinutes > ai_pricing_1.AI_COST_LIMITS.max_deepgram_minutes_per_day) {
            this.addAlert({
                type: 'DEEPGRAM_MINUTE_LIMIT',
                severity: 'CRITICAL',
                message: `Deepgram usage exceeded daily limit: ${Math.round(this.deepgramMinutes)} minutes (limit: ${ai_pricing_1.AI_COST_LIMITS.max_deepgram_minutes_per_day})`,
                currentValue: this.deepgramMinutes,
                threshold: ai_pricing_1.AI_COST_LIMITS.max_deepgram_minutes_per_day,
                timestamp: new Date().toISOString(),
            });
        }
    }
    checkOpenAILimits() {
        const totalTokens = this.openaiInputTokens + this.openaiOutputTokens;
        if (totalTokens > ai_pricing_1.AI_COST_LIMITS.max_openai_tokens_per_day) {
            this.addAlert({
                type: 'OPENAI_TOKEN_LIMIT',
                severity: 'CRITICAL',
                message: `OpenAI token usage exceeded daily limit: ${totalTokens} tokens (limit: ${ai_pricing_1.AI_COST_LIMITS.max_openai_tokens_per_day})`,
                currentValue: totalTokens,
                threshold: ai_pricing_1.AI_COST_LIMITS.max_openai_tokens_per_day,
                timestamp: new Date().toISOString(),
            });
        }
    }
    checkTranslationLimits() {
        if (this.translationCharacters > ai_pricing_1.AI_COST_LIMITS.max_translation_chars_per_day) {
            this.addAlert({
                type: 'TRANSLATION_CHAR_LIMIT',
                severity: 'CRITICAL',
                message: `Translation usage exceeded daily limit: ${this.translationCharacters} characters (limit: ${ai_pricing_1.AI_COST_LIMITS.max_translation_chars_per_day})`,
                currentValue: this.translationCharacters,
                threshold: ai_pricing_1.AI_COST_LIMITS.max_translation_chars_per_day,
                timestamp: new Date().toISOString(),
            });
        }
    }
    checkDailyCostLimit() {
        const costs = this.calculateCost();
        if (costs.totalCostUSD > ai_pricing_1.AI_COST_LIMITS.daily_cost_limit_usd) {
            this.addAlert({
                type: 'DAILY_COST_LIMIT',
                severity: 'CRITICAL',
                message: `Daily AI cost exceeded limit: $${costs.totalCostUSD.toFixed(2)} (limit: $${ai_pricing_1.AI_COST_LIMITS.daily_cost_limit_usd.toFixed(2)})`,
                currentValue: costs.totalCostUSD,
                threshold: ai_pricing_1.AI_COST_LIMITS.daily_cost_limit_usd,
                timestamp: new Date().toISOString(),
            });
        }
        else if (costs.totalCostUSD > ai_pricing_1.AI_COST_LIMITS.daily_cost_limit_usd * 0.8) {
            // Warning at 80% of limit
            this.addAlert({
                type: 'DAILY_COST_LIMIT',
                severity: 'WARNING',
                message: `Daily AI cost approaching limit: $${costs.totalCostUSD.toFixed(2)} (80% of $${ai_pricing_1.AI_COST_LIMITS.daily_cost_limit_usd.toFixed(2)})`,
                currentValue: costs.totalCostUSD,
                threshold: ai_pricing_1.AI_COST_LIMITS.daily_cost_limit_usd,
                timestamp: new Date().toISOString(),
            });
        }
    }
    addAlert(alert) {
        // Check if this alert type already exists (avoid duplicates)
        const existingIndex = this.activeAlerts.findIndex(a => a.type === alert.type && a.severity === alert.severity);
        if (existingIndex >= 0) {
            // Update existing alert
            this.activeAlerts[existingIndex] = alert;
        }
        else {
            // Add new alert
            this.activeAlerts.push(alert);
        }
        // Log the alert
        const logMeta = {
            severity: alert.severity,
            message: alert.message,
            currentValue: alert.currentValue,
            threshold: alert.threshold,
        };
        if (alert.severity === 'CRITICAL') {
            logger_1.logger.error(`[AI_COST_ALERT] ${alert.type}`, logMeta);
        }
        else {
            logger_1.logger.warn(`[AI_COST_ALERT] ${alert.type}`, logMeta);
        }
        // Emit event for external listeners
        this.emit('cost-alert', alert);
    }
    // ── Metrics Retrieval ───────────────────────────────────────
    /**
     * Get current AI cost metrics
     */
    getMetrics() {
        const costs = this.calculateCost();
        return {
            timestamp: new Date().toISOString(),
            periodStartedAt: this.periodStartedAt.toISOString(),
            deepgram: {
                totalMinutes: Math.round(this.deepgramMinutes * 100) / 100,
                requestCount: this.deepgramRequestCount,
                lastUsageAt: this.deepgramLastUsageAt,
            },
            openai: {
                totalInputTokens: this.openaiInputTokens,
                totalOutputTokens: this.openaiOutputTokens,
                requestCount: this.openaiRequestCount,
                lastUsageAt: this.openaiLastUsageAt,
                byModel: { ...this.openaiByModel },
            },
            translation: {
                totalCharacters: this.translationCharacters,
                requestCount: this.translationRequestCount,
                lastUsageAt: this.translationLastUsageAt,
                byLanguage: { ...this.translationByLanguage },
            },
            costs,
            alerts: [...this.activeAlerts],
        };
    }
    /**
     * Get metrics formatted for health endpoint
     */
    getHealthMetrics() {
        const costs = this.calculateCost();
        return {
            deepgramMinutes: Math.round(this.deepgramMinutes * 100) / 100,
            openaiInputTokens: this.openaiInputTokens,
            openaiOutputTokens: this.openaiOutputTokens,
            translationCharacters: this.translationCharacters,
            translationRequests: this.translationRequestCount,
            estimatedCostUSD: costs.totalCostUSD,
            alerts: [...this.activeAlerts],
        };
    }
    // ── Monitoring Output ───────────────────────────────────────
    /**
     * Log current metrics to console
     */
    logMetrics() {
        const metrics = this.getMetrics();
        const costs = metrics.costs;
        const colors = {
            reset: '\x1b[0m',
            green: '\x1b[32m',
            yellow: '\x1b[33m',
            cyan: '\x1b[36m',
            bold: '\x1b[1m',
            dim: '\x1b[2m',
        };
        console.log(`\n${colors.cyan}${'─'.repeat(40)}${colors.reset}`);
        console.log(`${colors.bold}  AI COST METRICS${colors.reset}  ${colors.dim}${metrics.timestamp}${colors.reset}`);
        console.log(`${colors.cyan}${'─'.repeat(40)}${colors.reset}`);
        console.log(`\n${colors.bold}Usage:${colors.reset}`);
        console.log(`  Deepgram Minutes:      ${metrics.deepgram.totalMinutes.toFixed(2)}`);
        console.log(`  OpenAI Input Tokens:   ${metrics.openai.totalInputTokens.toLocaleString()}`);
        console.log(`  OpenAI Output Tokens:  ${metrics.openai.totalOutputTokens.toLocaleString()}`);
        console.log(`  Translation Chars:     ${metrics.translation.totalCharacters.toLocaleString()}`);
        console.log(`  Translation Requests:  ${metrics.translation.requestCount}`);
        console.log(`\n${colors.bold}Estimated Cost (USD):${colors.reset}`);
        console.log(`  Deepgram:     $${costs.deepgramCostUSD.toFixed(4)}`);
        console.log(`  OpenAI Input: $${costs.openaiInputCostUSD.toFixed(4)}`);
        console.log(`  OpenAI Output:$${costs.openaiOutputCostUSD.toFixed(4)}`);
        console.log(`  Translation:  $${costs.translationCostUSD.toFixed(4)}`);
        console.log(`  ${colors.bold}Total:        $${costs.totalCostUSD.toFixed(4)}${colors.reset}`);
        if (metrics.alerts.length > 0) {
            console.log(`\n${colors.yellow}${colors.bold}Alerts (${metrics.alerts.length}):${colors.reset}`);
            for (const alert of metrics.alerts) {
                console.log(`  ${colors.yellow}⚠${colors.reset} [${alert.severity}] ${alert.message}`);
            }
        }
        console.log(`${colors.cyan}${'─'.repeat(40)}${colors.reset}\n`);
        // Also log to structured logger
        logger_1.logger.info('[AI_COST] Metrics snapshot', {
            deepgramMinutes: metrics.deepgram.totalMinutes,
            openaiInputTokens: metrics.openai.totalInputTokens,
            openaiOutputTokens: metrics.openai.totalOutputTokens,
            translationCharacters: metrics.translation.totalCharacters,
            translationRequests: metrics.translation.requestCount,
            estimatedCostUSD: costs.totalCostUSD,
            alertCount: metrics.alerts.length,
        });
        // Queue metrics for persistence (non-blocking)
        if (COST_MONITOR_CONFIG.persistence.enabled) {
            this.queueMetricsForPersistence(metrics, costs);
        }
    }
    // ── Persistence Methods ─────────────────────────────────────
    /**
     * Queue metrics for batched persistence to PostgreSQL
     * Non-blocking - never fails the pipeline
     */
    queueMetricsForPersistence(metrics, costs) {
        try {
            const row = {
                timestamp: new Date(),
                deepgram_minutes: metrics.deepgram.totalMinutes,
                openai_input_tokens: metrics.openai.totalInputTokens,
                openai_output_tokens: metrics.openai.totalOutputTokens,
                translation_characters: metrics.translation.totalCharacters,
                translation_requests: metrics.translation.requestCount,
                estimated_cost_usd: costs.totalCostUSD,
                deepgram_cost_usd: costs.deepgramCostUSD,
                openai_input_cost_usd: costs.openaiInputCostUSD,
                openai_output_cost_usd: costs.openaiOutputCostUSD,
                translation_cost_usd: costs.translationCostUSD,
                interval_type: 'snapshot',
            };
            this.metricsBuffer.push(row);
            // Check if we should flush
            const shouldFlush = this.metricsBuffer.length >= COST_MONITOR_CONFIG.persistence.batchSize ||
                (Date.now() - this.lastFlushAt) >= COST_MONITOR_CONFIG.persistence.batchTimeoutMs;
            if (shouldFlush) {
                // Flush asynchronously - don't await
                this.flushMetricsBuffer().catch(err => {
                    logger_1.logger.error('[AI_COST] Failed to flush metrics buffer', err);
                });
            }
        }
        catch (err) {
            logger_1.logger.error('[AI_COST] Failed to queue metrics for persistence', err);
        }
    }
    /**
     * Flush the metrics buffer to PostgreSQL
     * Uses batched insert for efficiency
     */
    async flushMetricsBuffer() {
        if (this.metricsBuffer.length === 0) {
            return;
        }
        // Take the current buffer and reset
        const rowsToInsert = [...this.metricsBuffer];
        this.metricsBuffer = [];
        this.lastFlushAt = Date.now();
        try {
            // Batched insert
            await (0, db_1.db)('ai_usage_metrics').insert(rowsToInsert);
            logger_1.logger.debug('[AI_COST] Flushed metrics to PostgreSQL', {
                rowCount: rowsToInsert.length,
            });
        }
        catch (err) {
            // Log error but don't fail - re-queue rows for next attempt
            logger_1.logger.error('[AI_COST] PostgreSQL insert failed', {
                error: err.message,
                rowCount: rowsToInsert.length,
            });
            // Re-queue failed rows (up to a limit to prevent memory issues)
            if (this.metricsBuffer.length < 100) {
                this.metricsBuffer.unshift(...rowsToInsert);
            }
        }
    }
    /**
     * Run retention cleanup - delete records older than retention period
     */
    async runRetentionCleanup() {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - COST_MONITOR_CONFIG.persistence.retentionDays);
            const result = await (0, db_1.db)('ai_usage_metrics')
                .where('timestamp', '<', cutoffDate)
                .delete();
            if (result > 0) {
                logger_1.logger.info('[AI_COST] Retention cleanup completed', {
                    deletedRows: result,
                    cutoffDate: cutoffDate.toISOString(),
                    retentionDays: COST_MONITOR_CONFIG.persistence.retentionDays,
                });
            }
        }
        catch (err) {
            logger_1.logger.error('[AI_COST] Retention cleanup failed', {
                error: err.message,
            });
        }
    }
    // ── Lifecycle ───────────────────────────────────────────────
    /**
     * Reset all metrics (call at start of new period)
     */
    resetMetrics() {
        this.deepgramMinutes = 0;
        this.deepgramRequestCount = 0;
        this.deepgramLastUsageAt = null;
        this.openaiInputTokens = 0;
        this.openaiOutputTokens = 0;
        this.openaiRequestCount = 0;
        this.openaiLastUsageAt = null;
        this.openaiByModel = {};
        this.translationCharacters = 0;
        this.translationRequestCount = 0;
        this.translationLastUsageAt = null;
        this.translationByLanguage = {};
        this.activeAlerts = [];
        this.periodStartedAt = new Date();
        logger_1.logger.info('[AI_COST] Metrics reset', {
            periodStartedAt: this.periodStartedAt.toISOString(),
        });
    }
    /**
     * Start the cost monitoring loop
     */
    start() {
        if (this.isRunning) {
            logger_1.logger.warn('[AI_COST] Monitor already running');
            return;
        }
        // Log pricing configuration
        const pricing = (0, ai_pricing_1.getPricingSnapshot)();
        logger_1.logger.info('[AI_COST] Monitor started', {
            pricing,
            limits: ai_pricing_1.AI_COST_LIMITS,
            logIntervalMs: COST_MONITOR_CONFIG.logIntervalMs,
            persistenceEnabled: COST_MONITOR_CONFIG.persistence.enabled,
        });
        // Log metrics immediately
        this.logMetrics();
        // Schedule periodic logging
        this.intervalId = setInterval(() => {
            try {
                this.checkDailyCostLimit();
                this.logMetrics();
                // Check for midnight reset
                if (COST_MONITOR_CONFIG.resetAtMidnight) {
                    this.checkMidnightReset();
                }
            }
            catch (err) {
                logger_1.logger.error('[AI_COST] Metric logging failed', err);
            }
        }, COST_MONITOR_CONFIG.logIntervalMs);
        // Start retention cleanup scheduler if persistence is enabled
        if (COST_MONITOR_CONFIG.persistence.enabled) {
            const cleanupIntervalMs = COST_MONITOR_CONFIG.persistence.retentionCleanupIntervalHours * 60 * 60 * 1000;
            // Run cleanup immediately on start
            this.runRetentionCleanup().catch(err => {
                logger_1.logger.error('[AI_COST] Initial retention cleanup failed', err);
            });
            // Schedule periodic cleanup
            this.retentionCleanupIntervalId = setInterval(() => {
                this.runRetentionCleanup().catch(err => {
                    logger_1.logger.error('[AI_COST] Scheduled retention cleanup failed', err);
                });
            }, cleanupIntervalMs);
        }
        this.isRunning = true;
    }
    lastResetDate = null;
    checkMidnightReset() {
        const now = new Date();
        const todayUTC = now.toISOString().split('T')[0];
        if (this.lastResetDate && this.lastResetDate !== todayUTC) {
            logger_1.logger.info('[AI_COST] Midnight reset triggered', {
                previousDate: this.lastResetDate,
                newDate: todayUTC,
            });
            this.resetMetrics();
        }
        this.lastResetDate = todayUTC;
    }
    /**
     * Stop the cost monitoring loop
     */
    stop() {
        if (!this.isRunning) {
            return;
        }
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (this.retentionCleanupIntervalId) {
            clearInterval(this.retentionCleanupIntervalId);
            this.retentionCleanupIntervalId = null;
        }
        // Flush any remaining metrics to DB
        if (COST_MONITOR_CONFIG.persistence.enabled && this.metricsBuffer.length > 0) {
            this.flushMetricsBuffer().catch(err => {
                logger_1.logger.error('[AI_COST] Failed to flush metrics on shutdown', err);
            });
        }
        // Log final metrics
        this.logMetrics();
        this.isRunning = false;
        logger_1.logger.info('[AI_COST] Monitor stopped');
    }
    /**
     * Check if monitor is running
     */
    isActive() {
        return this.isRunning;
    }
}
// ── Singleton Instance ──────────────────────────────────────
const aiCostMonitor = new AICostMonitorClass();
// ── Exports ─────────────────────────────────────────────────
/**
 * Start the AI cost monitor
 */
function startAICostMonitor() {
    aiCostMonitor.start();
}
/**
 * Stop the AI cost monitor
 */
function stopAICostMonitor() {
    aiCostMonitor.stop();
}
/**
 * Record Deepgram transcription usage
 */
function recordDeepgramUsage(durationSeconds, meetingId) {
    aiCostMonitor.recordDeepgramUsage(durationSeconds, meetingId);
}
/**
 * Record OpenAI API usage
 */
function recordOpenAIUsage(inputTokens, outputTokens, model, meetingId) {
    aiCostMonitor.recordOpenAIUsage(inputTokens, outputTokens, model, meetingId);
}
/**
 * Record translation service usage
 */
function recordTranslationUsage(textLength, languageCount, targetLanguages, meetingId) {
    aiCostMonitor.recordTranslationUsage(textLength, languageCount, targetLanguages, meetingId);
}
/**
 * Get current AI cost metrics
 */
function getAICostMetrics() {
    return aiCostMonitor.getMetrics();
}
/**
 * Get metrics formatted for health endpoint
 */
function getAICostHealthMetrics() {
    return aiCostMonitor.getHealthMetrics();
}
/**
 * Reset all metrics (for testing or manual reset)
 */
function resetAICostMetrics() {
    aiCostMonitor.resetMetrics();
}
/**
 * Get the monitor instance for event subscriptions
 */
function getAICostMonitor() {
    return aiCostMonitor;
}
/**
 * Get daily cost summary for a date range
 * @param startDate - Start date (inclusive)
 * @param endDate - End date (inclusive)
 * @returns Array of daily summaries
 */
async function getDailyCostSummary(startDate, endDate) {
    try {
        const query = (0, db_1.db)('ai_usage_metrics')
            .select(db_1.db.raw("DATE(timestamp) as date"), db_1.db.raw('MAX(deepgram_minutes) as deepgram_minutes'), db_1.db.raw('MAX(openai_input_tokens) as openai_input_tokens'), db_1.db.raw('MAX(openai_output_tokens) as openai_output_tokens'), db_1.db.raw('MAX(translation_characters) as translation_characters'), db_1.db.raw('MAX(translation_requests) as translation_requests'), db_1.db.raw('MAX(estimated_cost_usd) as total_cost_usd'), db_1.db.raw('COUNT(*) as snapshot_count'))
            .where('interval_type', 'snapshot')
            .groupByRaw('DATE(timestamp)')
            .orderBy('date', 'desc');
        if (startDate) {
            query.where('timestamp', '>=', startDate);
        }
        if (endDate) {
            query.where('timestamp', '<=', endDate);
        }
        const rows = await query;
        return rows.map((row) => ({
            date: row.date instanceof Date
                ? row.date.toISOString().split('T')[0]
                : String(row.date),
            deepgramMinutes: parseFloat(row.deepgram_minutes) || 0,
            openaiInputTokens: parseInt(row.openai_input_tokens, 10) || 0,
            openaiOutputTokens: parseInt(row.openai_output_tokens, 10) || 0,
            translationCharacters: parseInt(row.translation_characters, 10) || 0,
            translationRequests: parseInt(row.translation_requests, 10) || 0,
            totalCostUSD: parseFloat(row.total_cost_usd) || 0,
            snapshotCount: parseInt(row.snapshot_count, 10) || 0,
        }));
    }
    catch (err) {
        logger_1.logger.error('[AI_COST] getDailyCostSummary failed', { error: err.message });
        return [];
    }
}
/**
 * Get monthly cost summary
 * @param monthsBack - Number of months to look back (default: 12)
 * @returns Array of monthly summaries
 */
async function getMonthlyCostSummary(monthsBack = 12) {
    try {
        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - monthsBack);
        const rows = await (0, db_1.db)('ai_usage_metrics')
            .select(db_1.db.raw("EXTRACT(YEAR FROM timestamp)::integer as year"), db_1.db.raw("EXTRACT(MONTH FROM timestamp)::integer as month"), db_1.db.raw('MAX(deepgram_minutes) as deepgram_minutes'), db_1.db.raw('MAX(openai_input_tokens) as openai_input_tokens'), db_1.db.raw('MAX(openai_output_tokens) as openai_output_tokens'), db_1.db.raw('MAX(translation_characters) as translation_characters'), db_1.db.raw('MAX(translation_requests) as translation_requests'), db_1.db.raw('MAX(estimated_cost_usd) as total_cost_usd'), db_1.db.raw('COUNT(DISTINCT DATE(timestamp)) as day_count'), db_1.db.raw('COUNT(*) as snapshot_count'))
            .where('interval_type', 'snapshot')
            .where('timestamp', '>=', cutoffDate)
            .groupByRaw('EXTRACT(YEAR FROM timestamp), EXTRACT(MONTH FROM timestamp)')
            .orderByRaw('EXTRACT(YEAR FROM timestamp) DESC, EXTRACT(MONTH FROM timestamp) DESC');
        return rows.map((row) => {
            const totalCost = parseFloat(row.total_cost_usd) || 0;
            const dayCount = parseInt(row.day_count, 10) || 1;
            return {
                year: parseInt(row.year, 10),
                month: parseInt(row.month, 10),
                deepgramMinutes: parseFloat(row.deepgram_minutes) || 0,
                openaiInputTokens: parseInt(row.openai_input_tokens, 10) || 0,
                openaiOutputTokens: parseInt(row.openai_output_tokens, 10) || 0,
                translationCharacters: parseInt(row.translation_characters, 10) || 0,
                translationRequests: parseInt(row.translation_requests, 10) || 0,
                totalCostUSD: totalCost,
                dailyAvgCostUSD: Math.round((totalCost / dayCount) * 100) / 100,
                snapshotCount: parseInt(row.snapshot_count, 10) || 0,
            };
        });
    }
    catch (err) {
        logger_1.logger.error('[AI_COST] getMonthlyCostSummary failed', { error: err.message });
        return [];
    }
}
/**
 * Get the most recent N hours of cost metrics
 * @param hours - Number of hours to look back (default: 24)
 * @returns Array of metrics snapshots
 */
async function getRecentCostMetrics(hours = 24) {
    try {
        const cutoffDate = new Date();
        cutoffDate.setHours(cutoffDate.getHours() - hours);
        const rows = await (0, db_1.db)('ai_usage_metrics')
            .where('timestamp', '>=', cutoffDate)
            .where('interval_type', 'snapshot')
            .orderBy('timestamp', 'desc');
        return rows;
    }
    catch (err) {
        logger_1.logger.error('[AI_COST] getRecentCostMetrics failed', { error: err.message });
        return [];
    }
}
/**
 * Get total accumulated costs for a specific date
 * @param date - The date to query (defaults to today)
 * @returns Cost breakdown or null if no data
 */
async function getDayCost(date) {
    try {
        const targetDate = date || new Date();
        const dateStr = targetDate.toISOString().split('T')[0];
        const row = await (0, db_1.db)('ai_usage_metrics')
            .whereRaw("DATE(timestamp) = ?", [dateStr])
            .where('interval_type', 'snapshot')
            .orderBy('timestamp', 'desc')
            .first();
        if (!row) {
            return null;
        }
        return {
            deepgramCostUSD: parseFloat(row.deepgram_cost_usd) || 0,
            openaiInputCostUSD: parseFloat(row.openai_input_cost_usd) || 0,
            openaiOutputCostUSD: parseFloat(row.openai_output_cost_usd) || 0,
            translationCostUSD: parseFloat(row.translation_cost_usd) || 0,
            totalCostUSD: parseFloat(row.estimated_cost_usd) || 0,
        };
    }
    catch (err) {
        logger_1.logger.error('[AI_COST] getDayCost failed', { error: err.message });
        return null;
    }
}
exports.default = aiCostMonitor;
//# sourceMappingURL=ai-cost.monitor.js.map