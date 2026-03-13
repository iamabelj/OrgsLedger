"use strict";
// ============================================================
// OrgsLedger API — AI Rate Limit Guard
// Production-grade rate limiting for AI services
// ============================================================
//
// Features:
//   - Sliding window counters in Redis
//   - Warning at 80% utilization
//   - Backpressure at 95% utilization
//   - Graceful degradation strategies
//   - Prometheus metrics export
//
// Tracked Services:
//   - Deepgram (transcription)
//   - OpenAI (minutes generation)
//   - Google Translate (translations)
//
// Redis Keys:
//   - ai:rate:deepgram:{minute} — Deepgram requests per minute
//   - ai:rate:openai:{minute} — OpenAI requests per minute
//   - ai:rate:translate:{minute} — Translate requests per minute
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiRateLimitGuard = exports.aiRateLimitDegradedGauge = exports.aiRateLimitBackpressureCounter = exports.aiRateLimitWarningCounter = exports.aiRateLimitUtilizationGauge = void 0;
exports.initializeAIRateLimit = initializeAIRateLimit;
exports.checkDeepgramRateLimit = checkDeepgramRateLimit;
exports.checkOpenAIRateLimit = checkOpenAIRateLimit;
exports.checkTranslationRateLimit = checkTranslationRateLimit;
exports.isDeepgramRateLimited = isDeepgramRateLimited;
exports.isOpenAIRateLimited = isOpenAIRateLimited;
exports.isTranslationRateLimited = isTranslationRateLimited;
exports.getAIDegradationStrategy = getAIDegradationStrategy;
exports.getAIRateLimitMetrics = getAIRateLimitMetrics;
exports.isAnyAIBackpressureActive = isAnyAIBackpressureActive;
exports.onAIRateLimitEvent = onAIRateLimitEvent;
exports.shutdownAIRateLimit = shutdownAIRateLimit;
exports.guardDeepgramRequest = guardDeepgramRequest;
exports.guardOpenAIRequest = guardOpenAIRequest;
exports.guardTranslationRequest = guardTranslationRequest;
const client = __importStar(require("prom-client"));
const events_1 = require("events");
const ioredis_1 = __importDefault(require("ioredis"));
const logger_1 = require("../logger");
// ── Configuration ───────────────────────────────────────────
/**
 * Rate limit thresholds per minute
 * These represent the max requests/units we can sustain before hitting provider limits
 */
