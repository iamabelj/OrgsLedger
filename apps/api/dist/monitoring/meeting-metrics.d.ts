import * as client from 'prom-client';
export declare const PIPELINE_STAGES: readonly ["transcription", "translation", "broadcast"];
export type PipelineStage = typeof PIPELINE_STAGES[number];
export interface MeetingPipelineMetrics {
    id: string;
    meeting_id: string;
    transcripts_generated: number;
    translations_generated: number;
    broadcast_events: number;
    minutes_generation_ms: number | null;
    created_at: Date;
    updated_at: Date;
}
export interface MeetingMetricsSummary {
    meetingId: string;
    transcriptsGenerated: number;
    translationsGenerated: number;
    broadcastEvents: number;
    minutesGenerationMs: number | null;
    createdAt: string;
    updatedAt: string;
}
export interface PercentileSnapshot {
    stage: PipelineStage;
    count: number;
    p50: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
    avg: number;
}
export interface PipelineLatencyReport {
    timestamp: string;
    stages: PercentileSnapshot[];
    totalPipeline: {
        count: number;
        p50: number;
        p95: number;
        p99: number;
        min: number;
        max: number;
        avg: number;
    };
}
export declare const pipelineStageLatencyHistogram: client.Histogram<"stage">;
export declare const pipelineLatencyHistogram: client.Histogram<string>;
export declare const pipelineStageLatencyGauge: client.Gauge<"stage">;
/**
 * Record transcription stage latency.
 * Non-blocking — never throws.
 */
export declare function recordTranscriptionLatency(meetingId: string, latencyMs: number): void;
/**
 * Record translation stage latency.
 * Non-blocking — never throws.
 */
export declare function recordTranslationLatency(meetingId: string, latencyMs: number): void;
/**
 * Record broadcast stage latency.
 * Non-blocking — never throws.
 */
export declare function recordBroadcastLatency(meetingId: string, latencyMs: number): void;
/**
 * Record total pipeline latency (audio-in → broadcast-out).
 * Non-blocking — never throws.
 */
export declare function recordPipelineLatency(meetingId: string, latencyMs: number): void;
/**
 * Get rolling-window latency percentile report (in-memory, no DB hit).
 */
export declare function getLatencyReport(): PipelineLatencyReport;
/**
 * Query historical per-stage latency percentiles from PostgreSQL.
 * @param hours Look-back window (default 24)
 */
export declare function getHistoricalLatencyReport(hours?: number): Promise<PercentileSnapshot[]>;
/**
 * Get Grafana-compatible JSON metrics for dashboard panels.
 */
export declare function getGrafanaMetrics(): {
    targets: Array<{
        target: string;
        datapoints: Array<[number, number]>;
    }>;
};
/**
 * Start periodic flush and retention timers.
 * Safe to call multiple times — idempotent.
 */
export declare function startMeetingMetrics(): void;
/**
 * Stop timers and flush remaining buffered rows.
 */
export declare function stopMeetingMetrics(): Promise<void>;
/**
 * Increment transcripts_generated for a meeting
 * Non-blocking - never throws
 */
export declare function incrementTranscriptsGenerated(meetingId: string): Promise<void>;
/**
 * Increment translations_generated for a meeting
 * Non-blocking - never throws
 */
export declare function incrementTranslationsGenerated(meetingId: string): Promise<void>;
/**
 * Increment broadcast_events for a meeting
 * Non-blocking - never throws
 */
export declare function incrementBroadcastEvents(meetingId: string): Promise<void>;
/**
 * Store minutes generation duration for a meeting
 * Non-blocking - never throws
 */
export declare function storeMinutesGenerationMs(meetingId: string, durationMs: number): Promise<void>;
/**
 * Get metrics for a specific meeting
 */
export declare function getMeetingMetrics(meetingId: string): Promise<MeetingMetricsSummary | null>;
/**
 * Delete metrics for a meeting (cleanup)
 */
export declare function deleteMeetingMetrics(meetingId: string): Promise<void>;
//# sourceMappingURL=meeting-metrics.d.ts.map