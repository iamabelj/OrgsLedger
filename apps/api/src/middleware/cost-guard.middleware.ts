// ============================================================
// OrgsLedger API — AI Cost Guard Middleware
// Blocks new meeting creation when AI budget is exceeded
// ============================================================
//
// Protects against runaway AI costs by:
//   - Calculating projected daily cost for all AI services
//   - Blocking new meeting creation when budget is exceeded
//   - Emitting Prometheus metrics for cost utilization
//
// Error Response when budget exceeded:
//   {
//     error: "AI_BUDGET_EXCEEDED",
//     message: "System temporarily restricted"
//   }
//
// ============================================================

import { Request, Response, NextFunction } from 'express';
import * as client from 'prom-client';
import { logger } from '../logger';
import { getRegistry } from '../monitoring/prometheus.metrics';
import { getAICostMetrics } from '../monitoring/ai-cost.monitor';
import { AI_COST_LIMITS, AI_PRICING } from '../config/ai-pricing';

// ── Configuration ───────────────────────────────────────────

interface CostGuardConfig {
  // Whether to enforce budget blocking (can be disabled for testing)
  enabled: boolean;
  // Budget threshold percentage (0-1) at which to start blocking
  blockThreshold: number;
  // Warning threshold percentage (0-1)
  warnThreshold: number;
  // Estimated cost per meeting (for projection)
  estimatedCostPerMeeting: {
    transcriptionMinutes: number;
    translationCharacters: number;
    minutesGenerationTokens: number;
  };
}

const DEFAULT_CONFIG: CostGuardConfig = {
  enabled: true,
  blockThreshold: 1.0, // Block at 100% of budget
  warnThreshold: 0.8,  // Warn at 80% of budget
  estimatedCostPerMeeting: {
    // Estimate 30 minutes of transcription per meeting
    transcriptionMinutes: 30,
    // Estimate 50k characters for translation (multi-language)
    translationCharacters: 50_000,
    // Estimate 10k tokens for minutes generation (input + output)
    minutesGenerationTokens: 10_000,
  },
};

// Allow config override via environment
const config: CostGuardConfig = {
  enabled: process.env.AI_COST_GUARD_ENABLED !== 'false',
  blockThreshold: parseFloat(process.env.AI_COST_GUARD_BLOCK_THRESHOLD || '1.0'),
  warnThreshold: parseFloat(process.env.AI_COST_GUARD_WARN_THRESHOLD || '0.8'),
  estimatedCostPerMeeting: {
    transcriptionMinutes: parseFloat(
      process.env.AI_COST_GUARD_EST_TRANSCRIPT_MIN || 
      String(DEFAULT_CONFIG.estimatedCostPerMeeting.transcriptionMinutes)
    ),
    translationCharacters: parseFloat(
      process.env.AI_COST_GUARD_EST_TRANSLATE_CHARS || 
      String(DEFAULT_CONFIG.estimatedCostPerMeeting.translationCharacters)
    ),
    minutesGenerationTokens: parseFloat(
      process.env.AI_COST_GUARD_EST_MINUTES_TOKENS || 
      String(DEFAULT_CONFIG.estimatedCostPerMeeting.minutesGenerationTokens)
    ),
  },
};

// ── Prometheus Metrics ──────────────────────────────────────

const register = getRegistry();
const METRICS_PREFIX = 'orgsledger_';

export const aiCostUtilization = new client.Gauge({
  name: `${METRICS_PREFIX}ai_cost_utilization`,
  help: 'AI cost utilization as a percentage of daily budget (0-1)',
  labelNames: ['service'] as const,
  registers: [register],
});

export const aiCostGuardBlocksTotal = new client.Counter({
  name: `${METRICS_PREFIX}ai_cost_guard_blocks_total`,
  help: 'Total number of requests blocked by AI cost guard',
  registers: [register],
});

export const aiCostGuardWarningsTotal = new client.Counter({
  name: `${METRICS_PREFIX}ai_cost_guard_warnings_total`,
  help: 'Total number of AI cost guard warnings issued',
  registers: [register],
});

export const aiCostProjectedDaily = new client.Gauge({
  name: `${METRICS_PREFIX}ai_cost_projected_daily_usd`,
  help: 'Projected daily AI cost in USD',
  registers: [register],
});

export const aiCostBudgetRemaining = new client.Gauge({
  name: `${METRICS_PREFIX}ai_cost_budget_remaining_usd`,
  help: 'Remaining AI budget for the day in USD',
  registers: [register],
});

// ── Cost Calculation Functions ──────────────────────────────

interface CostBreakdown {
  currentCostUSD: number;
  projectedCostUSD: number;
  budgetLimitUSD: number;
  utilizationPercent: number;
  remainingBudgetUSD: number;
  byService: {
    transcription: { current: number; projected: number };
    translation: { current: number; projected: number };
    minutesGeneration: { current: number; projected: number };
  };
}

/**
 * Calculate current and projected AI costs
 */
