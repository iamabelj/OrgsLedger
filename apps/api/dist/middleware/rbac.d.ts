import { Request, Response, NextFunction } from 'express';
/**
 * Require minimum role level to access a route.
 * Must be used AFTER authenticate and loadMembership.
 */
export declare function requireRole(...allowedRoles: string[]): (req: Request, res: Response, next: NextFunction) => void;
/**
 * Require super admin access (platform-level).
 */
export declare function requireSuperAdmin(): (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=rbac.d.ts.map