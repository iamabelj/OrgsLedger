// ============================================================
// OrgsLedger API — Translation Metrics
// Lightweight latency + throughput tracking for the pipeline.
// Logs summary every 60 seconds when active.
// ============================================================

import { logger } from '../logger';
import { getCacheMetrics } from './translationCache';

interface MetricsWindow {
  translations: number;
  totalLatencyMs: number;
  maxLatencyMs: number;
  minLatencyMs: number;
  cacheHitsAtStart: number;
  cacheMissesAtStart: number;
}

let window: MetricsWindow = freshWindow();
let isRunning = false;
let intervalHandle: NodeJS.Timeout | null = null;

function freshWindow(): MetricsWindow {
  const cm = getCacheMetrics();
  return {
    translations: 0,
    totalLatencyMs: 0,
    maxLatencyMs: 0,
    minLatencyMs: Infinity,
    cacheHitsAtStart: cm.hits,
    cacheMissesAtStart: cm.misses,
  };
}

/**
 * Record a single translation latency measurement.
 */
export function recordTranslationLatency(latencyMs: number): void {
  window.translations++;
  window.totalLatencyMs += latencyMs;
  if (latencyMs > window.maxLatencyMs) window.maxLatencyMs = latencyMs;
  if (latencyMs < window.minLatencyMs) window.minLatencyMs = latencyMs;
}

/**
 * Start the periodic metrics reporter (every 60 seconds).
 */
export function startMetricsReporter(): void {
  if (isRunning) return;
  isRunning = true;

  intervalHandle = setInterval(() => {
    if (window.translations === 0) return; // Nothing to report

    const cm = getCacheMetrics();
    const periodHits = cm.hits - window.cacheHitsAtStart;
    const periodMisses = cm.misses - window.cacheMissesAtStart;
    const periodTotal = periodHits + periodMisses;

    logger.info('[TRANSLATION_METRICS] 60s summary', {
      translations: window.translations,
      avgLatencyMs: Math.round(window.totalLatencyMs / window.translations),
      maxLatencyMs: window.maxLatencyMs,
      minLatencyMs: window.minLatencyMs === Infinity ? 0 : window.minLatencyMs,
      cacheHitRate: periodTotal > 0 ? `${((periodHits / periodTotal) * 100).toFixed(1)}%` : 'N/A',
      l1Size: cm.l1Size,
    });

    window = freshWindow();
  }, 60_000);
}

/**
 * Stop the metrics reporter.
 */
export function stopMetricsReporter(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  isRunning = false;
}
