// ============================================================
// OrgsLedger API — Scaling Module Exports
// ============================================================

export * from './backpressure';
export * from './shard-router';
export * from './worker-identity';
export * from './broadcast-batch';
export * from './ws-throttle';

// WebSocket Reconnect Throttling
export {
  reconnectThrottle,
  createThrottleMiddleware,
  startReconnectThrottle,
  stopReconnectThrottle,
  checkConnection,
  startGracefulDrain,
  getReconnectThrottleStats,
  RECOMMENDED_CLIENT_CONFIG,
  // Prometheus metrics
  wsConnectionAttemptsCounter,
  wsConnectionsAcceptedCounter,
  wsConnectionsThrottledCounter,
  wsConnectionRateGauge,
  wsActiveConnectionsGauge,
  wsGracefulDisconnectCounter,
} from './ws-reconnect-throttle';

export type {
  ThrottleResult,
} from './ws-reconnect-throttle';

// Global Meeting Coordinator
export {
  GlobalMeetingCoordinator,
  globalMeetingCoordinator,
  startMeetingCoordinator,
  stopMeetingCoordinator,
  claimMeeting,
  releaseMeeting,
  sendMeetingHeartbeat,
  getMeetingInfo,
  getClusterHealth,
  onCoordinatorEvent,
  // Prometheus metrics
  activeMeetingsGauge,
  activeWorkersGauge,
  stuckMeetingsGauge,
  orphanedMeetingsGauge,
  meetingRecoveriesCounter,
  workerFailuresCounter,
  coordinatorErrorsCounter,
} from './meeting-coordinator';

export type {
  MeetingState,
  MeetingInfo,
  WorkerInfo,
  ClusterHealth,
  CoordinatorEvent,
} from './meeting-coordinator';

// Global Load Shedder
export {
  globalLoadShedder,
  createLoadShedderMiddleware,
  startLoadShedder,
  stopLoadShedder,
  getLoadShedderStatus,
  reportWsConnections,
  reportQueueLatency,
  // Prometheus metrics
  loadShedderRejectionsCounter,
  loadShedderSheddingGauge,
  loadShedderActiveMeetingsGauge,
  loadShedderQueueLatencyGauge,
  loadShedderWsConnectionsGauge,
  loadShedderRedisMemoryGauge,
} from './global-load-shedder';

export type {
  LoadShedderConfig,
  SystemPressure,
  LoadShedderStatus,
} from './global-load-shedder';

// Global Rate Governor
export {
  globalRateGovernor,
  createMeetingCreationRateLimitMiddleware,
  createAIRateLimitMiddleware,
  startRateGovernor,
  stopRateGovernor,
  checkMeetingCreationLimit,
  checkTranscriptRate,
  checkAIRate,
  getRateGovernorStats,
  // Prometheus metrics
  globalRateLimitHitsCounter,
  globalRateLimitCurrentGauge,
  globalRateLimitAllowedCounter,
} from './global-rate-governor';

export type {
  RateLimitType,
  RateLimitResult,
  RateGovernorStats,
  RateGovernorConfig,
} from './global-rate-governor';
