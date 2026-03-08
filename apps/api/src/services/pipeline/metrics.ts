// ============================================================
// OrgsLedger API — Pipeline Metrics Service
// Tracks latency, throughput, and errors across pipeline stages
// Supports 10K+ concurrent meetings monitoring
// ============================================================

import { logger } from '../../logger';
import { getRedisClient } from '../../infrastructure/redisClient';

// ── Types ─────────────────────────────────────────────────────

export interface MetricsBucket {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  errors: number;
}

export interface PipelineMetricsSnapshot {
  timestamp: Date;
  window: '1m' | '5m' | '1h';
  transcripts: MetricsBucket;
  translations: MetricsBucket;
  broadcasts: MetricsBucket;
  minutes: MetricsBucket;
  activeMeetings: number;
  queueDepths: {
    transcript: number;
    processing: number;
    broadcast: number;
    minutes: number;
  };
}

// ── Metrics Collector ─────────────────────────────────────────

class PipelineMetricsCollector {
  // In-memory metrics for current window
  private metrics = {
    transcripts: this.createBucket(),
    translations: this.createBucket(),
    broadcasts: this.createBucket(),
    minutes: this.createBucket(),
  };

  // Active meetings tracker
  private activeMeetings = new Set<string>();

  // Error tracking by stage
  private recentErrors: Array<{
    stage: string;
    meetingId: string;
    error: string;
    timestamp: Date;
  }> = [];
  private maxRecentErrors = 100;

  // Latency histograms (for percentile calculations)
  private latencyHistograms: Record<string, number[]> = {
    transcripts: [],
    translations: [],
    broadcasts: [],
    minutes: [],
  };
  private maxHistogramSize = 10000;

  // ── Bucket Management ───────────────────────────────────────

  private createBucket(): MetricsBucket {
    return {
      count: 0,
      totalMs: 0,
      minMs: Infinity,
      maxMs: 0,
      errors: 0,
    };
  }

  private resetBuckets(): void {
    this.metrics = {
      transcripts: this.createBucket(),
      translations: this.createBucket(),
      broadcasts: this.createBucket(),
      minutes: this.createBucket(),
    };
    this.latencyHistograms = {
      transcripts: [],
      translations: [],
      broadcasts: [],
      minutes: [],
    };
  }

  // ── Recording Methods ───────────────────────────────────────

  /**
   * Record a transcript processing event.
   */
  recordTranscript(
    meetingId: string,
    status: 'submitted' | 'completed' | 'error' | 'skip_no_targets' | 'chunked',
    chunkCount?: number
  ): void {
    this.activeMeetings.add(meetingId);

    if (status === 'error') {
      this.metrics.transcripts.errors++;
    } else {
      this.metrics.transcripts.count++;
      if (status === 'chunked' && chunkCount) {
        this.metrics.transcripts.count += chunkCount - 1;
      }
    }
  }

  /**
   * Record a transcript with latency.
   */
  recordTranscriptLatency(meetingId: string, latencyMs: number): void {
    this.activeMeetings.add(meetingId);
    this.updateBucket(this.metrics.transcripts, latencyMs);
    this.addToHistogram('transcripts', latencyMs);
  }

  /**
   * Record a translation event.
   */
  recordTranslation(
    meetingId: string,
    status: 'started' | 'completed' | 'error' | 'cached'
  ): void {
    this.activeMeetings.add(meetingId);

    if (status === 'error') {
      this.metrics.translations.errors++;
    } else if (status === 'completed' || status === 'cached') {
      this.metrics.translations.count++;
    }
  }

  /**
   * Record translation with latency.
   */
  recordTranslationLatency(meetingId: string, latencyMs: number, cached: boolean): void {
    this.activeMeetings.add(meetingId);
    this.updateBucket(this.metrics.translations, latencyMs);
    this.addToHistogram('translations', latencyMs);

    // Log slow translations
    if (latencyMs > 2000 && !cached) {
      logger.warn('[METRICS] Slow translation detected', {
        meetingId,
        latencyMs,
      });
    }
  }

  /**
   * Record a broadcast event.
   */
  recordBroadcast(
    meetingId: string,
    status: 'started' | 'completed' | 'error'
  ): void {
    if (status === 'error') {
      this.metrics.broadcasts.errors++;
    } else if (status === 'completed') {
      this.metrics.broadcasts.count++;
    }
  }

  /**
   * Record broadcast with latency.
   */
  recordBroadcastLatency(meetingId: string, latencyMs: number): void {
    this.updateBucket(this.metrics.broadcasts, latencyMs);
    this.addToHistogram('broadcasts', latencyMs);

    // Broadcasts should be very fast
    if (latencyMs > 500) {
      logger.warn('[METRICS] Slow broadcast detected', {
        meetingId,
        latencyMs,
      });
    }
  }

  /**
   * Record a minutes generation event.
   */
  recordMinutes(
    meetingId: string,
    status: 'requested' | 'completed' | 'error'
  ): void {
    this.activeMeetings.delete(meetingId); // Meeting ended

    if (status === 'error') {
      this.metrics.minutes.errors++;
    } else if (status === 'completed') {
      this.metrics.minutes.count++;
    }
  }

  /**
   * Record minutes with latency.
   */
  recordMinutesLatency(meetingId: string, latencyMs: number): void {
    this.updateBucket(this.metrics.minutes, latencyMs);
    this.addToHistogram('minutes', latencyMs);
  }

  /**
   * Record a pipeline event for general tracking.
   */
  recordEvent(stage: string, meetingId: string): void {
    this.activeMeetings.add(meetingId);
  }

