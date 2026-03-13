"use strict";
// ============================================================
// OrgsLedger API — Queue Backpressure Protection
// Prevents system collapse under extreme load
// ============================================================
//
// Architecture:
//   - Check queue depth before accepting new jobs
//   - Reject jobs if queue exceeds threshold
//   - Return SYSTEM_OVERLOADED error with retry hint
//   - Emit Prometheus metrics for alerting
//
// Thresholds:
//   - transcript-events: 10,000 max waiting
//   - translation-jobs: 20,000 max waiting
//   - broadcast-events: 5,000 max waiting
//   - minutes-generation: 5,000 max waiting
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
exports.backpressureManager = exports.backpressureDegradationGauge = exports.backpressureThrottledGauge = exports.backpressureAllowedGauge = exports.backpressureUtilizationGauge = exports.backpressureTriggeredCounter = exports.BackpressureError = void 0;
exports.checkTranscriptBackpressure = checkTranscriptBackpressure;
exports.checkTranslationBackpressure = checkTranslationBackpressure;
exports.checkBroadcastBackpressure = checkBroadcastBackpressure;
exports.checkMinutesBackpressure = checkMinutesBackpressure;
exports.assertTranscriptCanAccept = assertTranscriptCanAccept;
exports.assertTranslationCanAccept = assertTranslationCanAccept;
exports.assertBroadcastCanAccept = assertBroadcastCanAccept;
exports.assertMinutesCanAccept = assertMinutesCanAccept;
exports.getAllBackpressureStatus = getAllBackpressureStatus;
exports.checkBackpressure = checkBackpressure;
exports.assertCanAccept = assertCanAccept;
exports.shouldThrottle = shouldThrottle;
exports.shouldThrottleAll = shouldThrottleAll;
exports.isAnyBackpressureActive = isAnyBackpressureActive;
exports.withBackpressure = withBackpressure;
exports.BackpressureGuard = BackpressureGuard;
exports.backpressureMiddleware = backpressureMiddleware;
exports.isBackpressureError = isBackpressureError;
exports.formatBackpressureError = formatBackpressureError;
exports.submitTranscriptWithBackpressure = submitTranscriptWithBackpressure;
exports.submitTranslationWithBackpressure = submitTranslationWithBackpressure;
exports.submitBroadcastWithBackpressure = submitBroadcastWithBackpressure;
exports.submitMinutesWithBackpressure = submitMinutesWithBackpressure;
const events_1 = require("events");
const client = __importStar(require("prom-client"));
const logger_1 = require("../logger");
const queue_manager_1 = require("../queues/queue-manager");
function envInt(key, fallback) {
    const v = process.env[key];
    if (v === undefined || v === '')
        return fallback;
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? fallback : n;
}
const BACKPRESSURE_CONFIG = {
    [queue_manager_1.SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS]: {
        queueType: queue_manager_1.SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS,
        maxWaiting: envInt('BP_TRANSCRIPT_MAX_WAITING', 10000),
        throttleWaiting: envInt('BP_TRANSCRIPT_THROTTLE_WAITING', 6000),
        maxActive: envInt('BP_TRANSCRIPT_MAX_ACTIVE', 5000),
        retryAfterSeconds: envInt('BP_TRANSCRIPT_RETRY_AFTER', 10),
    },
    [queue_manager_1.SHARDED_QUEUE_TYPES.TRANSLATION_JOBS]: {
        queueType: queue_manager_1.SHARDED_QUEUE_TYPES.TRANSLATION_JOBS,
        maxWaiting: envInt('BP_TRANSLATION_MAX_WAITING', 20000),
        throttleWaiting: envInt('BP_TRANSLATION_THROTTLE_WAITING', 12000),
        maxActive: envInt('BP_TRANSLATION_MAX_ACTIVE', 10000),
        retryAfterSeconds: envInt('BP_TRANSLATION_RETRY_AFTER', 15),
    },
    [queue_manager_1.SHARDED_QUEUE_TYPES.BROADCAST_EVENTS]: {
        queueType: queue_manager_1.SHARDED_QUEUE_TYPES.BROADCAST_EVENTS,
        maxWaiting: envInt('BP_BROADCAST_MAX_WAITING', 5000),
        throttleWaiting: envInt('BP_BROADCAST_THROTTLE_WAITING', 3000),
        maxActive: envInt('BP_BROADCAST_MAX_ACTIVE', 2000),
        retryAfterSeconds: envInt('BP_BROADCAST_RETRY_AFTER', 5),
    },
    [queue_manager_1.SHARDED_QUEUE_TYPES.MINUTES_GENERATION]: {
        queueType: queue_manager_1.SHARDED_QUEUE_TYPES.MINUTES_GENERATION,
        maxWaiting: envInt('BP_MINUTES_MAX_WAITING', 5000),
        throttleWaiting: envInt('BP_MINUTES_THROTTLE_WAITING', 3000),
        maxActive: envInt('BP_MINUTES_MAX_ACTIVE', 1000),
        retryAfterSeconds: envInt('BP_MINUTES_RETRY_AFTER', 30),
    },
};
// Cache durations
const CACHE_TTL_MS = 1000; // Cache queue stats for 1 second to reduce Redis calls
class BackpressureError extends Error {
    code = 'SYSTEM_OVERLOADED';
    retryAfter;
    queueType;
    currentLoad;
    maxLoad;
    constructor(result) {
        super(`System overloaded: ${result.queueType} queue at ${result.utilizationPercent.toFixed(1)}% capacity`);
        this.name = 'BackpressureError';
        this.retryAfter = BACKPRESSURE_CONFIG[result.queueType].retryAfterSeconds;
        this.queueType = result.queueType;
        this.currentLoad = result.currentWaiting;
        this.maxLoad = result.maxWaiting;
    }
    toJSON() {
        return {
            error: 'SYSTEM_OVERLOADED',
            message: this.message,
            retryAfter: this.retryAfter,
            queueType: this.queueType,
            currentLoad: this.currentLoad,
            maxLoad: this.maxLoad,
        };
    }
}
exports.BackpressureError = BackpressureError;
// ── Prometheus Metrics ──────────────────────────────────────
const register = client.register;
exports.backpressureTriggeredCounter = new client.Counter({
    name: 'orgsledger_queue_backpressure_triggered',
    help: 'Number of times backpressure was triggered (jobs rejected)',
    labelNames: ['queue'],
    registers: [register],
});
exports.backpressureUtilizationGauge = new client.Gauge({
    name: 'orgsledger_queue_backpressure_utilization',
    help: 'Queue utilization percentage (waiting / max)',
    labelNames: ['queue'],
    registers: [register],
});
exports.backpressureAllowedGauge = new client.Gauge({
    name: 'orgsledger_queue_backpressure_allowed',
    help: 'Whether queue is accepting new jobs (1 = yes, 0 = no)',
    labelNames: ['queue'],
    registers: [register],
});
exports.backpressureThrottledGauge = new client.Gauge({
    name: 'orgsledger_queue_backpressure_throttled',
    help: 'Whether queue is in throttle mode (1 = throttled, 0 = normal)',
    labelNames: ['queue'],
    registers: [register],
});
exports.backpressureDegradationGauge = new client.Gauge({
    name: 'orgsledger_queue_backpressure_degradation_active',
    help: 'Active degradation actions (1 = active, 0 = inactive)',
    labelNames: ['queue', 'action'],
    registers: [register],
});
// ── Backpressure Manager Class ──────────────────────────────
class BackpressureManager extends events_1.EventEmitter {
    // Cache for queue stats to reduce Redis calls
    statsCache = new Map();
    // Track consecutive overload states for hysteresis
    overloadState = new Map();
    // Track throttle state for alert dedup
    throttleState = new Map();
    constructor() {
        super();
        // Initialize all queues as not overloaded
        for (const queueType of Object.values(queue_manager_1.SHARDED_QUEUE_TYPES)) {
            this.overloadState.set(queueType, false);
            this.throttleState.set(queueType, 'ALLOW');
        }
    }
    // ── Three-Tier shouldThrottle ──────────────────────────────
    /**
     * Evaluate queue pressure and return a 3-tier decision:
     *   ALLOW    — queue healthy, process normally
     *   THROTTLE — queue under pressure, apply degradation actions
     *   REJECT   — queue overloaded, refuse new work
     */
    async shouldThrottle(queueType) {
        const config = BACKPRESSURE_CONFIG[queueType];
        if (!config) {
            return {
                decision: 'ALLOW',
                queueType,
                currentWaiting: 0,
                currentActive: 0,
                utilizationPercent: 0,
                degradationActions: [],
            };
        }
        try {
            const { waiting, active } = await this.getQueueStats(queueType);
            const utilizationPercent = (waiting / config.maxWaiting) * 100;
            let decision;
            const degradationActions = [];
            const wasOverloaded = this.overloadState.get(queueType) || false;
            const recoveryThreshold = config.maxWaiting * 0.8;
            const throttleRecovery = config.throttleWaiting * 0.8;
            const prevDecision = this.throttleState.get(queueType) || 'ALLOW';
            // ── REJECT tier ──
            if (wasOverloaded
                ? (waiting >= recoveryThreshold || active >= config.maxActive)
                : (waiting >= config.maxWaiting || active >= config.maxActive)) {
                decision = 'REJECT';
                this.overloadState.set(queueType, true);
            }
            // ── THROTTLE tier ──
            else if (prevDecision === 'THROTTLE'
                ? (waiting >= throttleRecovery)
                : (waiting >= config.throttleWaiting)) {
                decision = 'THROTTLE';
                this.overloadState.set(queueType, false);
                // Graduated degradation actions based on utilization
                degradationActions.push('SLOW_INGESTION');
                degradationActions.push('DROP_LOW_PRIORITY');
                if (utilizationPercent >= 70) {
                    degradationActions.push('REDUCE_TRANSLATION_LANGUAGES');
                }
                if (utilizationPercent >= 80) {
                    degradationActions.push('DISABLE_MINUTES_GENERATION');
                }
            }
            // ── ALLOW tier ──
            else {
                decision = 'ALLOW';
                this.overloadState.set(queueType, false);
            }
            // Update Prometheus
            exports.backpressureUtilizationGauge.labels(queueType).set(utilizationPercent);
            exports.backpressureAllowedGauge.labels(queueType).set(decision === 'REJECT' ? 0 : 1);
            exports.backpressureThrottledGauge.labels(queueType).set(decision === 'THROTTLE' ? 1 : 0);
            for (const action of ['SLOW_INGESTION', 'DROP_LOW_PRIORITY', 'REDUCE_TRANSLATION_LANGUAGES', 'DISABLE_MINUTES_GENERATION']) {
                exports.backpressureDegradationGauge.labels(queueType, action).set(degradationActions.includes(action) ? 1 : 0);
            }
            if (decision === 'REJECT') {
                exports.backpressureTriggeredCounter.labels(queueType).inc();
            }
            // Emit alerts on state transitions
            if (decision !== prevDecision) {
                this.throttleState.set(queueType, decision);
                if (decision === 'THROTTLE') {
                    const alert = {
                        type: 'BACKPRESSURE_THROTTLE',
                        queueType,
                        waiting,
                        active,
                        utilizationPercent,
                        degradationActions,
                        timestamp: new Date().toISOString(),
                    };
                    this.emit('throttle', alert);
                    logger_1.logger.warn('[BACKPRESSURE] Throttle activated', alert);
                }
                else if (decision === 'REJECT') {
                    const alert = {
                        type: 'BACKPRESSURE_REJECT',
                        queueType,
                        waiting,
                        active,
                        utilizationPercent,
                        timestamp: new Date().toISOString(),
                    };
                    this.emit('reject', alert);
                    logger_1.logger.error('[BACKPRESSURE] Reject activated — queue overloaded', alert);
                }
                else {
                    const alert = {
                        type: 'BACKPRESSURE_RECOVERED',
                        queueType,
                        waiting,
                        active,
                        utilizationPercent,
                        timestamp: new Date().toISOString(),
                    };
                    this.emit('recovered', alert);
                    logger_1.logger.info('[BACKPRESSURE] Recovered to ALLOW', alert);
                }
            }
            const result = {
                decision,
                queueType,
                currentWaiting: waiting,
                currentActive: active,
                utilizationPercent,
                degradationActions,
            };
            if (decision === 'REJECT') {
                result.retryAfter = config.retryAfterSeconds;
            }
            return result;
        }
        catch (err) {
            // Fail-open
            logger_1.logger.error('[BACKPRESSURE] shouldThrottle check failed', { queueType, error: err });
            return {
                decision: 'ALLOW',
                queueType,
                currentWaiting: 0,
                currentActive: 0,
                utilizationPercent: 0,
                degradationActions: [],
            };
        }
    }
    /**
     * Check if a queue can accept new jobs
     * Returns true if allowed, false if backpressure should be applied
     */
    async checkBackpressure(queueType) {
        const config = BACKPRESSURE_CONFIG[queueType];
        if (!config) {
            logger_1.logger.warn('[BACKPRESSURE] Unknown queue type', { queueType });
            return {
                allowed: true,
                queueType,
                currentWaiting: 0,
                currentActive: 0,
                maxWaiting: 10000,
                maxActive: 5000,
                utilizationPercent: 0,
            };
        }
        try {
            // Get cached or fresh stats
            const { waiting, active } = await this.getQueueStats(queueType);
            // Calculate utilization
            const utilizationPercent = (waiting / config.maxWaiting) * 100;
            // Update Prometheus gauges
            exports.backpressureUtilizationGauge.labels(queueType).set(utilizationPercent);
            // Check if overloaded (with hysteresis to prevent flapping)
            const isOverloaded = this.checkOverloadWithHysteresis(queueType, waiting, active, config);
            const allowed = !isOverloaded;
            // Update allowed gauge
            exports.backpressureAllowedGauge.labels(queueType).set(allowed ? 1 : 0);
            const result = {
                allowed,
                queueType,
                currentWaiting: waiting,
                currentActive: active,
                maxWaiting: config.maxWaiting,
                maxActive: config.maxActive,
                utilizationPercent,
            };
            if (!allowed) {
                result.retryAfter = config.retryAfterSeconds;
                // Increment counter
                exports.backpressureTriggeredCounter.labels(queueType).inc();
                logger_1.logger.warn('[BACKPRESSURE] Queue overloaded, rejecting job', {
                    queueType,
                    waiting,
                    active,
                    maxWaiting: config.maxWaiting,
                    utilizationPercent: utilizationPercent.toFixed(1),
                });
            }
            return result;
        }
        catch (err) {
            // On error, allow the job (fail-open for availability)
            logger_1.logger.error('[BACKPRESSURE] Failed to check queue stats', { queueType, error: err });
            return {
                allowed: true,
                queueType,
                currentWaiting: 0,
                currentActive: 0,
                maxWaiting: config.maxWaiting,
                maxActive: config.maxActive,
                utilizationPercent: 0,
            };
        }
    }
    /**
     * Check with hysteresis to prevent flapping
     * Once overloaded, stay overloaded until 80% of threshold
     */
    checkOverloadWithHysteresis(queueType, waiting, active, config) {
        const wasOverloaded = this.overloadState.get(queueType) || false;
        // Recovery threshold (80% of max)
        const recoveryThreshold = config.maxWaiting * 0.8;
        let isOverloaded;
        if (wasOverloaded) {
            // If previously overloaded, only recover when below 80%
            isOverloaded = waiting >= recoveryThreshold || active >= config.maxActive;
        }
        else {
            // If not overloaded, trigger at 100%
            isOverloaded = waiting >= config.maxWaiting || active >= config.maxActive;
        }
        // Update state
        this.overloadState.set(queueType, isOverloaded);
        return isOverloaded;
    }
    /**
     * Get queue stats with caching
     */
    async getQueueStats(queueType) {
        const now = Date.now();
        const cached = this.statsCache.get(queueType);
        // Return cached if fresh
        if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
            return { waiting: cached.waiting, active: cached.active };
        }
        // Fetch fresh stats
        const stats = await (0, queue_manager_1.getShardStats)(queueType);
        const result = {
            waiting: stats.totals.waiting,
            active: stats.totals.active,
        };
        // Update cache
        this.statsCache.set(queueType, {
            ...result,
            timestamp: now,
        });
        return result;
    }
    /**
     * Assert that a queue can accept new jobs
     * Throws BackpressureError if overloaded
     */
    async assertCanAccept(queueType) {
        const result = await this.checkBackpressure(queueType);
        if (!result.allowed) {
            throw new BackpressureError(result);
        }
    }
    /**
     * Get current backpressure status for all queues
     */
    async getAllBackpressureStatus() {
        const results = {};
        // Check all queues in parallel
        const checks = await Promise.all(Object.values(queue_manager_1.SHARDED_QUEUE_TYPES).map(async (queueType) => ({
            queueType,
            result: await this.checkBackpressure(queueType),
        })));
        for (const { queueType, result } of checks) {
            results[queueType] = result;
        }
        return results;
    }
    /**
     * Update thresholds at runtime (for dynamic scaling)
     */
    updateThreshold(queueType, updates) {
        const current = BACKPRESSURE_CONFIG[queueType];
        if (current) {
            Object.assign(current, updates);
            logger_1.logger.info('[BACKPRESSURE] Threshold updated', { queueType, updates });
        }
    }
    /**
     * Clear cache (for testing)
     */
    clearCache() {
        this.statsCache.clear();
    }
    /**
     * Get current thresholds
     */
    getThresholds() {
        return { ...BACKPRESSURE_CONFIG };
    }
    /**
     * Get the current throttle state for all queues without querying Redis.
     */
    getThrottleStates() {
        const result = {};
        for (const qt of Object.values(queue_manager_1.SHARDED_QUEUE_TYPES)) {
            result[qt] = this.throttleState.get(qt) || 'ALLOW';
        }
        return result;
    }
}
// ── Singleton Instance ──────────────────────────────────────
const backpressureManager = new BackpressureManager();
exports.backpressureManager = backpressureManager;
/**
 * Check if transcript queue can accept new jobs
 */
