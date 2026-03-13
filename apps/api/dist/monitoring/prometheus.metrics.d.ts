import * as client from 'prom-client';
import { Router } from 'express';
export declare const aiDeepgramMinutesTotal: client.Gauge<string>;
export declare const aiOpenaiTokensTotal: client.Gauge<"type">;
export declare const aiTranslationCharactersTotal: client.Gauge<string>;
export declare const aiEstimatedCostUsd: client.Gauge<string>;
export declare const queueWaitingJobs: client.Gauge<"queue">;
export declare const queueActiveJobs: client.Gauge<"queue">;
export declare const queueFailedJobs: client.Gauge<"queue">;
export declare const queueStuckJobs: client.Gauge<"queue">;
export declare const workerProcessedJobsTotal: client.Gauge<"worker">;
export declare const workerFailedJobsTotal: client.Gauge<"worker">;
export declare const workerHealthy: client.Gauge<"worker">;
export declare const workerLastHeartbeatAgeMs: client.Gauge<"worker">;
export declare const pipelineBroadcastLatencyMs: client.Gauge<string>;
export declare const pipelineMinutesGenerationMs: client.Gauge<string>;
export declare const pipelineTranscriptThroughput: client.Gauge<string>;
export declare const pipelineTranslationThroughput: client.Gauge<string>;
export declare const systemRedisConnected: client.Gauge<string>;
export declare const systemRedisLatencyMs: client.Gauge<string>;
export declare const systemPostgresConnected: client.Gauge<string>;
export declare const systemPostgresLatencyMs: client.Gauge<string>;
export declare const systemOverallStatus: client.Gauge<string>;
export declare const systemAlertCount: client.Gauge<string>;
export declare const recoveryJobsRecovered: client.Counter<"queue">;
export declare const recoveryJobsFailed: client.Counter<"queue">;
export interface PrometheusMetricsUpdate {
    ai?: {
        deepgramMinutes: number;
        openaiInputTokens: number;
        openaiOutputTokens: number;
        translationCharacters: number;
        estimatedCostUsd: number;
    };
    queues?: Array<{
        name: string;
        waiting: number;
        active: number;
        failed: number;
        stuckJobs: number;
    }>;
    workers?: Array<{
        name: string;
        processed: number;
        failed: number;
        healthy: boolean;
        heartbeatAgeMs: number;
    }>;
    pipeline?: {
        broadcastLatencyMs: number;
        minutesGenerationMs: number;
        transcriptThroughputPerMin: number;
        translationThroughputPerMin: number;
    };
    system?: {
        redisConnected: boolean;
        redisLatencyMs: number;
        postgresConnected: boolean;
        postgresLatencyMs: number;
        overallStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
        alertCount: number;
    };
}
/**
 * Update all Prometheus metrics with current values
 * Called every monitoring cycle from SystemMonitor
 */
export declare function updatePrometheusMetrics(data: PrometheusMetricsUpdate): void;
/**
 * Increment recovery counters
 */
export declare function incrementRecoveryMetrics(queueName: string, action: 'recovered' | 'failed'): void;
/**
 * Create Express router for /metrics endpoint
 */
export declare function createMetricsRouter(): Router;
/**
 * Get the Prometheus registry (for testing or custom integrations)
 */
export declare function getRegistry(): client.Registry;
/**
 * Get metrics as string (for debugging)
 */
export declare function getMetricsString(): Promise<string>;
declare const _default: {
    updatePrometheusMetrics: typeof updatePrometheusMetrics;
    incrementRecoveryMetrics: typeof incrementRecoveryMetrics;
    createMetricsRouter: typeof createMetricsRouter;
    getRegistry: typeof getRegistry;
    getMetricsString: typeof getMetricsString;
};
export default _default;
//# sourceMappingURL=prometheus.metrics.d.ts.map