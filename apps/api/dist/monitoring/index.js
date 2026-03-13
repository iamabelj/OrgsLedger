"use strict";
// ============================================================
// OrgsLedger API — Monitoring Module Index
// Exports all monitoring utilities
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRegistry = exports.incrementRecoveryMetrics = exports.updatePrometheusMetrics = exports.createMetricsRouter = exports.PIPELINE_STAGES = exports.pipelineStageLatencyGauge = exports.pipelineLatencyHistogram = exports.pipelineStageLatencyHistogram = exports.stopMeetingMetrics = exports.startMeetingMetrics = exports.getGrafanaMetrics = exports.getHistoricalLatencyReport = exports.getLatencyReport = exports.recordPipelineLatency = exports.recordMeetingBroadcastLatency = exports.recordTranslationLatency = exports.recordTranscriptionLatency = exports.deleteMeetingMetrics = exports.getMeetingMetrics = exports.storeMinutesGenerationMs = exports.incrementBroadcastEvents = exports.incrementTranslationsGenerated = exports.incrementTranscriptsGenerated = exports.getDayCost = exports.getRecentCostMetrics = exports.getMonthlyCostSummary = exports.getDailyCostSummary = exports.getAICostMonitor = exports.resetAICostMetrics = exports.getAICostHealthMetrics = exports.getAICostMetrics = exports.recordTranslationUsage = exports.recordOpenAIUsage = exports.recordDeepgramUsage = exports.stopAICostMonitor = exports.startAICostMonitor = exports.getStuckJobFailedAlerts = exports.recoverStuckJobs = exports.triggerStuckJobRecovery = exports.apiLatencyMiddleware = exports.getSystemMonitor = exports.sendWorkerHeartbeat = exports.recordApiLatency = exports.recordTranslationDuration = exports.recordPipelineDelay = exports.recordMinutesGenerationTime = exports.recordBroadcastLatency = exports.getHealthReport = exports.stopSystemMonitor = exports.startSystemMonitor = void 0;
exports.QueueMetricsExporter = exports.stopSocketMetricsCollection = exports.startSocketMetricsCollection = exports.recordSocketRedisReconnect = exports.updateSocketRedisMetrics = exports.recordSocketEvent = exports.recordSocketBroadcast = exports.socketRedisConnectedGauge = exports.socketRedisReconnectsCounter = exports.socketRedisLatencyGauge = exports.socketBroadcastsCounter = exports.socketEventsCounter = exports.socketRoomsGauge = exports.socketConnectionsGauge = exports.aiRateLimitDegradedGauge = exports.aiRateLimitBackpressureCounter = exports.aiRateLimitWarningCounter = exports.aiRateLimitUtilizationGauge = exports.guardTranslationRequest = exports.guardOpenAIRequest = exports.guardDeepgramRequest = exports.shutdownAIRateLimit = exports.onAIRateLimitEvent = exports.isAnyAIBackpressureActive = exports.getAIRateLimitMetrics = exports.getAIDegradationStrategy = exports.isTranslationRateLimited = exports.isOpenAIRateLimited = exports.isDeepgramRateLimited = exports.checkTranslationRateLimit = exports.checkOpenAIRateLimit = exports.checkDeepgramRateLimit = exports.initializeAIRateLimit = exports.aiRateLimitGuard = exports.workerDeadGauge = exports.workerUnhealthyGauge = exports.workerAliveGauge = exports.HEARTBEAT_INTERVALS = exports.offWorkerEvent = exports.onWorkerEvent = exports.isWorkerHealthy = exports.getWorkersByQueue = exports.getWorkersByName = exports.getWorkerHeartbeatStats = exports.startAutomaticHeartbeat = exports.sendHeartbeat = exports.stopWorkerHeartbeatMonitor = exports.startWorkerHeartbeatMonitor = exports.workerHeartbeatMonitor = exports.getMetricsString = void 0;
exports.queueLagAlertsCounter = exports.queueLagGauge = exports.queueTotalLatencyHistogram = exports.queueProcessingLatencyHistogram = exports.queueWaitingLatencyHistogram = exports.getAllQueueLagStats = exports.getQueueLagStats = exports.onQueueLagAlert = exports.withLagTracking = exports.queueLagMonitor = exports.redisHealthAlertsCounter = exports.redisHitRateGauge = exports.redisOpsPerSecGauge = exports.redisBlockedClientsGauge = exports.redisConnectedClientsGauge = exports.redisFragmentationGauge = exports.redisEvictedKeysGauge = exports.redisMemoryUsageGauge = exports.redisMemoryMaxGauge = exports.redisMemoryUsedGauge = exports.onRedisHealthAlert = exports.getLastRedisHealthReport = exports.getRedisHealthReport = exports.stopRedisHealthMonitor = exports.startRedisHealthMonitor = exports.redisHealthMonitor = exports.queueCollectionErrorsTotal = exports.queueCollectionDurationMs = exports.queueDelayedJobsSharded = exports.queueFailedJobsSharded = exports.queueCompletedJobsSharded = exports.queueActiveJobsSharded = exports.queueWaitingJobsSharded = exports.createQueueMetricsRouter = exports.stopQueueMetricsExporter = exports.startQueueMetricsExporter = exports.getQueueMetricsExporter = void 0;
// System Health Monitor
var system_monitor_1 = require("./system.monitor");
Object.defineProperty(exports, "startSystemMonitor", { enumerable: true, get: function () { return system_monitor_1.startSystemMonitor; } });
Object.defineProperty(exports, "stopSystemMonitor", { enumerable: true, get: function () { return system_monitor_1.stopSystemMonitor; } });
Object.defineProperty(exports, "getHealthReport", { enumerable: true, get: function () { return system_monitor_1.getHealthReport; } });
Object.defineProperty(exports, "recordBroadcastLatency", { enumerable: true, get: function () { return system_monitor_1.recordBroadcastLatency; } });
Object.defineProperty(exports, "recordMinutesGenerationTime", { enumerable: true, get: function () { return system_monitor_1.recordMinutesGenerationTime; } });
Object.defineProperty(exports, "recordPipelineDelay", { enumerable: true, get: function () { return system_monitor_1.recordPipelineDelay; } });
Object.defineProperty(exports, "recordTranslationDuration", { enumerable: true, get: function () { return system_monitor_1.recordTranslationDuration; } });
Object.defineProperty(exports, "recordApiLatency", { enumerable: true, get: function () { return system_monitor_1.recordApiLatency; } });
Object.defineProperty(exports, "sendWorkerHeartbeat", { enumerable: true, get: function () { return system_monitor_1.sendWorkerHeartbeat; } });
Object.defineProperty(exports, "getSystemMonitor", { enumerable: true, get: function () { return system_monitor_1.getSystemMonitor; } });
Object.defineProperty(exports, "apiLatencyMiddleware", { enumerable: true, get: function () { return system_monitor_1.apiLatencyMiddleware; } });
// Stuck job recovery
Object.defineProperty(exports, "triggerStuckJobRecovery", { enumerable: true, get: function () { return system_monitor_1.triggerStuckJobRecovery; } });
Object.defineProperty(exports, "recoverStuckJobs", { enumerable: true, get: function () { return system_monitor_1.recoverStuckJobs; } });
Object.defineProperty(exports, "getStuckJobFailedAlerts", { enumerable: true, get: function () { return system_monitor_1.getStuckJobFailedAlerts; } });
// AI Cost Monitor
var ai_cost_monitor_1 = require("./ai-cost.monitor");
Object.defineProperty(exports, "startAICostMonitor", { enumerable: true, get: function () { return ai_cost_monitor_1.startAICostMonitor; } });
Object.defineProperty(exports, "stopAICostMonitor", { enumerable: true, get: function () { return ai_cost_monitor_1.stopAICostMonitor; } });
Object.defineProperty(exports, "recordDeepgramUsage", { enumerable: true, get: function () { return ai_cost_monitor_1.recordDeepgramUsage; } });
Object.defineProperty(exports, "recordOpenAIUsage", { enumerable: true, get: function () { return ai_cost_monitor_1.recordOpenAIUsage; } });
Object.defineProperty(exports, "recordTranslationUsage", { enumerable: true, get: function () { return ai_cost_monitor_1.recordTranslationUsage; } });
Object.defineProperty(exports, "getAICostMetrics", { enumerable: true, get: function () { return ai_cost_monitor_1.getAICostMetrics; } });
Object.defineProperty(exports, "getAICostHealthMetrics", { enumerable: true, get: function () { return ai_cost_monitor_1.getAICostHealthMetrics; } });
Object.defineProperty(exports, "resetAICostMetrics", { enumerable: true, get: function () { return ai_cost_monitor_1.resetAICostMetrics; } });
Object.defineProperty(exports, "getAICostMonitor", { enumerable: true, get: function () { return ai_cost_monitor_1.getAICostMonitor; } });
// Database query helpers
Object.defineProperty(exports, "getDailyCostSummary", { enumerable: true, get: function () { return ai_cost_monitor_1.getDailyCostSummary; } });
Object.defineProperty(exports, "getMonthlyCostSummary", { enumerable: true, get: function () { return ai_cost_monitor_1.getMonthlyCostSummary; } });
Object.defineProperty(exports, "getRecentCostMetrics", { enumerable: true, get: function () { return ai_cost_monitor_1.getRecentCostMetrics; } });
Object.defineProperty(exports, "getDayCost", { enumerable: true, get: function () { return ai_cost_monitor_1.getDayCost; } });
// Meeting Pipeline Metrics
var meeting_metrics_1 = require("./meeting-metrics");
Object.defineProperty(exports, "incrementTranscriptsGenerated", { enumerable: true, get: function () { return meeting_metrics_1.incrementTranscriptsGenerated; } });
Object.defineProperty(exports, "incrementTranslationsGenerated", { enumerable: true, get: function () { return meeting_metrics_1.incrementTranslationsGenerated; } });
Object.defineProperty(exports, "incrementBroadcastEvents", { enumerable: true, get: function () { return meeting_metrics_1.incrementBroadcastEvents; } });
Object.defineProperty(exports, "storeMinutesGenerationMs", { enumerable: true, get: function () { return meeting_metrics_1.storeMinutesGenerationMs; } });
Object.defineProperty(exports, "getMeetingMetrics", { enumerable: true, get: function () { return meeting_metrics_1.getMeetingMetrics; } });
Object.defineProperty(exports, "deleteMeetingMetrics", { enumerable: true, get: function () { return meeting_metrics_1.deleteMeetingMetrics; } });
// Latency tracking (per-meeting, per-event)
Object.defineProperty(exports, "recordTranscriptionLatency", { enumerable: true, get: function () { return meeting_metrics_1.recordTranscriptionLatency; } });
Object.defineProperty(exports, "recordTranslationLatency", { enumerable: true, get: function () { return meeting_metrics_1.recordTranslationLatency; } });
Object.defineProperty(exports, "recordMeetingBroadcastLatency", { enumerable: true, get: function () { return meeting_metrics_1.recordBroadcastLatency; } });
Object.defineProperty(exports, "recordPipelineLatency", { enumerable: true, get: function () { return meeting_metrics_1.recordPipelineLatency; } });
Object.defineProperty(exports, "getLatencyReport", { enumerable: true, get: function () { return meeting_metrics_1.getLatencyReport; } });
Object.defineProperty(exports, "getHistoricalLatencyReport", { enumerable: true, get: function () { return meeting_metrics_1.getHistoricalLatencyReport; } });
Object.defineProperty(exports, "getGrafanaMetrics", { enumerable: true, get: function () { return meeting_metrics_1.getGrafanaMetrics; } });
Object.defineProperty(exports, "startMeetingMetrics", { enumerable: true, get: function () { return meeting_metrics_1.startMeetingMetrics; } });
Object.defineProperty(exports, "stopMeetingMetrics", { enumerable: true, get: function () { return meeting_metrics_1.stopMeetingMetrics; } });
// Prometheus metrics
Object.defineProperty(exports, "pipelineStageLatencyHistogram", { enumerable: true, get: function () { return meeting_metrics_1.pipelineStageLatencyHistogram; } });
Object.defineProperty(exports, "pipelineLatencyHistogram", { enumerable: true, get: function () { return meeting_metrics_1.pipelineLatencyHistogram; } });
Object.defineProperty(exports, "pipelineStageLatencyGauge", { enumerable: true, get: function () { return meeting_metrics_1.pipelineStageLatencyGauge; } });
// Constants
Object.defineProperty(exports, "PIPELINE_STAGES", { enumerable: true, get: function () { return meeting_metrics_1.PIPELINE_STAGES; } });
// Prometheus Metrics
var prometheus_metrics_1 = require("./prometheus.metrics");
Object.defineProperty(exports, "createMetricsRouter", { enumerable: true, get: function () { return prometheus_metrics_1.createMetricsRouter; } });
Object.defineProperty(exports, "updatePrometheusMetrics", { enumerable: true, get: function () { return prometheus_metrics_1.updatePrometheusMetrics; } });
Object.defineProperty(exports, "incrementRecoveryMetrics", { enumerable: true, get: function () { return prometheus_metrics_1.incrementRecoveryMetrics; } });
Object.defineProperty(exports, "getRegistry", { enumerable: true, get: function () { return prometheus_metrics_1.getRegistry; } });
Object.defineProperty(exports, "getMetricsString", { enumerable: true, get: function () { return prometheus_metrics_1.getMetricsString; } });
// Worker Heartbeat Monitor
var worker_heartbeat_monitor_1 = require("./worker-heartbeat.monitor");
Object.defineProperty(exports, "workerHeartbeatMonitor", { enumerable: true, get: function () { return worker_heartbeat_monitor_1.workerHeartbeatMonitor; } });
Object.defineProperty(exports, "startWorkerHeartbeatMonitor", { enumerable: true, get: function () { return worker_heartbeat_monitor_1.startWorkerHeartbeatMonitor; } });
Object.defineProperty(exports, "stopWorkerHeartbeatMonitor", { enumerable: true, get: function () { return worker_heartbeat_monitor_1.stopWorkerHeartbeatMonitor; } });
Object.defineProperty(exports, "sendHeartbeat", { enumerable: true, get: function () { return worker_heartbeat_monitor_1.sendWorkerHeartbeat; } });
Object.defineProperty(exports, "startAutomaticHeartbeat", { enumerable: true, get: function () { return worker_heartbeat_monitor_1.startAutomaticHeartbeat; } });
Object.defineProperty(exports, "getWorkerHeartbeatStats", { enumerable: true, get: function () { return worker_heartbeat_monitor_1.getWorkerHeartbeatStats; } });
Object.defineProperty(exports, "getWorkersByName", { enumerable: true, get: function () { return worker_heartbeat_monitor_1.getWorkersByName; } });
Object.defineProperty(exports, "getWorkersByQueue", { enumerable: true, get: function () { return worker_heartbeat_monitor_1.getWorkersByQueue; } });
Object.defineProperty(exports, "isWorkerHealthy", { enumerable: true, get: function () { return worker_heartbeat_monitor_1.isWorkerHealthy; } });
Object.defineProperty(exports, "onWorkerEvent", { enumerable: true, get: function () { return worker_heartbeat_monitor_1.onWorkerEvent; } });
Object.defineProperty(exports, "offWorkerEvent", { enumerable: true, get: function () { return worker_heartbeat_monitor_1.offWorkerEvent; } });
Object.defineProperty(exports, "HEARTBEAT_INTERVALS", { enumerable: true, get: function () { return worker_heartbeat_monitor_1.HEARTBEAT_INTERVALS; } });
// Prometheus gauges
Object.defineProperty(exports, "workerAliveGauge", { enumerable: true, get: function () { return worker_heartbeat_monitor_1.workerAliveGauge; } });
Object.defineProperty(exports, "workerUnhealthyGauge", { enumerable: true, get: function () { return worker_heartbeat_monitor_1.workerUnhealthyGauge; } });
Object.defineProperty(exports, "workerDeadGauge", { enumerable: true, get: function () { return worker_heartbeat_monitor_1.workerDeadGauge; } });
// AI Rate Limit Guard
var ai_rate_limit_guard_1 = require("./ai-rate-limit.guard");
Object.defineProperty(exports, "aiRateLimitGuard", { enumerable: true, get: function () { return ai_rate_limit_guard_1.aiRateLimitGuard; } });
Object.defineProperty(exports, "initializeAIRateLimit", { enumerable: true, get: function () { return ai_rate_limit_guard_1.initializeAIRateLimit; } });
Object.defineProperty(exports, "checkDeepgramRateLimit", { enumerable: true, get: function () { return ai_rate_limit_guard_1.checkDeepgramRateLimit; } });
Object.defineProperty(exports, "checkOpenAIRateLimit", { enumerable: true, get: function () { return ai_rate_limit_guard_1.checkOpenAIRateLimit; } });
Object.defineProperty(exports, "checkTranslationRateLimit", { enumerable: true, get: function () { return ai_rate_limit_guard_1.checkTranslationRateLimit; } });
Object.defineProperty(exports, "isDeepgramRateLimited", { enumerable: true, get: function () { return ai_rate_limit_guard_1.isDeepgramRateLimited; } });
Object.defineProperty(exports, "isOpenAIRateLimited", { enumerable: true, get: function () { return ai_rate_limit_guard_1.isOpenAIRateLimited; } });
Object.defineProperty(exports, "isTranslationRateLimited", { enumerable: true, get: function () { return ai_rate_limit_guard_1.isTranslationRateLimited; } });
Object.defineProperty(exports, "getAIDegradationStrategy", { enumerable: true, get: function () { return ai_rate_limit_guard_1.getAIDegradationStrategy; } });
Object.defineProperty(exports, "getAIRateLimitMetrics", { enumerable: true, get: function () { return ai_rate_limit_guard_1.getAIRateLimitMetrics; } });
Object.defineProperty(exports, "isAnyAIBackpressureActive", { enumerable: true, get: function () { return ai_rate_limit_guard_1.isAnyAIBackpressureActive; } });
Object.defineProperty(exports, "onAIRateLimitEvent", { enumerable: true, get: function () { return ai_rate_limit_guard_1.onAIRateLimitEvent; } });
Object.defineProperty(exports, "shutdownAIRateLimit", { enumerable: true, get: function () { return ai_rate_limit_guard_1.shutdownAIRateLimit; } });
Object.defineProperty(exports, "guardDeepgramRequest", { enumerable: true, get: function () { return ai_rate_limit_guard_1.guardDeepgramRequest; } });
Object.defineProperty(exports, "guardOpenAIRequest", { enumerable: true, get: function () { return ai_rate_limit_guard_1.guardOpenAIRequest; } });
Object.defineProperty(exports, "guardTranslationRequest", { enumerable: true, get: function () { return ai_rate_limit_guard_1.guardTranslationRequest; } });
// Prometheus metrics
Object.defineProperty(exports, "aiRateLimitUtilizationGauge", { enumerable: true, get: function () { return ai_rate_limit_guard_1.aiRateLimitUtilizationGauge; } });
Object.defineProperty(exports, "aiRateLimitWarningCounter", { enumerable: true, get: function () { return ai_rate_limit_guard_1.aiRateLimitWarningCounter; } });
Object.defineProperty(exports, "aiRateLimitBackpressureCounter", { enumerable: true, get: function () { return ai_rate_limit_guard_1.aiRateLimitBackpressureCounter; } });
Object.defineProperty(exports, "aiRateLimitDegradedGauge", { enumerable: true, get: function () { return ai_rate_limit_guard_1.aiRateLimitDegradedGauge; } });
// Socket.IO Metrics
var socket_metrics_1 = require("./socket-metrics");
Object.defineProperty(exports, "socketConnectionsGauge", { enumerable: true, get: function () { return socket_metrics_1.socketConnectionsGauge; } });
Object.defineProperty(exports, "socketRoomsGauge", { enumerable: true, get: function () { return socket_metrics_1.socketRoomsGauge; } });
Object.defineProperty(exports, "socketEventsCounter", { enumerable: true, get: function () { return socket_metrics_1.socketEventsCounter; } });
Object.defineProperty(exports, "socketBroadcastsCounter", { enumerable: true, get: function () { return socket_metrics_1.socketBroadcastsCounter; } });
Object.defineProperty(exports, "socketRedisLatencyGauge", { enumerable: true, get: function () { return socket_metrics_1.socketRedisLatencyGauge; } });
Object.defineProperty(exports, "socketRedisReconnectsCounter", { enumerable: true, get: function () { return socket_metrics_1.socketRedisReconnectsCounter; } });
Object.defineProperty(exports, "socketRedisConnectedGauge", { enumerable: true, get: function () { return socket_metrics_1.socketRedisConnectedGauge; } });
Object.defineProperty(exports, "recordSocketBroadcast", { enumerable: true, get: function () { return socket_metrics_1.recordBroadcast; } });
Object.defineProperty(exports, "recordSocketEvent", { enumerable: true, get: function () { return socket_metrics_1.recordEvent; } });
Object.defineProperty(exports, "updateSocketRedisMetrics", { enumerable: true, get: function () { return socket_metrics_1.updateRedisMetrics; } });
Object.defineProperty(exports, "recordSocketRedisReconnect", { enumerable: true, get: function () { return socket_metrics_1.recordRedisReconnect; } });
Object.defineProperty(exports, "startSocketMetricsCollection", { enumerable: true, get: function () { return socket_metrics_1.startSocketMetricsCollection; } });
Object.defineProperty(exports, "stopSocketMetricsCollection", { enumerable: true, get: function () { return socket_metrics_1.stopSocketMetricsCollection; } });
// Queue Metrics Exporter
var queue_metrics_exporter_1 = require("./queue-metrics.exporter");
Object.defineProperty(exports, "QueueMetricsExporter", { enumerable: true, get: function () { return queue_metrics_exporter_1.QueueMetricsExporter; } });
Object.defineProperty(exports, "getQueueMetricsExporter", { enumerable: true, get: function () { return queue_metrics_exporter_1.getQueueMetricsExporter; } });
Object.defineProperty(exports, "startQueueMetricsExporter", { enumerable: true, get: function () { return queue_metrics_exporter_1.startQueueMetricsExporter; } });
Object.defineProperty(exports, "stopQueueMetricsExporter", { enumerable: true, get: function () { return queue_metrics_exporter_1.stopQueueMetricsExporter; } });
Object.defineProperty(exports, "createQueueMetricsRouter", { enumerable: true, get: function () { return queue_metrics_exporter_1.createQueueMetricsRouter; } });
Object.defineProperty(exports, "queueWaitingJobsSharded", { enumerable: true, get: function () { return queue_metrics_exporter_1.queueWaitingJobsSharded; } });
Object.defineProperty(exports, "queueActiveJobsSharded", { enumerable: true, get: function () { return queue_metrics_exporter_1.queueActiveJobsSharded; } });
Object.defineProperty(exports, "queueCompletedJobsSharded", { enumerable: true, get: function () { return queue_metrics_exporter_1.queueCompletedJobsSharded; } });
Object.defineProperty(exports, "queueFailedJobsSharded", { enumerable: true, get: function () { return queue_metrics_exporter_1.queueFailedJobsSharded; } });
Object.defineProperty(exports, "queueDelayedJobsSharded", { enumerable: true, get: function () { return queue_metrics_exporter_1.queueDelayedJobsSharded; } });
Object.defineProperty(exports, "queueCollectionDurationMs", { enumerable: true, get: function () { return queue_metrics_exporter_1.queueCollectionDurationMs; } });
Object.defineProperty(exports, "queueCollectionErrorsTotal", { enumerable: true, get: function () { return queue_metrics_exporter_1.queueCollectionErrorsTotal; } });
// Redis Health Monitor
var redis_health_monitor_1 = require("./redis-health.monitor");
Object.defineProperty(exports, "redisHealthMonitor", { enumerable: true, get: function () { return redis_health_monitor_1.redisHealthMonitor; } });
Object.defineProperty(exports, "startRedisHealthMonitor", { enumerable: true, get: function () { return redis_health_monitor_1.startRedisHealthMonitor; } });
Object.defineProperty(exports, "stopRedisHealthMonitor", { enumerable: true, get: function () { return redis_health_monitor_1.stopRedisHealthMonitor; } });
Object.defineProperty(exports, "getRedisHealthReport", { enumerable: true, get: function () { return redis_health_monitor_1.getRedisHealthReport; } });
Object.defineProperty(exports, "getLastRedisHealthReport", { enumerable: true, get: function () { return redis_health_monitor_1.getLastRedisHealthReport; } });
Object.defineProperty(exports, "onRedisHealthAlert", { enumerable: true, get: function () { return redis_health_monitor_1.onRedisHealthAlert; } });
// Prometheus metrics
Object.defineProperty(exports, "redisMemoryUsedGauge", { enumerable: true, get: function () { return redis_health_monitor_1.redisMemoryUsedGauge; } });
Object.defineProperty(exports, "redisMemoryMaxGauge", { enumerable: true, get: function () { return redis_health_monitor_1.redisMemoryMaxGauge; } });
Object.defineProperty(exports, "redisMemoryUsageGauge", { enumerable: true, get: function () { return redis_health_monitor_1.redisMemoryUsageGauge; } });
Object.defineProperty(exports, "redisEvictedKeysGauge", { enumerable: true, get: function () { return redis_health_monitor_1.redisEvictedKeysGauge; } });
Object.defineProperty(exports, "redisFragmentationGauge", { enumerable: true, get: function () { return redis_health_monitor_1.redisFragmentationGauge; } });
Object.defineProperty(exports, "redisConnectedClientsGauge", { enumerable: true, get: function () { return redis_health_monitor_1.redisConnectedClientsGauge; } });
Object.defineProperty(exports, "redisBlockedClientsGauge", { enumerable: true, get: function () { return redis_health_monitor_1.redisBlockedClientsGauge; } });
Object.defineProperty(exports, "redisOpsPerSecGauge", { enumerable: true, get: function () { return redis_health_monitor_1.redisOpsPerSecGauge; } });
Object.defineProperty(exports, "redisHitRateGauge", { enumerable: true, get: function () { return redis_health_monitor_1.redisHitRateGauge; } });
Object.defineProperty(exports, "redisHealthAlertsCounter", { enumerable: true, get: function () { return redis_health_monitor_1.redisHealthAlertsCounter; } });
// Queue Lag Monitor
var queue_lag_monitor_1 = require("./queue-lag.monitor");
Object.defineProperty(exports, "queueLagMonitor", { enumerable: true, get: function () { return queue_lag_monitor_1.queueLagMonitor; } });
Object.defineProperty(exports, "withLagTracking", { enumerable: true, get: function () { return queue_lag_monitor_1.withLagTracking; } });
Object.defineProperty(exports, "onQueueLagAlert", { enumerable: true, get: function () { return queue_lag_monitor_1.onQueueLagAlert; } });
Object.defineProperty(exports, "getQueueLagStats", { enumerable: true, get: function () { return queue_lag_monitor_1.getQueueLagStats; } });
Object.defineProperty(exports, "getAllQueueLagStats", { enumerable: true, get: function () { return queue_lag_monitor_1.getAllQueueLagStats; } });
// Prometheus metrics
Object.defineProperty(exports, "queueWaitingLatencyHistogram", { enumerable: true, get: function () { return queue_lag_monitor_1.queueWaitingLatencyHistogram; } });
Object.defineProperty(exports, "queueProcessingLatencyHistogram", { enumerable: true, get: function () { return queue_lag_monitor_1.queueProcessingLatencyHistogram; } });
Object.defineProperty(exports, "queueTotalLatencyHistogram", { enumerable: true, get: function () { return queue_lag_monitor_1.queueTotalLatencyHistogram; } });
Object.defineProperty(exports, "queueLagGauge", { enumerable: true, get: function () { return queue_lag_monitor_1.queueLagGauge; } });
Object.defineProperty(exports, "queueLagAlertsCounter", { enumerable: true, get: function () { return queue_lag_monitor_1.queueLagAlertsCounter; } });
//# sourceMappingURL=index.js.map