function calculateCostBreakdown(): CostBreakdown {
  const metrics = getAICostMetrics();
  const costs = metrics.costs;

  // Get pricing for projections
  const model = AI_PRICING.openai.defaultModel;
  const modelPricing = AI_PRICING.openai.models[model];

  // Calculate time-based projection factor
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const hoursElapsed = (now.getTime() - startOfDay.getTime()) / (1000 * 60 * 60);
  const projectionFactor = hoursElapsed > 0 ? 24 / hoursElapsed : 1;

  // Current costs
  const currentTranscriptionCost = costs.deepgramCostUSD;
  const currentTranslationCost = costs.translationCostUSD;
  const currentMinutesCost = costs.openaiInputCostUSD + costs.openaiOutputCostUSD;
  const currentTotalCost = costs.totalCostUSD;

  // Projected costs (based on current rate extrapolated to 24 hours)
  const projectedTranscriptionCost = Math.min(
    currentTranscriptionCost * projectionFactor,
    AI_COST_LIMITS.max_deepgram_minutes_per_day * AI_PRICING.deepgram.streaming_per_minute
  );
  const projectedTranslationCost = Math.min(
    currentTranslationCost * projectionFactor,
    AI_COST_LIMITS.max_translation_chars_per_day * AI_PRICING.translation.per_character
  );
  const projectedMinutesCost = Math.min(
    currentMinutesCost * projectionFactor,
    (AI_COST_LIMITS.max_openai_tokens_per_day / 1_000_000) * 
      (modelPricing.input_per_million_tokens + modelPricing.output_per_million_tokens) / 2
  );

  const projectedTotalCost = projectedTranscriptionCost + projectedTranslationCost + projectedMinutesCost;

  const budgetLimitUSD = AI_COST_LIMITS.daily_cost_limit_usd;
  const utilizationPercent = (currentTotalCost / budgetLimitUSD) * 100;
  const remainingBudgetUSD = Math.max(0, budgetLimitUSD - currentTotalCost);

  // Update Prometheus metrics
  aiCostUtilization.labels('transcription').set(
    currentTranscriptionCost / (budgetLimitUSD * 0.4) // Assume 40% budget for transcription
  );
  aiCostUtilization.labels('translation').set(
    currentTranslationCost / (budgetLimitUSD * 0.3) // Assume 30% budget for translation
  );
  aiCostUtilization.labels('minutes_generation').set(
    currentMinutesCost / (budgetLimitUSD * 0.3) // Assume 30% budget for minutes
  );
  aiCostUtilization.labels('total').set(currentTotalCost / budgetLimitUSD);

  aiCostProjectedDaily.set(projectedTotalCost);
  aiCostBudgetRemaining.set(remainingBudgetUSD);

  return {
    currentCostUSD: currentTotalCost,
    projectedCostUSD: projectedTotalCost,
    budgetLimitUSD,
    utilizationPercent,
    remainingBudgetUSD,
    byService: {
      transcription: {
        current: currentTranscriptionCost,
        projected: projectedTranscriptionCost,
      },
      translation: {
        current: currentTranslationCost,
        projected: projectedTranslationCost,
      },
      minutesGeneration: {
        current: currentMinutesCost,
        projected: projectedMinutesCost,
      },
    },
  };
}

/**
 * Estimate cost for a new meeting
 */
function estimateMeetingCost(): number {
  const model = AI_PRICING.openai.defaultModel;
  const modelPricing = AI_PRICING.openai.models[model];

  // Transcription cost
  const transcriptionCost = 
    config.estimatedCostPerMeeting.transcriptionMinutes * 
    AI_PRICING.deepgram.streaming_per_minute;

  // Translation cost
  const translationCost = 
    config.estimatedCostPerMeeting.translationCharacters * 
    AI_PRICING.translation.per_character;

  // Minutes generation cost (estimate 50/50 split input/output)
  const tokensForMinutes = config.estimatedCostPerMeeting.minutesGenerationTokens;
  const minutesCost = 
    (tokensForMinutes / 2 / 1_000_000) * modelPricing.input_per_million_tokens +
    (tokensForMinutes / 2 / 1_000_000) * modelPricing.output_per_million_tokens;

  return transcriptionCost + translationCost + minutesCost;
}

// ── Guard State ─────────────────────────────────────────────

interface CostGuardState {
  isBlocking: boolean;
  isWarning: boolean;
  lastCheck: number;
  costBreakdown: CostBreakdown | null;
}

const state: CostGuardState = {
  isBlocking: false,
  isWarning: false,
  lastCheck: 0,
  costBreakdown: null,
};

// Cache cost breakdown for 10 seconds to avoid excessive calculations
const CACHE_TTL_MS = 10_000;

/**
 * Get current cost state (with caching)
 */
