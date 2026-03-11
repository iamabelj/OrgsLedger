// ============================================================
// OrgsLedger API — Monitoring Module Index
// Exports all monitoring utilities
// ============================================================

// System Health Monitor
export {
  startSystemMonitor,
  stopSystemMonitor,
  getHealthReport,
  recordBroadcastLatency,
  recordMinutesGenerationTime,
  recordPipelineDelay,
  recordTranslationDuration,
  recordApiLatency,
  sendWorkerHeartbeat,
  getSystemMonitor,
  apiLatencyMiddleware,
  // Stuck job recovery
  triggerStuckJobRecovery,
  recoverStuckJobs,
  getStuckJobFailedAlerts,
} from './system.monitor';

// AI Cost Monitor
export {
  startAICostMonitor,
  stopAICostMonitor,
  recordDeepgramUsage,
  recordOpenAIUsage,
  recordTranslationUsage,
  getAICostMetrics,
  getAICostHealthMetrics,
  resetAICostMetrics,
  getAICostMonitor,
  // Database query helpers
  getDailyCostSummary,
  getMonthlyCostSummary,
  getRecentCostMetrics,
  getDayCost,
} from './ai-cost.monitor';

// Re-export types
export type {
  AICostAlert,
  DailyCostSummary,
  MonthlyCostSummary,
} from './ai-cost.monitor';

export type {
  // System monitor types
  WorkerAlert,
  RecoveryResult,
} from './system.monitor';

// Meeting Pipeline Metrics
export {
  incrementTranscriptsGenerated,
  incrementTranslationsGenerated,
  incrementBroadcastEvents,
  storeMinutesGenerationMs,
  getMeetingMetrics,
  deleteMeetingMetrics,
  // Latency tracking (per-meeting, per-event)
  recordTranscriptionLatency,
  recordTranslationLatency,
  recordBroadcastLatency as recordMeetingBroadcastLatency,
  recordPipelineLatency,
  getLatencyReport,
  getHistoricalLatencyReport,
  getGrafanaMetrics,
  startMeetingMetrics,
  stopMeetingMetrics,
  // Prometheus metrics
  pipelineStageLatencyHistogram,
  pipelineLatencyHistogram,
  pipelineStageLatencyGauge,
  // Constants
  PIPELINE_STAGES,
} from './meeting-metrics';

export type {
  MeetingMetricsSummary,
  PipelineStage,
  PercentileSnapshot,
  PipelineLatencyReport,
} from './meeting-metrics';

// Prometheus Metrics
export {
  createMetricsRouter,
  updatePrometheusMetrics,
  incrementRecoveryMetrics,
  getRegistry,
  getMetricsString,
} from './prometheus.metrics';

export type {
  PrometheusMetricsUpdate,
} from './prometheus.metrics';

// Worker Heartbeat Monitor
export {
  workerHeartbeatMonitor,
  startWorkerHeartbeatMonitor,
  stopWorkerHeartbeatMonitor,
  sendWorkerHeartbeat as sendHeartbeat,
  startAutomaticHeartbeat,
  getWorkerHeartbeatStats,
  getWorkersByName,
  getWorkersByQueue,
  isWorkerHealthy,
  onWorkerEvent,
  offWorkerEvent,
  HEARTBEAT_INTERVALS,
  // Prometheus gauges
  workerAliveGauge,
  workerUnhealthyGauge,
  workerDeadGauge,
} from './worker-heartbeat.monitor';

export type {
  HeartbeatData,
  WorkerStatus,
  WorkerHeartbeatEvent,
  WorkerHeartbeatStats,
} from './worker-heartbeat.monitor';

// AI Rate Limit Guard
export {
  aiRateLimitGuard,
  initializeAIRateLimit,
  checkDeepgramRateLimit,
  checkOpenAIRateLimit,
  checkTranslationRateLimit,
  isDeepgramRateLimited,
  isOpenAIRateLimited,
  isTranslationRateLimited,
  getAIDegradationStrategy,
  getAIRateLimitMetrics,
  isAnyAIBackpressureActive,
  onAIRateLimitEvent,
  shutdownAIRateLimit,
  guardDeepgramRequest,
  guardOpenAIRequest,
  guardTranslationRequest,
  // Prometheus metrics
  aiRateLimitUtilizationGauge,
  aiRateLimitWarningCounter,
  aiRateLimitBackpressureCounter,
  aiRateLimitDegradedGauge,
} from './ai-rate-limit.guard';

export type {
  AIService,
  RateLimitStatus,
  DegradationStrategy,
  AIRateLimitMetrics,
  RateLimitCheckResult,
} from './ai-rate-limit.guard';

// Socket.IO Metrics
export {
  socketConnectionsGauge,
  socketRoomsGauge,
  socketEventsCounter,
  socketBroadcastsCounter,
  socketRedisLatencyGauge,
  socketRedisReconnectsCounter,
  socketRedisConnectedGauge,
  recordBroadcast as recordSocketBroadcast,
  recordEvent as recordSocketEvent,
  updateRedisMetrics as updateSocketRedisMetrics,
  recordRedisReconnect as recordSocketRedisReconnect,
  startSocketMetricsCollection,
  stopSocketMetricsCollection,
} from './socket-metrics';

// Queue Metrics Exporter
export {
  QueueMetricsExporter,
  getQueueMetricsExporter,
  startQueueMetricsExporter,
  stopQueueMetricsExporter,
  createQueueMetricsRouter,
  queueWaitingJobsSharded,
  queueActiveJobsSharded,
  queueCompletedJobsSharded,
  queueFailedJobsSharded,
  queueDelayedJobsSharded,
  queueCollectionDurationMs,
  queueCollectionErrorsTotal,
} from './queue-metrics.exporter';

// Redis Health Monitor
export {
  redisHealthMonitor,
  startRedisHealthMonitor,
  stopRedisHealthMonitor,
  getRedisHealthReport,
  getLastRedisHealthReport,
  onRedisHealthAlert,
  // Prometheus metrics
  redisMemoryUsedGauge,
  redisMemoryMaxGauge,
  redisMemoryUsageGauge,
  redisEvictedKeysGauge,
  redisFragmentationGauge,
  redisConnectedClientsGauge,
  redisBlockedClientsGauge,
  redisOpsPerSecGauge,
  redisHitRateGauge,
  redisHealthAlertsCounter,
} from './redis-health.monitor';

export type {
  RedisMemoryInfo,
  RedisClientInfo,
  RedisStatsInfo,
  RedisHealthReport,
  RedisHealthAlert,
} from './redis-health.monitor';

// Queue Lag Monitor
export {
  queueLagMonitor,
  withLagTracking,
  onQueueLagAlert,
  getQueueLagStats,
  getAllQueueLagStats,
  // Prometheus metrics
  queueWaitingLatencyHistogram,
  queueProcessingLatencyHistogram,
  queueTotalLatencyHistogram,
  queueLagGauge,
  queueLagAlertsCounter,
} from './queue-lag.monitor';

export type {
  QueueLagAlert,
  QueueLagStats,
} from './queue-lag.monitor';
