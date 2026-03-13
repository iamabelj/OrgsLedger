"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.pipelineStageLatencyGauge = exports.pipelineLatencyHistogram = exports.pipelineStageLatencyHistogram = exports.PIPELINE_STAGES = void 0;
exports.recordTranscriptionLatency = recordTranscriptionLatency;
exports.recordTranslationLatency = recordTranslationLatency;
exports.recordBroadcastLatency = recordBroadcastLatency;
exports.recordPipelineLatency = recordPipelineLatency;
exports.getLatencyReport = getLatencyReport;
exports.getHistoricalLatencyReport = getHistoricalLatencyReport;
exports.getGrafanaMetrics = getGrafanaMetrics;
exports.startMeetingMetrics = startMeetingMetrics;
exports.stopMeetingMetrics = stopMeetingMetrics;
exports.incrementTranscriptsGenerated = incrementTranscriptsGenerated;
exports.incrementTranslationsGenerated = incrementTranslationsGenerated;
exports.incrementBroadcastEvents = incrementBroadcastEvents;
exports.storeMinutesGenerationMs = storeMinutesGenerationMs;
exports.getMeetingMetrics = getMeetingMetrics;
exports.deleteMeetingMetrics = deleteMeetingMetrics;
const client = __importStar(require("prom-client"));
const db_1 = require("../db");
const logger_1 = require("../logger");
// ── Constants ───────────────────────────────────────────────
const PREFIX = 'orgsledger_';
exports.PIPELINE_STAGES = ['transcription', 'translation', 'broadcast'];
const LATENCY_BUFFER_SIZE = 50;
const LATENCY_FLUSH_INTERVAL_MS = 30_000; // 30 seconds
const ROLLING_WINDOW_SIZE = 1000; // keep last 1000 samples per stage for percentiles
const RETENTION_DAYS = 30;
const RETENTION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
// ── Prometheus Metrics ──────────────────────────────────────
// Use the default registry so these are collected alongside all other orgsledger_ metrics
const defaultRegister = client.register;
exports.pipelineStageLatencyHistogram = new client.Histogram({
    name: `${PREFIX}pipeline_stage_latency_ms`,
    help: 'Pipeline per-stage latency in milliseconds',
    labelNames: ['stage'],
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
    registers: [defaultRegister],
});
exports.pipelineLatencyHistogram = new client.Histogram({
    name: `${PREFIX}pipeline_latency_ms`,
    help: 'Total pipeline latency (audio-in to broadcast-out) in milliseconds',
    buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
    registers: [defaultRegister],
});
exports.pipelineStageLatencyGauge = new client.Gauge({
    name: `${PREFIX}pipeline_stage_latency_p95_ms`,
    help: 'Pipeline per-stage p95 latency in milliseconds (rolling window)',
    labelNames: ['stage'],
    registers: [defaultRegister],
});
// ── In-Memory Rolling Window ────────────────────────────────
class RollingLatencyWindow {
    maxSize;
    samples = new Map();
    totalPipelineSamples = [];
    constructor(maxSize) {
        this.maxSize = maxSize;
        for (const stage of exports.PIPELINE_STAGES) {
            this.samples.set(stage, []);
        }
    }
    push(stage, latencyMs) {
        const arr = this.samples.get(stage);
        arr.push(latencyMs);
        if (arr.length > this.maxSize) {
            arr.shift();
        }
    }
    pushTotalPipeline(latencyMs) {
        this.totalPipelineSamples.push(latencyMs);
        if (this.totalPipelineSamples.length > this.maxSize) {
            this.totalPipelineSamples.shift();
        }
    }
    getStageSnapshot(stage) {
        const arr = this.samples.get(stage) ?? [];
        return { stage, ...computePercentiles(arr) };
    }
    getTotalPipelineStats() {
        return computePercentiles(this.totalPipelineSamples);
    }
    getReport() {
        return {
            timestamp: new Date().toISOString(),
            stages: exports.PIPELINE_STAGES.map(s => this.getStageSnapshot(s)),
            totalPipeline: this.getTotalPipelineStats(),
        };
    }
}
function computePercentiles(arr) {
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
let latencyBuffer = [];
let flushIntervalId = null;
let retentionIntervalId = null;
// ── Latency Recording Functions ─────────────────────────────
/**
 * Record transcription stage latency.
 * Non-blocking — never throws.
 */
function recordTranscriptionLatency(meetingId, latencyMs) {
    recordStageLatency(meetingId, 'transcription', latencyMs);
}
/**
 * Record translation stage latency.
 * Non-blocking — never throws.
 */
function recordTranslationLatency(meetingId, latencyMs) {
    recordStageLatency(meetingId, 'translation', latencyMs);
}
/**
 * Record broadcast stage latency.
 * Non-blocking — never throws.
 */
function recordBroadcastLatency(meetingId, latencyMs) {
    recordStageLatency(meetingId, 'broadcast', latencyMs);
}
/**
 * Record total pipeline latency (audio-in → broadcast-out).
 * Non-blocking — never throws.
 */
function recordPipelineLatency(meetingId, latencyMs) {
    try {
        exports.pipelineLatencyHistogram.observe(latencyMs);
        rollingWindow.pushTotalPipeline(latencyMs);
        logger_1.logger.debug('[MEETING_METRICS] Pipeline latency recorded', { meetingId, latencyMs });
    }
    catch (err) {
        logger_1.logger.debug('[MEETING_METRICS] Failed to record pipeline latency', { error: err.message });
    }
}
function recordStageLatency(meetingId, stage, latencyMs) {
    try {
        // 1. Prometheus histogram
        exports.pipelineStageLatencyHistogram.labels(stage).observe(latencyMs);
        // 2. In-memory rolling window for percentiles
        rollingWindow.push(stage, latencyMs);
        // 3. Buffer for batched PostgreSQL insert
        latencyBuffer.push({ meeting_id: meetingId, stage, latency_ms: latencyMs });
        if (latencyBuffer.length >= LATENCY_BUFFER_SIZE) {
            flushLatencyBuffer().catch(err => {
                logger_1.logger.debug('[MEETING_METRICS] Background flush failed', { error: err.message });
            });
        }
        logger_1.logger.debug('[MEETING_METRICS] Stage latency recorded', { meetingId, stage, latencyMs });
    }
    catch (err) {
        logger_1.logger.debug('[MEETING_METRICS] Failed to record stage latency', {
            meetingId, stage, error: err.message,
        });
    }
}
// ── PostgreSQL Persistence ──────────────────────────────────
async function flushLatencyBuffer() {
    if (latencyBuffer.length === 0)
        return;
    const rows = [...latencyBuffer];
    latencyBuffer = [];
    try {
        await (0, db_1.db)('meeting_pipeline_latency').insert(rows);
        logger_1.logger.debug('[MEETING_METRICS] Flushed latency buffer', { rowCount: rows.length });
    }
    catch (err) {
        logger_1.logger.error('[MEETING_METRICS] Latency flush failed', { error: err.message, rowCount: rows.length });
        // Re-queue (bounded)
        if (latencyBuffer.length < 500) {
            latencyBuffer.unshift(...rows);
        }
    }
}
async function runRetentionCleanup() {
    try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
        const deleted = await (0, db_1.db)('meeting_pipeline_latency').where('created_at', '<', cutoff).delete();
        if (deleted > 0) {
            logger_1.logger.info('[MEETING_METRICS] Retention cleanup', { deletedRows: deleted, retentionDays: RETENTION_DAYS });
        }
    }
    catch (err) {
        logger_1.logger.error('[MEETING_METRICS] Retention cleanup failed', { error: err.message });
    }
}
// ── Percentile Queries ──────────────────────────────────────
/**
 * Get rolling-window latency percentile report (in-memory, no DB hit).
 */