async function checkTranscriptBackpressure() {
    return backpressureManager.checkBackpressure(queue_manager_1.SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS);
}
/**
 * Check if translation queue can accept new jobs
 */
async function checkTranslationBackpressure() {
    return backpressureManager.checkBackpressure(queue_manager_1.SHARDED_QUEUE_TYPES.TRANSLATION_JOBS);
}
/**
 * Check if broadcast queue can accept new jobs
 */
async function checkBroadcastBackpressure() {
    return backpressureManager.checkBackpressure(queue_manager_1.SHARDED_QUEUE_TYPES.BROADCAST_EVENTS);
}
/**
 * Check if minutes queue can accept new jobs
 */
async function checkMinutesBackpressure() {
    return backpressureManager.checkBackpressure(queue_manager_1.SHARDED_QUEUE_TYPES.MINUTES_GENERATION);
}
/**
 * Assert transcript queue can accept new jobs (throws on overload)
 */
async function assertTranscriptCanAccept() {
    return backpressureManager.assertCanAccept(queue_manager_1.SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS);
}
/**
 * Assert translation queue can accept new jobs (throws on overload)
 */
async function assertTranslationCanAccept() {
    return backpressureManager.assertCanAccept(queue_manager_1.SHARDED_QUEUE_TYPES.TRANSLATION_JOBS);
}
/**
 * Assert broadcast queue can accept new jobs (throws on overload)
 */
