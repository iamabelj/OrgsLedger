"use strict";
// ============================================================
// OrgsLedger — Subscription Enforcement Middleware
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireActiveSubscription = requireActiveSubscription;
exports.checkAiWallet = checkAiWallet;
exports.checkTranslationWallet = checkTranslationWallet;
const subscription_service_1 = require("../services/subscription.service");
const logger_1 = require("../logger");
/**
 * Block request if organization has no active subscription.
 * Super admins always bypass.
 * Returns 402 Payment Required if subscription is expired/missing.
 */
async function requireActiveSubscription(req, res, next) {
    try {
        // Super admins and developers bypass
        if (req.user?.globalRole === 'super_admin' || req.user?.globalRole === 'developer')
            return next();
        const orgId = req.params.orgId || req.organizationId;
        if (!orgId)
            return next(); // No org context — skip
        const sub = await (0, subscription_service_1.getOrgSubscription)(orgId);
        if (!sub) {
            logger_1.logger.warn('[SUB] No active subscription', { orgId, path: req.originalUrl, userId: req.user?.userId });
            res.status(402).json({
                success: false,
                error: 'No active subscription. Please subscribe to a plan.',
                code: 'NO_SUBSCRIPTION',
            });
            return;
        }
        // Allow active AND grace_period — only block on fully expired/cancelled/suspended
        if (sub.status === 'cancelled' || sub.status === 'suspended') {
            logger_1.logger.warn('[SUB] Subscription not active', { orgId, status: sub.status, plan: sub.plan?.name, userId: req.user?.userId });
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
                logger_1.logger.info('[SUB] Auto-renewed free subscription', { orgId, newEnd: newEnd.toISOString() });
            }
            else {
                logger_1.logger.warn('[SUB] Subscription expired (paid)', { orgId, status: sub.status, plan: sub.plan?.name, expiredAt: sub.current_period_end, userId: req.user?.userId });
                res.status(402).json({
                    success: false,
                    error: 'Your subscription has expired. Please renew to continue.',
                    code: 'SUBSCRIPTION_EXPIRED',
                    subscription: { status: sub.status, plan: sub.plan?.name, expiredAt: sub.current_period_end },
                });
                return;
            }
        }
        logger_1.logger.debug('[SUB] Subscription valid', { orgId, status: sub.status, plan: sub.plan?.name });
        // Attach subscription to request
        req.subscription = sub;
        next();
    }
    catch (err) {
        next(err);
    }
}
/**
 * Soft-check AI wallet balance — sets req.aiWalletBalance and req.aiWalletEmpty.
 * Does NOT block the request.
 */
async function checkAiWallet(req, res, next) {
    try {
        const orgId = req.params.orgId || req.organizationId;
        if (orgId) {
            const wallet = await (0, subscription_service_1.getAiWallet)(orgId);
            const balance = parseFloat(wallet.balance_minutes);
            req.aiWalletBalance = balance;
            req.aiWalletEmpty = balance <= 0;
            logger_1.logger.debug('[WALLET] AI wallet checked', { orgId, balanceMinutes: balance, empty: balance <= 0 });
        }
        next();
    }
    catch {
        next();
    }
}
/**
 * Soft-check Translation wallet balance — sets req.translationWalletBalance and req.translationWalletEmpty.
 * Does NOT block the request.
 */
async function checkTranslationWallet(req, res, next) {
    try {
        const orgId = req.params.orgId || req.organizationId;
        if (orgId) {
            const wallet = await (0, subscription_service_1.getTranslationWallet)(orgId);
            const balance = parseFloat(wallet.balance_minutes);
            req.translationWalletBalance = balance;
            req.translationWalletEmpty = balance <= 0;
            logger_1.logger.debug('[WALLET] Translation wallet checked', { orgId, balanceMinutes: balance, empty: balance <= 0 });
        }
        next();
    }
    catch {
        next();
    }
}
//# sourceMappingURL=subscription.js.map