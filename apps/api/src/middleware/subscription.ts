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

    if (sub.status === 'expired' || sub.status === 'cancelled' || sub.status === 'suspended') {
      logger.warn('[SUB] Subscription not active', { orgId, status: sub.status, plan: sub.plan?.name, expiredAt: sub.current_period_end, userId: req.user?.userId });
      res.status(402).json({
        success: false,
        error: 'Your subscription has expired. Please renew to continue.',
        code: 'SUBSCRIPTION_EXPIRED',
        subscription: {
          status: sub.status,
          plan: sub.plan?.name,
          expiredAt: sub.current_period_end,
        },
      });
      return;
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