const AI_RATE_LIMITS = {
    deepgram: {
        // Deepgram concurrent streams / requests per minute
        requestsPerMinute: parseInt(process.env.DEEPGRAM_RATE_LIMIT_RPM || '200', 10),
        // Audio minutes processed per minute (for sliding window)
        minutesPerMinute: parseInt(process.env.DEEPGRAM_RATE_LIMIT_MPM || '1000', 10),
    },
    openai: {
        // OpenAI requests per minute (varies by tier)
        requestsPerMinute: parseInt(process.env.OPENAI_RATE_LIMIT_RPM || '500', 10),
        // Tokens per minute (varies by tier)
        tokensPerMinute: parseInt(process.env.OPENAI_RATE_LIMIT_TPM || '200000', 10),
    },
    translate: {
        // Translation API requests per minute
        requestsPerMinute: parseInt(process.env.TRANSLATE_RATE_LIMIT_RPM || '1000', 10),
        // Characters per minute
        charactersPerMinute: parseInt(process.env.TRANSLATE_RATE_LIMIT_CPM || '1000000', 10),
    },
};
// Threshold percentages
const THRESHOLDS = {
    warning: 0.80, // 80% - emit warning
    critical: 0.95, // 95% - activate backpressure
};
// Sliding window size (minutes)
const WINDOW_SIZE_MINUTES = 1;
const KEY_TTL_SECONDS = 120; // Keep keys for 2 minutes for sliding window
// Redis key prefixes
const REDIS_PREFIX = 'ai:rate';
// ── Prometheus Metrics ──────────────────────────────────────
const register = client.register;
exports.aiRateLimitUtilizationGauge = new client.Gauge({
    name: 'orgsledger_ai_rate_limit_utilization',
    help: 'AI service rate limit utilization percentage (0-100)',
    labelNames: ['service', 'metric'],
    registers: [register],
});
exports.aiRateLimitWarningCounter = new client.Counter({
    name: 'orgsledger_ai_rate_limit_warning',
    help: 'Number of times AI rate limit warning (80%) was triggered',
    labelNames: ['service'],
    registers: [register],
});
exports.aiRateLimitBackpressureCounter = new client.Counter({
    name: 'orgsledger_ai_rate_limit_backpressure',
    help: 'Number of times AI rate limit backpressure (95%) was activated',
    labelNames: ['service'],
    registers: [register],
});
exports.aiRateLimitDegradedGauge = new client.Gauge({
    name: 'orgsledger_ai_rate_limit_degraded',
    help: 'Whether service is in degraded mode (1=degraded, 0=normal)',
    labelNames: ['service'],
    registers: [register],
});
// ── AI Rate Limit Guard Class ───────────────────────────────
class AIRateLimitGuard extends events_1.EventEmitter {
    redis = null;
    isInitialized = false;
    // Track backpressure state per service
    backpressureState = new Map([
        ['deepgram', false],
        ['openai', false],
        ['translate', false],
    ]);
    // Track degradation strategies
    activeDegradations = new Map();
    // Hysteresis counters to prevent flapping
    warningCount = new Map();
    criticalCount = new Map();
    HYSTERESIS_THRESHOLD = 3; // 3 consecutive violations before triggering
    constructor() {
        super();
        this.initializeCounters();
    }
    initializeCounters() {
        const services = ['deepgram', 'openai', 'translate'];
        for (const service of services) {
            this.warningCount.set(service, 0);
            this.criticalCount.set(service, 0);
        }
    }
    /**
     * Initialize Redis connection
     */
    async initialize() {
        if (this.isInitialized)
            return;
        try {
            const host = process.env.REDIS_HOST || 'localhost';
            const port = parseInt(process.env.REDIS_PORT || '6379', 10);
            const password = process.env.REDIS_PASSWORD;
            this.redis = new ioredis_1.default({
                host,
                port,
                password,
                db: parseInt(process.env.REDIS_DB || '0', 10),
                lazyConnect: false,
                retryStrategy: (times) => {
                    const delay = Math.min(1000 * Math.pow(2, times - 1), 30000);
                    return delay;
                },
            });
            this.redis.on('ready', () => {
                logger_1.logger.info('[AI_RATE_LIMIT] Redis connected');
                this.isInitialized = true;
            });
            this.redis.on('error', (err) => {
                logger_1.logger.error('[AI_RATE_LIMIT] Redis error', { error: err.message });
            });
            // Wait for connection
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Redis connection timeout'));
                }, 10000);
                this.redis.once('ready', () => {
                    clearTimeout(timeout);
                    resolve();
                });
                this.redis.once('error', (err) => {
                    clearTimeout(timeout);
                    reject(err);
                });
            });
            this.isInitialized = true;
            logger_1.logger.info('[AI_RATE_LIMIT] Initialized');
        }
        catch (err) {
            logger_1.logger.error('[AI_RATE_LIMIT] Failed to initialize', { error: err.message });
            // Don't throw - fail-open for availability
            this.isInitialized = true;
        }
    }
    /**
     * Get Redis key for a service
     */
    getRedisKey(service, metric) {
        const minute = Math.floor(Date.now() / 60000);
        return `${REDIS_PREFIX}:${service}:${metric}:${minute}`;
    }
    /**
     * Record usage for a service
     */
    async recordUsage(service, metric, amount = 1) {
        if (!this.redis) {
            // Fail-open: return normal status
            return this.createDefaultStatus(service);
        }
        try {
            const key = this.getRedisKey(service, metric);
            // Increment and set TTL atomically using MULTI
            const pipeline = this.redis.multi();
            pipeline.incrby(key, amount);
            pipeline.expire(key, KEY_TTL_SECONDS);
            const results = await pipeline.exec();
            // Get the new value
            const currentUsage = results?.[0]?.[1] || 0;
            // Calculate limit based on service and metric
            const limit = this.getLimit(service, metric);
            // Calculate utilization
            const status = this.calculateStatus(service, currentUsage, limit);
            // Update Prometheus metrics
            exports.aiRateLimitUtilizationGauge
                .labels(service, metric)
                .set(status.utilizationPercent);
            // Handle warning state
            if (status.isWarning && !status.isCritical) {
                this.handleWarning(service, status);
            }
            // Handle critical state (backpressure)
            if (status.isCritical) {
                this.handleCritical(service, status);
            }
            else if (this.backpressureState.get(service)) {
                // Check if we can recover from backpressure
                this.checkRecovery(service, status);
            }
            return status;
        }
        catch (err) {
            logger_1.logger.error('[AI_RATE_LIMIT] Failed to record usage', {
                service,
                metric,
                error: err.message
            });
            // Fail-open
            return this.createDefaultStatus(service);
        }
    }
    /**
     * Check rate limit status without recording usage
     */
    async checkStatus(service, metric = 'requests') {
        if (!this.redis) {
            return this.createDefaultStatus(service);
        }
        try {
            const key = this.getRedisKey(service, metric);
            const currentUsage = parseInt(await this.redis.get(key) || '0', 10);
            const limit = this.getLimit(service, metric);
            return this.calculateStatus(service, currentUsage, limit);
        }
        catch (err) {
            logger_1.logger.error('[AI_RATE_LIMIT] Failed to check status', {
                service,
                error: err.message
            });
            return this.createDefaultStatus(service);
        }
    }
    /**
     * Check if a request should be allowed
     */
    async checkAndRecord(service, metric = 'requests', amount = 1) {
        // First check current status
        const status = await this.checkStatus(service, metric);
        // If backpressure active, apply degradation strategy
        if (status.backpressureActive) {
            const degradation = this.getDegradationStrategy(service);
            return {
                allowed: false,
                status,
                degradation,
            };
        }
        // Record the usage
        const newStatus = await this.recordUsage(service, metric, amount);
        // Check if we just hit backpressure
        if (newStatus.backpressureActive) {
            const degradation = this.getDegradationStrategy(service);
            return {
                allowed: false,
                status: newStatus,
                degradation,
            };
        }
        return {
            allowed: true,
            status: newStatus,
        };
    }
    /**
     * Get current rate limit for a metric
     */
    getLimit(service, metric) {
        switch (service) {
            case 'deepgram':
                if (metric === 'minutes')
                    return AI_RATE_LIMITS.deepgram.minutesPerMinute;
                return AI_RATE_LIMITS.deepgram.requestsPerMinute;
            case 'openai':
                if (metric === 'tokens')
                    return AI_RATE_LIMITS.openai.tokensPerMinute;
                return AI_RATE_LIMITS.openai.requestsPerMinute;
            case 'translate':
                if (metric === 'characters')
                    return AI_RATE_LIMITS.translate.charactersPerMinute;
                return AI_RATE_LIMITS.translate.requestsPerMinute;
            default:
                return 1000;
        }
    }
    /**
     * Calculate rate limit status
     */
    calculateStatus(service, currentUsage, limit) {
        const utilizationPercent = (currentUsage / limit) * 100;
        const isWarning = utilizationPercent >= THRESHOLDS.warning * 100;
        const isCritical = utilizationPercent >= THRESHOLDS.critical * 100;
        const backpressureActive = this.backpressureState.get(service) || false;
        return {
            service,
            utilizationPercent,
            currentUsage,
            limit,
            isWarning,
            isCritical,
            backpressureActive,
            retryAfterSeconds: backpressureActive ? this.calculateRetryAfter(utilizationPercent) : undefined,
        };
    }
    /**
     * Calculate when to retry based on utilization
     */
    calculateRetryAfter(utilization) {
        // Higher utilization = longer wait
        if (utilization >= 100)
            return 60; // Wait full minute
        if (utilization >= 95)
            return 30;
        if (utilization >= 90)
            return 15;
        return 10;
    }
    /**
     * Create default status for fail-open scenarios
     */
    createDefaultStatus(service) {
        return {
            service,
            utilizationPercent: 0,
            currentUsage: 0,
            limit: this.getLimit(service, 'requests'),
            isWarning: false,
            isCritical: false,
            backpressureActive: false,
        };
    }
    /**
     * Handle warning state (80% utilization)
     */
    handleWarning(service, status) {
        const count = (this.warningCount.get(service) || 0) + 1;
        this.warningCount.set(service, count);
        if (count >= this.HYSTERESIS_THRESHOLD) {
            // Emit warning metric
            exports.aiRateLimitWarningCounter.labels(service).inc();
            logger_1.logger.warn('[AI_RATE_LIMIT] Warning threshold reached', {
                service,
                utilizationPercent: status.utilizationPercent.toFixed(1),
                currentUsage: status.currentUsage,
                limit: status.limit,
            });
            this.emit('warning', { service, status });
        }
    }
    /**
     * Handle critical state (95% utilization)
     */
    handleCritical(service, status) {
        const count = (this.criticalCount.get(service) || 0) + 1;
        this.criticalCount.set(service, count);
        if (count >= this.HYSTERESIS_THRESHOLD && !this.backpressureState.get(service)) {
            // Activate backpressure
            this.backpressureState.set(service, true);
            // Set up degradation strategy
            const strategy = this.createDegradationStrategy(service);
            this.activeDegradations.set(service, strategy);
            // Update metrics
            exports.aiRateLimitBackpressureCounter.labels(service).inc();
            exports.aiRateLimitDegradedGauge.labels(service).set(1);
            logger_1.logger.error('[AI_RATE_LIMIT] Backpressure activated', {
                service,
                utilizationPercent: status.utilizationPercent.toFixed(1),
                strategy: strategy.action,
            });
            this.emit('backpressure', { service, status, strategy });
        }
    }
    /**
     * Check if we can recover from backpressure
     */
    checkRecovery(service, status) {
        // Recover at 70% utilization (below warning threshold)
        if (status.utilizationPercent < THRESHOLDS.warning * 100 * 0.875) {
            this.backpressureState.set(service, false);
            this.activeDegradations.delete(service);
            this.criticalCount.set(service, 0);
            this.warningCount.set(service, 0);
            exports.aiRateLimitDegradedGauge.labels(service).set(0);
            logger_1.logger.info('[AI_RATE_LIMIT] Recovered from backpressure', {
                service,
                utilizationPercent: status.utilizationPercent.toFixed(1),
            });
            this.emit('recovered', { service, status });
        }
    }
    /**
     * Create degradation strategy for a service
     */
    createDegradationStrategy(service) {
        switch (service) {
            case 'deepgram':
                return {
                    service: 'deepgram',
                    action: 'reduce_frequency',
                    skipPercent: 50, // Skip 50% of interim transcripts
                    reason: 'Deepgram rate limit approaching - reducing transcription frequency',
                };
            case 'openai':
                return {
                    service: 'openai',
                    action: 'queue',
                    delayMs: 30000, // Delay 30 seconds
                    reason: 'OpenAI rate limit approaching - queueing minutes generation',
                };
            case 'translate':
                return {
                    service: 'translate',
                    action: 'skip',
                    reason: 'Translation rate limit approaching - temporarily disabling translation',
                };
            default:
                return {
                    service,
                    action: 'skip',
                    reason: 'Rate limit reached',
                };
        }
    }
    /**
     * Get degradation strategy for a service
     */
    getDegradationStrategy(service) {
        return this.activeDegradations.get(service);
    }
    /**
     * Check if any service has backpressure active
     */
    isAnyBackpressureActive() {
        for (const active of this.backpressureState.values()) {
            if (active)
                return true;
        }
        return false;
    }
    /**
     * Check if a specific service has backpressure active
     */
    isBackpressureActive(service) {
        return this.backpressureState.get(service) || false;
    }
    /**
     * Get all rate limit metrics
     */
    async getAllMetrics() {
        const [deepgram, openai, translate] = await Promise.all([
            this.checkStatus('deepgram', 'requests'),
            this.checkStatus('openai', 'requests'),
            this.checkStatus('translate', 'requests'),
        ]);
        return {
            deepgram,
            openai,
            translate,
            anyBackpressureActive: this.isAnyBackpressureActive(),
            degradationStrategies: Array.from(this.activeDegradations.values()),
        };
    }
    /**
     * Manually reset backpressure for a service (for admin use)
     */
    resetBackpressure(service) {
        this.backpressureState.set(service, false);
        this.activeDegradations.delete(service);
        this.criticalCount.set(service, 0);
        this.warningCount.set(service, 0);
        exports.aiRateLimitDegradedGauge.labels(service).set(0);
        logger_1.logger.info('[AI_RATE_LIMIT] Backpressure manually reset', { service });
        this.emit('reset', { service });
    }
    /**
     * Update rate limits at runtime
     */
    updateRateLimits(service, limits) {
        if (service === 'deepgram') {
            if (limits.requestsPerMinute)
                AI_RATE_LIMITS.deepgram.requestsPerMinute = limits.requestsPerMinute;
            if (limits.minutesPerMinute)
                AI_RATE_LIMITS.deepgram.minutesPerMinute = limits.minutesPerMinute;
        }
        else if (service === 'openai') {
            if (limits.requestsPerMinute)
                AI_RATE_LIMITS.openai.requestsPerMinute = limits.requestsPerMinute;
            if (limits.tokensPerMinute)
                AI_RATE_LIMITS.openai.tokensPerMinute = limits.tokensPerMinute;
        }
        else if (service === 'translate') {
            if (limits.requestsPerMinute)
                AI_RATE_LIMITS.translate.requestsPerMinute = limits.requestsPerMinute;
            if (limits.charactersPerMinute)
                AI_RATE_LIMITS.translate.charactersPerMinute = limits.charactersPerMinute;
        }
        logger_1.logger.info('[AI_RATE_LIMIT] Rate limits updated', { service, limits });
    }
    /**
     * Get current rate limits
     */
    getRateLimits() {
        return { ...AI_RATE_LIMITS };
    }
    /**
     * Shutdown
     */
    async shutdown() {
        if (this.redis) {
            await this.redis.quit();
            this.redis = null;
        }
        this.isInitialized = false;
        logger_1.logger.info('[AI_RATE_LIMIT] Shutdown complete');
    }
}
// ── Singleton Instance ──────────────────────────────────────
const aiRateLimitGuard = new AIRateLimitGuard();
exports.aiRateLimitGuard = aiRateLimitGuard;
/**
 * Initialize the rate limit guard
 */
