import { Request, Response, NextFunction } from 'express';
/**
 * ETag middleware for GET requests.
 * Computes a hash of the response body and returns 304 Not Modified
 * if the client's If-None-Match header matches.
 */
export declare function etagMiddleware(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=etag.d.ts.map