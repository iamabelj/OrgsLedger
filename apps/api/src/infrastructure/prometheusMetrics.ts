// ============================================================
// OrgsLedger — Prometheus Metrics Registry
// Custom application-level metrics for the translation pipeline.
// Exposed via the existing /api/admin/observability route or
// via OpenTelemetry's PrometheusExporter on :9464/metrics.
// ============================================================

import { logger } from '../../logger';

// ── Simple counter/gauge/histogram implementations ──────
// (No external dependency required — these are plain objects
//  that can be scraped by the existing metrics.service.ts)

interface MetricValue {
  value: number;
  labels: Record<string, string>;
}

class Counter {
  name: string;
  help: string;
  private values: Map<string, MetricValue> = new Map();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  inc(labels: Record<string, string> = {}, value = 1): void {
    const key = JSON.stringify(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += value;
    } else {
      this.values.set(key, { value, labels });
    }
  }

  getAll(): MetricValue[] {
    return Array.from(this.values.values());
  }

  toPrometheus(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const mv of this.values.values()) {
      const labelStr = Object.entries(mv.labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
      lines.push(`${this.name}{${labelStr}} ${mv.value}`);
    }
    return lines.join('\n');
  }
}

class Gauge {
  name: string;
  help: string;
  private values: Map<string, MetricValue> = new Map();

  constructor(name: string, help: string) {
    this.name = name;
    this.help = help;
  }

  set(labels: Record<string, string> = {}, value: number): void {
    const key = JSON.stringify(labels);
    this.values.set(key, { value, labels });
  }

  inc(labels: Record<string, string> = {}, value = 1): void {
    const key = JSON.stringify(labels);
    const existing = this.values.get(key);
    if (existing) {
      existing.value += value;
    } else {
      this.values.set(key, { value, labels });
    }
  }

  dec(labels: Record<string, string> = {}, value = 1): void {
    this.inc(labels, -value);
  }

  toPrometheus(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const mv of this.values.values()) {
      const labelStr = Object.entries(mv.labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
      lines.push(`${this.name}{${labelStr}} ${mv.value}`);
    }
    return lines.join('\n');
  }
}

class Histogram {
  name: string;
  help: string;
  private buckets: number[];
  private counts: Map<string, number[]> = new Map();
  private sums: Map<string, number> = new Map();
  private totals: Map<string, number> = new Map();

  constructor(name: string, help: string, buckets?: number[]) {
    this.name = name;
    this.help = help;
    this.buckets = buckets || [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
  }

  observe(labels: Record<string, string> = {}, value: number): void {
    const key = JSON.stringify(labels);

    if (!this.counts.has(key)) {
      this.counts.set(key, new Array(this.buckets.length + 1).fill(0));
      this.sums.set(key, 0);
      this.totals.set(key, 0);
    }

    const buckets = this.counts.get(key)!;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) {
        buckets[i]++;
      }
    }
    buckets[this.buckets.length]++; // +Inf

    this.sums.set(key, (this.sums.get(key) || 0) + value);
    this.totals.set(key, (this.totals.get(key) || 0) + 1);
  }

  toPrometheus(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [key, buckets] of this.counts) {
      const labels = JSON.parse(key) as Record<string, string>;
      const labelStr = Object.entries(labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
      const prefix = labelStr ? `,${labelStr}` : '';

      let cumulative = 0;
      for (let i = 0; i < this.buckets.length; i++) {
        cumulative += buckets[i];
        lines.push(`${this.name}_bucket{le="${this.buckets[i]}"${prefix}} ${cumulative}`);
      }
      cumulative += buckets[this.buckets.length];
      lines.push(`${this.name}_bucket{le="+Inf"${prefix}} ${cumulative}`);
      lines.push(`${this.name}_sum{${labelStr}} ${this.sums.get(key) || 0}`);
      lines.push(`${this.name}_count{${labelStr}} ${this.totals.get(key) || 0}`);
    }
    return lines.join('\n');
  }
}

// ── Application Metrics ─────────────────────────────────

export const metrics = {
  // Transcription
  transcriptionLatency: new Histogram(
    'orgsledger_transcription_latency_ms',
    'Deepgram transcription round-trip latency in milliseconds',
    [50, 100, 200, 400, 800, 1500, 3000],
  ),
  transcriptionActiveStreams: new Gauge(
    'orgsledger_transcription_active_streams',
    'Number of active Deepgram transcription streams',
  ),
  transcriptionErrors: new Counter(
    'orgsledger_transcription_errors_total',
    'Total Deepgram transcription errors',
  ),

  // Translation
  translationLatency: new Histogram(
    'orgsledger_translation_latency_ms',
    'Translation pipeline latency in milliseconds',
    [5, 10, 25, 50, 100, 250, 500, 1000],
  ),
  translationCacheHits: new Counter(
    'orgsledger_translation_cache_hits_total',
    'Translation cache hit count by tier',
  ),
  translationCacheMisses: new Counter(
    'orgsledger_translation_cache_misses_total',
    'Translation cache miss count',
  ),
  translationQueueDepth: new Gauge(
    'orgsledger_translation_queue_depth',
    'Number of pending translation jobs',
  ),

  // Broadcast
  broadcastLatency: new Histogram(
    'orgsledger_broadcast_latency_ms',
    'Socket.IO broadcast latency in milliseconds',
    [1, 5, 10, 25, 50, 100],
  ),
  broadcastConnectedClients: new Gauge(
    'orgsledger_broadcast_connected_clients',
    'Number of connected Socket.IO clients',
  ),
  broadcastEventsPerSecond: new Gauge(
    'orgsledger_broadcast_events_per_second',
    'Broadcast events emitted per second',
  ),

  // Meetings
  meetingsActive: new Gauge(
    'orgsledger_meetings_active_total',
    'Number of currently active meetings',
  ),
  meetingsParticipants: new Gauge(
    'orgsledger_meetings_participants_total',
    'Total connected meeting participants',
  ),

  // System
  requestCount: new Counter(
    'orgsledger_http_requests_total',
    'Total HTTP requests by method and status',
  ),
  requestLatency: new Histogram(
    'orgsledger_http_request_duration_ms',
    'HTTP request duration in milliseconds',
    [10, 50, 100, 250, 500, 1000, 5000],
  ),
};

/**
 * Render all metrics in Prometheus text exposition format.
 */
export function renderPrometheusMetrics(): string {
  return [
    metrics.transcriptionLatency.toPrometheus(),
    metrics.transcriptionActiveStreams.toPrometheus(),
    metrics.transcriptionErrors.toPrometheus(),
    metrics.translationLatency.toPrometheus(),
    metrics.translationCacheHits.toPrometheus(),
    metrics.translationCacheMisses.toPrometheus(),
    metrics.translationQueueDepth.toPrometheus(),
    metrics.broadcastLatency.toPrometheus(),
    metrics.broadcastConnectedClients.toPrometheus(),
    metrics.broadcastEventsPerSecond.toPrometheus(),
    metrics.meetingsActive.toPrometheus(),
    metrics.meetingsParticipants.toPrometheus(),
    metrics.requestCount.toPrometheus(),
    metrics.requestLatency.toPrometheus(),
  ].join('\n\n');
}
