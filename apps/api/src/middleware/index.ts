import { Request, Response, NextFunction } from 'express';
import { loadMembership as _loadMembership } from './auth';
import { requireActiveSubscription as _requireActiveSubscription } from './subscription';

export { authenticate, loadMembership } from './auth';
export { requireRole, requireSuperAdmin, requireDeveloper } from './rbac';
export { auditContext, writeAuditLog } from './audit';
export { validate } from './validate';
export { requireActiveSubscription, checkAiWallet, checkTranslationWallet } from './subscription';

/**
 * Combined middleware: loads membership then enforces active subscription.
 * Use on all org-scoped routes that require a paid plan.
 */
export function loadMembershipAndSub(req: Request, res: Response, next: NextFunction): void {
  _loadMembership(req, res, (err?: any) => {
    if (err) return next(err);
    if (res.headersSent) return;
    _requireActiveSubscription(req, res, next);
  });
}
