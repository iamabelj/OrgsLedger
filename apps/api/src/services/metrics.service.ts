// ============================================================
// OrgsLedger API — Metrics Collection Service
// In-memory counters & histograms for API / business metrics.
// Exposes data at /api/admin/metrics (JSON) for dashboards.
// Zero external deps — replace with prom-client if needed.
// ============================================================

import { Request, Response, NextFunction } from 'express';

// ── Counter Primitives ────────────────────────────────────
interface Counter {
  value: number;
  inc(amount?: number): void;
  reset(): void;
}

interface Histogram {
  values: number[];
  observe(value: number): void;
  percentile(p: number): number;
  avg(): number;
  count(): number;
  reset(): void;
}

function createCounter(name: string): Counter {
  const c: Counter = {
    value: 0,
    inc(amount = 1) { c.value += amount; },
    reset() { c.value = 0; },
  };
  return c;
}

const HISTOGRAM_MAX_SAMPLES = 5000;
function createHistogram(): Histogram {
  const h: Histogram = {
    values: [],
    observe(value: number) {
      h.values.push(value);
      if (h.values.length > HISTOGRAM_MAX_SAMPLES) {
        h.values = h.values.slice(-HISTOGRAM_MAX_SAMPLES);
      }
    },
    percentile(p: number): number {
      if (h.values.length === 0) return 0;
      const sorted = [...h.values].sort((a, b) => a - b);
      const idx = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, idx)];
    },
    avg(): number {
      if (h.values.length === 0) return 0;
      return h.values.reduce((a, b) => a + b, 0) / h.values.length;
    },
    count(): number {
      return h.values.length;
    },
    reset() { h.values = []; },
  };
  return h;
}

// ── Metric Registry ───────────────────────────────────────
export const metrics = {
  // HTTP Metrics
  httpRequestsTotal: createCounter('http_requests_total'),
  httpResponsesByStatus: {
    '2xx': createCounter('http_responses_2xx'),
    '3xx': createCounter('http_responses_3xx'),
    '4xx': createCounter('http_responses_4xx'),
    '5xx': createCounter('http_responses_5xx'),
  } as Record<string, Counter>,
  httpResponseTime: createHistogram(),

  // Route-level metrics
  routeMetrics: new Map<string, { count: number; totalTime: number; errors: number }>(),

  // Auth Metrics
  authLoginAttempts: createCounter('auth_login_attempts'),
  authLoginSuccess: createCounter('auth_login_success'),
  authLoginFailures: createCounter('auth_login_failures'),
  authTokenRefreshes: createCounter('auth_token_refreshes'),

  // Business Metrics
  walletOperations: createCounter('wallet_operations'),
  walletDeductions: createCounter('wallet_deductions'),
  aiMinutesUsed: createCounter('ai_minutes_used'),

  // Organization Metrics
  orgsCreated: createCounter('orgs_created'),
  membersAdded: createCounter('members_added'),
  announcementsSent: createCounter('announcements_sent'),

  // Payment Metrics
  paymentsInitiated: createCounter('payments_initiated'),
  paymentsCompleted: createCounter('payments_completed'),
  paymentsFailed: createCounter('payments_failed'),

  // WebSocket Metrics
  wsConnectionsActive: createCounter('ws_connections_active'),
  wsMessagesTotal: createCounter('ws_messages_total'),

  // System
  startedAt: new Date().toISOString(),
};

// ── Helper: Classify Status Code ──────────────────────────
function statusBucket(code: number): string {
  if (code < 300) return '2xx';
  if (code < 400) return '3xx';
  if (code < 500) return '4xx';
  return '5xx';
}

// ── Express Middleware — Captures HTTP Metrics ────────────
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

    // Global counters
    metrics.httpRequestsTotal.inc();
    const bucket = statusBucket(res.statusCode);
    if (!metrics.httpResponsesByStatus[bucket]) {
      metrics.httpResponsesByStatus[bucket] = createCounter(`http_responses_${bucket}`);
    }
    metrics.httpResponsesByStatus[bucket].inc();
    metrics.httpResponseTime.observe(durationMs);

    // Route-level tracking (use route pattern, not raw path with IDs)
    const routePath = req.route?.path;
    if (routePath) {
      const routeKey = `${req.method} ${req.baseUrl}${routePath}`;
      let routeStat = metrics.routeMetrics.get(routeKey);
      if (!routeStat) {
        // Cap route metrics to prevent unbounded growth
        if (metrics.routeMetrics.size >= 200) {
          const oldestKey = metrics.routeMetrics.keys().next().value;
          if (oldestKey) metrics.routeMetrics.delete(oldestKey);
        }
        routeStat = { count: 0, totalTime: 0, errors: 0 };
        metrics.routeMetrics.set(routeKey, routeStat);
      }
      routeStat.count++;
      routeStat.totalTime += durationMs;
      if (res.statusCode >= 400) routeStat.errors++;
    }
  });

  next();
}

