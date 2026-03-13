"use strict";
// ============================================================
// OrgsLedger API — AI Circuit Breaker Service
// Protects against slow/failing AI providers
// ============================================================
//
// Protects:
//   - OpenAI (minutes generation, AI summaries)
//   - Deepgram (live transcription)
//
// Tracking:
//   - Request latency (rolling window)
//   - Error rate (rolling window)
//
// Rules:
//   - Open circuit if error rate > 20% over last 50 requests
//   - Open circuit if avg latency > 3 seconds
//   - Stay open for 60 seconds, then half-open
//
// States:
//   CLOSED   → Normal operation
//   OPEN     → Reject immediately, return fallback
//   HALF_OPEN → Allow 1 test request
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
exports.aiCircuitBreakerService = exports.CircuitOpenError = exports.aiCircuitBreakerAvgLatencyGauge = exports.aiCircuitBreakerErrorRateGauge = exports.aiCircuitBreakerLatencyHistogram = exports.aiCircuitBreakerFallbackCounter = exports.aiCircuitBreakerRejectsCounter = exports.aiCircuitBreakerSuccessesCounter = exports.aiCircuitBreakerFailuresCounter = exports.aiCircuitBreakerStateGauge = void 0;
exports.executeOpenAI = executeOpenAI;
exports.executeDeepgram = executeDeepgram;
exports.isOpenAIAvailable = isOpenAIAvailable;
exports.isDeepgramAvailable = isDeepgramAvailable;
exports.getAICircuitBreakerStats = getAICircuitBreakerStats;
exports.getAllAICircuitBreakerStats = getAllAICircuitBreakerStats;
exports.getAICircuitBreakerState = getAICircuitBreakerState;
exports.forceAICircuitBreakerState = forceAICircuitBreakerState;
exports.resetAICircuitBreaker = resetAICircuitBreaker;
exports.resetAllAICircuitBreakers = resetAllAICircuitBreakers;
exports.onAICircuitBreakerStateChange = onAICircuitBreakerStateChange;
const client = __importStar(require("prom-client"));
const events_1 = require("events");
const logger_1 = require("../logger");
const DEFAULT_CONFIG = {
    windowSize: parseInt(process.env.AI_CIRCUIT_WINDOW_SIZE || '50', 10),
    errorRateThreshold: parseFloat(process.env.AI_CIRCUIT_ERROR_THRESHOLD || '0.20'),
    latencyThresholdMs: parseInt(process.env.AI_CIRCUIT_LATENCY_THRESHOLD_MS || '3000', 10),
    openDurationMs: parseInt(process.env.AI_CIRCUIT_OPEN_DURATION_MS || '60000', 10),
    halfOpenSuccessThreshold: parseInt(process.env.AI_CIRCUIT_HALF_OPEN_SUCCESS || '3', 10),
};
// ── Prometheus Metrics ──────────────────────────────────────
const PREFIX = 'orgsledger_ai_circuit_breaker_';
exports.aiCircuitBreakerStateGauge = new client.Gauge({
    name: `${PREFIX}state`,
    help: 'Circuit breaker state (0=CLOSED, 1=OPEN, 2=HALF_OPEN)',
    labelNames: ['provider'],
});
exports.aiCircuitBreakerFailuresCounter = new client.Counter({
    name: `${PREFIX}failures_total`,
    help: 'Total failures recorded by circuit breaker',
    labelNames: ['provider'],
});
exports.aiCircuitBreakerSuccessesCounter = new client.Counter({
    name: `${PREFIX}successes_total`,
    help: 'Total successes recorded by circuit breaker',
    labelNames: ['provider'],
});
exports.aiCircuitBreakerRejectsCounter = new client.Counter({
    name: `${PREFIX}rejects_total`,
    help: 'Requests rejected while circuit is open',
    labelNames: ['provider'],
});
exports.aiCircuitBreakerFallbackCounter = new client.Counter({
    name: `${PREFIX}fallback_total`,
    help: 'Fallback responses returned',
    labelNames: ['provider'],
});
exports.aiCircuitBreakerLatencyHistogram = new client.Histogram({
    name: `${PREFIX}latency_seconds`,
    help: 'Request latency through circuit breaker',
    labelNames: ['provider', 'success'],
    buckets: [0.1, 0.5, 1, 2, 3, 5, 10, 30],
});
exports.aiCircuitBreakerErrorRateGauge = new client.Gauge({
    name: `${PREFIX}error_rate`,
    help: 'Current error rate (0-1)',
    labelNames: ['provider'],
});
exports.aiCircuitBreakerAvgLatencyGauge = new client.Gauge({
    name: `${PREFIX}avg_latency_ms`,
    help: 'Current average latency in ms',
    labelNames: ['provider'],
});
// ── Errors ──────────────────────────────────────────────────
class CircuitOpenError extends Error {
    provider;
    retryAfterMs;
    constructor(provider, retryAfterMs) {
        super(`Circuit breaker OPEN for ${provider}`);
        this.provider = provider;
        this.retryAfterMs = retryAfterMs;
        this.name = 'CircuitOpenError';
    }
}
exports.CircuitOpenError = CircuitOpenError;
// ── Provider Circuit Breaker ────────────────────────────────
class ProviderCircuitBreaker extends events_1.EventEmitter {
    provider;
    config;
    state = 'CLOSED';
    records = [];
    halfOpenSuccesses = 0;
    openedAt;
    lastSuccess;
    lastError;
    resetTimer;
    constructor(provider, config) {
        super();
        this.provider = provider;
        this.config = config;
        exports.aiCircuitBreakerStateGauge.set({ provider }, 0); // CLOSED
    }
    /**
     * Execute a function through the circuit breaker.
     */
    async execute(fn, fallback) {
        // Check if circuit is open
        if (this.state === 'OPEN') {
            const retryAfter = this.openedAt
                ? this.config.openDurationMs - (Date.now() - this.openedAt.getTime())
                : this.config.openDurationMs;
            exports.aiCircuitBreakerRejectsCounter.inc({ provider: this.provider });
            if (fallback) {
                exports.aiCircuitBreakerFallbackCounter.inc({ provider: this.provider });
                logger_1.logger.info(`[AI_CIRCUIT] ${this.provider}: Returning fallback (circuit OPEN)`);
                return fallback();
            }
            throw new CircuitOpenError(this.provider, Math.max(0, retryAfter));
        }
        // Half-open: only allow one test request at a time
        if (this.state === 'HALF_OPEN') {
            // Allow the test request through
            logger_1.logger.info(`[AI_CIRCUIT] ${this.provider}: Allowing test request (HALF_OPEN)`);
        }
        const startTime = Date.now();
        let success = false;
        let error;
        try {
            const result = await fn();
            success = true;
            this.lastSuccess = new Date();
            return result;
        }
        catch (err) {
            error = err instanceof Error ? err : new Error(String(err));
            this.lastError = error.message;
            throw err;
        }
        finally {
            const latencyMs = Date.now() - startTime;
            this.recordRequest(latencyMs, success, error?.message);
        }
    }
    /**
     * Record a request result.
     */
    recordRequest(latencyMs, success, errorMsg) {
        const record = {
            timestamp: Date.now(),
            latencyMs,
            success,
            error: errorMsg,
        };
        this.records.push(record);
        // Trim to window size
        while (this.records.length > this.config.windowSize) {
            this.records.shift();
        }
        // Update Prometheus metrics
        exports.aiCircuitBreakerLatencyHistogram.observe({ provider: this.provider, success: success ? 'true' : 'false' }, latencyMs / 1000);
        if (success) {
            exports.aiCircuitBreakerSuccessesCounter.inc({ provider: this.provider });
        }
        else {
            exports.aiCircuitBreakerFailuresCounter.inc({ provider: this.provider });
        }
        // Update state based on new record
        this.evaluateState(success);
    }
    /**
     * Evaluate whether to change state.
     */
    evaluateState(lastSuccess) {
        const { errorRate, avgLatency } = this.calculateMetrics();
        // Update metric gauges
        exports.aiCircuitBreakerErrorRateGauge.set({ provider: this.provider }, errorRate);
        exports.aiCircuitBreakerAvgLatencyGauge.set({ provider: this.provider }, avgLatency);
        switch (this.state) {
            case 'CLOSED':
                // Check if we should open
                if (this.records.length >= 10) { // Need minimum requests before opening
                    if (errorRate > this.config.errorRateThreshold) {
                        this.transitionTo('OPEN', `error_rate_${(errorRate * 100).toFixed(1)}%`);
                    }
                    else if (avgLatency > this.config.latencyThresholdMs) {
                        this.transitionTo('OPEN', `avg_latency_${avgLatency.toFixed(0)}ms`);
                    }
                }
                break;
            case 'HALF_OPEN':
                if (lastSuccess) {
                    this.halfOpenSuccesses++;
                    if (this.halfOpenSuccesses >= this.config.halfOpenSuccessThreshold) {
                        this.transitionTo('CLOSED', 'recovery_confirmed');
                    }
                }
                else {
                    // Any failure in half-open reopens the circuit
                    this.transitionTo('OPEN', 'half_open_failure');
                }
                break;
            case 'OPEN':
                // Should not receive requests in OPEN state
                break;
        }
    }
    /**
     * Calculate error rate and average latency.
     */
    calculateMetrics() {
        if (this.records.length === 0) {
            return { errorRate: 0, avgLatency: 0 };
        }
        const errorCount = this.records.filter(r => !r.success).length;
        const errorRate = errorCount / this.records.length;
        const totalLatency = this.records.reduce((sum, r) => sum + r.latencyMs, 0);
        const avgLatency = totalLatency / this.records.length;
        return { errorRate, avgLatency };
    }
    /**
     * Transition to a new state.
     */
    transitionTo(newState, reason) {
        const previousState = this.state;
        this.state = newState;
        logger_1.logger.warn(`[AI_CIRCUIT] ${this.provider}: ${previousState} → ${newState}`, {
            reason,
            errorRate: this.calculateMetrics().errorRate,
            avgLatency: this.calculateMetrics().avgLatency,
        });
        // Update metric
        const stateValue = newState === 'CLOSED' ? 0 : newState === 'OPEN' ? 1 : 2;
        exports.aiCircuitBreakerStateGauge.set({ provider: this.provider }, stateValue);
        // Clear reset timer
        if (this.resetTimer) {
            clearTimeout(this.resetTimer);
            this.resetTimer = undefined;
        }
        switch (newState) {
            case 'OPEN':
                this.openedAt = new Date();
                this.halfOpenSuccesses = 0;
                // Schedule transition to half-open
                this.resetTimer = setTimeout(() => {
                    this.transitionTo('HALF_OPEN', 'timeout_expired');
                }, this.config.openDurationMs);
                this.resetTimer.unref();
                break;
            case 'HALF_OPEN':
                this.halfOpenSuccesses = 0;
                break;
            case 'CLOSED':
                this.records = []; // Clear history on close
                this.openedAt = undefined;
                break;
        }
        // Emit event
        this.emit('state_change', {
            type: 'state_change',
            provider: this.provider,
            previousState,
            newState,
            reason,
            timestamp: new Date(),
        });
    }
    /**
     * Get current stats.
     */
    getStats() {
        const { errorRate, avgLatency } = this.calculateMetrics();
        return {
            provider: this.provider,
            state: this.state,
            requestCount: this.records.length,
            errorCount: this.records.filter(r => !r.success).length,
            errorRate,
            avgLatencyMs: avgLatency,
            lastError: this.lastError,
            lastSuccess: this.lastSuccess,
            openedAt: this.openedAt,
            halfOpenSuccesses: this.halfOpenSuccesses,
        };
    }
    /**
     * Get current state.
     */
    getState() {
        return this.state;
    }
    /**
     * Force state (for testing/admin).
     */
    forceState(state) {
        this.transitionTo(state, 'forced');
    }
    /**
     * Reset the circuit breaker.
     */
    reset() {
        this.records = [];
        this.halfOpenSuccesses = 0;
        this.openedAt = undefined;
        this.lastError = undefined;
        if (this.resetTimer) {
            clearTimeout(this.resetTimer);
            this.resetTimer = undefined;
        }
        this.transitionTo('CLOSED', 'manual_reset');
    }
}
// ── AI Circuit Breaker Service ──────────────────────────────
class AICircuitBreakerService extends events_1.EventEmitter {
    breakers = new Map();
    config;
    constructor(config = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        // Initialize breakers for each provider
        for (const provider of ['openai', 'deepgram']) {
            const breaker = new ProviderCircuitBreaker(provider, this.config);
            // Forward events
            breaker.on('state_change', (event) => {
                this.emit('state_change', event);
            });
            this.breakers.set(provider, breaker);
        }
        logger_1.logger.info('[AI_CIRCUIT] Service initialized', {
            providers: Array.from(this.breakers.keys()),
            config: this.config,
        });
    }
    /**
     * Execute a function through the specified provider's circuit breaker.
     */
    async execute(provider, fn, fallback) {
        const breaker = this.breakers.get(provider);
        if (!breaker) {
            throw new Error(`Unknown AI provider: ${provider}`);
        }
        return breaker.execute(fn, fallback);
    }
    /**
     * Get stats for a provider.
     */
    getStats(provider) {
        return this.breakers.get(provider)?.getStats() || null;
    }
    /**
     * Get stats for all providers.
     */
    getAllStats() {
        return Array.from(this.breakers.values()).map(b => b.getStats());
    }
    /**
     * Get state for a provider.
     */
    getState(provider) {
        return this.breakers.get(provider)?.getState() || null;
    }
    /**
     * Check if a provider is available (not OPEN).
     */
    isAvailable(provider) {
        const state = this.getState(provider);
        return state !== 'OPEN';
    }
    /**
     * Force a provider's state.
     */
    forceState(provider, state) {
        this.breakers.get(provider)?.forceState(state);
    }
    /**
     * Reset a provider's circuit breaker.
     */
    reset(provider) {
        this.breakers.get(provider)?.reset();
    }
    /**
     * Reset all circuit breakers.
     */
    resetAll() {
        for (const breaker of this.breakers.values()) {
            breaker.reset();
        }
    }
}
// ── Singleton ───────────────────────────────────────────────
exports.aiCircuitBreakerService = new AICircuitBreakerService();
// ── Convenient Wrappers ─────────────────────────────────────
/**
 * Execute an OpenAI request through the circuit breaker.
 */
