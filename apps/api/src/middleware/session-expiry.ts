// ============================================================
// OrgsLedger API — Session Expiry Middleware
// Enforces platform-specific session lifetimes and inactivity timeouts
// ============================================================

import { Request, Response, NextFunction } from 'express';
import db from '../db';
import { logger } from '../logger';

// Platform-specific session limits (in milliseconds)
const SESSION_LIMITS = {
  web: {
    maxSessionAge: 7 * 24 * 60 * 60 * 1000, // 7 days from last signin
    inactivityTimeout: 7 * 24 * 60 * 60 * 1000, // 7 days of inactivity
  },
  mobile: {
    maxSessionAge: 30 * 24 * 60 * 60 * 1000, // 30 days from last signin
    inactivityTimeout: 30 * 24 * 60 * 60 * 1000, // 30 days of inactivity
    noSigninPurgeDays: 30, // Auto-logout if not signed in for 30 days
  },
};

/**
 * Detect platform from request headers.
 * Web clients: standard browsers (without mobile indicators)
 * Mobile clients: React Native apps (X-Client-Type header) or User-Agent with mobile indicators
 */
function detectPlatform(req: Request): 'web' | 'mobile' {
  const clientType = req.headers['x-client-type']?.toString().toLowerCase();
  const userAgent = req.headers['user-agent']?.toString().toLowerCase() || '';

  // Explicit client type header takes precedence
  if (clientType === 'mobile' || clientType === 'react-native' || clientType === 'flutter') {
    return 'mobile';
  }
  if (clientType === 'web') {
    return 'web';
  }

  // Fallback: User-Agent heuristics
  const mobileIndicators = [
    'mobile',
    'iphone',
    'ipad',
    'android',
    'windows phone',
    'blackberry',
    'opera mini',
  ];
  const isLikelyMobile = mobileIndicators.some((indicator) => userAgent.includes(indicator));

  return isLikelyMobile ? 'mobile' : 'web';
}

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
export async function sessionExpiry(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Skip if user not authenticated (authenticate middleware will handle)
  if (!req.user) {
    return next();
  }

  try {
    const userId = req.user.userId;
    const platform = detectPlatform(req);

    // Fetch last activity and signin timestamps
    const user = await db('users')
      .where({ id: userId })
      .select('last_activity_at', 'last_signin_at', 'is_active')
      .first();

    if (!user) {
      // User was deleted or deactivated since token was issued
      logger.warn('[SESSION] User not found', { userId, platform });
      res.status(401).json({
        success: false,
        error: 'Session invalid — user not found',
        code: 'SESSION_INVALID',
      });
      return;
    }

    if (!user.is_active) {
      logger.warn('[SESSION] User is inactive', { userId, platform });
      res.status(401).json({
        success: false,
        error: 'Session invalid — user account is inactive',
        code: 'USER_INACTIVE',
      });
      return;
    }

    const now = Date.now();
    const limits = SESSION_LIMITS[platform];

    // Check inactivity timeout
    if (user.last_activity_at) {
      const lastActivityMs = new Date(user.last_activity_at).getTime();
      const inactivityDuration = now - lastActivityMs;

      if (inactivityDuration > limits.inactivityTimeout) {
        const inactivityDays = Math.floor(inactivityDuration / (24 * 60 * 60 * 1000));
        logger.warn('[SESSION] Session expired due to inactivity', {
          userId,
          platform,
          inactivityDays,
          maxInactivityDays: limits.inactivityTimeout / (24 * 60 * 60 * 1000),
        });
        res.status(401).json({
          success: false,
          error: `Session expired due to ${inactivityDays} days of inactivity. Please sign in again.`,
          code: 'SESSION_INACTIVITY_TIMEOUT',
        });
        return;
      }
    }

    // Mobile-specific: Check 30-day no-signin
    if (platform === 'mobile' && user.last_signin_at) {
      const lastSigninMs = new Date(user.last_signin_at).getTime();
      const noSigninDuration = now - lastSigninMs;
      const noSigninDays = Math.floor(noSigninDuration / (24 * 60 * 60 * 1000));

      if (noSigninDays > SESSION_LIMITS.mobile.noSigninPurgeDays) {
        logger.warn('[SESSION] Mobile session expired — no signin for 30+ days', {
          userId,
          noSigninDays,
        });
        res.status(401).json({
          success: false,
          error: `Mobile session expired — you haven't signed in for ${noSigninDays} days. Please sign in again.`,
          code: 'SESSION_NO_SIGNIN_TIMEOUT',
        });
        return;
      }
    }

    logger.debug('[SESSION] Session valid', {
      userId,
      platform,
      lastActivity: user.last_activity_at,
    });

    // Update last_activity_at for non-login endpoints
    // (login endpoint will update last_signin_at instead)
    if (req.path !== '/auth/login' && req.path !== '/auth/admin-register') {
      // Non-blocking async update
      db('users')
        .where({ id: userId })
        .update({ last_activity_at: db.fn.now() })
        .catch((err) => {
          logger.warn('[SESSION] Failed to update last_activity_at', { userId, error: err.message });
        });
    }

    next();
  } catch (err: any) {
    logger.error('[SESSION] Unexpected error in session expiry check', {
      error: err.message,
      userId: req.user?.userId,
    });
    // Don't block request on middleware error — log and continue
    next();
  }
}

/**
 * Update last_signin_at for manual login attempts.
 * Call this in the login endpoint after successful authentication.
 */
export async function updateLastSignin(userId: string): Promise<void> {
  try {
    await db('users').where({ id: userId }).update({
      last_signin_at: db.fn.now(),
      last_activity_at: db.fn.now(),
    });
  } catch (err: any) {
    logger.warn('[SESSION] Failed to update last_signin_at', { userId, error: err.message });
  }
}
