import { Request, Response, NextFunction } from 'express';
/**
 * Session expiry middleware.
 *
 * Validates that authenticated users haven't exceeded their session limits.
 * Platform-specific limits:
 *   - Web: 7-day inactivity timeout
 *   - Mobile: 30-day inactivity timeout + 30-day no-signin auto-logout
 *
 * **Must be applied AFTER authenticate middleware.**
 * Expects req.user to be populated.
 *
 * @example
 * app.use(authenticate);
 * app.use(sessionExpiry);
 */
export declare function sessionExpiry(req: Request, res: Response, next: NextFunction): Promise<void>;
/**
 * Update last_signin_at for manual login attempts.
 * Call this in the login endpoint after successful authentication.
 */
export declare function updateLastSignin(userId: string): Promise<void>;
//# sourceMappingURL=session-expiry.d.ts.map