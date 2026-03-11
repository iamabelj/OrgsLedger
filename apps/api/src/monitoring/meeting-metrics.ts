// ============================================================
// OrgsLedger API — Meeting Pipeline Metrics
// Per-meeting metrics tracking for pipeline observability
// ============================================================
//
// Pipeline: audio → transcription → translation → broadcast
//
// Tracks:
//   - Per-stage latency (transcription, translation, broadcast)
//   - Total pipeline latency (audio-in → broadcast-out)
//   - Per-meeting event counters
//   - Prometheus histograms with p50/p95/p99
//   - PostgreSQL persistence for historical analysis
//
// ============================================================

import * as client from 'prom-client';
import { db } from '../db';
import { logger } from '../logger';

// ── Constants ───────────────────────────────────────────────

const PREFIX = 'orgsledger_';

export const PIPELINE_STAGES = ['transcription', 'translation', 'broadcast'] as const;
export type PipelineStage = typeof PIPELINE_STAGES[number];

const LATENCY_BUFFER_SIZE = 50;
const LATENCY_FLUSH_INTERVAL_MS = 30_000; // 30 seconds
const ROLLING_WINDOW_SIZE = 1000; // keep last 1000 samples per stage for percentiles
const RETENTION_DAYS = 30;
const RETENTION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

// ── Types ───────────────────────────────────────────────────

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

interface LatencyRow {
  meeting_id: string;
  stage: PipelineStage;
  latency_ms: number;
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

// ── Prometheus Metrics ──────────────────────────────────────

// Use the default registry so these are collected alongside all other orgsledger_ metrics
const defaultRegister = client.register;

export const pipelineStageLatencyHistogram = new client.Histogram({
  name: `${PREFIX}pipeline_stage_latency_ms`,
  help: 'Pipeline per-stage latency in milliseconds',
  labelNames: ['stage'] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [defaultRegister],
});

export const pipelineLatencyHistogram = new client.Histogram({
  name: `${PREFIX}pipeline_latency_ms`,
  help: 'Total pipeline latency (audio-in to broadcast-out) in milliseconds',
  buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
  registers: [defaultRegister],
});

export const pipelineStageLatencyGauge = new client.Gauge({
  name: `${PREFIX}pipeline_stage_latency_p95_ms`,
  help: 'Pipeline per-stage p95 latency in milliseconds (rolling window)',
  labelNames: ['stage'] as const,
  registers: [defaultRegister],
});

// ── In-Memory Rolling Window ────────────────────────────────

class RollingLatencyWindow {
  private samples: Map<PipelineStage, number[]> = new Map();
  private totalPipelineSamples: number[] = [];

  constructor(private maxSize: number) {
    for (const stage of PIPELINE_STAGES) {
      this.samples.set(stage, []);
    }
  }

  push(stage: PipelineStage, latencyMs: number): void {
    const arr = this.samples.get(stage)!;
    arr.push(latencyMs);
    if (arr.length > this.maxSize) {
      arr.shift();
    }
  }

  pushTotalPipeline(latencyMs: number): void {
    this.totalPipelineSamples.push(latencyMs);
    if (this.totalPipelineSamples.length > this.maxSize) {
      this.totalPipelineSamples.shift();
    }
  }

  getStageSnapshot(stage: PipelineStage): PercentileSnapshot {
    const arr = this.samples.get(stage) ?? [];
    return { stage, ...computePercentiles(arr) };
  }

  getTotalPipelineStats(): { count: number; p50: number; p95: number; p99: number; min: number; max: number; avg: number } {
    return computePercentiles(this.totalPipelineSamples);
  }

