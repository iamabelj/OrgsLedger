"use strict";
// ============================================================
// OrgsLedger API — Scaling Module Exports
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
exports.checkMeetingCreationLimit = exports.stopRateGovernor = exports.startRateGovernor = exports.createAIRateLimitMiddleware = exports.createMeetingCreationRateLimitMiddleware = exports.globalRateGovernor = exports.loadShedderRedisMemoryGauge = exports.loadShedderWsConnectionsGauge = exports.loadShedderQueueLatencyGauge = exports.loadShedderActiveMeetingsGauge = exports.loadShedderSheddingGauge = exports.loadShedderRejectionsCounter = exports.reportQueueLatency = exports.reportWsConnections = exports.getLoadShedderStatus = exports.stopLoadShedder = exports.startLoadShedder = exports.createLoadShedderMiddleware = exports.globalLoadShedder = exports.coordinatorErrorsCounter = exports.workerFailuresCounter = exports.meetingRecoveriesCounter = exports.orphanedMeetingsGauge = exports.stuckMeetingsGauge = exports.activeWorkersGauge = exports.activeMeetingsGauge = exports.onCoordinatorEvent = exports.getClusterHealth = exports.getMeetingInfo = exports.sendMeetingHeartbeat = exports.releaseMeeting = exports.claimMeeting = exports.stopMeetingCoordinator = exports.startMeetingCoordinator = exports.globalMeetingCoordinator = exports.GlobalMeetingCoordinator = exports.wsGracefulDisconnectCounter = exports.wsActiveConnectionsGauge = exports.wsConnectionRateGauge = exports.wsConnectionsThrottledCounter = exports.wsConnectionsAcceptedCounter = exports.wsConnectionAttemptsCounter = exports.RECOMMENDED_CLIENT_CONFIG = exports.getReconnectThrottleStats = exports.startGracefulDrain = exports.checkConnection = exports.stopReconnectThrottle = exports.startReconnectThrottle = exports.createThrottleMiddleware = exports.reconnectThrottle = void 0;
exports.globalRateLimitAllowedCounter = exports.globalRateLimitCurrentGauge = exports.globalRateLimitHitsCounter = exports.getRateGovernorStats = exports.checkAIRate = exports.checkTranscriptRate = void 0;
__exportStar(require("./backpressure"), exports);
__exportStar(require("./shard-router"), exports);
__exportStar(require("./worker-identity"), exports);
__exportStar(require("./broadcast-batch"), exports);
__exportStar(require("./ws-throttle"), exports);
// WebSocket Reconnect Throttling
var ws_reconnect_throttle_1 = require("./ws-reconnect-throttle");
Object.defineProperty(exports, "reconnectThrottle", { enumerable: true, get: function () { return ws_reconnect_throttle_1.reconnectThrottle; } });
Object.defineProperty(exports, "createThrottleMiddleware", { enumerable: true, get: function () { return ws_reconnect_throttle_1.createThrottleMiddleware; } });
Object.defineProperty(exports, "startReconnectThrottle", { enumerable: true, get: function () { return ws_reconnect_throttle_1.startReconnectThrottle; } });
Object.defineProperty(exports, "stopReconnectThrottle", { enumerable: true, get: function () { return ws_reconnect_throttle_1.stopReconnectThrottle; } });
Object.defineProperty(exports, "checkConnection", { enumerable: true, get: function () { return ws_reconnect_throttle_1.checkConnection; } });
Object.defineProperty(exports, "startGracefulDrain", { enumerable: true, get: function () { return ws_reconnect_throttle_1.startGracefulDrain; } });
Object.defineProperty(exports, "getReconnectThrottleStats", { enumerable: true, get: function () { return ws_reconnect_throttle_1.getReconnectThrottleStats; } });
Object.defineProperty(exports, "RECOMMENDED_CLIENT_CONFIG", { enumerable: true, get: function () { return ws_reconnect_throttle_1.RECOMMENDED_CLIENT_CONFIG; } });
// Prometheus metrics
Object.defineProperty(exports, "wsConnectionAttemptsCounter", { enumerable: true, get: function () { return ws_reconnect_throttle_1.wsConnectionAttemptsCounter; } });
Object.defineProperty(exports, "wsConnectionsAcceptedCounter", { enumerable: true, get: function () { return ws_reconnect_throttle_1.wsConnectionsAcceptedCounter; } });
Object.defineProperty(exports, "wsConnectionsThrottledCounter", { enumerable: true, get: function () { return ws_reconnect_throttle_1.wsConnectionsThrottledCounter; } });
Object.defineProperty(exports, "wsConnectionRateGauge", { enumerable: true, get: function () { return ws_reconnect_throttle_1.wsConnectionRateGauge; } });
Object.defineProperty(exports, "wsActiveConnectionsGauge", { enumerable: true, get: function () { return ws_reconnect_throttle_1.wsActiveConnectionsGauge; } });
Object.defineProperty(exports, "wsGracefulDisconnectCounter", { enumerable: true, get: function () { return ws_reconnect_throttle_1.wsGracefulDisconnectCounter; } });
// Global Meeting Coordinator
var meeting_coordinator_1 = require("./meeting-coordinator");
Object.defineProperty(exports, "GlobalMeetingCoordinator", { enumerable: true, get: function () { return meeting_coordinator_1.GlobalMeetingCoordinator; } });
Object.defineProperty(exports, "globalMeetingCoordinator", { enumerable: true, get: function () { return meeting_coordinator_1.globalMeetingCoordinator; } });
Object.defineProperty(exports, "startMeetingCoordinator", { enumerable: true, get: function () { return meeting_coordinator_1.startMeetingCoordinator; } });
Object.defineProperty(exports, "stopMeetingCoordinator", { enumerable: true, get: function () { return meeting_coordinator_1.stopMeetingCoordinator; } });
Object.defineProperty(exports, "claimMeeting", { enumerable: true, get: function () { return meeting_coordinator_1.claimMeeting; } });
Object.defineProperty(exports, "releaseMeeting", { enumerable: true, get: function () { return meeting_coordinator_1.releaseMeeting; } });
Object.defineProperty(exports, "sendMeetingHeartbeat", { enumerable: true, get: function () { return meeting_coordinator_1.sendMeetingHeartbeat; } });
Object.defineProperty(exports, "getMeetingInfo", { enumerable: true, get: function () { return meeting_coordinator_1.getMeetingInfo; } });
Object.defineProperty(exports, "getClusterHealth", { enumerable: true, get: function () { return meeting_coordinator_1.getClusterHealth; } });
Object.defineProperty(exports, "onCoordinatorEvent", { enumerable: true, get: function () { return meeting_coordinator_1.onCoordinatorEvent; } });
// Prometheus metrics
Object.defineProperty(exports, "activeMeetingsGauge", { enumerable: true, get: function () { return meeting_coordinator_1.activeMeetingsGauge; } });
Object.defineProperty(exports, "activeWorkersGauge", { enumerable: true, get: function () { return meeting_coordinator_1.activeWorkersGauge; } });
Object.defineProperty(exports, "stuckMeetingsGauge", { enumerable: true, get: function () { return meeting_coordinator_1.stuckMeetingsGauge; } });
Object.defineProperty(exports, "orphanedMeetingsGauge", { enumerable: true, get: function () { return meeting_coordinator_1.orphanedMeetingsGauge; } });
Object.defineProperty(exports, "meetingRecoveriesCounter", { enumerable: true, get: function () { return meeting_coordinator_1.meetingRecoveriesCounter; } });
Object.defineProperty(exports, "workerFailuresCounter", { enumerable: true, get: function () { return meeting_coordinator_1.workerFailuresCounter; } });
Object.defineProperty(exports, "coordinatorErrorsCounter", { enumerable: true, get: function () { return meeting_coordinator_1.coordinatorErrorsCounter; } });
// Global Load Shedder
var global_load_shedder_1 = require("./global-load-shedder");
Object.defineProperty(exports, "globalLoadShedder", { enumerable: true, get: function () { return global_load_shedder_1.globalLoadShedder; } });
Object.defineProperty(exports, "createLoadShedderMiddleware", { enumerable: true, get: function () { return global_load_shedder_1.createLoadShedderMiddleware; } });
Object.defineProperty(exports, "startLoadShedder", { enumerable: true, get: function () { return global_load_shedder_1.startLoadShedder; } });
Object.defineProperty(exports, "stopLoadShedder", { enumerable: true, get: function () { return global_load_shedder_1.stopLoadShedder; } });
Object.defineProperty(exports, "getLoadShedderStatus", { enumerable: true, get: function () { return global_load_shedder_1.getLoadShedderStatus; } });
Object.defineProperty(exports, "reportWsConnections", { enumerable: true, get: function () { return global_load_shedder_1.reportWsConnections; } });
Object.defineProperty(exports, "reportQueueLatency", { enumerable: true, get: function () { return global_load_shedder_1.reportQueueLatency; } });
// Prometheus metrics
Object.defineProperty(exports, "loadShedderRejectionsCounter", { enumerable: true, get: function () { return global_load_shedder_1.loadShedderRejectionsCounter; } });
Object.defineProperty(exports, "loadShedderSheddingGauge", { enumerable: true, get: function () { return global_load_shedder_1.loadShedderSheddingGauge; } });
Object.defineProperty(exports, "loadShedderActiveMeetingsGauge", { enumerable: true, get: function () { return global_load_shedder_1.loadShedderActiveMeetingsGauge; } });
Object.defineProperty(exports, "loadShedderQueueLatencyGauge", { enumerable: true, get: function () { return global_load_shedder_1.loadShedderQueueLatencyGauge; } });
Object.defineProperty(exports, "loadShedderWsConnectionsGauge", { enumerable: true, get: function () { return global_load_shedder_1.loadShedderWsConnectionsGauge; } });
Object.defineProperty(exports, "loadShedderRedisMemoryGauge", { enumerable: true, get: function () { return global_load_shedder_1.loadShedderRedisMemoryGauge; } });
// Global Rate Governor
var global_rate_governor_1 = require("./global-rate-governor");
Object.defineProperty(exports, "globalRateGovernor", { enumerable: true, get: function () { return global_rate_governor_1.globalRateGovernor; } });
Object.defineProperty(exports, "createMeetingCreationRateLimitMiddleware", { enumerable: true, get: function () { return global_rate_governor_1.createMeetingCreationRateLimitMiddleware; } });
Object.defineProperty(exports, "createAIRateLimitMiddleware", { enumerable: true, get: function () { return global_rate_governor_1.createAIRateLimitMiddleware; } });
Object.defineProperty(exports, "startRateGovernor", { enumerable: true, get: function () { return global_rate_governor_1.startRateGovernor; } });
Object.defineProperty(exports, "stopRateGovernor", { enumerable: true, get: function () { return global_rate_governor_1.stopRateGovernor; } });
Object.defineProperty(exports, "checkMeetingCreationLimit", { enumerable: true, get: function () { return global_rate_governor_1.checkMeetingCreationLimit; } });
Object.defineProperty(exports, "checkTranscriptRate", { enumerable: true, get: function () { return global_rate_governor_1.checkTranscriptRate; } });
Object.defineProperty(exports, "checkAIRate", { enumerable: true, get: function () { return global_rate_governor_1.checkAIRate; } });
Object.defineProperty(exports, "getRateGovernorStats", { enumerable: true, get: function () { return global_rate_governor_1.getRateGovernorStats; } });
// Prometheus metrics
Object.defineProperty(exports, "globalRateLimitHitsCounter", { enumerable: true, get: function () { return global_rate_governor_1.globalRateLimitHitsCounter; } });
Object.defineProperty(exports, "globalRateLimitCurrentGauge", { enumerable: true, get: function () { return global_rate_governor_1.globalRateLimitCurrentGauge; } });
Object.defineProperty(exports, "globalRateLimitAllowedCounter", { enumerable: true, get: function () { return global_rate_governor_1.globalRateLimitAllowedCounter; } });
//# sourceMappingURL=index.js.map