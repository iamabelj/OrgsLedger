import { Request, Response, NextFunction } from 'express';
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
/** Invalidate cache for a user (call after password change, deactivation, etc.) */
export declare function invalidateUserCache(userId: string): void;
/** Clear entire user cache (used in tests) */
export declare function clearUserCache(): void;
export declare function authenticate(req: Request, res: Response, next: NextFunction): Promise<void>;
/**
 * Load membership for the current user in the given organization.
 * Expects :orgId param in the route.
 */
export declare function loadMembership(req: Request, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=auth.d.ts.map