// ── Snapshot — Called by Dashboard Endpoint ────────────────
export function getMetricsSnapshot() {
  const uptime = process.uptime();

  // Route-level stats (top 20 by count)
  const topRoutes = Array.from(metrics.routeMetrics.entries())
    .map(([route, stat]) => ({
      route,
      requests: stat.count,
      avgResponseTimeMs: Math.round(stat.totalTime / stat.count),
      errorRate: stat.count > 0 ? +(stat.errors / stat.count * 100).toFixed(1) : 0,
    }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 20);

  return {
    system: {
      uptime: Math.round(uptime),
      uptimeHuman: formatUptime(uptime),
      startedAt: metrics.startedAt,
      memoryMB: {
        rss: +(process.memoryUsage().rss / 1048576).toFixed(1),
        heapUsed: +(process.memoryUsage().heapUsed / 1048576).toFixed(1),
        heapTotal: +(process.memoryUsage().heapTotal / 1048576).toFixed(1),
        external: +(process.memoryUsage().external / 1048576).toFixed(1),
      },
      cpuUsage: process.cpuUsage(),
      nodeVersion: process.version,
      pid: process.pid,
    },

    http: {
      totalRequests: metrics.httpRequestsTotal.value,
      requestsPerMinute: uptime > 0 ? +(metrics.httpRequestsTotal.value / (uptime / 60)).toFixed(2) : 0,
      byStatus: {
        '2xx': metrics.httpResponsesByStatus['2xx']?.value || 0,
        '3xx': metrics.httpResponsesByStatus['3xx']?.value || 0,
        '4xx': metrics.httpResponsesByStatus['4xx']?.value || 0,
        '5xx': metrics.httpResponsesByStatus['5xx']?.value || 0,
      },
      responseTime: {
        avg: +metrics.httpResponseTime.avg().toFixed(2),
        p50: +metrics.httpResponseTime.percentile(50).toFixed(2),
        p95: +metrics.httpResponseTime.percentile(95).toFixed(2),
        p99: +metrics.httpResponseTime.percentile(99).toFixed(2),
        samples: metrics.httpResponseTime.count(),
      },
      topRoutes,
    },

    auth: {
      loginAttempts: metrics.authLoginAttempts.value,
      loginSuccess: metrics.authLoginSuccess.value,
      loginFailures: metrics.authLoginFailures.value,
      tokenRefreshes: metrics.authTokenRefreshes.value,
    },

    business: {
      walletOperations: metrics.walletOperations.value,
      walletDeductions: metrics.walletDeductions.value,
      aiMinutesUsed: metrics.aiMinutesUsed.value,
    },

    organizations: {
      orgsCreated: metrics.orgsCreated.value,
      membersAdded: metrics.membersAdded.value,
      announcementsSent: metrics.announcementsSent.value,
    },

    payments: {
      initiated: metrics.paymentsInitiated.value,
      completed: metrics.paymentsCompleted.value,
      failed: metrics.paymentsFailed.value,
    },

    websocket: {
      activeConnections: metrics.wsConnectionsActive.value,
      totalMessages: metrics.wsMessagesTotal.value,
    },
  };
}

// ── Helpers ────────────────────────────────────────────────
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

// ── Convenience: Increment Business Metrics ───────────────
// Call these from route handlers / services.
export const MetricsHelper = {
  trackLogin(success: boolean) {
    metrics.authLoginAttempts.inc();
    if (success) metrics.authLoginSuccess.inc();
    else metrics.authLoginFailures.inc();
  },
  trackWallet(deduction = false) {
    metrics.walletOperations.inc();
    if (deduction) metrics.walletDeductions.inc();
  },
  trackPayment(status: 'initiated' | 'completed' | 'failed') {
    if (status === 'initiated') metrics.paymentsInitiated.inc();
    if (status === 'completed') metrics.paymentsCompleted.inc();
    if (status === 'failed') metrics.paymentsFailed.inc();
  },
  trackAiUsage(minutes: number) {
    metrics.aiMinutesUsed.inc(minutes);
  },
  trackWsConnect() { metrics.wsConnectionsActive.inc(); },
  trackWsDisconnect() { metrics.wsConnectionsActive.inc(-1); },
  trackWsMessage() { metrics.wsMessagesTotal.inc(); },
};

// ── Prometheus Text Format Export ─────────────────────────
// Outputs metrics in OpenMetrics / Prometheus exposition format.
// Scraped by Prometheus at /api/admin/observability/metrics/prometheus
export function getPrometheusMetrics(): string {
  const lines: string[] = [];

  function gauge(name: string, help: string, value: number) {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} gauge`);
    lines.push(`${name} ${value}`);
  }

  function counter(name: string, help: string, value: number) {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} counter`);
    lines.push(`${name} ${value}`);
  }

  // System
  const mem = process.memoryUsage();
  gauge('process_resident_memory_bytes', 'Resident memory size in bytes', mem.rss);
  gauge('process_heap_used_bytes', 'Heap used in bytes', mem.heapUsed);
  gauge('process_heap_total_bytes', 'Heap total in bytes', mem.heapTotal);
  gauge('process_uptime_seconds', 'Process uptime in seconds', process.uptime());
  gauge('nodejs_active_handles_total', 'Active handles', (process as any)._getActiveHandles?.()?.length || 0);
  gauge('nodejs_active_requests_total', 'Active requests', (process as any)._getActiveRequests?.()?.length || 0);

  // HTTP
  counter('http_requests_total', 'Total HTTP requests', metrics.httpRequestsTotal.value);
  counter('http_responses_2xx_total', '2xx responses', metrics.httpResponsesByStatus['2xx']?.value || 0);
  counter('http_responses_4xx_total', '4xx responses', metrics.httpResponsesByStatus['4xx']?.value || 0);
  counter('http_responses_5xx_total', '5xx responses', metrics.httpResponsesByStatus['5xx']?.value || 0);

  // Response time histogram with Prometheus-standard buckets
  const BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
  const rtValues = metrics.httpResponseTime.values;
  const totalSum = rtValues.reduce((a, b) => a + b, 0);
  lines.push('# HELP http_request_duration_ms HTTP request duration in milliseconds');
  lines.push('# TYPE http_request_duration_ms histogram');
  let cumulative = 0;
  for (const le of BUCKETS) {
    cumulative = rtValues.filter(v => v <= le).length;
    lines.push(`http_request_duration_ms_bucket{le="${le}"} ${cumulative}`);
  }
  lines.push(`http_request_duration_ms_bucket{le="+Inf"} ${rtValues.length}`);
  lines.push(`http_request_duration_ms_sum ${+totalSum.toFixed(2)}`);
  lines.push(`http_request_duration_ms_count ${rtValues.length}`);

  // Response time percentiles (summary gauges for convenience)
  gauge('http_response_time_p50_ms', 'HTTP response time p50', +metrics.httpResponseTime.percentile(50).toFixed(2));
  gauge('http_response_time_p95_ms', 'HTTP response time p95', +metrics.httpResponseTime.percentile(95).toFixed(2));
  gauge('http_response_time_p99_ms', 'HTTP response time p99', +metrics.httpResponseTime.percentile(99).toFixed(2));

  // Auth
  counter('auth_login_attempts_total', 'Login attempts', metrics.authLoginAttempts.value);
  counter('auth_login_success_total', 'Successful logins', metrics.authLoginSuccess.value);
  counter('auth_login_failures_total', 'Failed logins', metrics.authLoginFailures.value);
  counter('auth_token_refreshes_total', 'Token refreshes', metrics.authTokenRefreshes.value);

  // Business
  counter('wallet_operations_total', 'Wallet operations', metrics.walletOperations.value);
  counter('payments_initiated_total', 'Payments initiated', metrics.paymentsInitiated.value);
  counter('payments_completed_total', 'Payments completed', metrics.paymentsCompleted.value);
  counter('payments_failed_total', 'Payments failed', metrics.paymentsFailed.value);

  // WebSocket
  gauge('ws_connections_active', 'Active WebSocket connections', metrics.wsConnectionsActive.value);
  counter('ws_messages_total', 'WebSocket messages processed', metrics.wsMessagesTotal.value);

  return lines.join('\n') + '\n';
}