  getReport(): PipelineLatencyReport {
    return {
      timestamp: new Date().toISOString(),
      stages: PIPELINE_STAGES.map(s => this.getStageSnapshot(s)),
      totalPipeline: this.getTotalPipelineStats(),
    };
  }
}

function computePercentiles(arr: number[]): { count: number; p50: number; p95: number; p99: number; min: number; max: number; avg: number } {
  if (arr.length === 0) {
    return { count: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
  }
  const sorted = [...arr].sort((a, b) => a - b);
  const len = sorted.length;
  const sum = sorted.reduce((s, v) => s + v, 0);
  return {
    count: len,
    p50: sorted[Math.floor(len * 0.5)],
    p95: sorted[Math.floor(len * 0.95)],
    p99: sorted[Math.floor(len * 0.99)],
    min: sorted[0],
    max: sorted[len - 1],
    avg: Math.round((sum / len) * 100) / 100,
  };
}

// ── Singleton State ─────────────────────────────────────────

const rollingWindow = new RollingLatencyWindow(ROLLING_WINDOW_SIZE);
let latencyBuffer: LatencyRow[] = [];
let flushIntervalId: NodeJS.Timeout | null = null;
let retentionIntervalId: NodeJS.Timeout | null = null;

// ── Latency Recording Functions ─────────────────────────────

/**
 * Record transcription stage latency.
 * Non-blocking — never throws.
 */
export function recordTranscriptionLatency(meetingId: string, latencyMs: number): void {
  recordStageLatency(meetingId, 'transcription', latencyMs);
}

/**
 * Record translation stage latency.
 * Non-blocking — never throws.
 */
export function recordTranslationLatency(meetingId: string, latencyMs: number): void {
  recordStageLatency(meetingId, 'translation', latencyMs);
}

/**
 * Record broadcast stage latency.
 * Non-blocking — never throws.
 */
export function recordBroadcastLatency(meetingId: string, latencyMs: number): void {
  recordStageLatency(meetingId, 'broadcast', latencyMs);
}

/**
 * Record total pipeline latency (audio-in → broadcast-out).
 * Non-blocking — never throws.
 */
export function recordPipelineLatency(meetingId: string, latencyMs: number): void {
  try {
    pipelineLatencyHistogram.observe(latencyMs);
    rollingWindow.pushTotalPipeline(latencyMs);

    logger.debug('[MEETING_METRICS] Pipeline latency recorded', { meetingId, latencyMs });
  } catch (err) {
    logger.debug('[MEETING_METRICS] Failed to record pipeline latency', { error: (err as Error).message });
  }
}

function recordStageLatency(meetingId: string, stage: PipelineStage, latencyMs: number): void {
  try {
    // 1. Prometheus histogram
    pipelineStageLatencyHistogram.labels(stage).observe(latencyMs);

    // 2. In-memory rolling window for percentiles
    rollingWindow.push(stage, latencyMs);

    // 3. Buffer for batched PostgreSQL insert
    latencyBuffer.push({ meeting_id: meetingId, stage, latency_ms: latencyMs });

    if (latencyBuffer.length >= LATENCY_BUFFER_SIZE) {
      flushLatencyBuffer().catch(err => {
        logger.debug('[MEETING_METRICS] Background flush failed', { error: (err as Error).message });
      });
    }

    logger.debug('[MEETING_METRICS] Stage latency recorded', { meetingId, stage, latencyMs });
  } catch (err) {
    logger.debug('[MEETING_METRICS] Failed to record stage latency', {
      meetingId, stage, error: (err as Error).message,
    });
  }
}

// ── PostgreSQL Persistence ──────────────────────────────────

async function flushLatencyBuffer(): Promise<void> {
  if (latencyBuffer.length === 0) return;

  const rows = [...latencyBuffer];
  latencyBuffer = [];

  try {
    await db('meeting_pipeline_latency').insert(rows);
    logger.debug('[MEETING_METRICS] Flushed latency buffer', { rowCount: rows.length });
  } catch (err: any) {
    logger.error('[MEETING_METRICS] Latency flush failed', { error: err.message, rowCount: rows.length });
    // Re-queue (bounded)
    if (latencyBuffer.length < 500) {
      latencyBuffer.unshift(...rows);
    }
  }
}

async function runRetentionCleanup(): Promise<void> {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const deleted = await db('meeting_pipeline_latency').where('created_at', '<', cutoff).delete();
    if (deleted > 0) {
      logger.info('[MEETING_METRICS] Retention cleanup', { deletedRows: deleted, retentionDays: RETENTION_DAYS });
    }
  } catch (err: any) {
    logger.error('[MEETING_METRICS] Retention cleanup failed', { error: err.message });
  }
}

// ── Percentile Queries ──────────────────────────────────────

/**
 * Get rolling-window latency percentile report (in-memory, no DB hit).
 */
export function getLatencyReport(): PipelineLatencyReport {
  // Update Prometheus p95 gauges as a side-effect
  for (const stage of PIPELINE_STAGES) {
    const snap = rollingWindow.getStageSnapshot(stage);
    pipelineStageLatencyGauge.labels(stage).set(snap.p95);
  }
  return rollingWindow.getReport();
}

/**
 * Query historical per-stage latency percentiles from PostgreSQL.
 * @param hours Look-back window (default 24)
 */
export async function getHistoricalLatencyReport(hours = 24): Promise<PercentileSnapshot[]> {
  try {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hours);

    const results: PercentileSnapshot[] = [];

    for (const stage of PIPELINE_STAGES) {
      const rows = await db('meeting_pipeline_latency')
        .where('stage', stage)
        .where('created_at', '>=', cutoff)
        .select('latency_ms')
        .orderBy('latency_ms', 'asc');

      const values = rows.map((r: { latency_ms: number }) => r.latency_ms);
      results.push({ stage, ...computePercentiles(values) });
    }

    return results;
  } catch (err: any) {
    logger.error('[MEETING_METRICS] Historical latency query failed', { error: err.message });
    return [];
  }
}