function getCostState(): CostBreakdown {
  const now = Date.now();
  if (state.costBreakdown && now - state.lastCheck < CACHE_TTL_MS) {
    return state.costBreakdown;
  }

  const breakdown = calculateCostBreakdown();
  state.costBreakdown = breakdown;
  state.lastCheck = now;

  // Update blocking/warning state
  const utilization = breakdown.currentCostUSD / breakdown.budgetLimitUSD;
  state.isBlocking = utilization >= config.blockThreshold;
  state.isWarning = utilization >= config.warnThreshold && !state.isBlocking;

  return breakdown;
}

// ── Middleware ──────────────────────────────────────────────

/**
 * AI Cost Guard Middleware
 * 
 * Blocks requests when AI budget is exceeded.
 * Apply to meeting creation and other AI-intensive endpoints.
 * 
 * Usage:
 *   router.post('/meetings/create', aiCostGuard, meetingController.create);
 */
export function aiCostGuard(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip guard if disabled
  if (!config.enabled) {
    return next();
  }

  try {
    const costState = getCostState();
    const estimatedNewMeetingCost = estimateMeetingCost();
    const projectedAfterMeeting = costState.currentCostUSD + estimatedNewMeetingCost;

    // Check if adding this meeting would exceed budget
    if (projectedAfterMeeting > costState.budgetLimitUSD || state.isBlocking) {
      aiCostGuardBlocksTotal.inc();

      logger.warn('[COST_GUARD] Blocking meeting creation - budget exceeded', {
        currentCostUSD: costState.currentCostUSD.toFixed(4),
        estimatedNewMeetingCost: estimatedNewMeetingCost.toFixed(4),
        projectedAfterMeeting: projectedAfterMeeting.toFixed(4),
        budgetLimitUSD: costState.budgetLimitUSD.toFixed(2),
        utilizationPercent: costState.utilizationPercent.toFixed(1),
        path: req.path,
        method: req.method,
      });

      res.status(503).json({
        error: 'AI_BUDGET_EXCEEDED',
        message: 'System temporarily restricted',
      });
      return;
    }

    // Log warning if approaching limit
    if (state.isWarning) {
      aiCostGuardWarningsTotal.inc();

      logger.info('[COST_GUARD] Approaching budget limit', {
        currentCostUSD: costState.currentCostUSD.toFixed(4),
        budgetLimitUSD: costState.budgetLimitUSD.toFixed(2),
        utilizationPercent: costState.utilizationPercent.toFixed(1),
        remainingBudgetUSD: costState.remainingBudgetUSD.toFixed(4),
      });
    }

    next();
  } catch (err: any) {
    // Never block the request if there's an error in cost calculation
    logger.error('[COST_GUARD] Error calculating costs, allowing request', {
      error: err.message,
      path: req.path,
    });
    next();
  }
}

/**
 * Lenient AI Cost Guard
 * 
 * Logs warnings but doesn't block requests.
 * Use for non-critical AI endpoints.
 */
export function aiCostGuardLenient(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!config.enabled) {
    return next();
  }

  try {
    const costState = getCostState();

    if (state.isWarning || state.isBlocking) {
      const severity = state.isBlocking ? 'CRITICAL' : 'WARNING';
      
      logger.warn(`[COST_GUARD] ${severity} - budget ${state.isBlocking ? 'exceeded' : 'approaching limit'}`, {
        currentCostUSD: costState.currentCostUSD.toFixed(4),
        budgetLimitUSD: costState.budgetLimitUSD.toFixed(2),
        utilizationPercent: costState.utilizationPercent.toFixed(1),
        path: req.path,
        method: req.method,
      });
    }

    next();
  } catch (err: any) {
    logger.debug('[COST_GUARD] Error in lenient guard', { error: err.message });
    next();
  }
}

// ── Status API ──────────────────────────────────────────────

/**
 * Get current cost guard status
 * For use in system health endpoints
 */
export function getCostGuardStatus(): {
  enabled: boolean;
  isBlocking: boolean;
  isWarning: boolean;
  costBreakdown: CostBreakdown;
  config: {
    blockThreshold: number;
    warnThreshold: number;
    estimatedCostPerMeeting: number;
  };
} {
  const breakdown = getCostState();
  
  return {
    enabled: config.enabled,
    isBlocking: state.isBlocking,
    isWarning: state.isWarning,
    costBreakdown: breakdown,
    config: {
      blockThreshold: config.blockThreshold,
      warnThreshold: config.warnThreshold,
      estimatedCostPerMeeting: estimateMeetingCost(),
    },
  };
}

/**
 * Check if system is currently budget-constrained
 * Quick check without full breakdown
 */
export function isBudgetConstrained(): boolean {
  if (!config.enabled) return false;
  getCostState(); // Update state
  return state.isBlocking;
}

/**
 * Get remaining budget
 */
export function getRemainingBudget(): number {
  const breakdown = getCostState();
  return breakdown.remainingBudgetUSD;
}

// ── Default Export ──────────────────────────────────────────

export default {
  aiCostGuard,
  aiCostGuardLenient,
  getCostGuardStatus,
  isBudgetConstrained,
  getRemainingBudget,
};
