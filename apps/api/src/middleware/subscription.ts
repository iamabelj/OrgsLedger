// ============================================================
// OrgsLedger — Subscription Enforcement Middleware
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { getOrgSubscription, getAiWallet, getTranslationWallet } from '../services/subscription.service';
import { logger } from '../logger';

/**
 * Block request if organization has no active subscription.
 * Super admins always bypass.
 * Returns 402 Payment Required if subscription is expired/missing.
 */
export async function requireActiveSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    // Super admins and developers bypass
    if (req.user?.globalRole === 'super_admin' || req.user?.globalRole === 'developer') return next();

    const orgId = req.params.orgId || (req as any).organizationId;
    if (!orgId) return next(); // No org context — skip

    const sub = await getOrgSubscription(orgId);

    if (!sub) {
      logger.warn('[SUB] No active subscription', { orgId, path: req.originalUrl, userId: req.user?.userId });
      res.status(402).json({
        success: false,
        error: 'No active subscription. Please subscribe to a plan.',
        code: 'NO_SUBSCRIPTION',
      });
      return;
    }

    // Allow active AND grace_period — only block on fully expired/cancelled/suspended
    if (sub.status === 'cancelled' || sub.status === 'suspended') {
      logger.warn('[SUB] Subscription not active', { orgId, status: sub.status, plan: sub.plan?.name, userId: req.user?.userId });
      res.status(402).json({
        success: false,
        error: 'Your subscription has been ' + sub.status + '. Please contact support.',
        code: 'SUBSCRIPTION_' + sub.status.toUpperCase(),
        subscription: { status: sub.status, plan: sub.plan?.name, expiredAt: sub.current_period_end },
      });
      return;
    }

    if (sub.status === 'expired') {
      // Auto-renew for free during early access (amount_paid === 0 or '0' or '0.00')
      const paid = parseFloat(sub.amount_paid) || 0;
      if (paid === 0) {
        // Free/seed subscription — auto-extend by 1 year
        const now = new Date();
        const newEnd = new Date(now);
        newEnd.setFullYear(newEnd.getFullYear() + 1);
        const newGrace = new Date(newEnd);
        newGrace.setDate(newGrace.getDate() + 7);
        const subDb = require('../db').default;
        await subDb('subscriptions').where({ id: sub.id }).update({
          status: 'active',
          current_period_start: now.toISOString(),
          current_period_end: newEnd.toISOString(),
          grace_period_end: newGrace.toISOString(),
          updated_at: subDb.fn.now(),
        });
        await subDb('organizations').where({ id: orgId }).update({ subscription_status: 'active' });
        sub.status = 'active';
        logger.info('[SUB] Auto-renewed free subscription', { orgId, newEnd: newEnd.toISOString() });
      } else {
        logger.warn('[SUB] Subscription expired (paid)', { orgId, status: sub.status, plan: sub.plan?.name, expiredAt: sub.current_period_end, userId: req.user?.userId });
        res.status(402).json({
          success: false,
          error: 'Your subscription has expired. Please renew to continue.',
          code: 'SUBSCRIPTION_EXPIRED',
          subscription: { status: sub.status, plan: sub.plan?.name, expiredAt: sub.current_period_end },
        });
        return;
      }
    }

    logger.debug('[SUB] Subscription valid', { orgId, status: sub.status, plan: sub.plan?.name });
    // Attach subscription to request
    (req as any).subscription = sub;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Soft-check AI wallet balance — sets req.aiWalletBalance and req.aiWalletEmpty.
 * Does NOT block the request.
 */
export async function checkAiWallet(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.params.orgId || (req as any).organizationId;
    if (orgId) {
      const wallet = await getAiWallet(orgId);
      const balance = parseFloat(wallet.balance_minutes);
      (req as any).aiWalletBalance = balance;
      (req as any).aiWalletEmpty = balance <= 0;
      logger.debug('[WALLET] AI wallet checked', { orgId, balanceMinutes: balance, empty: balance <= 0 });
    }
    next();
  } catch {
    next();
  }
}

/**
 * Soft-check Translation wallet balance — sets req.translationWalletBalance and req.translationWalletEmpty.
 * Does NOT block the request.
 */
export async function checkTranslationWallet(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.params.orgId || (req as any).organizationId;
    if (orgId) {
      const wallet = await getTranslationWallet(orgId);
      const balance = parseFloat(wallet.balance_minutes);
      (req as any).translationWalletBalance = balance;
      (req as any).translationWalletEmpty = balance <= 0;
      logger.debug('[WALLET] Translation wallet checked', { orgId, balanceMinutes: balance, empty: balance <= 0 });
    }
    next();
  } catch {
    next();
  }
}
