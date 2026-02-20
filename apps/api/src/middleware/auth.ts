// ============================================================
// OrgsLedger API — Authentication Middleware (Optimized)
// ============================================================

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import db from '../db';
import { logger } from '../logger';

export interface AuthPayload {
  userId: string;
  email: string;
  globalRole: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
      membership?: {
        id: string;
        role: string;
        organizationId: string;
        isActive: boolean;
      };
    }
  }
}

// ── In-Memory User Cache (avoids DB hit on every request) ──
// TTL-based: entries expire after 60 seconds
interface CachedUser {
  is_active: boolean;
  global_role: string;
  password_changed_at: string | null;
  cachedAt: number;
}
const USER_CACHE = new Map<string, CachedUser>();
const USER_CACHE_TTL = 60_000; // 60 seconds
const USER_CACHE_MAX = 500;    // Max entries to prevent memory leak

function getCachedUser(userId: string): CachedUser | null {
  const entry = USER_CACHE.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > USER_CACHE_TTL) {
    USER_CACHE.delete(userId);
    return null;
  }
  return entry;
}

function cacheUser(userId: string, user: any): void {
  // Evict oldest if at capacity
  if (USER_CACHE.size >= USER_CACHE_MAX) {
    const firstKey = USER_CACHE.keys().next().value;
    if (firstKey) USER_CACHE.delete(firstKey);
  }
  USER_CACHE.set(userId, {
    is_active: user.is_active,
    global_role: user.global_role,
    password_changed_at: user.password_changed_at,
    cachedAt: Date.now(),
  });
}

/** Invalidate cache for a user (call after password change, deactivation, etc.) */
export function invalidateUserCache(userId: string): void {
  USER_CACHE.delete(userId);
}

/** Clear entire user cache (used in tests) */
export function clearUserCache(): void {
  USER_CACHE.clear();
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const token = authHeader.split(' ')[1];

    // ── Try gateway token first (developer admin — no DB account) ──
    const gatewaySecret = process.env.GATEWAY_JWT_SECRET;
    if (gatewaySecret) {
      try {
        const gwPayload = jwt.verify(token, gatewaySecret) as any;
        if (gwPayload.role === 'gateway_admin') {
          // Synthetic developer user — above super_admin, no database record
          req.user = {
            userId: 'gateway-developer',
            email: gwPayload.email || process.env.ADMIN_EMAIL || 'developer@orgsledger.com',
            globalRole: 'developer',
          };
          logger.debug('[AUTH] Gateway developer authenticated', { email: req.user.email, path: req.originalUrl });
          return next();
        }
      } catch {
        // Not a gateway token — fall through to normal JWT verification
      }
    }

    // ── Normal app user JWT ──
    const payload = jwt.verify(token, config.jwt.secret) as AuthPayload & { iat?: number };

    // Check cache first, then DB
    let user = getCachedUser(payload.userId);
    if (!user) {
      const dbUser = await db('users')
        .where({ id: payload.userId })
        .select('is_active', 'global_role', 'password_changed_at')
        .first();
      if (!dbUser || !dbUser.is_active) {
        logger.warn('[AUTH] User not found or deactivated', { userId: payload.userId });
        res.status(401).json({ success: false, error: 'User not found or deactivated' });
        return;
      }
      cacheUser(payload.userId, dbUser);
      user = getCachedUser(payload.userId)!;
    }

    if (!user.is_active) {
      res.status(401).json({ success: false, error: 'User not found or deactivated' });
      return;
    }

    // Check if password was changed after this token was issued
    if (user.password_changed_at && payload.iat) {
      const changedAt = Math.floor(new Date(user.password_changed_at).getTime() / 1000);
      if (payload.iat < changedAt) {
        logger.warn('[AUTH] Token issued before password change', { userId: payload.userId });
        res.status(401).json({ success: false, error: 'Token invalidated — please log in again' });
        return;
      }
    }

    logger.debug('[AUTH] Authenticated', { userId: payload.userId, email: payload.email, role: payload.globalRole, path: req.originalUrl });
    req.user = payload;
    next();
  } catch (err: any) {
    logger.warn('[AUTH] Token verification failed', { error: err.message, path: req.originalUrl, ip: req.ip });
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

/**
 * Load membership for the current user in the given organization.
 * Expects :orgId param in the route.
 */
export async function loadMembership(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const orgId = req.params.orgId;
    if (!orgId || !req.user) {
      res.status(400).json({ success: false, error: 'Organization ID required' });
      return;
    }

    // Super admins and developers get admin-level access everywhere
    if (req.user.globalRole === 'super_admin' || req.user.globalRole === 'developer') {
      req.membership = {
        id: req.user.userId,  // Use actual user ID, not role string
        role: 'org_admin',
        organizationId: orgId,
        isActive: true,
      };
      return next();
    }

    const membership = await db('memberships')
      .where({
        user_id: req.user.userId,
        organization_id: orgId,
        is_active: true,
      })
      .first();

    if (!membership) {
      logger.warn('[AUTH] Non-member access attempt', { userId: req.user.userId, orgId });
      res.status(403).json({ success: false, error: 'Not a member of this organization' });
      return;
    }

    logger.debug('[AUTH] Membership loaded', { userId: req.user.userId, orgId, role: membership.role });
    req.membership = {
      id: membership.id,
      role: membership.role,
      organizationId: orgId,
      isActive: membership.is_active,
    };

    next();
  } catch (err) {
    next(err);
  }
}
