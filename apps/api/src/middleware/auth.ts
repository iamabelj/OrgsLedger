// ============================================================
// OrgsLedger API — Authentication Middleware
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
    const payload = jwt.verify(token, config.jwt.secret) as AuthPayload;

    // Verify user still exists and is active
    const user = await db('users')
      .where({ id: payload.userId, is_active: true })
      .first();
    if (!user) {
      logger.warn('[AUTH] User not found or deactivated', { userId: payload.userId, email: payload.email });
      res.status(401).json({ success: false, error: 'User not found or deactivated' });
      return;
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

    // Super admins get admin-level access everywhere
    if (req.user.globalRole === 'super_admin') {
      req.membership = {
        id: 'super_admin',
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
