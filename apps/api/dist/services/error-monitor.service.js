"use strict";
// ============================================================
// OrgsLedger API — Error Monitoring (Sentry-compatible)
// Lightweight error tracking with contextual metadata.
// When SENTRY_DSN is set, errors are forwarded to Sentry.
// Otherwise, errors are structured-logged for self-hosted setups.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureError = captureError;
exports.errorMonitorMiddleware = errorMonitorMiddleware;
exports.setupProcessErrorHandlers = setupProcessErrorHandlers;
exports.getRecentErrors = getRecentErrors;
exports.getErrorFrequency = getErrorFrequency;
exports.getErrorStats = getErrorStats;
const logger_1 = require("../logger");
const config_1 = require("../config");
// ── In-Memory Error Buffer ────────────────────────────────
// Keeps last N errors for the /api/admin/errors dashboard.
// In production, this supplements Sentry — not a replacement.
const ERROR_BUFFER_SIZE = 200;
const errorBuffer = [];
// Error frequency tracking (for deduplication/alerting)
const errorFrequency = new Map();
// ── Fingerprint Generator ─────────────────────────────────
function fingerprint(err, context) {
    const route = context.route || 'unknown';
    const name = err.name || 'Error';
    const firstLine = (err.stack || err.message).split('\n')[0].substring(0, 100);
    return `${name}:${route}:${firstLine}`;
}
// ── Core Capture Function ─────────────────────────────────
function captureError(err, severity = 'error', context = {}) {
    const fp = fingerprint(err, context);
    const now = new Date().toISOString();
    // Track frequency (capped at 500 unique fingerprints)
    const freq = errorFrequency.get(fp);
    if (freq) {
        freq.count++;
        freq.lastSeen = now;
    }
    else {
        if (errorFrequency.size >= 500) {
            // Evict oldest fingerprint
            const oldestKey = errorFrequency.keys().next().value;
            if (oldestKey)
                errorFrequency.delete(oldestKey);
        }
        errorFrequency.set(fp, { count: 1, firstSeen: now, lastSeen: now });
    }
    // Add to buffer (circular)
    const entry = {
        timestamp: now,
        severity,
        message: err.message,
        stack: err.stack,
        context,
        fingerprint: fp,
    };
    errorBuffer.push(entry);
    if (errorBuffer.length > ERROR_BUFFER_SIZE) {
        errorBuffer.shift();
    }
    // Structured log
    const logLevel = severity === 'fatal' || severity === 'error' ? 'error' : 'warn';
    logger_1.logger[logLevel](`[ERROR_MONITOR] ${err.message}`, {
        severity,
        fingerprint: fp,
        errorName: err.name,
        ...context,
        occurrences: errorFrequency.get(fp)?.count || 1,
    });
    // Forward to Sentry if configured
    if (process.env.SENTRY_DSN) {
        forwardToSentry(err, severity, context);
    }
}
// ── Sentry Forwarding ─────────────────────────────────────
// Lightweight HTTP-based Sentry forwarding without the full SDK.
// Install @sentry/node for full integration — this is a zero-dep fallback.
async function forwardToSentry(err, severity, context) {
    try {
        const dsn = process.env.SENTRY_DSN;
        // Parse DSN: https://<key>@<host>/<project_id>
        const match = dsn.match(/https?:\/\/(\w+)@([^/]+)\/(\d+)/);
        if (!match) {
            logger_1.logger.warn('[SENTRY] Invalid DSN format');
            return;
        }
        const [, publicKey, host, projectId] = match;
        const url = `https://${host}/api/${projectId}/store/`;
        const payload = {
            event_id: crypto.randomUUID?.() || Date.now().toString(16),
            timestamp: new Date().toISOString(),
            level: severity,
            platform: 'node',
            server_name: process.env.HOSTNAME || 'orgsledger-api',
            environment: config_1.config.env,
            release: process.env.npm_package_version || '1.0.0',
            exception: {
                values: [
                    {
                        type: err.name,
                        value: err.message,
                        stacktrace: {
                            frames: (err.stack || '')
                                .split('\n')
                                .slice(1)
                                .map((line) => ({ filename: line.trim() }))
                                .reverse(),
                        },
                    },
                ],
            },
            tags: {
                route: context.route || 'unknown',
                method: context.method || 'unknown',
            },
            user: context.userId ? { id: context.userId } : undefined,
            extra: {
                orgId: context.orgId,
                statusCode: context.statusCode,
                correlationId: context.correlationId,
                ...context.extra,
            },
        };
        await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${publicKey}, sentry_client=orgsledger/1.0`,
            },
            body: JSON.stringify(payload),
        }).catch(() => {
            // Silently fail — monitoring should never crash the app
        });
    }
    catch {
        // Never let Sentry integration crash the app
    }
}
// ── Express Error Middleware ──────────────────────────────
function errorMonitorMiddleware(err, req, res, next) {
    captureError(err instanceof Error ? err : new Error(String(err)), 'error', {
        userId: req.user?.userId,
        orgId: req.params?.orgId,
        route: `${req.method} ${req.route?.path || req.originalUrl}`,
        method: req.method,
        statusCode: err.status || 500,
        correlationId: req.correlationId,
    });
    next(err);
}
// ── Unhandled Rejection / Exception Handlers ─────────────
function setupProcessErrorHandlers() {
    process.on('uncaughtException', (err) => {
        captureError(err, 'fatal', { extra: { type: 'uncaughtException' } });
        logger_1.logger.error('[FATAL] Uncaught exception — process will exit', { error: err.message, stack: err.stack });
        // Give Sentry time to flush, then exit
        setTimeout(() => process.exit(1), 2000);
    });
    process.on('unhandledRejection', (reason) => {
        const err = reason instanceof Error ? reason : new Error(String(reason));
        captureError(err, 'error', { extra: { type: 'unhandledRejection' } });
    });
}
// ── Dashboard Data Accessors ─────────────────────────────
function getRecentErrors(limit = 50) {
    return errorBuffer.slice(-limit).reverse();
}
function getErrorFrequency() {
    const entries = [];
    errorFrequency.forEach((val, key) => {
        entries.push({ fingerprint: key, ...val });
    });
    return entries.sort((a, b) => b.count - a.count).slice(0, 50);
}
function getErrorStats() {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recent = errorBuffer.filter((e) => e.timestamp >= last24h);
    return {
        total: errorBuffer.length,
        last24h: recent.length,
        bySeverity: {
            fatal: recent.filter((e) => e.severity === 'fatal').length,
            error: recent.filter((e) => e.severity === 'error').length,
            warning: recent.filter((e) => e.severity === 'warning').length,
        },
        uniqueFingerprints: errorFrequency.size,
        topErrors: getErrorFrequency().slice(0, 10),
    };
}
//# sourceMappingURL=error-monitor.service.js.map