/**
 * Get Grafana-compatible JSON metrics for dashboard panels.
 */
export function getGrafanaMetrics(): {
  targets: Array<{
    target: string;
    datapoints: Array<[number, number]>;
  }>;
} {
  const report = getLatencyReport();
  const now = Date.now();

  return {
    targets: [
      ...report.stages.map(s => ({
        target: `pipeline.${s.stage}.p95`,
        datapoints: [[s.p95, now]] as Array<[number, number]>,
      })),
      ...report.stages.map(s => ({
        target: `pipeline.${s.stage}.p50`,
        datapoints: [[s.p50, now]] as Array<[number, number]>,
      })),
      {
        target: 'pipeline.total.p95',
        datapoints: [[report.totalPipeline.p95, now]],
      },
      {
        target: 'pipeline.total.p50',
        datapoints: [[report.totalPipeline.p50, now]],
      },
    ],
  };
}

// ── Lifecycle ───────────────────────────────────────────────

/**
 * Start periodic flush and retention timers.
 * Safe to call multiple times — idempotent.
 */
export function startMeetingMetrics(): void {
  if (flushIntervalId) return;

  flushIntervalId = setInterval(() => {
    flushLatencyBuffer().catch(err => {
      logger.debug('[MEETING_METRICS] Periodic flush failed', { error: (err as Error).message });
    });
  }, LATENCY_FLUSH_INTERVAL_MS);

  retentionIntervalId = setInterval(() => {
    runRetentionCleanup().catch(err => {
      logger.debug('[MEETING_METRICS] Retention cleanup timer failed', { error: (err as Error).message });
    });
  }, RETENTION_CLEANUP_INTERVAL_MS);

  logger.info('[MEETING_METRICS] Pipeline latency tracking started');
}

/**
 * Stop timers and flush remaining buffered rows.
 */
export async function stopMeetingMetrics(): Promise<void> {
  if (flushIntervalId) {
    clearInterval(flushIntervalId);
    flushIntervalId = null;
  }
  if (retentionIntervalId) {
    clearInterval(retentionIntervalId);
    retentionIntervalId = null;
  }

  await flushLatencyBuffer().catch(() => {});
  logger.info('[MEETING_METRICS] Pipeline latency tracking stopped');
}

// ── Existing Meeting-Level Counter Functions ────────────────

/**
 * Get or create metrics record for a meeting
 * Non-blocking - returns null on error
 */
async function getOrCreateMetricsRecord(meetingId: string): Promise<MeetingPipelineMetrics | null> {
  try {
    // Try to get existing record
    let record = await db('meeting_pipeline_metrics')
      .where('meeting_id', meetingId)
      .first();

    if (!record) {
      // Create new record
      const [newRecord] = await db('meeting_pipeline_metrics')
        .insert({ meeting_id: meetingId })
        .returning('*');
      record = newRecord;
    }

    return record;
  } catch (err: any) {
    // Handle race condition - another process may have created the record
    if (err.code === '23505') { // Unique violation
      try {
        return await db('meeting_pipeline_metrics')
          .where('meeting_id', meetingId)
          .first();
      } catch {
        return null;
      }
    }
    logger.debug('[MEETING_METRICS] Failed to get/create metrics record', {
      meetingId,
      error: err.message,
    });
    return null;
  }
}

/**
 * Increment transcripts_generated for a meeting
 * Non-blocking - never throws
 */