async function assertBroadcastCanAccept() {
    return backpressureManager.assertCanAccept(queue_manager_1.SHARDED_QUEUE_TYPES.BROADCAST_EVENTS);
}
/**
 * Assert minutes queue can accept new jobs (throws on overload)
 */
async function assertMinutesCanAccept() {
    return backpressureManager.assertCanAccept(queue_manager_1.SHARDED_QUEUE_TYPES.MINUTES_GENERATION);
}
/**
 * Get backpressure status for all queues
 */
async function getAllBackpressureStatus() {
    return backpressureManager.getAllBackpressureStatus();
}
/**
 * Check backpressure for a specific queue type
 */
async function checkBackpressure(queueType) {
    return backpressureManager.checkBackpressure(queueType);
}
/**
 * Assert queue can accept new jobs (throws BackpressureError on overload)
 */
async function assertCanAccept(queueType) {
    return backpressureManager.assertCanAccept(queueType);
}
// ── Three-Tier shouldThrottle API ───────────────────────────
/**
 * Evaluate queue pressure and return ALLOW | THROTTLE | REJECT.
 *
 * ALLOW    — queue healthy, process normally.
 * THROTTLE — queue under pressure. Caller should apply the returned
 *            `degradationActions` (slow ingestion, drop low-priority
 *            tasks, reduce translation languages, disable minutes).
 * REJECT   — queue overloaded, refuse the work entirely.
 */
