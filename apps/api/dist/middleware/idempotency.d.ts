import { Request, Response, NextFunction } from 'express';
/**
 * Idempotency middleware for mutating endpoints.
 * Usage: app.use('/api/payments', idempotencyMiddleware);
 *
 * Behaviour:
 * - Only applies to POST, PUT, PATCH, DELETE methods
 * - If no Idempotency-Key header is present, request passes through
 * - If key was seen before and completed, replays the stored response
 * - If key is currently in-flight, returns 409 Conflict
 */
export declare function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): Promise<void>;
/** Clear the idempotency store (used in tests) */
export declare function clearIdempotencyStore(): void;
//# sourceMappingURL=idempotency.d.ts.map