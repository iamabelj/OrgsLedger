"use strict";
// ============================================================
// OrgsLedger API — AI Circuit Breaker
// Protects against slow/failing AI providers (OpenAI, Deepgram, etc.)
// ============================================================
//
// Circuit Breaker States:
//   CLOSED  → Normal operation, tracking failures
//   OPEN    → Reject immediately, return fallback
//   HALF_OPEN → Test if service recovered
//
// Services Protected:
//   - openai (minutes generation, AI summaries)
//   - deepgram (live transcription)
//   - translation (Google/DeepL)
//
// Configuration per service:
//   - Failure threshold to open circuit
//   - Timeout per request
//   - Reset timeout before half-open
//   - Success threshold to close circuit
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
exports.aiCircuitBreaker = exports.CircuitTimeoutError = exports.CircuitOpenError = exports.circuitLatencyHistogram = exports.circuitTimeoutsCounter = exports.circuitFallbackCounter = exports.circuitRejectedCounter = exports.circuitSuccessesCounter = exports.circuitFailuresCounter = exports.circuitStateGauge = void 0;
exports.withOpenAICircuitBreaker = withOpenAICircuitBreaker;
exports.withDeepgramCircuitBreaker = withDeepgramCircuitBreaker;
exports.withTranslationCircuitBreaker = withTranslationCircuitBreaker;
exports.getCircuitBreakerStats = getCircuitBreakerStats;
exports.getAllCircuitBreakerStats = getAllCircuitBreakerStats;
exports.isServiceAvailable = isServiceAvailable;
exports.forceCircuitState = forceCircuitState;
exports.resetAllCircuits = resetAllCircuits;
const client = __importStar(require("prom-client"));
const events_1 = require("events");
const logger_1 = require("../logger");
const DEFAULT_CONFIGS = {
    openai: {
        failureThreshold: parseInt(process.env.CIRCUIT_OPENAI_FAILURE_THRESHOLD || '5', 10),
        successThreshold: parseInt(process.env.CIRCUIT_OPENAI_SUCCESS_THRESHOLD || '3', 10),
        timeoutMs: parseInt(process.env.CIRCUIT_OPENAI_TIMEOUT_MS || '30000', 10),
        resetTimeoutMs: parseInt(process.env.CIRCUIT_OPENAI_RESET_MS || '60000', 10),
        halfOpenMaxConcurrent: 2,
        windowMs: 60000,
        enableFallback: process.env.CIRCUIT_OPENAI_FALLBACK !== 'false',
    },
    deepgram: {
        failureThreshold: parseInt(process.env.CIRCUIT_DEEPGRAM_FAILURE_THRESHOLD || '3', 10),
        successThreshold: parseInt(process.env.CIRCUIT_DEEPGRAM_SUCCESS_THRESHOLD || '2', 10),
        timeoutMs: parseInt(process.env.CIRCUIT_DEEPGRAM_TIMEOUT_MS || '10000', 10),
        resetTimeoutMs: parseInt(process.env.CIRCUIT_DEEPGRAM_RESET_MS || '30000', 10),
        halfOpenMaxConcurrent: 1,
        windowMs: 30000,
        enableFallback: process.env.CIRCUIT_DEEPGRAM_FALLBACK !== 'false',
    },
    translation: {
        failureThreshold: parseInt(process.env.CIRCUIT_TRANSLATION_FAILURE_THRESHOLD || '5', 10),
        successThreshold: parseInt(process.env.CIRCUIT_TRANSLATION_SUCCESS_THRESHOLD || '3', 10),
        timeoutMs: parseInt(process.env.CIRCUIT_TRANSLATION_TIMEOUT_MS || '15000', 10),
        resetTimeoutMs: parseInt(process.env.CIRCUIT_TRANSLATION_RESET_MS || '45000', 10),
        halfOpenMaxConcurrent: 2,
        windowMs: 60000,
        enableFallback: process.env.CIRCUIT_TRANSLATION_FALLBACK !== 'false',
    },
};
// ── Prometheus Metrics ──────────────────────────────────────
const PREFIX = 'orgsledger_circuit_breaker_';
exports.circuitStateGauge = new client.Gauge({
    name: `${PREFIX}state`,
    help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
    labelNames: ['service'],
});
exports.circuitFailuresCounter = new client.Counter({
    name: `${PREFIX}failures_total`,
    help: 'Total failures per service',
    labelNames: ['service'],
});
exports.circuitSuccessesCounter = new client.Counter({
    name: `${PREFIX}successes_total`,
    help: 'Total successes per service',
    labelNames: ['service'],
});
exports.circuitRejectedCounter = new client.Counter({
    name: `${PREFIX}rejected_total`,
    help: 'Requests rejected (circuit open)',
    labelNames: ['service'],
});
exports.circuitFallbackCounter = new client.Counter({
    name: `${PREFIX}fallback_total`,
    help: 'Fallback responses returned',
    labelNames: ['service'],
});
exports.circuitTimeoutsCounter = new client.Counter({
    name: `${PREFIX}timeouts_total`,
    help: 'Request timeouts',
    labelNames: ['service'],
});
exports.circuitLatencyHistogram = new client.Histogram({
    name: `${PREFIX}latency_seconds`,
    help: 'Request latency through circuit breaker',
    labelNames: ['service', 'outcome'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
});
class CircuitOpenError extends Error {
    service;
    retryAfterMs;
    constructor(service, retryAfterMs) {
        super(`Circuit breaker open for ${service}`);
        this.service = service;
        this.retryAfterMs = retryAfterMs;
        this.name = 'CircuitOpenError';
    }
}
exports.CircuitOpenError = CircuitOpenError;
class CircuitTimeoutError extends Error {
    service;
    timeoutMs;
    constructor(service, timeoutMs) {
        super(`Request to ${service} timed out after ${timeoutMs}ms`);
        this.service = service;
        this.timeoutMs = timeoutMs;
        this.name = 'CircuitTimeoutError';
    }
}
exports.CircuitTimeoutError = CircuitTimeoutError;
class ServiceCircuitBreaker {
    service;
    config;
    state = 'closed';
    failures = [];
    successCount = 0;
    halfOpenTests = 0;
    lastFailure;
    lastSuccess;
    openedAt;
    resetTimer;
    constructor(service, config) {
        this.service = service;
        this.config = config;
        exports.circuitStateGauge.set({ service }, 0); // closed
    }
    /**
     * Execute a function through the circuit breaker.
     */
    async execute(fn, fallback) {
        // Check if circuit is open
        if (this.state === 'open') {
            if (this.config.enableFallback && fallback) {
                exports.circuitFallbackCounter.inc({ service: this.service });
                exports.circuitRejectedCounter.inc({ service: this.service });
                return fallback();
            }
            const retryAfter = this.openedAt
                ? this.config.resetTimeoutMs - (Date.now() - this.openedAt.getTime())
                : this.config.resetTimeoutMs;
            exports.circuitRejectedCounter.inc({ service: this.service });
            throw new CircuitOpenError(this.service, Math.max(0, retryAfter));
        }
        // Half-open: limit concurrent tests
        if (this.state === 'half-open') {
            if (this.halfOpenTests >= this.config.halfOpenMaxConcurrent) {
                if (this.config.enableFallback && fallback) {
                    exports.circuitFallbackCounter.inc({ service: this.service });
                    return fallback();
                }
                throw new CircuitOpenError(this.service, 5000);
            }
            this.halfOpenTests++;
        }
        // Execute with timeout
        const startTime = Date.now();
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
        }, this.config.timeoutMs);
        try {
            const result = await fn(controller.signal);
            clearTimeout(timeoutId);
            const latency = (Date.now() - startTime) / 1000;
            exports.circuitLatencyHistogram.observe({ service: this.service, outcome: 'success' }, latency);
            this.recordSuccess();
            return result;
        }
        catch (err) {
            clearTimeout(timeoutId);
            const latency = (Date.now() - startTime) / 1000;
            const isTimeout = controller.signal.aborted ||
                (err instanceof Error && err.name === 'AbortError');
            if (isTimeout) {
                exports.circuitTimeoutsCounter.inc({ service: this.service });
                exports.circuitLatencyHistogram.observe({ service: this.service, outcome: 'timeout' }, latency);
                this.recordFailure(new CircuitTimeoutError(this.service, this.config.timeoutMs));
                if (this.config.enableFallback && fallback) {
                    exports.circuitFallbackCounter.inc({ service: this.service });
                    return fallback();
                }
                throw new CircuitTimeoutError(this.service, this.config.timeoutMs);
            }
            exports.circuitLatencyHistogram.observe({ service: this.service, outcome: 'error' }, latency);
            this.recordFailure(err instanceof Error ? err : new Error(String(err)));
            // Return fallback on failure if available
            if (this.config.enableFallback && fallback) {
                exports.circuitFallbackCounter.inc({ service: this.service });
                return fallback();
            }
            throw err;
        }
        finally {
            if (this.state === 'half-open') {
                this.halfOpenTests = Math.max(0, this.halfOpenTests - 1);
            }
        }
    }
    /**
     * Record a successful request.
     */
    recordSuccess() {
        this.lastSuccess = new Date();
        exports.circuitSuccessesCounter.inc({ service: this.service });
        if (this.state === 'half-open') {
            this.successCount++;
            if (this.successCount >= this.config.successThreshold) {
                this.transitionTo('closed');
            }
        }
        else if (this.state === 'closed') {
            // Clear old failures outside window
            this.pruneFailures();
        }
    }
    /**
     * Record a failed request.
     */
    recordFailure(error) {
        this.lastFailure = new Date();
        exports.circuitFailuresCounter.inc({ service: this.service });
        this.failures.push({
            timestamp: Date.now(),
            error: error.message,
        });
        // Prune old failures
        this.pruneFailures();
        logger_1.logger.warn(`[CIRCUIT_BREAKER] Failure recorded for ${this.service}`, {
            error: error.message,
            failures: this.failures.length,
            threshold: this.config.failureThreshold,
            state: this.state,
        });
        if (this.state === 'half-open') {
            // Any failure in half-open reopens the circuit
            this.transitionTo('open');
        }
        else if (this.state === 'closed') {
            // Check if we hit threshold
            if (this.failures.length >= this.config.failureThreshold) {
                this.transitionTo('open');
            }
        }
    }
    /**
     * Prune failures outside the sliding window.
     */
    pruneFailures() {
        const cutoff = Date.now() - this.config.windowMs;
        this.failures = this.failures.filter(f => f.timestamp > cutoff);
    }
    /**
     * Transition to a new state.
     */
    transitionTo(newState) {
        const previousState = this.state;
        this.state = newState;
        logger_1.logger.info(`[CIRCUIT_BREAKER] ${this.service}: ${previousState} → ${newState}`);
        // Update metrics
        const stateValue = newState === 'closed' ? 0 : newState === 'open' ? 1 : 2;
        exports.circuitStateGauge.set({ service: this.service }, stateValue);
        // Clear any existing reset timer
        if (this.resetTimer) {
            clearTimeout(this.resetTimer);
            this.resetTimer = undefined;
        }
        switch (newState) {
            case 'open':
                this.openedAt = new Date();
                this.successCount = 0;
                this.halfOpenTests = 0;
                // Schedule transition to half-open
                this.resetTimer = setTimeout(() => {
                    this.transitionTo('half-open');
                }, this.config.resetTimeoutMs);
                this.resetTimer.unref();
                break;
            case 'half-open':
                this.successCount = 0;
                this.halfOpenTests = 0;
                break;
            case 'closed':
                this.failures = [];
                this.successCount = 0;
                this.openedAt = undefined;
                break;
        }
    }
    /**
     * Get current stats.
     */
    getStats() {
        this.pruneFailures();
        return {
            service: this.service,
            state: this.state,
            failures: this.failures.length,
            successes: this.successCount,
            lastFailure: this.lastFailure,
            lastSuccess: this.lastSuccess,
            openedAt: this.openedAt,
            halfOpenTests: this.halfOpenTests,
        };
    }
    /**
     * Force circuit state (for testing/admin).
     */
    forceState(state) {
        logger_1.logger.warn(`[CIRCUIT_BREAKER] Force ${this.service} to ${state}`);
        this.transitionTo(state);
    }
    /**
     * Get current state.
     */
    getState() {
        return this.state;
    }
}
// ── Circuit Breaker Manager ─────────────────────────────────
class AICircuitBreakerManager extends events_1.EventEmitter {
    breakers = new Map();
    constructor() {
        super();
        // Initialize all service breakers
        for (const service of ['openai', 'deepgram', 'translation']) {
            this.breakers.set(service, new ServiceCircuitBreaker(service, DEFAULT_CONFIGS[service]));
        }
        logger_1.logger.info('[CIRCUIT_BREAKER] Initialized', {
            services: Array.from(this.breakers.keys()),
        });
    }
    /**
     * Execute a function through a service's circuit breaker.
     */
    async execute(service, fn, fallback) {
        const breaker = this.breakers.get(service);
        if (!breaker) {
            throw new Error(`Unknown service: ${service}`);
        }
        return breaker.execute(fn, fallback);
    }
    /**
     * Get stats for a service.
     */
    getStats(service) {
        return this.breakers.get(service)?.getStats() || null;
    }
    /**
     * Get stats for all services.
     */
    getAllStats() {
        return Array.from(this.breakers.values()).map(b => b.getStats());
    }
    /**
     * Get current state for a service.
     */
    getState(service) {
        return this.breakers.get(service)?.getState() || null;
    }
    /**
     * Check if a service is available (not open).
     */
    isAvailable(service) {
        const state = this.getState(service);
        return state !== 'open';
    }
    /**
     * Force a service to a specific state.
     */
    forceState(service, state) {
        this.breakers.get(service)?.forceState(state);
    }
    /**
     * Reset all breakers to closed.
     */
    resetAll() {
        for (const breaker of this.breakers.values()) {
            breaker.forceState('closed');
        }
    }
}
// ── Singleton ───────────────────────────────────────────────
exports.aiCircuitBreaker = new AICircuitBreakerManager();
// ── Convenient Wrappers ─────────────────────────────────────
/**
 * Execute an OpenAI request through the circuit breaker.
 */
async function withOpenAICircuitBreaker(fn, fallback) {
    return exports.aiCircuitBreaker.execute('openai', fn, fallback);
}
/**
 * Execute a Deepgram request through the circuit breaker.
 */
async function withDeepgramCircuitBreaker(fn, fallback) {
    return exports.aiCircuitBreaker.execute('deepgram', fn, fallback);
}
/**
 * Execute a translation request through the circuit breaker.
 */
async function withTranslationCircuitBreaker(fn, fallback) {
    return exports.aiCircuitBreaker.execute('translation', fn, fallback);
}
// ── Exports ─────────────────────────────────────────────────
function getCircuitBreakerStats(service) {
    return exports.aiCircuitBreaker.getStats(service);
}
function getAllCircuitBreakerStats() {
    return exports.aiCircuitBreaker.getAllStats();
}
function isServiceAvailable(service) {
    return exports.aiCircuitBreaker.isAvailable(service);
}
function forceCircuitState(service, state) {
    exports.aiCircuitBreaker.forceState(service, state);
}
function resetAllCircuits() {
    exports.aiCircuitBreaker.resetAll();
}
//# sourceMappingURL=ai-circuit-breaker.js.map