async function executeOpenAI(fn, fallback) {
    return exports.aiCircuitBreakerService.execute('openai', fn, fallback);
}
/**
 * Execute a Deepgram request through the circuit breaker.
 */
async function executeDeepgram(fn, fallback) {
    return exports.aiCircuitBreakerService.execute('deepgram', fn, fallback);
}
/**
 * Check if OpenAI is available.
 */
function isOpenAIAvailable() {
    return exports.aiCircuitBreakerService.isAvailable('openai');
}
/**
 * Check if Deepgram is available.
 */
function isDeepgramAvailable() {
    return exports.aiCircuitBreakerService.isAvailable('deepgram');
}
// ── Exports ─────────────────────────────────────────────────
function getAICircuitBreakerStats(provider) {
    return exports.aiCircuitBreakerService.getStats(provider);
}
function getAllAICircuitBreakerStats() {
    return exports.aiCircuitBreakerService.getAllStats();
}
function getAICircuitBreakerState(provider) {
    return exports.aiCircuitBreakerService.getState(provider);
}
function forceAICircuitBreakerState(provider, state) {
    exports.aiCircuitBreakerService.forceState(provider, state);
}
function resetAICircuitBreaker(provider) {
    exports.aiCircuitBreakerService.reset(provider);
}
function resetAllAICircuitBreakers() {
    exports.aiCircuitBreakerService.resetAll();
}
function onAICircuitBreakerStateChange(callback) {
    exports.aiCircuitBreakerService.on('state_change', callback);
    return () => exports.aiCircuitBreakerService.off('state_change', callback);
}
//# sourceMappingURL=ai-circuit-breaker.js.map