async function initializeAIRateLimit() {
    return aiRateLimitGuard.initialize();
}
/**
 * Record Deepgram usage and check rate limit
 */
async function checkDeepgramRateLimit(audioMinutes = 0) {
    // Record both requests and audio minutes
    if (audioMinutes > 0) {
        await aiRateLimitGuard.recordUsage('deepgram', 'minutes', Math.ceil(audioMinutes));
    }
    return aiRateLimitGuard.checkAndRecord('deepgram', 'requests', 1);
}
/**
 * Record OpenAI usage and check rate limit
 */
async function checkOpenAIRateLimit(tokens = 0) {
    if (tokens > 0) {
        await aiRateLimitGuard.recordUsage('openai', 'tokens', tokens);
    }
    return aiRateLimitGuard.checkAndRecord('openai', 'requests', 1);
}
/**
 * Record translation usage and check rate limit
 */
async function checkTranslationRateLimit(characters = 0) {
    if (characters > 0) {
        await aiRateLimitGuard.recordUsage('translate', 'characters', characters);
    }
    return aiRateLimitGuard.checkAndRecord('translate', 'requests', 1);
}
/**
 * Check if Deepgram is rate limited (without recording)
 */
async function isDeepgramRateLimited() {
    const status = await aiRateLimitGuard.checkStatus('deepgram', 'requests');
    return status.backpressureActive;
}
/**
 * Check if OpenAI is rate limited (without recording)
 */
