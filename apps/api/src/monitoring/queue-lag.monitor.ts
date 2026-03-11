// ============================================================
// OrgsLedger API — Queue Lag Monitor
// Monitors queue processing latency and alerts on lag
// ============================================================
//
// What It Monitors:
//   - Time from job enqueue to job start (waiting time)
//   - Time from job start to job complete (processing time)
//   - Total job latency (waiting + processing)
//
// Alert Thresholds:
//   - Warning: Total latency > 1 second
//   - Critical: Total latency > 2 seconds (workers can't keep up)
//
// Integration:
//   - Wraps BullMQ job processing
//   - Emits Prometheus metrics
//   - Fires alerts via EventEmitter
//
// ============================================================

import * as client from 'prom-client';
import { EventEmitter } from 'events';
import { Job, Queue } from 'bullmq';
import { logger } from '../logger';

// ── Configuration ───────────────────────────────────────────

interface QueueLagConfig {
  /** Warning threshold in milliseconds */
  lagWarningMs: number;
  /** Critical threshold in milliseconds */
  lagCriticalMs: number;
  /** How many recent samples to keep for averaging */
  sampleWindowSize: number;
  /** Minimum samples before alerting */
  minSamplesForAlert: number;
  /** Alert cooldown in milliseconds */
  alertCooldownMs: number;
}

const DEFAULT_CONFIG: QueueLagConfig = {
  lagWarningMs: parseInt(process.env.QUEUE_LAG_WARNING_MS || '1000', 10),
  lagCriticalMs: parseInt(process.env.QUEUE_LAG_CRITICAL_MS || '2000', 10),
  sampleWindowSize: parseInt(process.env.QUEUE_LAG_SAMPLE_SIZE || '100', 10),
  minSamplesForAlert: parseInt(process.env.QUEUE_LAG_MIN_SAMPLES || '10', 10),
  alertCooldownMs: parseInt(process.env.QUEUE_LAG_COOLDOWN_MS || '60000', 10),
};

// ── Types ───────────────────────────────────────────────────

export interface QueueLagAlert {
  level: 'warning' | 'critical';
  queueName: string;
  avgLatencyMs: number;
  threshold: number;
  sampleCount: number;
  timestamp: Date;
}

export interface QueueLagStats {
  queueName: string;
  sampleCount: number;
  avgWaitingMs: number;
  avgProcessingMs: number;
  avgTotalMs: number;
  p50TotalMs: number;
  p95TotalMs: number;
  p99TotalMs: number;
  maxTotalMs: number;
}

interface LagSample {
  waitingMs: number;
  processingMs: number;
  totalMs: number;
  timestamp: number;
}

// ── Prometheus Metrics ──────────────────────────────────────

const PREFIX = 'orgsledger_queue_';

