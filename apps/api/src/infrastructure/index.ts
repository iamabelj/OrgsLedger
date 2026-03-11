// ============================================================
// OrgsLedger API — Infrastructure Module Exports
// ============================================================

// Redis Clients
export * from './redisClient';
export * from './redisShardRouter';

// Redis Failover (Sentinel & Cluster)
export {
  redisFailoverManager,
  createFailoverConnection,
  connectRedisWithFailover,
  disconnectRedis,
  getRedisFailoverHealth,
  isRedisConnected,
  onRedisFailoverEvent,
  getRedisConnection,
  // Prometheus metrics
  redisFailoverModeGauge,
  redisFailoverConnectedGauge,
  redisFailoverReconnectsCounter,
  redisFailoverFailoversCounter,
  redisFailoverLatencyHistogram,
  redisFailoverErrorsCounter,
} from './redis-failover';

export type {
  RedisMode,
  RedisHealthStatus,
  RedisFailoverEvent,
} from './redis-failover';

// AI Circuit Breaker
export {
  aiCircuitBreaker,
  withOpenAICircuitBreaker,
  withDeepgramCircuitBreaker,
  withTranslationCircuitBreaker,
  getCircuitBreakerStats,
  getAllCircuitBreakerStats,
  isServiceAvailable,
  forceCircuitState,
  resetAllCircuits,
  // Errors
  CircuitOpenError,
  CircuitTimeoutError,
  // Prometheus metrics
  circuitStateGauge,
  circuitFailuresCounter,
  circuitSuccessesCounter,
  circuitRejectedCounter,
  circuitFallbackCounter,
  circuitTimeoutsCounter,
  circuitLatencyHistogram,
} from './ai-circuit-breaker';

export type {
  AIService,
  CircuitState,
  CircuitStats,
  CircuitBreakerEvent,
} from './ai-circuit-breaker';

// Deepgram Client
export * from './deepgramClient';
