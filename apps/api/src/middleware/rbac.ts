// ============================================================
// OrgsLedger API — Role-Based Access Control Middleware
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { ROLE_HIERARCHY } from '../constants';

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

    // Super admin and developer bypass all checks
    if (req.user.globalRole === 'super_admin' || req.user.globalRole === 'developer') {
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
 * Require developer access (platform-level SaaS owner).
 * Developer is the GOD OF THEM ALL — above super_admin.
 */
export function requireDeveloper() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || (req.user.globalRole !== 'developer' && req.user.globalRole !== 'super_admin')) {
      res.status(403).json({
        success: false,
        error: 'Developer or super admin access required',
      });
      return;
    }
    next();
  };
}

/**
 * Require super admin access (organization-level God) or higher.
 * Both super_admin and developer pass this check.
 */
export function requireSuperAdmin() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || (req.user.globalRole !== 'super_admin' && req.user.globalRole !== 'developer')) {
      res.status(403).json({
        success: false,
        error: 'Super admin access required',
      });
      return;
    }
    next();
  };
}
