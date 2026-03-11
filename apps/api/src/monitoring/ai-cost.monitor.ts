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

import { EventEmitter } from 'events';
import { logger } from '../logger';
import { db } from '../db';
import { 
  AI_PRICING, 
  AI_COST_LIMITS, 
  OpenAIModel,
  getPricingSnapshot 
} from '../config/ai-pricing';

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

// ── Types ───────────────────────────────────────────────────

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
  byModel: Record<string, { inputTokens: number; outputTokens: number; requests: number }>;
}

interface TranslationMetrics {
  totalCharacters: number;
  requestCount: number;
  lastUsageAt: number | null;
  byLanguage: Record<string, { characters: number; requests: number }>;
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

// ── AI Cost Monitor Class ───────────────────────────────────

class AICostMonitorClass extends EventEmitter {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private periodStartedAt: Date;

  // Deepgram metrics
  private deepgramMinutes = 0;
  private deepgramRequestCount = 0;
  private deepgramLastUsageAt: number | null = null;

  // OpenAI metrics
  private openaiInputTokens = 0;
  private openaiOutputTokens = 0;
  private openaiRequestCount = 0;
  private openaiLastUsageAt: number | null = null;
  private openaiByModel: Record<string, { inputTokens: number; outputTokens: number; requests: number }> = {};

  // Translation metrics
  private translationCharacters = 0;
  private translationRequestCount = 0;
  private translationLastUsageAt: number | null = null;
  private translationByLanguage: Record<string, { characters: number; requests: number }> = {};

  // Active alerts
  private activeAlerts: AICostAlert[] = [];

  // Persistence
  private metricsBuffer: AIUsageMetricRow[] = [];
  private lastFlushAt: number = Date.now();
  private retentionCleanupIntervalId: NodeJS.Timeout | null = null;

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
  recordDeepgramUsage(durationSeconds: number, meetingId?: string): void {
    try {
      const minutes = durationSeconds / 60;
      this.deepgramMinutes += minutes;
      this.deepgramRequestCount++;
      this.deepgramLastUsageAt = Date.now();

      logger.debug('[AI_COST] Deepgram usage recorded', {
        durationSeconds,
        minutes,
        totalMinutes: this.deepgramMinutes,
        meetingId,
      });

      // Check limits after recording
      this.checkDeepgramLimits();
    } catch (err) {
      // Never block the pipeline - just log the error
      logger.error('[AI_COST] Failed to record Deepgram usage', err);
    }
  }

  /**
   * Record OpenAI API usage
   * @param inputTokens - Number of input/prompt tokens
   * @param outputTokens - Number of output/completion tokens
   * @param model - OpenAI model used (defaults to config default)
   * @param meetingId - Optional meeting ID for tracking
   */
  recordOpenAIUsage(
    inputTokens: number, 
    outputTokens: number, 
    model?: OpenAIModel,
    meetingId?: string
  ): void {
    try {
      const modelName = model || AI_PRICING.openai.defaultModel;
      
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

      logger.debug('[AI_COST] OpenAI usage recorded', {
        inputTokens,
        outputTokens,
        model: modelName,
        totalInputTokens: this.openaiInputTokens,
        totalOutputTokens: this.openaiOutputTokens,
        meetingId,
      });

      // Check limits after recording
      this.checkOpenAILimits();
    } catch (err) {
      logger.error('[AI_COST] Failed to record OpenAI usage', err);
    }
  }

  /**
   * Record translation service usage
   * @param textLength - Length of source text in characters
   * @param languageCount - Number of target languages
   * @param targetLanguages - Optional array of target language codes
   * @param meetingId - Optional meeting ID for tracking
   */
  recordTranslationUsage(
    textLength: number, 
    languageCount: number,
    targetLanguages?: string[],
    meetingId?: string
  ): void {
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

      logger.debug('[AI_COST] Translation usage recorded', {
        textLength,
        languageCount,
        totalCharacters,
        cumulativeCharacters: this.translationCharacters,
        targetLanguages,
        meetingId,
      });

      // Check limits after recording
      this.checkTranslationLimits();
    } catch (err) {
      logger.error('[AI_COST] Failed to record translation usage', err);
    }
  }

  // ── Cost Calculation ────────────────────────────────────────

