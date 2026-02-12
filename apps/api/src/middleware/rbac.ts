// ============================================================
// OrgsLedger API — Role-Based Access Control Middleware
// ============================================================

import { Request, Response, NextFunction } from 'express';

const ROLE_HIERARCHY: Record<string, number> = {
  guest: 0,
  member: 1,
  executive: 2,
  org_admin: 3,
  super_admin: 4,
};

/**
 * Require minimum role level to access a route.
 * Must be used AFTER authenticate and loadMembership.
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    // Super admin bypasses all checks
    if (req.user.globalRole === 'super_admin') {
      return next();
    }

    if (!req.membership) {
      res.status(403).json({ success: false, error: 'Organization membership required' });
      return;
    }

    const userRole = req.membership.role;
    if (allowedRoles.includes(userRole)) {
      return next();
    }

    // Check hierarchy: if user's role level >= any allowed role level
    const userLevel = ROLE_HIERARCHY[userRole] ?? 0;
    const minAllowedLevel = Math.min(
      ...allowedRoles.map((r) => ROLE_HIERARCHY[r] ?? 999)
    );

    if (userLevel >= minAllowedLevel) {
      return next();
    }

    res.status(403).json({
      success: false,
      error: 'Insufficient permissions',
    });
  };
}

/**
 * Require super admin access (platform-level).
 */
export function requireSuperAdmin() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || req.user.globalRole !== 'super_admin') {
      res.status(403).json({
        success: false,
        error: 'Super admin access required',
      });
      return;
    }
    next();
  };
}