async function isOpenAIRateLimited() {
    const status = await aiRateLimitGuard.checkStatus('openai', 'requests');
    return status.backpressureActive;
}
/**
 * Check if Translation is rate limited (without recording)
 */
async function isTranslationRateLimited() {
    const status = await aiRateLimitGuard.checkStatus('translate', 'requests');
    return status.backpressureActive;
}
/**
 * Get degradation strategy for a service
 */
function getAIDegradationStrategy(service) {
    return aiRateLimitGuard.getDegradationStrategy(service);
}
/**
 * Get all rate limit metrics
 */
async function getAIRateLimitMetrics() {
    return aiRateLimitGuard.getAllMetrics();
}
/**
 * Check if any AI service has backpressure active
 */
function isAnyAIBackpressureActive() {
    return aiRateLimitGuard.isAnyBackpressureActive();
}
/**
 * Subscribe to rate limit events
 */
function onAIRateLimitEvent(event, listener) {
    aiRateLimitGuard.on(event, listener);
}
/**
 * Shutdown rate limit guard
 */
async function shutdownAIRateLimit() {
    return aiRateLimitGuard.shutdown();
}
// ── Service Integration Helpers ─────────────────────────────
/**
 * Guard for Deepgram transcription requests
 * Returns true if request should proceed, false if should be skipped/degraded
 */
