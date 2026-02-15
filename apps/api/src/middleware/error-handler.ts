// ============================================================
// OrgsLedger API — Async Route Handler Wrapper
// Eliminates repetitive try/catch in every route handler.
// ============================================================

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { logger } from '../logger';
import { config } from '../config';

/**
 * Application-level error with an HTTP status code.
 * Throw this from any controller / service to return a clean JSON error.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  /** 400 Bad Request */
  static badRequest(msg: string = 'Bad request') { return new AppError(msg, 400); }
  /** 401 Unauthorized */
  static unauthorized(msg: string = 'Authentication required') { return new AppError(msg, 401); }
  /** 403 Forbidden */
  static forbidden(msg: string = 'Insufficient permissions') { return new AppError(msg, 403); }
  /** 404 Not Found */
  static notFound(msg: string = 'Resource not found') { return new AppError(msg, 404); }
  /** 409 Conflict */
  static conflict(msg: string = 'Resource already exists') { return new AppError(msg, 409); }
  /** 422 Unprocessable Entity */
  static validation(msg: string = 'Validation failed') { return new AppError(msg, 422); }
  /** 429 Too Many Requests */
  static rateLimit(msg: string = 'Too many requests') { return new AppError(msg, 429); }
  /** 402 Payment Required */
  static paymentRequired(msg: string = 'Payment required') { return new AppError(msg, 402); }
  /** 503 Service Unavailable */
  static serviceUnavailable(msg: string = 'Service unavailable') { return new AppError(msg, 503); }
}

/**
 * Wrap an async route handler so that thrown errors (including AppError)
 * are automatically caught and forwarded to Express error handling.
 *
 * Usage:
 * ```ts
 * router.get('/items', asyncHandler(async (req, res) => {
 *   const items = await db('items').select('*');
 *   if (!items.length) throw AppError.notFound('No items');
 *   res.json({ success: true, data: items });
 * }));
 * ```
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void | any>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Global error-handling middleware.
 * Place at the END of the middleware chain.
 */
export function globalErrorHandler(
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    // Known operational error — send structured JSON
    logger.warn(`[AppError] ${err.statusCode} ${err.message}`);
    res.status(err.statusCode).json({
      success: false,
      error: err.message,
    });
    return;
  }

  // Unknown / programming error — hide details in production
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({
    success: false,
    error: config.env === 'production' ? 'Internal server error' : err.message,
  });
}