export const queueWaitingLatencyHistogram = new client.Histogram({
  name: `${PREFIX}waiting_latency_seconds`,
  help: 'Time jobs spend waiting in queue before processing',
  labelNames: ['queue'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
});

export const queueProcessingLatencyHistogram = new client.Histogram({
  name: `${PREFIX}processing_latency_seconds`,
  help: 'Time jobs spend being processed',
  labelNames: ['queue'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
});

export const queueTotalLatencyHistogram = new client.Histogram({
  name: `${PREFIX}total_latency_seconds`,
  help: 'Total time from job enqueue to completion',
  labelNames: ['queue'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
});

export const queueLagGauge = new client.Gauge({
  name: `${PREFIX}lag_avg_seconds`,
  help: 'Average queue lag over sample window',
  labelNames: ['queue'],
});

export const queueLagAlertsCounter = new client.Counter({
  name: `${PREFIX}lag_alerts_total`,
  help: 'Total queue lag alerts',
  labelNames: ['queue', 'level'],
});

// ── Queue Lag Monitor Class ─────────────────────────────────

class QueueLagMonitor extends EventEmitter {
  private config: QueueLagConfig;
  private samples: Map<string, LagSample[]> = new Map();
  private lastAlertTime: Map<string, number> = new Map();
  private isRunning = false;

  constructor(config: Partial<QueueLagConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a job's latency when it starts processing.
   * Call this at the beginning of your worker processor.
   */
  recordJobStart(job: Job, queueName: string): { startTime: number; waitingMs: number } {
    const now = Date.now();
    const waitingMs = now - job.timestamp;

    queueWaitingLatencyHistogram.observe({ queue: queueName }, waitingMs / 1000);

    return { startTime: now, waitingMs };
  }

  /**
   * Record a job's complete latency.
   * Call this at the end of your worker processor.
   */
  recordJobComplete(
    job: Job,
    queueName: string,
    startTime: number,
    waitingMs: number
  ): void {
    const now = Date.now();
    const processingMs = now - startTime;
    const totalMs = waitingMs + processingMs;

    // Record to Prometheus histograms
    queueProcessingLatencyHistogram.observe({ queue: queueName }, processingMs / 1000);
    queueTotalLatencyHistogram.observe({ queue: queueName }, totalMs / 1000);

    // Add to samples
    this.addSample(queueName, { waitingMs, processingMs, totalMs, timestamp: now });

    // Check for alerts
    this.checkAlerts(queueName);
  }

  /**
   * Add a sample to the rolling window.
   */
  private addSample(queueName: string, sample: LagSample): void {
    let queueSamples = this.samples.get(queueName);
    if (!queueSamples) {
      queueSamples = [];
      this.samples.set(queueName, queueSamples);
    }

    queueSamples.push(sample);

    // Trim to window size
    while (queueSamples.length > this.config.sampleWindowSize) {
      queueSamples.shift();
    }
  }

  /**
   * Check if we need to fire alerts for a queue.
   */
  private checkAlerts(queueName: string): void {
    const samples = this.samples.get(queueName);
    if (!samples || samples.length < this.config.minSamplesForAlert) {
      return;
    }

    // Calculate average total latency
    const avgTotalMs = samples.reduce((sum, s) => sum + s.totalMs, 0) / samples.length;

    // Update gauge
    queueLagGauge.set({ queue: queueName }, avgTotalMs / 1000);

    // Check cooldown
    const lastAlert = this.lastAlertTime.get(queueName) || 0;
    if (Date.now() - lastAlert < this.config.alertCooldownMs) {
      return;
    }

    // Determine alert level
    let level: 'warning' | 'critical' | null = null;
    let threshold = 0;

    if (avgTotalMs >= this.config.lagCriticalMs) {
      level = 'critical';
      threshold = this.config.lagCriticalMs;
    } else if (avgTotalMs >= this.config.lagWarningMs) {
      level = 'warning';
      threshold = this.config.lagWarningMs;
    }

    if (level) {
      const alert: QueueLagAlert = {
        level,
        queueName,
        avgLatencyMs: avgTotalMs,
        threshold,
        sampleCount: samples.length,
        timestamp: new Date(),
      };

      this.fireAlert(alert);
      this.lastAlertTime.set(queueName, Date.now());
    }
  }

  /**
   * Fire an alert.
   */
  private fireAlert(alert: QueueLagAlert): void {
    const message = `[QUEUE_LAG] ${alert.level.toUpperCase()}: Queue "${alert.queueName}" lag at ${alert.avgLatencyMs.toFixed(0)}ms (threshold: ${alert.threshold}ms)`;
    const meta = {
      queue: alert.queueName,
      avgLatencyMs: alert.avgLatencyMs,
      threshold: alert.threshold,
      sampleCount: alert.sampleCount,
    };

    if (alert.level === 'critical') {
      logger.error(message, meta);
    } else {
      logger.warn(message, meta);
    }

    queueLagAlertsCounter.inc({ queue: alert.queueName, level: alert.level });
    this.emit('alert', alert);
  }

  /**
   * Get stats for a specific queue.
   */
  getQueueStats(queueName: string): QueueLagStats | null {
    const samples = this.samples.get(queueName);
    if (!samples || samples.length === 0) {
      return null;
    }

    const sortedTotal = samples.map(s => s.totalMs).sort((a, b) => a - b);

    return {
      queueName,
      sampleCount: samples.length,
      avgWaitingMs: samples.reduce((sum, s) => sum + s.waitingMs, 0) / samples.length,
      avgProcessingMs: samples.reduce((sum, s) => sum + s.processingMs, 0) / samples.length,
      avgTotalMs: samples.reduce((sum, s) => sum + s.totalMs, 0) / samples.length,
      p50TotalMs: this.percentile(sortedTotal, 50),
      p95TotalMs: this.percentile(sortedTotal, 95),
      p99TotalMs: this.percentile(sortedTotal, 99),
      maxTotalMs: sortedTotal[sortedTotal.length - 1],
    };
  }

  /**
   * Get stats for all queues.
   */
  getAllQueueStats(): QueueLagStats[] {
    const stats: QueueLagStats[] = [];
    for (const queueName of this.samples.keys()) {
      const queueStats = this.getQueueStats(queueName);
      if (queueStats) {
        stats.push(queueStats);
      }
    }
    return stats;
  }

  /**
   * Calculate percentile from sorted array.
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Reset all samples (useful for testing).
   */
  reset(): void {
    this.samples.clear();
    this.lastAlertTime.clear();
  }
}

// ── Singleton ───────────────────────────────────────────────

export const queueLagMonitor = new QueueLagMonitor();

// ── Helper: Wrap Worker Processor ───────────────────────────

/**
 * Wraps a BullMQ worker processor to automatically track latency.
 *
 * Usage:
 * ```ts
 * const processor = withLagTracking('transcript', async (job) => {
 *   // your processing logic
 * });
 * new Worker('transcript', processor, { connection });
 * ```
 */
export function withLagTracking<T, R>(
  queueName: string,
  processor: (job: Job<T>) => Promise<R>
): (job: Job<T>) => Promise<R> {
  return async (job: Job<T>): Promise<R> => {
    const { startTime, waitingMs } = queueLagMonitor.recordJobStart(job, queueName);

    try {
      const result = await processor(job);
      queueLagMonitor.recordJobComplete(job, queueName, startTime, waitingMs);
      return result;
    } catch (err) {
      // Still record completion on error to track failed job latency
      queueLagMonitor.recordJobComplete(job, queueName, startTime, waitingMs);
      throw err;
    }
  };
}

// ── Exports ─────────────────────────────────────────────────

export function onQueueLagAlert(
  callback: (alert: QueueLagAlert) => void
): () => void {
  queueLagMonitor.on('alert', callback);
  return () => queueLagMonitor.off('alert', callback);
}

export function getQueueLagStats(queueName: string): QueueLagStats | null {
  return queueLagMonitor.getQueueStats(queueName);
}

export function getAllQueueLagStats(): QueueLagStats[] {
  return queueLagMonitor.getAllQueueStats();
}
