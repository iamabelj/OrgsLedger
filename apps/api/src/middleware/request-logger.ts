// ============================================================
// OrgsLedger — Full Request/Response Logging Middleware
// Structured logging with correlation IDs for request tracing
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { logger, generateCorrelationId } from '../logger';

/**
 * Log every API request with method, path, user, org, duration, status.
 * Assigns a correlation ID to each request for distributed tracing.
 * Attach to app.use() BEFORE route handlers.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const { method, originalUrl, ip } = req;

  // Assign correlation ID (use incoming header if available, else generate)
  const correlationId = (req.headers['x-correlation-id'] as string) || generateCorrelationId();
  (req as any).correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);

  // Capture response finish
  res.on('finish', () => {
    const duration = Date.now() - start;
    const userId = req.user?.userId || 'anon';
    const orgId = req.params?.orgId || (req as any).organizationId || '-';
    const status = res.statusCode;
    const contentLength = res.getHeader('content-length') || '-';

    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

    logger[level]('[REQ]', {
      correlationId,
      method,
      path: originalUrl,
      status,
      duration: `${duration}ms`,
      durationMs: duration,
      contentLength,
      userId,
      orgId,
      ip: ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent']?.substring(0, 80),
    });
  });

  next();
}
