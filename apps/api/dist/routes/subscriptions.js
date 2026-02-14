"use strict";
// ============================================================
// OrgsLedger API — Subscription Routes
// Plans, subscriptions, wallets, invite links, super admin
// ============================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = __importDefault(require("../db"));
const middleware_1 = require("../middleware");
const logger_1 = require("../logger");
const subSvc = __importStar(require("../services/subscription.service"));
const router = (0, express_1.Router)();
// ── Schemas ─────────────────────────────────────────────────
const subscribeSchema = zod_1.z.object({
    planSlug: zod_1.z.string(),
    billingCycle: zod_1.z.enum(['annual', 'monthly']).default('annual'),
    billingCountry: zod_1.z.string().optional(),
    paymentGateway: zod_1.z.string().optional(),
    paymentReference: zod_1.z.string().optional(),
});
const renewSchema = zod_1.z.object({
    paymentReference: zod_1.z.string().optional(),
    amountPaid: zod_1.z.number().optional(),
});
const topUpSchema = zod_1.z.object({
    hours: zod_1.z.number().min(1),
    paymentGateway: zod_1.z.string().optional(),
    paymentReference: zod_1.z.string().optional(),
});
const createInviteSchema = zod_1.z.object({
    role: zod_1.z.enum(['member', 'executive', 'org_admin']).default('member'),
    maxUses: zod_1.z.number().int().min(1).max(1000).default(50),
    expiresAt: zod_1.z.string().optional(),
});
const adjustWalletSchema = zod_1.z.object({
    organizationId: zod_1.z.string().uuid(),
    hours: zod_1.z.number(),
    description: zod_1.z.string().min(1),
});
const orgStatusSchema = zod_1.z.object({
    organizationId: zod_1.z.string().uuid(),
    action: zod_1.z.enum(['suspend', 'activate']),
    reason: zod_1.z.string().optional(),
});
const overrideSchema = zod_1.z.object({
    subscriptionId: zod_1.z.string().uuid().optional(),
    organizationId: zod_1.z.string().uuid(),
    planSlug: zod_1.z.string().optional(),
    status: zod_1.z.enum(['active', 'grace_period', 'expired', 'cancelled', 'suspended']).optional(),
    periodEnd: zod_1.z.string().optional(),
});
// ════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ════════════════════════════════════════════════════════════
// GET /plans — list all active plans
router.get('/plans', async (_req, res) => {
    try {
        const plans = await subSvc.getPlans();
        res.json({ success: true, data: plans });
    }
    catch (err) {
        logger_1.logger.error('Get plans error', err);
        res.status(500).json({ success: false, error: 'Failed to load plans' });
    }
});
// GET /invite/:code — validate invite link (public, no auth needed)
router.get('/invite/:code', async (req, res) => {
    try {
        const invite = await subSvc.validateInviteLink(req.params.code);
        if (!invite) {
            res.status(404).json({ success: false, error: 'Invalid or expired invite link' });
            return;
        }
        res.json({ success: true, data: invite });
    }
    catch (err) {
        logger_1.logger.error('Validate invite error', err);
        res.status(500).json({ success: false, error: 'Failed to validate invite' });
    }
});
// POST /invite/:code/join — join org via invite (requires auth)
router.post('/invite/:code/join', middleware_1.authenticate, async (req, res) => {
    try {
        const result = await subSvc.useInviteLink(req.params.code, req.user.userId);
        res.json({ success: true, data: result });
    }
    catch (err) {
        logger_1.logger.error('Join via invite error', err);
        const status = err.message?.includes('already') ? 409 :
            err.message?.includes('limit') ? 403 :
                err.message?.includes('Invalid') || err.message?.includes('expired') ? 404 : 500;
        res.status(status).json({ success: false, error: err.message || 'Failed to join' });
    }
});
// ════════════════════════════════════════════════════════════
// ORG-SCOPED ROUTES (authenticated)
// ════════════════════════════════════════════════════════════
// GET /:orgId/subscription
router.get('/:orgId/subscription', middleware_1.authenticate, middleware_1.loadMembership, async (req, res) => {
    try {
        const sub = await subSvc.getOrgSubscription(req.params.orgId);
        if (!sub) {
            res.json({ success: true, data: null });
            return;
        }
        const plan = sub.plan_id ? await subSvc.getPlanById(sub.plan_id) : null;
        res.json({ success: true, data: { ...sub, plan } });
    }
    catch (err) {
        logger_1.logger.error('Get subscription error', err);
        res.status(500).json({ success: false, error: 'Failed to get subscription' });
    }
});
// POST /:orgId/subscribe
router.post('/:orgId/subscribe', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin'), (0, middleware_1.validate)(subscribeSchema), async (req, res) => {
    try {
        const { planSlug, billingCycle, billingCountry, paymentGateway, paymentReference } = req.body;
        const plan = await subSvc.getPlanBySlug(planSlug);
        if (!plan) {
            res.status(404).json({ success: false, error: 'Plan not found' });
            return;
        }
        const currency = subSvc.getCurrency(billingCountry);
        const price = subSvc.getPlanPrice(plan, currency, billingCycle);
        const sub = await subSvc.createSubscription({
            organizationId: req.params.orgId,
            planId: plan.id,
            billingCycle,
            currency,
            amountPaid: price,
            paymentGateway,
            gatewaySubscriptionId: paymentReference,
        });
        res.json({ success: true, data: sub });
    }
    catch (err) {
        logger_1.logger.error('Subscribe error', err);
        res.status(500).json({ success: false, error: err.message || 'Subscription failed' });
    }
});
// POST /:orgId/renew
router.post('/:orgId/renew', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin'), async (req, res) => {
    try {
        const sub = await subSvc.getOrgSubscription(req.params.orgId);
        if (!sub) {
            res.status(404).json({ success: false, error: 'No subscription found' });
            return;
        }
        const plan = await subSvc.getPlanById(sub.plan_id);
        if (!plan) {
            res.status(404).json({ success: false, error: 'Plan not found' });
            return;
        }
        const org = await (0, db_1.default)('organizations').where({ id: req.params.orgId }).select('billing_currency').first();
        const currency = org?.billing_currency || 'USD';
        const price = subSvc.getPlanPrice(plan, currency, sub.billing_cycle);
        const renewed = await subSvc.renewSubscription(req.params.orgId, price, req.body?.paymentReference);
        res.json({ success: true, data: renewed });
    }
    catch (err) {
        logger_1.logger.error('Renew error', err);
        res.status(500).json({ success: false, error: err.message || 'Renewal failed' });
    }
});
// ── Wallets ─────────────────────────────────────────────────
// GET /:orgId/wallets — combined
router.get('/:orgId/wallets', middleware_1.authenticate, middleware_1.loadMembership, async (req, res) => {
    try {
        const [ai, translation] = await Promise.all([
            subSvc.getAiWallet(req.params.orgId),
            subSvc.getTranslationWallet(req.params.orgId),
        ]);
        res.json({ success: true, data: { ai, translation } });
    }
    catch (err) {
        logger_1.logger.error('Get wallets error', err);
        res.status(500).json({ success: false, error: 'Failed to get wallets' });
    }
});
// GET /:orgId/wallet/ai
router.get('/:orgId/wallet/ai', middleware_1.authenticate, middleware_1.loadMembership, async (req, res) => {
    try {
        const wallet = await subSvc.getAiWallet(req.params.orgId);
        res.json({ success: true, data: wallet });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get AI wallet' });
    }
});
// GET /:orgId/wallet/translation
router.get('/:orgId/wallet/translation', middleware_1.authenticate, middleware_1.loadMembership, async (req, res) => {
    try {
        const wallet = await subSvc.getTranslationWallet(req.params.orgId);
        res.json({ success: true, data: wallet });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get translation wallet' });
    }
});
// POST /:orgId/wallet/ai/topup
router.post('/:orgId/wallet/ai/topup', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin'), (0, middleware_1.validate)(topUpSchema), async (req, res) => {
    try {
        const { hours, paymentGateway, paymentReference } = req.body;
        const org = await (0, db_1.default)('organizations').where({ id: req.params.orgId }).select('billing_currency').first();
        const currency = org?.billing_currency || 'USD';
        const pricePerHour = currency === 'NGN' ? 18000 : 10;
        const minutes = hours * 60;
        const cost = hours * pricePerHour;
        const wallet = await subSvc.topUpAiWallet({
            orgId: req.params.orgId,
            minutes,
            cost,
            currency,
            paymentRef: paymentReference,
            paymentGateway,
        });
        res.json({ success: true, data: wallet });
    }
    catch (err) {
        logger_1.logger.error('AI topup error', err);
        res.status(500).json({ success: false, error: err.message || 'Top-up failed' });
    }
});
// POST /:orgId/wallet/translation/topup
router.post('/:orgId/wallet/translation/topup', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin'), (0, middleware_1.validate)(topUpSchema), async (req, res) => {
    try {
        const { hours, paymentGateway, paymentReference } = req.body;
        const org = await (0, db_1.default)('organizations').where({ id: req.params.orgId }).select('billing_currency').first();
        const currency = org?.billing_currency || 'USD';
        const pricePerHour = currency === 'NGN' ? 45000 : 25;
        const minutes = hours * 60;
        const cost = hours * pricePerHour;
        const wallet = await subSvc.topUpTranslationWallet({
            orgId: req.params.orgId,
            minutes,
            cost,
            currency,
            paymentRef: paymentReference,
            paymentGateway,
        });
        res.json({ success: true, data: wallet });
    }
    catch (err) {
        logger_1.logger.error('Translation topup error', err);
        res.status(500).json({ success: false, error: err.message || 'Top-up failed' });
    }
});
// GET /:orgId/wallet/ai/history
router.get('/:orgId/wallet/ai/history', middleware_1.authenticate, middleware_1.loadMembership, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const history = await subSvc.getAiWalletHistory(req.params.orgId, limit, offset);
        res.json({ success: true, data: history });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get AI wallet history' });
    }
});
// GET /:orgId/wallet/translation/history
router.get('/:orgId/wallet/translation/history', middleware_1.authenticate, middleware_1.loadMembership, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const history = await subSvc.getTranslationWalletHistory(req.params.orgId, limit, offset);
        res.json({ success: true, data: history });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get translation history' });
    }
});
// ── Invite Links ────────────────────────────────────────────
// POST /:orgId/invite
router.post('/:orgId/invite', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin'), (0, middleware_1.validate)(createInviteSchema), async (req, res) => {
    try {
        const { role, maxUses, expiresAt } = req.body;
        const invite = await subSvc.createInviteLink(req.params.orgId, req.user.userId, role || 'member', maxUses || 50, expiresAt);
        res.json({ success: true, data: invite });
    }
    catch (err) {
        logger_1.logger.error('Create invite error', err);
        res.status(500).json({ success: false, error: err.message || 'Failed to create invite' });
    }
});
// GET /:orgId/invites
router.get('/:orgId/invites', middleware_1.authenticate, middleware_1.loadMembership, async (req, res) => {
    try {
        const invites = await (0, db_1.default)('invite_links')
            .where({ organization_id: req.params.orgId })
            .orderBy('created_at', 'desc');
        res.json({ success: true, data: invites });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get invites' });
    }
});
// DELETE /:orgId/invite/:inviteId
router.delete('/:orgId/invite/:inviteId', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin'), async (req, res) => {
    try {
        await (0, db_1.default)('invite_links').where({ id: req.params.inviteId, organization_id: req.params.orgId }).del();
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to delete invite' });
    }
});
// ════════════════════════════════════════════════════════════
// SUPER ADMIN ROUTES
// ════════════════════════════════════════════════════════════
// GET /admin/revenue
router.get('/admin/revenue', middleware_1.authenticate, (0, middleware_1.requireSuperAdmin)(), async (_req, res) => {
    try {
        const revenue = await subSvc.getPlatformRevenue();
        res.json({ success: true, data: revenue });
    }
    catch (err) {
        logger_1.logger.error('Admin revenue error', err);
        res.status(500).json({ success: false, error: 'Failed to get revenue' });
    }
});
// GET /admin/subscriptions
router.get('/admin/subscriptions', middleware_1.authenticate, (0, middleware_1.requireSuperAdmin)(), async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;
        const subs = await (0, db_1.default)('subscriptions')
            .join('subscription_plans', 'subscriptions.plan_id', 'subscription_plans.id')
            .join('organizations', 'subscriptions.organization_id', 'organizations.id')
            .select('subscriptions.*', 'subscription_plans.name as plan_name', 'subscription_plans.slug as plan_slug', 'organizations.name as org_name')
            .orderBy('subscriptions.created_at', 'desc')
            .limit(limit)
            .offset(offset);
        res.json({ success: true, data: subs });
    }
    catch (err) {
        logger_1.logger.error('Admin subscriptions error', err);
        res.status(500).json({ success: false, error: 'Failed' });
    }
});
// GET /admin/organizations — list all orgs with subscription + wallet info
router.get('/admin/organizations', middleware_1.authenticate, (0, middleware_1.requireSuperAdmin)(), async (_req, res) => {
    try {
        const orgs = await (0, db_1.default)('organizations')
            .leftJoin('subscriptions', function () {
            this.on('organizations.id', '=', 'subscriptions.organization_id')
                .andOnVal('subscriptions.status', 'in', db_1.default.raw('(?, ?, ?)', ['active', 'grace_period', 'expired']));
        })
            .leftJoin('subscription_plans', 'subscriptions.plan_id', 'subscription_plans.id')
            .leftJoin('ai_wallet', 'organizations.id', 'ai_wallet.organization_id')
            .leftJoin('translation_wallet', 'organizations.id', 'translation_wallet.organization_id')
            .select('organizations.id', 'organizations.name', 'organizations.subscription_status', 'organizations.billing_currency', 'organizations.created_at', 'subscription_plans.name as plan_name', 'subscription_plans.slug as plan_slug', 'subscriptions.status as sub_status', 'subscriptions.current_period_end', 'ai_wallet.balance_minutes as ai_balance_minutes', 'translation_wallet.balance_minutes as translation_balance_minutes')
            .orderBy('organizations.created_at', 'desc');
        // Add member count
        const orgIds = orgs.map((o) => o.id);
        const counts = orgIds.length > 0
            ? await (0, db_1.default)('organization_members')
                .whereIn('organization_id', orgIds)
                .groupBy('organization_id')
                .select('organization_id')
                .count('* as member_count')
            : [];
        const countMap = {};
        counts.forEach((c) => { countMap[c.organization_id] = parseInt(c.member_count); });
        const result = orgs.map((o) => ({ ...o, member_count: countMap[o.id] || 0 }));
        res.json({ success: true, data: result });
    }
    catch (err) {
        logger_1.logger.error('Admin orgs error', err);
        res.status(500).json({ success: false, error: 'Failed' });
    }
});
// POST /admin/wallet/ai/adjust
router.post('/admin/wallet/ai/adjust', middleware_1.authenticate, (0, middleware_1.requireSuperAdmin)(), (0, middleware_1.validate)(adjustWalletSchema), async (req, res) => {
    try {
        const { organizationId, hours, description } = req.body;
        const minutes = hours * 60;
        const wallet = await subSvc.adminAdjustAiWallet(organizationId, minutes, description);
        res.json({ success: true, data: wallet });
    }
    catch (err) {
        logger_1.logger.error('Admin adjust AI error', err);
        res.status(500).json({ success: false, error: err.message || 'Adjustment failed' });
    }
});
// POST /admin/wallet/translation/adjust
router.post('/admin/wallet/translation/adjust', middleware_1.authenticate, (0, middleware_1.requireSuperAdmin)(), (0, middleware_1.validate)(adjustWalletSchema), async (req, res) => {
    try {
        const { organizationId, hours, description } = req.body;
        const minutes = hours * 60;
        const wallet = await subSvc.adminAdjustTranslationWallet(organizationId, minutes, description);
        res.json({ success: true, data: wallet });
    }
    catch (err) {
        logger_1.logger.error('Admin adjust translation error', err);
        res.status(500).json({ success: false, error: err.message || 'Adjustment failed' });
    }
});
// POST /admin/org/status — suspend or activate
router.post('/admin/org/status', middleware_1.authenticate, (0, middleware_1.requireSuperAdmin)(), (0, middleware_1.validate)(orgStatusSchema), async (req, res) => {
    try {
        const { organizationId, action, reason } = req.body;
        const newStatus = action === 'suspend' ? 'suspended' : 'active';
        await (0, db_1.default)('organizations').where({ id: organizationId }).update({ subscription_status: newStatus });
        if (action === 'suspend') {
            await (0, db_1.default)('subscriptions').where({ organization_id: organizationId, status: 'active' }).update({ status: 'suspended' });
        }
        else {
            // Reactivate latest subscription
            const latestSub = await (0, db_1.default)('subscriptions').where({ organization_id: organizationId }).orderBy('created_at', 'desc').first();
            if (latestSub && latestSub.status === 'suspended') {
                await (0, db_1.default)('subscriptions').where({ id: latestSub.id }).update({ status: 'active' });
            }
        }
        logger_1.logger.info(`Admin ${action} org ${organizationId}: ${reason || 'no reason'}`);
        res.json({ success: true, message: `Organization ${action}d` });
    }
    catch (err) {
        logger_1.logger.error('Admin org status error', err);
        res.status(500).json({ success: false, error: 'Failed' });
    }
});
// POST /admin/subscription/override
router.post('/admin/subscription/override', middleware_1.authenticate, (0, middleware_1.requireSuperAdmin)(), (0, middleware_1.validate)(overrideSchema), async (req, res) => {
    try {
        const { organizationId, planSlug, status, periodEnd } = req.body;
        const updates = {};
        if (planSlug) {
            const plan = await subSvc.getPlanBySlug(planSlug);
            if (plan)
                updates.plan_id = plan.id;
        }
        if (status)
            updates.status = status;
        if (periodEnd)
            updates.current_period_end = new Date(periodEnd);
        updates.updated_at = new Date();
        const sub = await (0, db_1.default)('subscriptions')
            .where({ organization_id: organizationId })
            .orderBy('created_at', 'desc')
            .first();
        if (!sub) {
            res.status(404).json({ success: false, error: 'No subscription found' });
            return;
        }
        await (0, db_1.default)('subscriptions').where({ id: sub.id }).update(updates);
        logger_1.logger.info(`Admin override subscription for org ${organizationId}`, updates);
        res.json({ success: true, message: 'Subscription overridden' });
    }
    catch (err) {
        logger_1.logger.error('Admin override error', err);
        res.status(500).json({ success: false, error: 'Override failed' });
    }
});
// GET /admin/wallet-analytics
router.get('/admin/wallet-analytics', middleware_1.authenticate, (0, middleware_1.requireSuperAdmin)(), async (_req, res) => {
    try {
        // AI wallet totals
        const aiStats = await (0, db_1.default)('ai_wallet')
            .select(db_1.default.raw('SUM(balance_minutes) as total_balance'), db_1.default.raw('COUNT(*) as wallet_count'))
            .first();
        const aiTxStats = await (0, db_1.default)('ai_wallet_transactions')
            .select(db_1.default.raw("SUM(CASE WHEN amount_minutes > 0 THEN amount_minutes ELSE 0 END) as total_added"), db_1.default.raw("SUM(CASE WHEN amount_minutes < 0 THEN ABS(amount_minutes) ELSE 0 END) as total_used"))
            .first();
        // Translation wallet totals
        const transStats = await (0, db_1.default)('translation_wallet')
            .select(db_1.default.raw('SUM(balance_minutes) as total_balance'), db_1.default.raw('COUNT(*) as wallet_count'))
            .first();
        const transTxStats = await (0, db_1.default)('translation_wallet_transactions')
            .select(db_1.default.raw("SUM(CASE WHEN amount_minutes > 0 THEN amount_minutes ELSE 0 END) as total_added"), db_1.default.raw("SUM(CASE WHEN amount_minutes < 0 THEN ABS(amount_minutes) ELSE 0 END) as total_used"))
            .first();
        res.json({
            success: true,
            data: {
                aiHoursSold: parseFloat(aiTxStats?.total_added || '0') / 60,
                aiHoursUsed: parseFloat(aiTxStats?.total_used || '0') / 60,
                aiWalletCount: parseInt(aiStats?.wallet_count || '0'),
                aiTotalBalanceHours: parseFloat(aiStats?.total_balance || '0') / 60,
                translationHoursSold: parseFloat(transTxStats?.total_added || '0') / 60,
                translationHoursUsed: parseFloat(transTxStats?.total_used || '0') / 60,
                translationWalletCount: parseInt(transStats?.wallet_count || '0'),
                translationTotalBalanceHours: parseFloat(transStats?.total_balance || '0') / 60,
            },
        });
    }
    catch (err) {
        logger_1.logger.error('Wallet analytics error', err);
        res.status(500).json({ success: false, error: 'Failed' });
    }
});
// GET /admin/plans
router.get('/admin/plans', middleware_1.authenticate, (0, middleware_1.requireSuperAdmin)(), async (_req, res) => {
    try {
        const plans = await (0, db_1.default)('subscription_plans').orderBy('sort_order', 'asc');
        res.json({ success: true, data: plans });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});
// PUT /admin/plans/:planId
router.put('/admin/plans/:planId', middleware_1.authenticate, (0, middleware_1.requireSuperAdmin)(), async (req, res) => {
    try {
        const allowed = ['name', 'description', 'price_usd_annual', 'price_usd_monthly', 'price_ngn_annual', 'price_ngn_monthly', 'max_members', 'features', 'is_active', 'sort_order'];
        const updates = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined)
                updates[key] = req.body[key];
        }
        updates.updated_at = new Date();
        await (0, db_1.default)('subscription_plans').where({ id: req.params.planId }).update(updates);
        const plan = await (0, db_1.default)('subscription_plans').where({ id: req.params.planId }).first();
        res.json({ success: true, data: plan });
    }
    catch (err) {
        logger_1.logger.error('Update plan error', err);
        res.status(500).json({ success: false, error: 'Failed to update plan' });
    }
});
exports.default = router;
//# sourceMappingURL=subscriptions.js.map