import { Request, Response, NextFunction } from 'express';
/**
 * Require minimum role level to access a route.
 * Must be used AFTER authenticate and loadMembership.
 */
export declare function requireRole(...allowedRoles: string[]): (req: Request, res: Response, next: NextFunction) => void;
/**
 * Require developer access (platform-level SaaS owner).
 * Developer is the GOD OF THEM ALL — above super_admin.
 */
export declare function requireDeveloper(): (req: Request, res: Response, next: NextFunction) => void;
/**
 * Require super admin access (organization-level God) or higher.
 * Both super_admin and developer pass this check.
 */
export declare function requireSuperAdmin(): (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=rbac.d.ts.map