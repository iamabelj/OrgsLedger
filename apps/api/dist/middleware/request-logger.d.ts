import { Request, Response, NextFunction } from 'express';
/**
 * Log every API request with method, path, user, org, duration, status.
 * Attach to app.use() BEFORE route handlers.
 */
export declare function requestLogger(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=request-logger.d.ts.map