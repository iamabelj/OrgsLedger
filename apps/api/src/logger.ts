// ============================================================
// OrgsLedger API — Structured Logger (Winston)
// JSON logging in production with request correlation IDs,
// custom metadata fields, and performance timing.
// ============================================================

import winston from 'winston';
import { config } from './config';
import crypto from 'crypto';

// ── Correlation ID Generator ──────────────────────────────
export function generateCorrelationId(): string {
  return crypto.randomBytes(8).toString('hex');
}

// ── Custom Log Formats ────────────────────────────────────
const structuredFormat = winston.format.printf(({ level, message, timestamp, ...meta }) => {
  // Strip Symbol-keyed properties that Winston adds
  const cleanMeta = { ...meta };
  delete (cleanMeta as any)[Symbol.for('level')];
  delete (cleanMeta as any)[Symbol.for('splat')];

  return JSON.stringify({
    timestamp,
    level,
    message,
    service: 'orgsledger-api',
    environment: config.env,
    ...cleanMeta,
  });
});

const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.printf(({ level, message, timestamp, ...meta }) => {
    const cleanMeta = { ...meta };
    delete (cleanMeta as any)[Symbol.for('level')];
    delete (cleanMeta as any)[Symbol.for('splat')];
    delete cleanMeta.service;

    const metaStr = Object.keys(cleanMeta).length > 0
      ? ' ' + JSON.stringify(cleanMeta)
      : '';
    return `${timestamp} ${level}: ${message}${metaStr}`;
  }),
);

// ── Logger Instance ───────────────────────────────────────
export const logger = winston.createLogger({
  level: config.env === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    winston.format.errors({ stack: true }),
  ),
  defaultMeta: {
    service: 'orgsledger-api',
    version: process.env.npm_package_version || '1.0.0',
    nodeVersion: process.version,
    pid: process.pid,
  },
  transports: [
    new winston.transports.Console({
      format: config.env === 'production' ? structuredFormat : devFormat,
    }),
  ],
});

// ── Child Logger Factory ──────────────────────────────────
// Create scoped loggers for services with pre-set metadata
export function createServiceLogger(service: string) {
  return logger.child({ component: service });
}

// ── Performance Timer ─────────────────────────────────────
export function startTimer(operation: string) {
  const start = process.hrtime.bigint();
  return {
    end(meta?: Record<string, unknown>) {
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6; // ms
      logger.info(`[PERF] ${operation}`, {
        operation,
        durationMs: Math.round(elapsed * 100) / 100,
        ...meta,
      });
      return elapsed;
    },
  };
}