  /**
   * Calculate current cost breakdown
   */
  calculateCost(): CostBreakdown {
    const model = AI_PRICING.openai.defaultModel;
    const modelPricing = AI_PRICING.openai.models[model];

    // Deepgram cost
    const deepgramCostUSD = this.deepgramMinutes * AI_PRICING.deepgram.streaming_per_minute;

    // OpenAI cost
    const openaiInputCostUSD = (this.openaiInputTokens / 1_000_000) * modelPricing.input_per_million_tokens;
    const openaiOutputCostUSD = (this.openaiOutputTokens / 1_000_000) * modelPricing.output_per_million_tokens;

    // Translation cost
    const translationCostUSD = this.translationCharacters * AI_PRICING.translation.per_character;

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

  private checkDeepgramLimits(): void {
    if (this.deepgramMinutes > AI_COST_LIMITS.max_deepgram_minutes_per_day) {
      this.addAlert({
        type: 'DEEPGRAM_MINUTE_LIMIT',
        severity: 'CRITICAL',
        message: `Deepgram usage exceeded daily limit: ${Math.round(this.deepgramMinutes)} minutes (limit: ${AI_COST_LIMITS.max_deepgram_minutes_per_day})`,
        currentValue: this.deepgramMinutes,
        threshold: AI_COST_LIMITS.max_deepgram_minutes_per_day,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private checkOpenAILimits(): void {
    const totalTokens = this.openaiInputTokens + this.openaiOutputTokens;
    if (totalTokens > AI_COST_LIMITS.max_openai_tokens_per_day) {
      this.addAlert({
        type: 'OPENAI_TOKEN_LIMIT',
        severity: 'CRITICAL',
        message: `OpenAI token usage exceeded daily limit: ${totalTokens} tokens (limit: ${AI_COST_LIMITS.max_openai_tokens_per_day})`,
        currentValue: totalTokens,
        threshold: AI_COST_LIMITS.max_openai_tokens_per_day,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private checkTranslationLimits(): void {
    if (this.translationCharacters > AI_COST_LIMITS.max_translation_chars_per_day) {
      this.addAlert({
        type: 'TRANSLATION_CHAR_LIMIT',
        severity: 'CRITICAL',
        message: `Translation usage exceeded daily limit: ${this.translationCharacters} characters (limit: ${AI_COST_LIMITS.max_translation_chars_per_day})`,
        currentValue: this.translationCharacters,
        threshold: AI_COST_LIMITS.max_translation_chars_per_day,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private checkDailyCostLimit(): void {
    const costs = this.calculateCost();
    if (costs.totalCostUSD > AI_COST_LIMITS.daily_cost_limit_usd) {
      this.addAlert({
        type: 'DAILY_COST_LIMIT',
        severity: 'CRITICAL',
        message: `Daily AI cost exceeded limit: $${costs.totalCostUSD.toFixed(2)} (limit: $${AI_COST_LIMITS.daily_cost_limit_usd.toFixed(2)})`,
        currentValue: costs.totalCostUSD,
        threshold: AI_COST_LIMITS.daily_cost_limit_usd,
        timestamp: new Date().toISOString(),
      });
    } else if (costs.totalCostUSD > AI_COST_LIMITS.daily_cost_limit_usd * 0.8) {
      // Warning at 80% of limit
      this.addAlert({
        type: 'DAILY_COST_LIMIT',
        severity: 'WARNING',
        message: `Daily AI cost approaching limit: $${costs.totalCostUSD.toFixed(2)} (80% of $${AI_COST_LIMITS.daily_cost_limit_usd.toFixed(2)})`,
        currentValue: costs.totalCostUSD,
        threshold: AI_COST_LIMITS.daily_cost_limit_usd,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private addAlert(alert: AICostAlert): void {
    // Check if this alert type already exists (avoid duplicates)
    const existingIndex = this.activeAlerts.findIndex(
      a => a.type === alert.type && a.severity === alert.severity
    );

    if (existingIndex >= 0) {
      // Update existing alert
      this.activeAlerts[existingIndex] = alert;
    } else {
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
      logger.error(`[AI_COST_ALERT] ${alert.type}`, logMeta);
    } else {
      logger.warn(`[AI_COST_ALERT] ${alert.type}`, logMeta);
    }

    // Emit event for external listeners
    this.emit('cost-alert', alert);
  }

  // ── Metrics Retrieval ───────────────────────────────────────

  /**
   * Get current AI cost metrics
   */
  getMetrics(): AICostMetrics {
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
  getHealthMetrics(): {
    deepgramMinutes: number;
    openaiInputTokens: number;
    openaiOutputTokens: number;
    translationCharacters: number;
    translationRequests: number;
    estimatedCostUSD: number;
    alerts: AICostAlert[];
  } {
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
  logMetrics(): void {
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
    logger.info('[AI_COST] Metrics snapshot', {
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
  private queueMetricsForPersistence(metrics: AICostMetrics, costs: CostBreakdown): void {
    try {
      const row: AIUsageMetricRow = {
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
      const shouldFlush = 
        this.metricsBuffer.length >= COST_MONITOR_CONFIG.persistence.batchSize ||
        (Date.now() - this.lastFlushAt) >= COST_MONITOR_CONFIG.persistence.batchTimeoutMs;

      if (shouldFlush) {
        // Flush asynchronously - don't await
        this.flushMetricsBuffer().catch(err => {
          logger.error('[AI_COST] Failed to flush metrics buffer', err);
        });
      }
    } catch (err) {
      logger.error('[AI_COST] Failed to queue metrics for persistence', err);
    }
  }

  /**
   * Flush the metrics buffer to PostgreSQL
   * Uses batched insert for efficiency
   */
  private async flushMetricsBuffer(): Promise<void> {
    if (this.metricsBuffer.length === 0) {
      return;
    }

    // Take the current buffer and reset
    const rowsToInsert = [...this.metricsBuffer];
    this.metricsBuffer = [];
    this.lastFlushAt = Date.now();

    try {
      // Batched insert
      await db('ai_usage_metrics').insert(rowsToInsert);

      logger.debug('[AI_COST] Flushed metrics to PostgreSQL', {
        rowCount: rowsToInsert.length,
      });
    } catch (err: any) {
      // Log error but don't fail - re-queue rows for next attempt
      logger.error('[AI_COST] PostgreSQL insert failed', {
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
  private async runRetentionCleanup(): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - COST_MONITOR_CONFIG.persistence.retentionDays);

      const result = await db('ai_usage_metrics')
        .where('timestamp', '<', cutoffDate)
        .delete();

      if (result > 0) {
        logger.info('[AI_COST] Retention cleanup completed', {
          deletedRows: result,
          cutoffDate: cutoffDate.toISOString(),
          retentionDays: COST_MONITOR_CONFIG.persistence.retentionDays,
        });
      }
    } catch (err: any) {
      logger.error('[AI_COST] Retention cleanup failed', {
        error: err.message,
      });
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────

  /**
   * Reset all metrics (call at start of new period)
   */
  resetMetrics(): void {
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

    logger.info('[AI_COST] Metrics reset', {
      periodStartedAt: this.periodStartedAt.toISOString(),
    });
  }

  /**
   * Start the cost monitoring loop
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('[AI_COST] Monitor already running');
      return;
    }

    // Log pricing configuration
    const pricing = getPricingSnapshot();
    logger.info('[AI_COST] Monitor started', {
      pricing,
      limits: AI_COST_LIMITS,
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
      } catch (err) {
        logger.error('[AI_COST] Metric logging failed', err);
      }
    }, COST_MONITOR_CONFIG.logIntervalMs);

    // Start retention cleanup scheduler if persistence is enabled
    if (COST_MONITOR_CONFIG.persistence.enabled) {
      const cleanupIntervalMs = COST_MONITOR_CONFIG.persistence.retentionCleanupIntervalHours * 60 * 60 * 1000;
      
      // Run cleanup immediately on start
      this.runRetentionCleanup().catch(err => {
        logger.error('[AI_COST] Initial retention cleanup failed', err);
      });
      
      // Schedule periodic cleanup
      this.retentionCleanupIntervalId = setInterval(() => {
        this.runRetentionCleanup().catch(err => {
          logger.error('[AI_COST] Scheduled retention cleanup failed', err);
        });
      }, cleanupIntervalMs);
    }

    this.isRunning = true;
  }

  private lastResetDate: string | null = null;

  private checkMidnightReset(): void {
    const now = new Date();
    const todayUTC = now.toISOString().split('T')[0];

    if (this.lastResetDate && this.lastResetDate !== todayUTC) {
      logger.info('[AI_COST] Midnight reset triggered', {
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
  stop(): void {
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
        logger.error('[AI_COST] Failed to flush metrics on shutdown', err);
      });
    }

    // Log final metrics
    this.logMetrics();

    this.isRunning = false;
    logger.info('[AI_COST] Monitor stopped');
  }

  /**
   * Check if monitor is running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

// ── Singleton Instance ──────────────────────────────────────

const aiCostMonitor = new AICostMonitorClass();

// ── Exports ─────────────────────────────────────────────────

/**
 * Start the AI cost monitor
 */
export function startAICostMonitor(): void {
  aiCostMonitor.start();
}

/**
 * Stop the AI cost monitor
 */
export function stopAICostMonitor(): void {
  aiCostMonitor.stop();
}

/**
 * Record Deepgram transcription usage
 */
export function recordDeepgramUsage(durationSeconds: number, meetingId?: string): void {
  aiCostMonitor.recordDeepgramUsage(durationSeconds, meetingId);
}

/**
 * Record OpenAI API usage
 */
export function recordOpenAIUsage(
  inputTokens: number, 
  outputTokens: number, 
  model?: OpenAIModel,
  meetingId?: string
): void {
  aiCostMonitor.recordOpenAIUsage(inputTokens, outputTokens, model, meetingId);
}

/**
 * Record translation service usage
 */
export function recordTranslationUsage(
  textLength: number, 
  languageCount: number,
  targetLanguages?: string[],
  meetingId?: string
): void {
  aiCostMonitor.recordTranslationUsage(textLength, languageCount, targetLanguages, meetingId);
}

/**
 * Get current AI cost metrics
 */
export function getAICostMetrics(): AICostMetrics {
  return aiCostMonitor.getMetrics();
}

/**
 * Get metrics formatted for health endpoint
 */
export function getAICostHealthMetrics(): ReturnType<AICostMonitorClass['getHealthMetrics']> {
  return aiCostMonitor.getHealthMetrics();
}

/**
 * Reset all metrics (for testing or manual reset)
 */
export function resetAICostMetrics(): void {
  aiCostMonitor.resetMetrics();
}

/**
 * Get the monitor instance for event subscriptions
 */
export function getAICostMonitor(): AICostMonitorClass {
  return aiCostMonitor;
}

// ── Database Query Helpers ──────────────────────────────────

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
export async function getDailyCostSummary(
  startDate?: Date,
  endDate?: Date
): Promise<DailyCostSummary[]> {
  try {
    const query = db('ai_usage_metrics')
      .select(
        db.raw("DATE(timestamp) as date"),
        db.raw('MAX(deepgram_minutes) as deepgram_minutes'),
        db.raw('MAX(openai_input_tokens) as openai_input_tokens'),
        db.raw('MAX(openai_output_tokens) as openai_output_tokens'),
        db.raw('MAX(translation_characters) as translation_characters'),
        db.raw('MAX(translation_requests) as translation_requests'),
        db.raw('MAX(estimated_cost_usd) as total_cost_usd'),
        db.raw('COUNT(*) as snapshot_count')
      )
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

    return rows.map((row: any) => ({
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
  } catch (err: any) {
    logger.error('[AI_COST] getDailyCostSummary failed', { error: err.message });
    return [];
  }
}

/**
 * Get monthly cost summary
 * @param monthsBack - Number of months to look back (default: 12)
 * @returns Array of monthly summaries
 */
export async function getMonthlyCostSummary(
  monthsBack: number = 12
): Promise<MonthlyCostSummary[]> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsBack);

    const rows = await db('ai_usage_metrics')
      .select(
        db.raw("EXTRACT(YEAR FROM timestamp)::integer as year"),
        db.raw("EXTRACT(MONTH FROM timestamp)::integer as month"),
        db.raw('MAX(deepgram_minutes) as deepgram_minutes'),
        db.raw('MAX(openai_input_tokens) as openai_input_tokens'),
        db.raw('MAX(openai_output_tokens) as openai_output_tokens'),
        db.raw('MAX(translation_characters) as translation_characters'),
        db.raw('MAX(translation_requests) as translation_requests'),
        db.raw('MAX(estimated_cost_usd) as total_cost_usd'),
        db.raw('COUNT(DISTINCT DATE(timestamp)) as day_count'),
        db.raw('COUNT(*) as snapshot_count')
      )
      .where('interval_type', 'snapshot')
      .where('timestamp', '>=', cutoffDate)
      .groupByRaw('EXTRACT(YEAR FROM timestamp), EXTRACT(MONTH FROM timestamp)')
      .orderByRaw('EXTRACT(YEAR FROM timestamp) DESC, EXTRACT(MONTH FROM timestamp) DESC');

    return rows.map((row: any) => {
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
  } catch (err: any) {
    logger.error('[AI_COST] getMonthlyCostSummary failed', { error: err.message });
    return [];
  }
}

/**
 * Get the most recent N hours of cost metrics
 * @param hours - Number of hours to look back (default: 24)
 * @returns Array of metrics snapshots
 */
export async function getRecentCostMetrics(hours: number = 24): Promise<AIUsageMetricRow[]> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - hours);

    const rows = await db('ai_usage_metrics')
      .where('timestamp', '>=', cutoffDate)
      .where('interval_type', 'snapshot')
      .orderBy('timestamp', 'desc');

    return rows;
  } catch (err: any) {
    logger.error('[AI_COST] getRecentCostMetrics failed', { error: err.message });
    return [];
  }
}

/**
 * Get total accumulated costs for a specific date
 * @param date - The date to query (defaults to today)
 * @returns Cost breakdown or null if no data
 */
export async function getDayCost(date?: Date): Promise<CostBreakdown | null> {
  try {
    const targetDate = date || new Date();
    const dateStr = targetDate.toISOString().split('T')[0];

    const row = await db('ai_usage_metrics')
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
  } catch (err: any) {
    logger.error('[AI_COST] getDayCost failed', { error: err.message });
    return null;
  }
}

export default aiCostMonitor;
