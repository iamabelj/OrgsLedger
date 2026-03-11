// ============================================================
// OrgsLedger API — Prometheus Metrics
// Production-grade metrics export for observability
// ============================================================
//
// Exports Prometheus-compatible metrics for:
//   - AI service usage (Deepgram, OpenAI, Translation)
//   - Queue health (waiting, failed jobs)
//   - Worker statistics (processed, failed)
//   - Pipeline latencies (broadcast, minutes generation)
//
// Endpoint: GET /metrics
// Format: Prometheus text exposition format
//
// ============================================================

import * as client from 'prom-client';
import { Request, Response, Router } from 'express';
import { logger } from '../logger';

// ── Configuration ───────────────────────────────────────────

const METRICS_CONFIG = {
  // Prefix for all metrics
  prefix: 'orgsledger_',
  
  // Default labels applied to all metrics
  defaultLabels: {
    app: 'orgsledger-api',
  },
};

// ── Initialize Registry ─────────────────────────────────────

// Create a custom registry (allows isolation from default metrics)
const register = new client.Registry();

// Set default labels
register.setDefaultLabels(METRICS_CONFIG.defaultLabels);

// Collect default Node.js metrics (memory, CPU, event loop)
client.collectDefaultMetrics({ register, prefix: METRICS_CONFIG.prefix });

// ── AI Usage Metrics ────────────────────────────────────────

export const aiDeepgramMinutesTotal = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}ai_deepgram_minutes_total`,
  help: 'Total Deepgram transcription minutes consumed',
  registers: [register],
});

export const aiOpenaiTokensTotal = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}ai_openai_tokens_total`,
  help: 'Total OpenAI tokens consumed',
  labelNames: ['type'] as const, // 'input' or 'output'
  registers: [register],
});

export const aiTranslationCharactersTotal = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}ai_translation_characters_total`,
  help: 'Total translation characters processed',
  registers: [register],
});

export const aiEstimatedCostUsd = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}ai_estimated_cost_usd`,
  help: 'Estimated AI service cost in USD',
  registers: [register],
});

// ── Queue Metrics ───────────────────────────────────────────

export const queueWaitingJobs = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}queue_waiting_jobs`,
  help: 'Number of jobs waiting in queue',
  labelNames: ['queue'] as const,
  registers: [register],
});

export const queueActiveJobs = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}queue_active_jobs`,
  help: 'Number of jobs currently active',
  labelNames: ['queue'] as const,
  registers: [register],
});

export const queueFailedJobs = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}queue_failed_jobs`,
  help: 'Number of failed jobs in queue',
  labelNames: ['queue'] as const,
  registers: [register],
});

export const queueStuckJobs = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}queue_stuck_jobs`,
  help: 'Number of stuck jobs in queue',
  labelNames: ['queue'] as const,
  registers: [register],
});

// ── Worker Metrics ──────────────────────────────────────────

export const workerProcessedJobsTotal = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}worker_processed_jobs_total`,
  help: 'Total jobs processed by worker',
  labelNames: ['worker'] as const,
  registers: [register],
});

export const workerFailedJobsTotal = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}worker_failed_jobs_total`,
  help: 'Total jobs failed by worker',
  labelNames: ['worker'] as const,
  registers: [register],
});

export const workerHealthy = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}worker_healthy`,
  help: 'Worker health status (1 = healthy, 0 = unhealthy)',
  labelNames: ['worker'] as const,
  registers: [register],
});

export const workerLastHeartbeatAgeMs = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}worker_last_heartbeat_age_ms`,
  help: 'Age of last worker heartbeat in milliseconds',
  labelNames: ['worker'] as const,
  registers: [register],
});

// ── Pipeline Metrics ────────────────────────────────────────

export const pipelineBroadcastLatencyMs = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}pipeline_broadcast_latency_ms`,
  help: 'Broadcast pipeline latency in milliseconds',
  registers: [register],
});

export const pipelineMinutesGenerationMs = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}pipeline_minutes_generation_ms`,
  help: 'Minutes generation time in milliseconds',
  registers: [register],
});

export const pipelineTranscriptThroughput = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}pipeline_transcript_throughput_per_min`,
  help: 'Transcript events processed per minute',
  registers: [register],
});

export const pipelineTranslationThroughput = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}pipeline_translation_throughput_per_min`,
  help: 'Translation events processed per minute',
  registers: [register],
});

// ── System Health Metrics ───────────────────────────────────

export const systemRedisConnected = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}system_redis_connected`,
  help: 'Redis connection status (1 = connected, 0 = disconnected)',
  registers: [register],
});

export const systemRedisLatencyMs = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}system_redis_latency_ms`,
  help: 'Redis ping latency in milliseconds',
  registers: [register],
});

export const systemPostgresConnected = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}system_postgres_connected`,
  help: 'PostgreSQL connection status (1 = connected, 0 = disconnected)',
  registers: [register],
});

export const systemPostgresLatencyMs = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}system_postgres_latency_ms`,
  help: 'PostgreSQL query latency in milliseconds',
  registers: [register],
});