export async function incrementTranscriptsGenerated(meetingId: string): Promise<void> {
  try {
    const record = await getOrCreateMetricsRecord(meetingId);
    if (!record) return;

    await db('meeting_pipeline_metrics')
      .where('id', record.id)
      .update({
        transcripts_generated: db.raw('transcripts_generated + 1'),
        updated_at: db.fn.now(),
      });

    logger.debug('[MEETING_METRICS] Incremented transcripts_generated', { meetingId });
  } catch (err) {
    logger.debug('[MEETING_METRICS] Failed to increment transcripts_generated', {
      meetingId,
      error: (err as Error).message,
    });
  }
}

/**
 * Increment translations_generated for a meeting
 * Non-blocking - never throws
 */
export async function incrementTranslationsGenerated(meetingId: string): Promise<void> {
  try {
    const record = await getOrCreateMetricsRecord(meetingId);
    if (!record) return;

    await db('meeting_pipeline_metrics')
      .where('id', record.id)
      .update({
        translations_generated: db.raw('translations_generated + 1'),
        updated_at: db.fn.now(),
      });

    logger.debug('[MEETING_METRICS] Incremented translations_generated', { meetingId });
  } catch (err) {
    logger.debug('[MEETING_METRICS] Failed to increment translations_generated', {
      meetingId,
      error: (err as Error).message,
    });
  }
}

/**
 * Increment broadcast_events for a meeting
 * Non-blocking - never throws
 */
export async function incrementBroadcastEvents(meetingId: string): Promise<void> {
  try {
    const record = await getOrCreateMetricsRecord(meetingId);
    if (!record) return;

    await db('meeting_pipeline_metrics')
      .where('id', record.id)
      .update({
        broadcast_events: db.raw('broadcast_events + 1'),
        updated_at: db.fn.now(),
      });

    logger.debug('[MEETING_METRICS] Incremented broadcast_events', { meetingId });
  } catch (err) {
    logger.debug('[MEETING_METRICS] Failed to increment broadcast_events', {
      meetingId,
      error: (err as Error).message,
    });
  }
}

/**
 * Store minutes generation duration for a meeting
 * Non-blocking - never throws
 */
export async function storeMinutesGenerationMs(meetingId: string, durationMs: number): Promise<void> {
  try {
    const record = await getOrCreateMetricsRecord(meetingId);
    if (!record) return;

    await db('meeting_pipeline_metrics')
      .where('id', record.id)
      .update({
        minutes_generation_ms: durationMs,
        updated_at: db.fn.now(),
      });

    logger.debug('[MEETING_METRICS] Stored minutes_generation_ms', { meetingId, durationMs });
  } catch (err) {
    logger.debug('[MEETING_METRICS] Failed to store minutes_generation_ms', {
      meetingId,
      error: (err as Error).message,
    });
  }
}

/**
 * Get metrics for a specific meeting
 */
export async function getMeetingMetrics(meetingId: string): Promise<MeetingMetricsSummary | null> {
  try {
    const record = await db('meeting_pipeline_metrics')
      .where('meeting_id', meetingId)
      .first();

    if (!record) {
      return null;
    }

    return {
      meetingId: record.meeting_id,
      transcriptsGenerated: record.transcripts_generated,
      translationsGenerated: record.translations_generated,
      broadcastEvents: record.broadcast_events,
      minutesGenerationMs: record.minutes_generation_ms,
      createdAt: record.created_at.toISOString(),
      updatedAt: record.updated_at.toISOString(),
    };
  } catch (err) {
    logger.error('[MEETING_METRICS] Failed to get meeting metrics', {
      meetingId,
      error: (err as Error).message,
    });
    return null;
  }
}

/**
 * Delete metrics for a meeting (cleanup)
 */
export async function deleteMeetingMetrics(meetingId: string): Promise<void> {
  try {
    await db('meeting_pipeline_metrics')
      .where('meeting_id', meetingId)
      .delete();

    // Also clean up latency rows
    await db('meeting_pipeline_latency')
      .where('meeting_id', meetingId)
      .delete();

    logger.debug('[MEETING_METRICS] Deleted metrics', { meetingId });
  } catch (err) {
    logger.debug('[MEETING_METRICS] Failed to delete metrics', {
      meetingId,
      error: (err as Error).message,
    });
  }
}
