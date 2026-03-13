"use strict";
// ============================================================
// OrgsLedger API — Infrastructure Module Exports
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.circuitLatencyHistogram = exports.circuitTimeoutsCounter = exports.circuitFallbackCounter = exports.circuitRejectedCounter = exports.circuitSuccessesCounter = exports.circuitFailuresCounter = exports.circuitStateGauge = exports.CircuitTimeoutError = exports.CircuitOpenError = exports.resetAllCircuits = exports.forceCircuitState = exports.isServiceAvailable = exports.getAllCircuitBreakerStats = exports.getCircuitBreakerStats = exports.withTranslationCircuitBreaker = exports.withDeepgramCircuitBreaker = exports.withOpenAICircuitBreaker = exports.aiCircuitBreaker = exports.redisFailoverErrorsCounter = exports.redisFailoverLatencyHistogram = exports.redisFailoverFailoversCounter = exports.redisFailoverReconnectsCounter = exports.redisFailoverConnectedGauge = exports.redisFailoverModeGauge = exports.getRedisConnection = exports.onRedisFailoverEvent = exports.isRedisConnected = exports.getRedisFailoverHealth = exports.disconnectRedis = exports.connectRedisWithFailover = exports.createFailoverConnection = exports.redisFailoverManager = void 0;
// Redis Clients
__exportStar(require("./redisClient"), exports);
__exportStar(require("./redisShardRouter"), exports);
// Redis Failover (Sentinel & Cluster)
var redis_failover_1 = require("./redis-failover");
Object.defineProperty(exports, "redisFailoverManager", { enumerable: true, get: function () { return redis_failover_1.redisFailoverManager; } });
Object.defineProperty(exports, "createFailoverConnection", { enumerable: true, get: function () { return redis_failover_1.createFailoverConnection; } });
Object.defineProperty(exports, "connectRedisWithFailover", { enumerable: true, get: function () { return redis_failover_1.connectRedisWithFailover; } });
Object.defineProperty(exports, "disconnectRedis", { enumerable: true, get: function () { return redis_failover_1.disconnectRedis; } });
Object.defineProperty(exports, "getRedisFailoverHealth", { enumerable: true, get: function () { return redis_failover_1.getRedisFailoverHealth; } });
Object.defineProperty(exports, "isRedisConnected", { enumerable: true, get: function () { return redis_failover_1.isRedisConnected; } });
Object.defineProperty(exports, "onRedisFailoverEvent", { enumerable: true, get: function () { return redis_failover_1.onRedisFailoverEvent; } });
Object.defineProperty(exports, "getRedisConnection", { enumerable: true, get: function () { return redis_failover_1.getRedisConnection; } });
// Prometheus metrics
Object.defineProperty(exports, "redisFailoverModeGauge", { enumerable: true, get: function () { return redis_failover_1.redisFailoverModeGauge; } });
Object.defineProperty(exports, "redisFailoverConnectedGauge", { enumerable: true, get: function () { return redis_failover_1.redisFailoverConnectedGauge; } });
Object.defineProperty(exports, "redisFailoverReconnectsCounter", { enumerable: true, get: function () { return redis_failover_1.redisFailoverReconnectsCounter; } });
Object.defineProperty(exports, "redisFailoverFailoversCounter", { enumerable: true, get: function () { return redis_failover_1.redisFailoverFailoversCounter; } });
Object.defineProperty(exports, "redisFailoverLatencyHistogram", { enumerable: true, get: function () { return redis_failover_1.redisFailoverLatencyHistogram; } });
Object.defineProperty(exports, "redisFailoverErrorsCounter", { enumerable: true, get: function () { return redis_failover_1.redisFailoverErrorsCounter; } });
// AI Circuit Breaker
var ai_circuit_breaker_1 = require("./ai-circuit-breaker");
Object.defineProperty(exports, "aiCircuitBreaker", { enumerable: true, get: function () { return ai_circuit_breaker_1.aiCircuitBreaker; } });
Object.defineProperty(exports, "withOpenAICircuitBreaker", { enumerable: true, get: function () { return ai_circuit_breaker_1.withOpenAICircuitBreaker; } });
Object.defineProperty(exports, "withDeepgramCircuitBreaker", { enumerable: true, get: function () { return ai_circuit_breaker_1.withDeepgramCircuitBreaker; } });
Object.defineProperty(exports, "withTranslationCircuitBreaker", { enumerable: true, get: function () { return ai_circuit_breaker_1.withTranslationCircuitBreaker; } });
Object.defineProperty(exports, "getCircuitBreakerStats", { enumerable: true, get: function () { return ai_circuit_breaker_1.getCircuitBreakerStats; } });
Object.defineProperty(exports, "getAllCircuitBreakerStats", { enumerable: true, get: function () { return ai_circuit_breaker_1.getAllCircuitBreakerStats; } });
Object.defineProperty(exports, "isServiceAvailable", { enumerable: true, get: function () { return ai_circuit_breaker_1.isServiceAvailable; } });
Object.defineProperty(exports, "forceCircuitState", { enumerable: true, get: function () { return ai_circuit_breaker_1.forceCircuitState; } });
Object.defineProperty(exports, "resetAllCircuits", { enumerable: true, get: function () { return ai_circuit_breaker_1.resetAllCircuits; } });
// Errors
Object.defineProperty(exports, "CircuitOpenError", { enumerable: true, get: function () { return ai_circuit_breaker_1.CircuitOpenError; } });
Object.defineProperty(exports, "CircuitTimeoutError", { enumerable: true, get: function () { return ai_circuit_breaker_1.CircuitTimeoutError; } });
// Prometheus metrics
Object.defineProperty(exports, "circuitStateGauge", { enumerable: true, get: function () { return ai_circuit_breaker_1.circuitStateGauge; } });
Object.defineProperty(exports, "circuitFailuresCounter", { enumerable: true, get: function () { return ai_circuit_breaker_1.circuitFailuresCounter; } });
Object.defineProperty(exports, "circuitSuccessesCounter", { enumerable: true, get: function () { return ai_circuit_breaker_1.circuitSuccessesCounter; } });
Object.defineProperty(exports, "circuitRejectedCounter", { enumerable: true, get: function () { return ai_circuit_breaker_1.circuitRejectedCounter; } });
Object.defineProperty(exports, "circuitFallbackCounter", { enumerable: true, get: function () { return ai_circuit_breaker_1.circuitFallbackCounter; } });
Object.defineProperty(exports, "circuitTimeoutsCounter", { enumerable: true, get: function () { return ai_circuit_breaker_1.circuitTimeoutsCounter; } });
Object.defineProperty(exports, "circuitLatencyHistogram", { enumerable: true, get: function () { return ai_circuit_breaker_1.circuitLatencyHistogram; } });
// Deepgram Client
__exportStar(require("./deepgramClient"), exports);
//# sourceMappingURL=index.js.map