  /**
   * Record an error with details.
   */
  recordError(stage: string, meetingId: string, error: string): void {
    this.recentErrors.push({
      stage,
      meetingId,
      error,
      timestamp: new Date(),
    });

    // Trim old errors
    if (this.recentErrors.length > this.maxRecentErrors) {
      this.recentErrors = this.recentErrors.slice(-this.maxRecentErrors);
    }
  }

  /**
   * Mark meeting as ended.
   */
  markMeetingEnded(meetingId: string): void {
    this.activeMeetings.delete(meetingId);
  }

  // ── Bucket Helpers ──────────────────────────────────────────

  private updateBucket(bucket: MetricsBucket, latencyMs: number): void {
    bucket.count++;
    bucket.totalMs += latencyMs;
    bucket.minMs = Math.min(bucket.minMs, latencyMs);
    bucket.maxMs = Math.max(bucket.maxMs, latencyMs);
  }

  private addToHistogram(key: string, latencyMs: number): void {
    const histogram = this.latencyHistograms[key];
    if (histogram) {
      histogram.push(latencyMs);
      if (histogram.length > this.maxHistogramSize) {
        histogram.shift();
      }
    }
  }

  // ── Retrieval Methods ───────────────────────────────────────

  /**
   * Get current metrics snapshot.
   */
  getMetrics(): {
    transcripts: MetricsBucket & { avgMs: number };
    translations: MetricsBucket & { avgMs: number };
    broadcasts: MetricsBucket & { avgMs: number };
    minutes: MetricsBucket & { avgMs: number };
    activeMeetings: number;
    recentErrors: number;
    percentiles: {
      transcripts: { p50: number; p95: number; p99: number };
      translations: { p50: number; p95: number; p99: number };
      broadcasts: { p50: number; p95: number; p99: number };
    };
  } {
    return {
      transcripts: this.enrichBucket(this.metrics.transcripts),
      translations: this.enrichBucket(this.metrics.translations),
      broadcasts: this.enrichBucket(this.metrics.broadcasts),
      minutes: this.enrichBucket(this.metrics.minutes),
      activeMeetings: this.activeMeetings.size,
      recentErrors: this.recentErrors.length,
      percentiles: {
        transcripts: this.calculatePercentiles('transcripts'),
        translations: this.calculatePercentiles('translations'),
        broadcasts: this.calculatePercentiles('broadcasts'),
      },
    };
  }

  /**
   * Get recent errors for debugging.
   */
  getRecentErrors(): typeof this.recentErrors {
    return [...this.recentErrors];
  }

  /**
   * Get active meeting IDs.
   */
  getActiveMeetingIds(): string[] {
    return Array.from(this.activeMeetings);
  }

  private enrichBucket(bucket: MetricsBucket): MetricsBucket & { avgMs: number } {
    const avgMs = bucket.count > 0 ? Math.round(bucket.totalMs / bucket.count) : 0;
    return {
      ...bucket,
      minMs: bucket.minMs === Infinity ? 0 : bucket.minMs,
      avgMs,
    };
  }

  private calculatePercentiles(key: string): { p50: number; p95: number; p99: number } {
    const histogram = this.latencyHistograms[key];
    if (!histogram || histogram.length === 0) {
      return { p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...histogram].sort((a, b) => a - b);
    const p50Index = Math.floor(sorted.length * 0.5);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p99Index = Math.floor(sorted.length * 0.99);

    return {
      p50: sorted[p50Index] || 0,
      p95: sorted[p95Index] || 0,
      p99: sorted[p99Index] || 0,
    };
  }

  // ── Redis Persistence ───────────────────────────────────────

  /**
   * Persist current metrics to Redis for cross-instance aggregation.
   */
  async persistToRedis(): Promise<void> {
    try {
      const redis = await getRedisClient();
      const snapshot = {
        timestamp: new Date().toISOString(),
        instanceId: process.env.INSTANCE_ID || 'default',
        metrics: this.getMetrics(),
      };

      // Store with 5-minute TTL
      await redis.setex(
        `pipeline:metrics:${snapshot.instanceId}`,
        300,
        JSON.stringify(snapshot)
      );
    } catch (err) {
      logger.debug('[METRICS] Failed to persist to Redis', err);
    }
  }

  /**
   * Aggregate metrics from all instances.
   */
  async aggregateFromRedis(): Promise<Record<string, ReturnType<typeof this.getMetrics>>> {
    try {
      const redis = await getRedisClient();
      const keys = await redis.keys('pipeline:metrics:*');
      const result: Record<string, ReturnType<typeof this.getMetrics>> = {};

      for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
          const parsed = JSON.parse(data);
          result[parsed.instanceId] = parsed.metrics;
        }
      }

      return result;
    } catch (err) {
      logger.debug('[METRICS] Failed to aggregate from Redis', err);
      return {};
    }
  }

  /**
   * Reset all metrics (for testing or window rotation).
   */
  reset(): void {
    this.resetBuckets();
    this.activeMeetings.clear();
    this.recentErrors = [];
  }
}

// Export singleton instance
export const pipelineMetrics = new PipelineMetricsCollector();

// ── Periodic Tasks ────────────────────────────────────────────

// Persist metrics to Redis every minute
setInterval(() => {
  pipelineMetrics.persistToRedis().catch(() => {});
}, 60000);

// Log metrics summary every 5 minutes
setInterval(() => {
  const metrics = pipelineMetrics.getMetrics();
  logger.info('[METRICS] Pipeline summary', {
    activeMeetings: metrics.activeMeetings,
    transcripts: metrics.transcripts.count,
    translations: metrics.translations.count,
    broadcasts: metrics.broadcasts.count,
    minutes: metrics.minutes.count,
    errors: metrics.recentErrors,
    p95: {
      transcript: metrics.percentiles.transcripts.p95,
      translation: metrics.percentiles.translations.p95,
      broadcast: metrics.percentiles.broadcasts.p95,
    },
  });
}, 300000);
