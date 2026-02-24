"use strict";
// ============================================================
// OrgsLedger API — Circuit Breaker
// Protects against cascading failures from external services
// (AI APIs, payment gateways, email, etc.)
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.circuits = exports.CircuitBreaker = exports.CircuitState = void 0;
const logger_1 = require("../logger");
var CircuitState;
(function (CircuitState) {
    CircuitState["CLOSED"] = "closed";
    CircuitState["OPEN"] = "open";
    CircuitState["HALF_OPEN"] = "half_open";
})(CircuitState || (exports.CircuitState = CircuitState = {}));
class CircuitBreaker {
    state = CircuitState.CLOSED;
    failures = [];
    lastFailureTime = 0;
    successCount = 0;
    name;
    failureThreshold;
    resetTimeout;
    failureWindow;
    constructor(options) {
        this.name = options.name;
        this.failureThreshold = options.failureThreshold ?? 5;
        this.resetTimeout = options.resetTimeout ?? 30_000; // 30 seconds
        this.failureWindow = options.failureWindow ?? 60_000; // 1 minute
    }
    /**
     * Execute a function with circuit breaker protection.
     * @param fn - The async function to call
     * @param fallback - Optional fallback value if circuit is open
     */
    async execute(fn, fallback) {
        // Check if circuit should transition from OPEN to HALF_OPEN
        if (this.state === CircuitState.OPEN) {
            if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
                this.state = CircuitState.HALF_OPEN;
                this.successCount = 0;
                logger_1.logger.info(`[CIRCUIT] ${this.name}: transitioning to HALF_OPEN`);
            }
            else {
                logger_1.logger.debug(`[CIRCUIT] ${this.name}: circuit OPEN — rejecting call`);
                if (fallback !== undefined)
                    return fallback;
                throw new Error(`Circuit breaker open for ${this.name}`);
            }
        }
        try {
            const result = await fn();
            this.onSuccess();
            return result;
        }
        catch (err) {
            this.onFailure();
            if (fallback !== undefined)
                return fallback;
            throw err;
        }
    }
    onSuccess() {
        if (this.state === CircuitState.HALF_OPEN) {
            this.successCount++;
            // Require 2 successive successes to close
            if (this.successCount >= 2) {
                this.state = CircuitState.CLOSED;
                this.failures = [];
                logger_1.logger.info(`[CIRCUIT] ${this.name}: circuit CLOSED (recovered)`);
            }
        }
        else {
            // In closed state, clear old failures
            this.pruneFailures();
        }
    }
    onFailure() {
        const now = Date.now();
        this.failures.push(now);
        this.lastFailureTime = now;
        this.pruneFailures();
        if (this.state === CircuitState.HALF_OPEN) {
            // Any failure in half-open → back to open
            this.state = CircuitState.OPEN;
            logger_1.logger.warn(`[CIRCUIT] ${this.name}: circuit OPEN (half-open test failed)`);
        }
        else if (this.failures.length >= this.failureThreshold) {
            this.state = CircuitState.OPEN;
            logger_1.logger.warn(`[CIRCUIT] ${this.name}: circuit OPEN (${this.failures.length} failures in window)`);
        }
    }
    pruneFailures() {
        const cutoff = Date.now() - this.failureWindow;
        this.failures = this.failures.filter(t => t > cutoff);
    }
    /** Get current circuit state */
    getState() {
        return this.state;
    }
    /** Get stats for observability */
    getStats() {
        return {
            name: this.name,
            state: this.state,
            failureCount: this.failures.length,
            lastFailure: this.lastFailureTime,
        };
    }
    /** Reset circuit (used in tests) */
    reset() {
        this.state = CircuitState.CLOSED;
        this.failures = [];
        this.lastFailureTime = 0;
        this.successCount = 0;
    }
}
exports.CircuitBreaker = CircuitBreaker;
// ── Pre-built circuits for external services ──
exports.circuits = {
    ai: new CircuitBreaker({ name: 'AI/OpenAI', failureThreshold: 3, resetTimeout: 60_000 }),
    email: new CircuitBreaker({ name: 'Email/SMTP', failureThreshold: 5, resetTimeout: 30_000 }),
    stripe: new CircuitBreaker({ name: 'Stripe', failureThreshold: 3, resetTimeout: 30_000 }),
    paystack: new CircuitBreaker({ name: 'Paystack', failureThreshold: 3, resetTimeout: 30_000 }),
    livekit: new CircuitBreaker({ name: 'LiveKit', failureThreshold: 3, resetTimeout: 15_000 }),
};
//# sourceMappingURL=circuit-breaker.js.map