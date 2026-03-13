import { Request, Response, NextFunction, RequestHandler } from 'express';
/**
 * Application-level error with an HTTP status code.
 * Throw this from any controller / service to return a clean JSON error.
 */
export declare class AppError extends Error {
    readonly statusCode: number;
    readonly isOperational: boolean;
    constructor(message: string, statusCode?: number, isOperational?: boolean);
    /** 400 Bad Request */
    static badRequest(msg?: string): AppError;
    /** 401 Unauthorized */
    static unauthorized(msg?: string): AppError;
    /** 403 Forbidden */
    static forbidden(msg?: string): AppError;
    /** 404 Not Found */
    static notFound(msg?: string): AppError;
    /** 409 Conflict */
    static conflict(msg?: string): AppError;
    /** 422 Unprocessable Entity */
    static validation(msg?: string): AppError;
    /** 429 Too Many Requests */
    static rateLimit(msg?: string): AppError;
    /** 402 Payment Required */
    static paymentRequired(msg?: string): AppError;
    /** 503 Service Unavailable */
    static serviceUnavailable(msg?: string): AppError;
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
export declare function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void | any>): RequestHandler;
/**
 * Global error-handling middleware.
 * Place at the END of the middleware chain.
 */
export declare function globalErrorHandler(err: Error | AppError, _req: Request, res: Response, _next: NextFunction): void;
//# sourceMappingURL=error-handler.d.ts.map