function getLatencyReport() {
    // Update Prometheus p95 gauges as a side-effect
    for (const stage of exports.PIPELINE_STAGES) {
        const snap = rollingWindow.getStageSnapshot(stage);
        exports.pipelineStageLatencyGauge.labels(stage).set(snap.p95);
    }
    return rollingWindow.getReport();
}
/**
 * Query historical per-stage latency percentiles from PostgreSQL.
 * @param hours Look-back window (default 24)
 */
async function getHistoricalLatencyReport(hours = 24) {
    try {
        const cutoff = new Date();
        cutoff.setHours(cutoff.getHours() - hours);
        const results = [];
        for (const stage of exports.PIPELINE_STAGES) {
            const rows = await (0, db_1.db)('meeting_pipeline_latency')
                .where('stage', stage)
                .where('created_at', '>=', cutoff)
                .select('latency_ms')
                .orderBy('latency_ms', 'asc');
            const values = rows.map((r) => r.latency_ms);
            results.push({ stage, ...computePercentiles(values) });
        }
        return results;
    }
    catch (err) {
        logger_1.logger.error('[MEETING_METRICS] Historical latency query failed', { error: err.message });
        return [];
    }
}
/**
 * Get Grafana-compatible JSON metrics for dashboard panels.
 */
function getGrafanaMetrics() {
    const report = getLatencyReport();
    const now = Date.now();
    return {
        targets: [
            ...report.stages.map(s => ({
                target: `pipeline.${s.stage}.p95`,
                datapoints: [[s.p95, now]],
            })),
            ...report.stages.map(s => ({
                target: `pipeline.${s.stage}.p50`,
                datapoints: [[s.p50, now]],
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
function startMeetingMetrics() {
    if (flushIntervalId)
        return;
    flushIntervalId = setInterval(() => {
        flushLatencyBuffer().catch(err => {
            logger_1.logger.debug('[MEETING_METRICS] Periodic flush failed', { error: err.message });
        });
    }, LATENCY_FLUSH_INTERVAL_MS);
    retentionIntervalId = setInterval(() => {
        runRetentionCleanup().catch(err => {
            logger_1.logger.debug('[MEETING_METRICS] Retention cleanup timer failed', { error: err.message });
        });
    }, RETENTION_CLEANUP_INTERVAL_MS);
    logger_1.logger.info('[MEETING_METRICS] Pipeline latency tracking started');
}
/**
 * Stop timers and flush remaining buffered rows.
 */
async function stopMeetingMetrics() {
    if (flushIntervalId) {
        clearInterval(flushIntervalId);
        flushIntervalId = null;
    }
    if (retentionIntervalId) {
        clearInterval(retentionIntervalId);
        retentionIntervalId = null;
    }
    await flushLatencyBuffer().catch(() => { });
    logger_1.logger.info('[MEETING_METRICS] Pipeline latency tracking stopped');
}
// ── Existing Meeting-Level Counter Functions ────────────────
/**
 * Get or create metrics record for a meeting
 * Non-blocking - returns null on error
 */
async function getOrCreateMetricsRecord(meetingId) {
    try {
        // Try to get existing record
        let record = await (0, db_1.db)('meeting_pipeline_metrics')
            .where('meeting_id', meetingId)
            .first();
        if (!record) {
            // Create new record
            const [newRecord] = await (0, db_1.db)('meeting_pipeline_metrics')
                .insert({ meeting_id: meetingId })
                .returning('*');
            record = newRecord;
        }
        return record;
    }
    catch (err) {
        // Handle race condition - another process may have created the record
        if (err.code === '23505') { // Unique violation
            try {
                return await (0, db_1.db)('meeting_pipeline_metrics')
                    .where('meeting_id', meetingId)
                    .first();
            }
            catch {
                return null;
            }
        }
        logger_1.logger.debug('[MEETING_METRICS] Failed to get/create metrics record', {
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
async function incrementTranscriptsGenerated(meetingId) {
    try {
        const record = await getOrCreateMetricsRecord(meetingId);
        if (!record)
            return;
        await (0, db_1.db)('meeting_pipeline_metrics')
            .where('id', record.id)
            .update({
            transcripts_generated: db_1.db.raw('transcripts_generated + 1'),
            updated_at: db_1.db.fn.now(),
        });
        logger_1.logger.debug('[MEETING_METRICS] Incremented transcripts_generated', { meetingId });
    }
    catch (err) {
        logger_1.logger.debug('[MEETING_METRICS] Failed to increment transcripts_generated', {
            meetingId,
            error: err.message,
        });
    }
}
/**
 * Increment translations_generated for a meeting
 * Non-blocking - never throws
 */
async function incrementTranslationsGenerated(meetingId) {
    try {
        const record = await getOrCreateMetricsRecord(meetingId);
        if (!record)
            return;
        await (0, db_1.db)('meeting_pipeline_metrics')
            .where('id', record.id)
            .update({
            translations_generated: db_1.db.raw('translations_generated + 1'),
            updated_at: db_1.db.fn.now(),
        });
        logger_1.logger.debug('[MEETING_METRICS] Incremented translations_generated', { meetingId });
    }
    catch (err) {
        logger_1.logger.debug('[MEETING_METRICS] Failed to increment translations_generated', {
            meetingId,
            error: err.message,
        });
    }
}
/**
 * Increment broadcast_events for a meeting
 * Non-blocking - never throws
 */
async function incrementBroadcastEvents(meetingId) {
    try {
        const record = await getOrCreateMetricsRecord(meetingId);
        if (!record)
            return;
        await (0, db_1.db)('meeting_pipeline_metrics')
            .where('id', record.id)
            .update({
            broadcast_events: db_1.db.raw('broadcast_events + 1'),
            updated_at: db_1.db.fn.now(),
        });
        logger_1.logger.debug('[MEETING_METRICS] Incremented broadcast_events', { meetingId });
    }
    catch (err) {
        logger_1.logger.debug('[MEETING_METRICS] Failed to increment broadcast_events', {
            meetingId,
            error: err.message,
        });
    }
}
/**
 * Store minutes generation duration for a meeting
 * Non-blocking - never throws
 */
async function storeMinutesGenerationMs(meetingId, durationMs) {
    try {
        const record = await getOrCreateMetricsRecord(meetingId);
        if (!record)
            return;
        await (0, db_1.db)('meeting_pipeline_metrics')
            .where('id', record.id)
            .update({
            minutes_generation_ms: durationMs,
            updated_at: db_1.db.fn.now(),
        });
        logger_1.logger.debug('[MEETING_METRICS] Stored minutes_generation_ms', { meetingId, durationMs });
    }
    catch (err) {
        logger_1.logger.debug('[MEETING_METRICS] Failed to store minutes_generation_ms', {
            meetingId,
            error: err.message,
        });
    }
}
/**
 * Get metrics for a specific meeting
 */
async function getMeetingMetrics(meetingId) {
    try {
        const record = await (0, db_1.db)('meeting_pipeline_metrics')
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
    }
    catch (err) {
        logger_1.logger.error('[MEETING_METRICS] Failed to get meeting metrics', {
            meetingId,
            error: err.message,
        });
        return null;
    }
}
/**
 * Delete metrics for a meeting (cleanup)
 */
async function deleteMeetingMetrics(meetingId) {
    try {
        await (0, db_1.db)('meeting_pipeline_metrics')
            .where('meeting_id', meetingId)
            .delete();
        // Also clean up latency rows
        await (0, db_1.db)('meeting_pipeline_latency')
            .where('meeting_id', meetingId)
            .delete();
        logger_1.logger.debug('[MEETING_METRICS] Deleted metrics', { meetingId });
    }
    catch (err) {
        logger_1.logger.debug('[MEETING_METRICS] Failed to delete metrics', {
            meetingId,
            error: err.message,
        });
    }
}
//# sourceMappingURL=meeting-metrics.js.map