async function shouldThrottle(queueType) {
    return backpressureManager.shouldThrottle(queueType);
}
/**
 * Evaluate all queues at once.
 */
async function shouldThrottleAll() {
    const results = {};
    const checks = await Promise.all(Object.values(queue_manager_1.SHARDED_QUEUE_TYPES).map(async (qt) => ({
        qt,
        result: await backpressureManager.shouldThrottle(qt),
    })));
    for (const { qt, result } of checks) {
        results[qt] = result;
    }
    return results;
}
/**
 * Quick check: is any queue currently throttled or rejected?
 */
function isAnyBackpressureActive() {
    const states = backpressureManager.getThrottleStates();
    return Object.values(states).some(s => s !== 'ALLOW');
}
// ── Higher-Order Function for Service Methods ──────────────
/**
 * Wrap a function to check backpressure before execution
 * Throws BackpressureError if queue is overloaded
 */
function withBackpressure(queueType, fn) {
    return (async (...args) => {
        await backpressureManager.assertCanAccept(queueType);
        return fn(...args);
    });
}
/**
 * Decorator-style backpressure check for class methods
 */
function BackpressureGuard(queueType) {
    return function (_target, _propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = async function (...args) {
            await backpressureManager.assertCanAccept(queueType);
            return originalMethod.apply(this, args);
        };
        return descriptor;
    };
}
/**
 * Express middleware to check backpressure before processing request
 */
