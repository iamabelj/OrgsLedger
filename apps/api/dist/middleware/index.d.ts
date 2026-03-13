import { Request, Response, NextFunction } from 'express';
export { authenticate, loadMembership } from './auth';
export { requireRole, requireSuperAdmin, requireDeveloper } from './rbac';
export { auditContext, writeAuditLog } from './audit';
export { validate } from './validate';
export { requireActiveSubscription, checkAiWallet } from './subscription';
export { aiCostGuard, aiCostGuardLenient, getCostGuardStatus, isBudgetConstrained, getRemainingBudget, } from './cost-guard.middleware';
/**
 * Combined middleware: loads membership then enforces active subscription.
 * Use on all org-scoped routes that require a paid plan.
 */
export declare function loadMembershipAndSub(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=index.d.ts.map