// ============================================================
// OrgsLedger — OpenTelemetry Instrumentation
// Distributed tracing + Prometheus metrics export.
// Initialize BEFORE any other imports in standalone workers
// or set OTEL_ENABLED=true in the monolith.
//
// Traces flow: service → OTLP collector → Jaeger/Tempo
// Metrics flow: service → /metrics endpoint → Prometheus
// ============================================================

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { logger } from '../../logger';

const OTEL_ENABLED = process.env.OTEL_ENABLED === 'true';
const OTEL_COLLECTOR_URL = process.env.OTEL_COLLECTOR_URL || 'http://localhost:4318/v1/traces';
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'orgsledger-api';
const METRICS_PORT = parseInt(process.env.OTEL_METRICS_PORT || '9464', 10);

let sdk: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry SDK.
 * Call this FIRST in your entry point, before importing other modules.
 */
export function initTelemetry(serviceName?: string): void {
  if (!OTEL_ENABLED) {
    logger.info('[OTEL] Telemetry disabled (set OTEL_ENABLED=true to enable)');
    return;
  }

  const svcName = serviceName || SERVICE_NAME;

  try {
    // Prometheus metrics exporter (scrape on :9464/metrics)
    const prometheusExporter = new PrometheusExporter({
      port: METRICS_PORT,
    });

    // OTLP trace exporter (push to collector)
    const traceExporter = new OTLPTraceExporter({
      url: OTEL_COLLECTOR_URL,
    });

    sdk = new NodeSDK({
      resource: new Resource({
        [ATTR_SERVICE_NAME]: svcName,
        [ATTR_SERVICE_VERSION]: '1.0.0',
      }),
      traceExporter,
      // Note: metrics handled by Prometheus pull model
      instrumentations: [
        new HttpInstrumentation({
          // Don't trace health checks
          ignoreIncomingRequestHook: (req) => {
            return req.url === '/health' || req.url === '/metrics';
          },
        }),
        new ExpressInstrumentation(),
        new IORedisInstrumentation(),
      ],
    });

    sdk.start();
    logger.info(`[OTEL] Telemetry initialized for ${svcName}, metrics on :${METRICS_PORT}/metrics`);
  } catch (err) {
    logger.error('[OTEL] Failed to initialize telemetry', err);
  }
}

/**
 * Gracefully shutdown the SDK (flush pending spans).
 */
export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
      logger.info('[OTEL] Telemetry shut down');
    } catch (err) {
      logger.error('[OTEL] Telemetry shutdown error', err);
    }
  }
}
