"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiCostBudgetRemaining = exports.aiCostProjectedDaily = exports.aiCostGuardWarningsTotal = exports.aiCostGuardBlocksTotal = exports.aiCostUtilization = void 0;
exports.aiCostGuard = aiCostGuard;
exports.aiCostGuardLenient = aiCostGuardLenient;
exports.getCostGuardStatus = getCostGuardStatus;
exports.isBudgetConstrained = isBudgetConstrained;
exports.getRemainingBudget = getRemainingBudget;
const client = __importStar(require("prom-client"));
const logger_1 = require("../logger");
const prometheus_metrics_1 = require("../monitoring/prometheus.metrics");
const ai_cost_monitor_1 = require("../monitoring/ai-cost.monitor");
const ai_pricing_1 = require("../config/ai-pricing");
const DEFAULT_CONFIG = {
    enabled: true,
    blockThreshold: 1.0, // Block at 100% of budget
    warnThreshold: 0.8, // Warn at 80% of budget
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
const config = {
    enabled: process.env.AI_COST_GUARD_ENABLED !== 'false',
    blockThreshold: parseFloat(process.env.AI_COST_GUARD_BLOCK_THRESHOLD || '1.0'),
    warnThreshold: parseFloat(process.env.AI_COST_GUARD_WARN_THRESHOLD || '0.8'),
    estimatedCostPerMeeting: {
        transcriptionMinutes: parseFloat(process.env.AI_COST_GUARD_EST_TRANSCRIPT_MIN ||
            String(DEFAULT_CONFIG.estimatedCostPerMeeting.transcriptionMinutes)),
        translationCharacters: parseFloat(process.env.AI_COST_GUARD_EST_TRANSLATE_CHARS ||
            String(DEFAULT_CONFIG.estimatedCostPerMeeting.translationCharacters)),
        minutesGenerationTokens: parseFloat(process.env.AI_COST_GUARD_EST_MINUTES_TOKENS ||
            String(DEFAULT_CONFIG.estimatedCostPerMeeting.minutesGenerationTokens)),
    },
};
// ── Prometheus Metrics ──────────────────────────────────────
const register = (0, prometheus_metrics_1.getRegistry)();
const METRICS_PREFIX = 'orgsledger_';
exports.aiCostUtilization = new client.Gauge({
    name: `${METRICS_PREFIX}ai_cost_utilization`,
    help: 'AI cost utilization as a percentage of daily budget (0-1)',
    labelNames: ['service'],
    registers: [register],
});
exports.aiCostGuardBlocksTotal = new client.Counter({
    name: `${METRICS_PREFIX}ai_cost_guard_blocks_total`,
    help: 'Total number of requests blocked by AI cost guard',
    registers: [register],
});
exports.aiCostGuardWarningsTotal = new client.Counter({
    name: `${METRICS_PREFIX}ai_cost_guard_warnings_total`,
    help: 'Total number of AI cost guard warnings issued',
    registers: [register],
});
exports.aiCostProjectedDaily = new client.Gauge({
    name: `${METRICS_PREFIX}ai_cost_projected_daily_usd`,
    help: 'Projected daily AI cost in USD',
    registers: [register],
});
exports.aiCostBudgetRemaining = new client.Gauge({
    name: `${METRICS_PREFIX}ai_cost_budget_remaining_usd`,
    help: 'Remaining AI budget for the day in USD',
    registers: [register],
});
/**
 * Calculate current and projected AI costs
 */
function calculateCostBreakdown() {
    const metrics = (0, ai_cost_monitor_1.getAICostMetrics)();
    const costs = metrics.costs;
    // Get pricing for projections
    const model = ai_pricing_1.AI_PRICING.openai.defaultModel;
    const modelPricing = ai_pricing_1.AI_PRICING.openai.models[model];
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
    const projectedTranscriptionCost = Math.min(currentTranscriptionCost * projectionFactor, ai_pricing_1.AI_COST_LIMITS.max_deepgram_minutes_per_day * ai_pricing_1.AI_PRICING.deepgram.streaming_per_minute);
    const projectedTranslationCost = Math.min(currentTranslationCost * projectionFactor, ai_pricing_1.AI_COST_LIMITS.max_translation_chars_per_day * ai_pricing_1.AI_PRICING.translation.per_character);
    const projectedMinutesCost = Math.min(currentMinutesCost * projectionFactor, (ai_pricing_1.AI_COST_LIMITS.max_openai_tokens_per_day / 1_000_000) *
        (modelPricing.input_per_million_tokens + modelPricing.output_per_million_tokens) / 2);
    const projectedTotalCost = projectedTranscriptionCost + projectedTranslationCost + projectedMinutesCost;
    const budgetLimitUSD = ai_pricing_1.AI_COST_LIMITS.daily_cost_limit_usd;
    const utilizationPercent = (currentTotalCost / budgetLimitUSD) * 100;
    const remainingBudgetUSD = Math.max(0, budgetLimitUSD - currentTotalCost);
    // Update Prometheus metrics
    exports.aiCostUtilization.labels('transcription').set(currentTranscriptionCost / (budgetLimitUSD * 0.4) // Assume 40% budget for transcription
    );
    exports.aiCostUtilization.labels('translation').set(currentTranslationCost / (budgetLimitUSD * 0.3) // Assume 30% budget for translation
    );
    exports.aiCostUtilization.labels('minutes_generation').set(currentMinutesCost / (budgetLimitUSD * 0.3) // Assume 30% budget for minutes
    );
    exports.aiCostUtilization.labels('total').set(currentTotalCost / budgetLimitUSD);
    exports.aiCostProjectedDaily.set(projectedTotalCost);
    exports.aiCostBudgetRemaining.set(remainingBudgetUSD);
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
function estimateMeetingCost() {
    const model = ai_pricing_1.AI_PRICING.openai.defaultModel;
    const modelPricing = ai_pricing_1.AI_PRICING.openai.models[model];
    // Transcription cost
    const transcriptionCost = config.estimatedCostPerMeeting.transcriptionMinutes *
        ai_pricing_1.AI_PRICING.deepgram.streaming_per_minute;
    // Translation cost
    const translationCost = config.estimatedCostPerMeeting.translationCharacters *
        ai_pricing_1.AI_PRICING.translation.per_character;
    // Minutes generation cost (estimate 50/50 split input/output)
    const tokensForMinutes = config.estimatedCostPerMeeting.minutesGenerationTokens;
    const minutesCost = (tokensForMinutes / 2 / 1_000_000) * modelPricing.input_per_million_tokens +
        (tokensForMinutes / 2 / 1_000_000) * modelPricing.output_per_million_tokens;
    return transcriptionCost + translationCost + minutesCost;
}
const state = {
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
function getCostState() {
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
function aiCostGuard(req, res, next) {
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
            exports.aiCostGuardBlocksTotal.inc();
            logger_1.logger.warn('[COST_GUARD] Blocking meeting creation - budget exceeded', {
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
            exports.aiCostGuardWarningsTotal.inc();
            logger_1.logger.info('[COST_GUARD] Approaching budget limit', {
                currentCostUSD: costState.currentCostUSD.toFixed(4),
                budgetLimitUSD: costState.budgetLimitUSD.toFixed(2),
                utilizationPercent: costState.utilizationPercent.toFixed(1),
                remainingBudgetUSD: costState.remainingBudgetUSD.toFixed(4),
            });
        }
        next();
    }
    catch (err) {
        // Never block the request if there's an error in cost calculation
        logger_1.logger.error('[COST_GUARD] Error calculating costs, allowing request', {
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
function aiCostGuardLenient(req, res, next) {
    if (!config.enabled) {
        return next();
    }
    try {
        const costState = getCostState();
        if (state.isWarning || state.isBlocking) {
            const severity = state.isBlocking ? 'CRITICAL' : 'WARNING';
            logger_1.logger.warn(`[COST_GUARD] ${severity} - budget ${state.isBlocking ? 'exceeded' : 'approaching limit'}`, {
                currentCostUSD: costState.currentCostUSD.toFixed(4),
                budgetLimitUSD: costState.budgetLimitUSD.toFixed(2),
                utilizationPercent: costState.utilizationPercent.toFixed(1),
                path: req.path,
                method: req.method,
            });
        }
        next();
    }
    catch (err) {
        logger_1.logger.debug('[COST_GUARD] Error in lenient guard', { error: err.message });
        next();
    }
}
// ── Status API ──────────────────────────────────────────────
/**
 * Get current cost guard status
 * For use in system health endpoints
 */
function getCostGuardStatus() {
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
function isBudgetConstrained() {
    if (!config.enabled)
        return false;
    getCostState(); // Update state
    return state.isBlocking;
}
/**
 * Get remaining budget
 */
function getRemainingBudget() {
    const breakdown = getCostState();
    return breakdown.remainingBudgetUSD;
}
// ── Default Export ──────────────────────────────────────────
exports.default = {
    aiCostGuard,
    aiCostGuardLenient,
    getCostGuardStatus,
    isBudgetConstrained,
    getRemainingBudget,
};
//# sourceMappingURL=cost-guard.middleware.js.map