async function guardDeepgramRequest(isFinal = true) {
    const result = await checkDeepgramRateLimit();
    if (!result.allowed) {
        const degradation = result.degradation;
        // For interim transcripts with reduce_frequency strategy
        if (!isFinal && degradation?.action === 'reduce_frequency') {
            const skipPercent = degradation.skipPercent || 50;
            // Skip based on percentage
            if (Math.random() * 100 < skipPercent) {
                return {
                    proceed: false,
                    skipReason: `Rate limited: skipping ${skipPercent}% of interim transcripts`,
                };
            }
        }
        // For final transcripts, we try to proceed anyway but log
        if (isFinal) {
            logger_1.logger.warn('[AI_RATE_LIMIT] Deepgram rate limited but proceeding with final transcript', {
                utilization: result.status.utilizationPercent.toFixed(1),
            });
            return { proceed: true };
        }
        return {
            proceed: false,
            skipReason: degradation?.reason || 'Rate limit exceeded',
        };
    }
    return { proceed: true };
}
/**
 * Guard for OpenAI requests (minutes generation)
 * Returns delay in ms if should be delayed, 0 if should proceed immediately
 */
async function guardOpenAIRequest(estimatedTokens = 1000) {
    const result = await checkOpenAIRateLimit(estimatedTokens);
    if (!result.allowed) {
        const degradation = result.degradation;
        if (degradation?.action === 'queue' && degradation.delayMs) {
            return {
                proceed: false,
                delayMs: degradation.delayMs,
                skipReason: degradation.reason,
            };
        }
        return {
            proceed: false,
            delayMs: result.status.retryAfterSeconds ? result.status.retryAfterSeconds * 1000 : 30000,
            skipReason: degradation?.reason || 'Rate limit exceeded',
        };
    }
    return { proceed: true, delayMs: 0 };
}
/**
 * Guard for translation requests
 * Returns true if should proceed, false if translation should be skipped
 */
async function guardTranslationRequest(characterCount) {
    const result = await checkTranslationRateLimit(characterCount);
    if (!result.allowed) {
        const degradation = result.degradation;
        return {
            proceed: false,
            skipReason: degradation?.reason || 'Translation temporarily disabled due to rate limiting',
        };
    }
    return { proceed: true };
}
//# sourceMappingURL=ai-rate-limit.guard.js.map