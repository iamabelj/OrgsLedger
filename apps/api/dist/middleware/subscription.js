"use strict";
// ============================================================
// OrgsLedger — Subscription Enforcement Middleware
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireActiveSubscription = requireActiveSubscription;
exports.checkAiWallet = checkAiWallet;
exports.checkTranslationWallet = checkTranslationWallet;
const subscription_service_1 = require("../services/subscription.service");
/**
 * Block request if organization has no active subscription.
 * Super admins always bypass.
 * Returns 402 Payment Required if subscription is expired/missing.
 */
async function requireActiveSubscription(req, res, next) {
    try {
        // Super admins bypass
        if (req.user?.globalRole === 'super_admin')
            return next();
        const orgId = req.params.orgId || req.organizationId;
        if (!orgId)
            return next(); // No org context — skip
        const sub = await (0, subscription_service_1.getOrgSubscription)(orgId);
        if (!sub) {
            res.status(402).json({
                success: false,
                error: 'No active subscription. Please subscribe to a plan.',
                code: 'NO_SUBSCRIPTION',
            });
            return;
        }
        if (sub.status === 'expired' || sub.status === 'cancelled' || sub.status === 'suspended') {
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
            req.aiWalletBalance = parseFloat(wallet.balance_minutes);
            req.aiWalletEmpty = parseFloat(wallet.balance_minutes) <= 0;
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
            req.translationWalletBalance = parseFloat(wallet.balance_minutes);
            req.translationWalletEmpty = parseFloat(wallet.balance_minutes) <= 0;
        }
        next();
    }
    catch {
        next();
    }
}
//# sourceMappingURL=subscription.js.map