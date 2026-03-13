"use strict";
// ============================================================
// OrgsLedger API — Socket.IO Metrics
// Prometheus metrics for WebSocket connections and events
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKER_ID = exports.socketRedisConnectedGauge = exports.socketRedisReconnectsCounter = exports.socketRedisLatencyGauge = exports.socketBroadcastsCounter = exports.socketEventsCounter = exports.socketRoomsGauge = exports.socketConnectionsGauge = void 0;
exports.recordBroadcast = recordBroadcast;
exports.recordEvent = recordEvent;
exports.updateRedisMetrics = updateRedisMetrics;
exports.recordRedisReconnect = recordRedisReconnect;
exports.startSocketMetricsCollection = startSocketMetricsCollection;
exports.stopSocketMetricsCollection = stopSocketMetricsCollection;
const client = __importStar(require("prom-client"));
const os_1 = __importDefault(require("os"));
const logger_1 = require("../logger");
const socket_1 = require("../socket");
// ── Constants ───────────────────────────────────────────────
const PREFIX = 'orgsledger_socket_';
const WORKER_ID = `${os_1.default.hostname()}-${process.pid}`;
exports.WORKER_ID = WORKER_ID;
const METRICS_COLLECTION_INTERVAL_MS = 15000; // 15 seconds
// ── Metrics ─────────────────────────────────────────────────
// Connection gauges
exports.socketConnectionsGauge = new client.Gauge({
    name: `${PREFIX}connections_total`,
    help: 'Current number of active Socket.IO connections',
    labelNames: ['worker_id'],
});
exports.socketRoomsGauge = new client.Gauge({
    name: `${PREFIX}rooms_total`,
    help: 'Current number of Socket.IO rooms',
    labelNames: ['worker_id', 'room_type'],
});
// Event counters
exports.socketEventsCounter = new client.Counter({
    name: `${PREFIX}events_total`,
    help: 'Total number of Socket.IO events emitted',
    labelNames: ['worker_id', 'event_type'],
});
exports.socketBroadcastsCounter = new client.Counter({
    name: `${PREFIX}broadcasts_total`,
    help: 'Total number of room broadcasts',
    labelNames: ['worker_id', 'room_type'],
});
// Redis adapter metrics
exports.socketRedisLatencyGauge = new client.Gauge({
    name: `${PREFIX}redis_latency_ms`,
    help: 'Redis pub/sub latency in milliseconds',
    labelNames: ['worker_id'],
});
exports.socketRedisReconnectsCounter = new client.Counter({
    name: `${PREFIX}redis_reconnects_total`,
    help: 'Total number of Redis reconnection attempts',
    labelNames: ['worker_id'],
});
exports.socketRedisConnectedGauge = new client.Gauge({
    name: `${PREFIX}redis_connected`,
    help: 'Whether Redis pub/sub is connected (1 = yes, 0 = no)',
    labelNames: ['worker_id'],
});
// ── Helper Functions ────────────────────────────────────────
/**
 * Increment broadcast counter for a specific room type.
 */
function recordBroadcast(roomType) {
    exports.socketBroadcastsCounter.inc({ worker_id: WORKER_ID, room_type: roomType });
}
/**
 * Increment event counter for a specific event type.
 */
function recordEvent(eventType) {
    exports.socketEventsCounter.inc({ worker_id: WORKER_ID, event_type: eventType });
}
/**
 * Update Redis connection status metrics.
 */
function updateRedisMetrics(connected, latencyMs) {
    exports.socketRedisConnectedGauge.set({ worker_id: WORKER_ID }, connected ? 1 : 0);
    if (latencyMs !== null) {
        exports.socketRedisLatencyGauge.set({ worker_id: WORKER_ID }, latencyMs);
    }
}
/**
 * Record a Redis reconnection attempt.
 */
function recordRedisReconnect() {
    exports.socketRedisReconnectsCounter.inc({ worker_id: WORKER_ID });
}
// ── Metrics Collection ──────────────────────────────────────
let metricsInterval = null;
/**
 * Start periodic metrics collection.
 */
function startSocketMetricsCollection() {
    if (metricsInterval)
        return;
    logger_1.logger.info('[SOCKET_METRICS] Starting metrics collection', {
        workerId: WORKER_ID,
        intervalMs: METRICS_COLLECTION_INTERVAL_MS,
    });
    metricsInterval = setInterval(() => {
        try {
            const stats = (0, socket_1.getSocketStats)();
            // Update connection gauge
            exports.socketConnectionsGauge.set({ worker_id: WORKER_ID }, stats.totalConnections);
            // Update room gauges by type
            exports.socketRoomsGauge.set({ worker_id: WORKER_ID, room_type: 'meeting' }, stats.meetingRooms);
            exports.socketRoomsGauge.set({ worker_id: WORKER_ID, room_type: 'user' }, stats.userRooms);
            exports.socketRoomsGauge.set({ worker_id: WORKER_ID, room_type: 'channel' }, stats.channelRooms);
            exports.socketRoomsGauge.set({ worker_id: WORKER_ID, room_type: 'total' }, stats.activeRooms);
        }
        catch (err) {
            logger_1.logger.error('[SOCKET_METRICS] Failed to collect metrics', {
                error: err instanceof Error ? err.message : String(err),
                workerId: WORKER_ID,
            });
        }
    }, METRICS_COLLECTION_INTERVAL_MS);
}
/**
 * Stop metrics collection.
 */
function stopSocketMetricsCollection() {
    if (metricsInterval) {
        clearInterval(metricsInterval);
        metricsInterval = null;
        logger_1.logger.info('[SOCKET_METRICS] Stopped metrics collection', {
            workerId: WORKER_ID,
        });
    }
}
//# sourceMappingURL=socket-metrics.js.map