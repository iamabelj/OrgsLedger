import * as client from 'prom-client';
declare const WORKER_ID: string;
export declare const socketConnectionsGauge: client.Gauge<"worker_id">;
export declare const socketRoomsGauge: client.Gauge<"worker_id" | "room_type">;
export declare const socketEventsCounter: client.Counter<"worker_id" | "event_type">;
export declare const socketBroadcastsCounter: client.Counter<"worker_id" | "room_type">;
export declare const socketRedisLatencyGauge: client.Gauge<"worker_id">;
export declare const socketRedisReconnectsCounter: client.Counter<"worker_id">;
export declare const socketRedisConnectedGauge: client.Gauge<"worker_id">;
/**
 * Increment broadcast counter for a specific room type.
 */
export declare function recordBroadcast(roomType: 'meeting' | 'channel' | 'user' | 'org' | 'ledger'): void;
/**
 * Increment event counter for a specific event type.
 */
export declare function recordEvent(eventType: string): void;
/**
 * Update Redis connection status metrics.
 */
export declare function updateRedisMetrics(connected: boolean, latencyMs: number | null): void;
/**
 * Record a Redis reconnection attempt.
 */
export declare function recordRedisReconnect(): void;
/**
 * Start periodic metrics collection.
 */
export declare function startSocketMetricsCollection(): void;
/**
 * Stop metrics collection.
 */
export declare function stopSocketMetricsCollection(): void;
export { WORKER_ID };
//# sourceMappingURL=socket-metrics.d.ts.map