function backpressureMiddleware(queueType) {
    return async (req, res, next) => {
        try {
            const result = await backpressureManager.checkBackpressure(queueType);
            if (!result.allowed) {
                const error = new BackpressureError(result);
                res.setHeader('Retry-After', error.retryAfter.toString());
                return res.status(503).json(error.toJSON());
            }
            next();
        }
        catch (err) {
            // Fail-open: don't block on backpressure check failure
            logger_1.logger.error('[BACKPRESSURE_MIDDLEWARE] Check failed', { error: err });
            next();
        }
    };
}
// ── Utility Functions ───────────────────────────────────────
/**
 * Check if an error is a BackpressureError
 */
function isBackpressureError(err) {
    return err instanceof BackpressureError ||
        (err instanceof Error && err.code === 'SYSTEM_OVERLOADED');
}
/**
 * Format error for API response
 */
function formatBackpressureError(err) {
    return err.toJSON();
}
// ── Backpressure-Protected Submit Functions ─────────────────
const queue_manager_2 = require("../queues/queue-manager");
/**
 * Submit a transcript event with backpressure protection
 * Throws BackpressureError if queue is overloaded
 */
async function submitTranscriptWithBackpressure(data, options) {
    await backpressureManager.assertCanAccept(queue_manager_1.SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS);
    return (0, queue_manager_2.submitTranscript)(data, options);
}
/**
 * Submit a translation job with backpressure protection
 * Throws BackpressureError if queue is overloaded
 */
async function submitTranslationWithBackpressure(data, options) {
    await backpressureManager.assertCanAccept(queue_manager_1.SHARDED_QUEUE_TYPES.TRANSLATION_JOBS);
    return (0, queue_manager_2.submitTranslation)(data, options);
}
/**
 * Submit a broadcast event with backpressure protection
 * Throws BackpressureError if queue is overloaded
 */
async function submitBroadcastWithBackpressure(data) {
    await backpressureManager.assertCanAccept(queue_manager_1.SHARDED_QUEUE_TYPES.BROADCAST_EVENTS);
    return (0, queue_manager_2.submitBroadcast)(data);
}
/**
 * Submit a minutes generation job with backpressure protection
 * Throws BackpressureError if queue is overloaded
 */
async function submitMinutesWithBackpressure(data, options) {
    await backpressureManager.assertCanAccept(queue_manager_1.SHARDED_QUEUE_TYPES.MINUTES_GENERATION);
    return (0, queue_manager_2.submitMinutes)(data, options);
}
//# sourceMappingURL=backpressure.js.map