export const systemOverallStatus = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}system_overall_status`,
  help: 'Overall system status (2 = healthy, 1 = degraded, 0 = critical)',
  registers: [register],
});

export const systemAlertCount = new client.Gauge({
  name: `${METRICS_CONFIG.prefix}system_alert_count`,
  help: 'Number of active system alerts',
  registers: [register],
});

// ── Recovery Metrics ────────────────────────────────────────

export const recoveryJobsRecovered = new client.Counter({
  name: `${METRICS_CONFIG.prefix}recovery_jobs_recovered_total`,
  help: 'Total number of stuck jobs recovered',
  labelNames: ['queue'] as const,
  registers: [register],
});

export const recoveryJobsFailed = new client.Counter({
  name: `${METRICS_CONFIG.prefix}recovery_jobs_failed_total`,
  help: 'Total number of stuck jobs that exceeded max retries',
  labelNames: ['queue'] as const,
  registers: [register],
});

// ── Metrics Update Interface ────────────────────────────────

export interface PrometheusMetricsUpdate {
  // AI metrics
  ai?: {
    deepgramMinutes: number;
    openaiInputTokens: number;
    openaiOutputTokens: number;
    translationCharacters: number;
    estimatedCostUsd: number;
  };
  
  // Queue metrics (array of queue stats)
  queues?: Array<{
    name: string;
    waiting: number;
    active: number;
    failed: number;
    stuckJobs: number;
  }>;
  
  // Worker metrics (array of worker stats)
  workers?: Array<{
    name: string;
    processed: number;
    failed: number;
    healthy: boolean;
    heartbeatAgeMs: number;
  }>;
  
  // Pipeline metrics
  pipeline?: {
    broadcastLatencyMs: number;
    minutesGenerationMs: number;
    transcriptThroughputPerMin: number;
    translationThroughputPerMin: number;
  };
  
  // System health
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
export function updatePrometheusMetrics(data: PrometheusMetricsUpdate): void {
  try {
    // Update AI metrics
    if (data.ai) {
      aiDeepgramMinutesTotal.set(data.ai.deepgramMinutes);
      aiOpenaiTokensTotal.labels('input').set(data.ai.openaiInputTokens);
      aiOpenaiTokensTotal.labels('output').set(data.ai.openaiOutputTokens);
      aiTranslationCharactersTotal.set(data.ai.translationCharacters);
      aiEstimatedCostUsd.set(data.ai.estimatedCostUsd);
    }

    // Update queue metrics
    if (data.queues) {
      for (const queue of data.queues) {
        queueWaitingJobs.labels(queue.name).set(queue.waiting);
        queueActiveJobs.labels(queue.name).set(queue.active);
        queueFailedJobs.labels(queue.name).set(queue.failed);
        queueStuckJobs.labels(queue.name).set(queue.stuckJobs);
      }
    }

    // Update worker metrics
    if (data.workers) {
      for (const worker of data.workers) {
        workerProcessedJobsTotal.labels(worker.name).set(worker.processed);
        workerFailedJobsTotal.labels(worker.name).set(worker.failed);
        workerHealthy.labels(worker.name).set(worker.healthy ? 1 : 0);
        workerLastHeartbeatAgeMs.labels(worker.name).set(worker.heartbeatAgeMs);
      }
    }

    // Update pipeline metrics
    if (data.pipeline) {
      pipelineBroadcastLatencyMs.set(data.pipeline.broadcastLatencyMs);
      pipelineMinutesGenerationMs.set(data.pipeline.minutesGenerationMs);
      pipelineTranscriptThroughput.set(data.pipeline.transcriptThroughputPerMin);
      pipelineTranslationThroughput.set(data.pipeline.translationThroughputPerMin);
    }

    // Update system health metrics
    if (data.system) {
      systemRedisConnected.set(data.system.redisConnected ? 1 : 0);
      systemRedisLatencyMs.set(data.system.redisLatencyMs);
      systemPostgresConnected.set(data.system.postgresConnected ? 1 : 0);
      systemPostgresLatencyMs.set(data.system.postgresLatencyMs);
      
      // Map status to numeric value
      const statusMap: Record<string, number> = {
        'HEALTHY': 2,
        'DEGRADED': 1,
        'CRITICAL': 0,
      };
      systemOverallStatus.set(statusMap[data.system.overallStatus] ?? 0);
      systemAlertCount.set(data.system.alertCount);
    }

    logger.debug('[PROMETHEUS] Metrics updated');
  } catch (err) {
    logger.error('[PROMETHEUS] Failed to update metrics', err);
  }
}

/**
 * Increment recovery counters
 */
export function incrementRecoveryMetrics(
  queueName: string,
  action: 'recovered' | 'failed'
): void {
  try {
    if (action === 'recovered') {
      recoveryJobsRecovered.labels(queueName).inc();
    } else {
      recoveryJobsFailed.labels(queueName).inc();
    }
  } catch (err) {
    logger.debug('[PROMETHEUS] Failed to increment recovery metrics', err);
  }
}

// ── Express Router ──────────────────────────────────────────

/**
 * Create Express router for /metrics endpoint
 */
export function createMetricsRouter(): Router {
  const router = Router();

  // GET /metrics - Prometheus scrape endpoint
  router.get('/', async (_req: Request, res: Response) => {
    try {
      res.set('Content-Type', register.contentType);
      const metrics = await register.metrics();
      res.end(metrics);
    } catch (err) {
      logger.error('[PROMETHEUS] Failed to generate metrics', err);
      res.status(500).end('Error generating metrics');
    }
  });

  return router;
}

/**
 * Get the Prometheus registry (for testing or custom integrations)
 */
export function getRegistry(): client.Registry {
  return register;
}

/**
 * Get metrics as string (for debugging)
 */
export async function getMetricsString(): Promise<string> {
  return register.metrics();
}

// ── Exports ─────────────────────────────────────────────────

export default {
  updatePrometheusMetrics,
  incrementRecoveryMetrics,
  createMetricsRouter,
  getRegistry,
  getMetricsString,
};
