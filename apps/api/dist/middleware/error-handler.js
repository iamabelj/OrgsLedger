"use strict";
// ============================================================
// OrgsLedger API — Async Route Handler Wrapper
// Eliminates repetitive try/catch in every route handler.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = void 0;
exports.asyncHandler = asyncHandler;
exports.globalErrorHandler = globalErrorHandler;
const logger_1 = require("../logger");
const config_1 = require("../config");
/**
 * Application-level error with an HTTP status code.
 * Throw this from any controller / service to return a clean JSON error.
 */
class AppError extends Error {
    statusCode;
    isOperational;
    constructor(message, statusCode = 500, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        Object.setPrototypeOf(this, AppError.prototype);
    }
    /** 400 Bad Request */
    static badRequest(msg = 'Bad request') { return new AppError(msg, 400); }
    /** 401 Unauthorized */
    static unauthorized(msg = 'Authentication required') { return new AppError(msg, 401); }
    /** 403 Forbidden */
    static forbidden(msg = 'Insufficient permissions') { return new AppError(msg, 403); }
    /** 404 Not Found */
    static notFound(msg = 'Resource not found') { return new AppError(msg, 404); }
    /** 409 Conflict */
    static conflict(msg = 'Resource already exists') { return new AppError(msg, 409); }
    /** 422 Unprocessable Entity */
    static validation(msg = 'Validation failed') { return new AppError(msg, 422); }
    /** 429 Too Many Requests */
    static rateLimit(msg = 'Too many requests') { return new AppError(msg, 429); }
    /** 402 Payment Required */
    static paymentRequired(msg = 'Payment required') { return new AppError(msg, 402); }
    /** 503 Service Unavailable */
    static serviceUnavailable(msg = 'Service unavailable') { return new AppError(msg, 503); }
}
exports.AppError = AppError;
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
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
/**
 * Global error-handling middleware.
 * Place at the END of the middleware chain.
 */
function globalErrorHandler(err, _req, res, _next) {
    if (err instanceof AppError) {
        // Known operational error — send structured JSON
        logger_1.logger.warn(`[AppError] ${err.statusCode} ${err.message}`);
        res.status(err.statusCode).json({
            success: false,
            error: err.message,
        });
        return;
    }
    // Unknown / programming error — hide details in production
    logger_1.logger.error('Unhandled error', { error: err.message, stack: err.stack });
    res.status(500).json({
        success: false,
        error: config_1.config.env === 'production' ? 'Internal server error' : err.message,
    });
}
//# sourceMappingURL=error-handler.js.map