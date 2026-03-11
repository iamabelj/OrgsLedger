// ============================================================
// OrgsLedger API — Socket.IO Metrics
// Prometheus metrics for WebSocket connections and events
// ============================================================

import * as client from 'prom-client';
import os from 'os';
import { logger } from '../logger';
import { getSocketStats } from '../socket';

// ── Constants ───────────────────────────────────────────────

const PREFIX = 'orgsledger_socket_';
const WORKER_ID = `${os.hostname()}-${process.pid}`;
const METRICS_COLLECTION_INTERVAL_MS = 15000; // 15 seconds

// ── Metrics ─────────────────────────────────────────────────

// Connection gauges
export const socketConnectionsGauge = new client.Gauge({
  name: `${PREFIX}connections_total`,
  help: 'Current number of active Socket.IO connections',
  labelNames: ['worker_id'],
});

export const socketRoomsGauge = new client.Gauge({
  name: `${PREFIX}rooms_total`,
  help: 'Current number of Socket.IO rooms',
  labelNames: ['worker_id', 'room_type'],
});

// Event counters
export const socketEventsCounter = new client.Counter({
  name: `${PREFIX}events_total`,
  help: 'Total number of Socket.IO events emitted',
  labelNames: ['worker_id', 'event_type'],
});

export const socketBroadcastsCounter = new client.Counter({
  name: `${PREFIX}broadcasts_total`,
  help: 'Total number of room broadcasts',
  labelNames: ['worker_id', 'room_type'],
});

// Redis adapter metrics
export const socketRedisLatencyGauge = new client.Gauge({
  name: `${PREFIX}redis_latency_ms`,
  help: 'Redis pub/sub latency in milliseconds',
  labelNames: ['worker_id'],
});

export const socketRedisReconnectsCounter = new client.Counter({
  name: `${PREFIX}redis_reconnects_total`,
  help: 'Total number of Redis reconnection attempts',
  labelNames: ['worker_id'],
});

export const socketRedisConnectedGauge = new client.Gauge({
  name: `${PREFIX}redis_connected`,
  help: 'Whether Redis pub/sub is connected (1 = yes, 0 = no)',
  labelNames: ['worker_id'],
});

// ── Helper Functions ────────────────────────────────────────

/**
 * Increment broadcast counter for a specific room type.
 */
export function recordBroadcast(roomType: 'meeting' | 'channel' | 'user' | 'org' | 'ledger'): void {
  socketBroadcastsCounter.inc({ worker_id: WORKER_ID, room_type: roomType });
}

/**
 * Increment event counter for a specific event type.
 */
export function recordEvent(eventType: string): void {
  socketEventsCounter.inc({ worker_id: WORKER_ID, event_type: eventType });
}

/**
 * Update Redis connection status metrics.
 */
export function updateRedisMetrics(connected: boolean, latencyMs: number | null): void {
  socketRedisConnectedGauge.set({ worker_id: WORKER_ID }, connected ? 1 : 0);
  if (latencyMs !== null) {
    socketRedisLatencyGauge.set({ worker_id: WORKER_ID }, latencyMs);
  }
}

/**
 * Record a Redis reconnection attempt.
 */
export function recordRedisReconnect(): void {
  socketRedisReconnectsCounter.inc({ worker_id: WORKER_ID });
}

// ── Metrics Collection ──────────────────────────────────────

let metricsInterval: NodeJS.Timeout | null = null;

/**
 * Start periodic metrics collection.
 */
export function startSocketMetricsCollection(): void {
  if (metricsInterval) return;

  logger.info('[SOCKET_METRICS] Starting metrics collection', {
    workerId: WORKER_ID,
    intervalMs: METRICS_COLLECTION_INTERVAL_MS,
  });

  metricsInterval = setInterval(() => {
    try {
      const stats = getSocketStats();

      // Update connection gauge
      socketConnectionsGauge.set({ worker_id: WORKER_ID }, stats.totalConnections);

      // Update room gauges by type
      socketRoomsGauge.set({ worker_id: WORKER_ID, room_type: 'meeting' }, stats.meetingRooms);
      socketRoomsGauge.set({ worker_id: WORKER_ID, room_type: 'user' }, stats.userRooms);
      socketRoomsGauge.set({ worker_id: WORKER_ID, room_type: 'channel' }, stats.channelRooms);
      socketRoomsGauge.set({ worker_id: WORKER_ID, room_type: 'total' }, stats.activeRooms);
    } catch (err) {
      logger.error('[SOCKET_METRICS] Failed to collect metrics', {
        error: err instanceof Error ? err.message : String(err),
        workerId: WORKER_ID,
      });
    }
  }, METRICS_COLLECTION_INTERVAL_MS);
}

/**
 * Stop metrics collection.
 */
export function stopSocketMetricsCollection(): void {
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
    logger.info('[SOCKET_METRICS] Stopped metrics collection', {
      workerId: WORKER_ID,
    });
  }
}

// ── Exports ─────────────────────────────────────────────────

export { WORKER_ID };
