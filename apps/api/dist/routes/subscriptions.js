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
const audit_1 = require("../middleware/audit");
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
    organizationId: zod_1.z.string().uuid().optional(),
    organization_id: zod_1.z.string().uuid().optional(),
    hours: zod_1.z.number(),
    description: zod_1.z.string().min(1).optional(),
    reason: zod_1.z.string().min(1).optional(),
}).refine(d => d.organizationId || d.organization_id, { message: 'organizationId or organization_id required' })
    .refine(d => d.description || d.reason, { message: 'description or reason required' });
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
        // If plan has a cost but no payment reference, create as pending (needs webhook confirmation)
        const isPaid = price <= 0 || !!paymentReference;
        const sub = await subSvc.createSubscription({
            organizationId: req.params.orgId,
            planId: plan.id,
            billingCycle,
            currency,
            amountPaid: isPaid ? price : 0,
            paymentGateway,
            gatewaySubscriptionId: paymentReference,
            status: isPaid ? 'active' : 'pending',
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
        // Require payment reference for real top-ups
        if (!paymentReference) {
            res.status(400).json({ success: false, error: 'Payment reference required. Complete payment first.' });
            return;
        }
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
        // Require payment reference for real top-ups
        if (!paymentReference) {
            res.status(400).json({ success: false, error: 'Payment reference required. Complete payment first.' });
            return;
        }
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
router.get('/admin/revenue', middleware_1.authenticate, (0, middleware_1.requireDeveloper)(), async (_req, res) => {
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
router.get('/admin/subscriptions', middleware_1.authenticate, (0, middleware_1.requireDeveloper)(), async (req, res) => {
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
router.get('/admin/organizations', middleware_1.authenticate, (0, middleware_1.requireDeveloper)(), async (_req, res) => {
    try {
        const orgs = await (0, db_1.default)('organizations')
            .leftJoin('subscriptions', function () {
            this.on('organizations.id', '=', 'subscriptions.organization_id')
                .andOnVal('subscriptions.status', 'in', db_1.default.raw('(?, ?, ?)', ['active', 'grace_period', 'expired']));
        })
            .leftJoin('subscription_plans', 'subscriptions.plan_id', 'subscription_plans.id')
            .leftJoin('ai_wallet', 'organizations.id', 'ai_wallet.organization_id')
            .leftJoin('translation_wallet', 'organizations.id', 'translation_wallet.organization_id')
            .select('organizations.id', 'organizations.name', 'organizations.subscription_status', 'organizations.billing_currency', 'organizations.billing_country', 'organizations.created_at', 'subscription_plans.name as plan_name', 'subscription_plans.slug as plan_slug', 'subscriptions.status as sub_status', 'subscriptions.current_period_end', 'ai_wallet.balance_minutes as ai_balance_minutes', 'translation_wallet.balance_minutes as translation_balance_minutes')
            .orderBy('organizations.created_at', 'desc');
        // Add member count
        const orgIds = orgs.map((o) => o.id);
        const counts = orgIds.length > 0
            ? await (0, db_1.default)('memberships')
                .whereIn('organization_id', orgIds)
                .groupBy('organization_id')
                .select('organization_id')
                .count('* as member_count')
            : [];
        const countMap = {};
        counts.forEach((c) => { countMap[c.organization_id] = parseInt(c.member_count); });
        const result = orgs.map((o) => ({ ...o, member_count: countMap[o.id] || 0 }));
        res.json({ success: true, organizations: result });
    }
    catch (err) {
        logger_1.logger.error('Admin orgs error', err);
        res.status(500).json({ success: false, error: 'Failed' });
    }
});
// POST /admin/organizations — super admin creates an organization
const adminCreateOrgSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).max(200),
    slug: zod_1.z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
    ownerEmail: zod_1.z.string().email(),
    plan: zod_1.z.enum(['standard', 'professional', 'enterprise']).default('standard'),
    currency: zod_1.z.enum(['USD', 'NGN']).default('USD'),
});
router.post('/admin/organizations', middleware_1.authenticate, (0, middleware_1.requireDeveloper)(), (0, middleware_1.validate)(adminCreateOrgSchema), async (req, res) => {
    try {
        const { name, slug, ownerEmail, plan, currency } = req.body;
        // Check slug uniqueness
        const existing = await (0, db_1.default)('organizations').where({ slug }).first();
        if (existing) {
            res.status(409).json({ success: false, error: 'Slug already taken' });
            return;
        }
        // Find or validate owner user
        const owner = await (0, db_1.default)('users').where({ email: ownerEmail.toLowerCase() }).first();
        if (!owner) {
            res.status(404).json({ success: false, error: `User with email ${ownerEmail} not found. They must register first.` });
            return;
        }
        // Ensure a free license exists (legacy compat)
        let freeLicense = await (0, db_1.default)('licenses').where({ type: 'free' }).first();
        if (!freeLicense) {
            [freeLicense] = await (0, db_1.default)('licenses')
                .insert({
                type: 'free',
                max_members: 50,
                features: JSON.stringify({ chat: true, meetings: true, aiMinutes: false, financials: true, donations: true, voting: true }),
                ai_credits_included: 0,
                price_monthly: 0,
            })
                .returning('*');
        }
        // Create organization
        const [org] = await (0, db_1.default)('organizations')
            .insert({
            name,
            slug,
            status: 'active',
            subscription_status: 'active',
            license_id: freeLicense.id,
            billing_currency: currency,
            settings: JSON.stringify({
                currency,
                timezone: 'UTC',
                locale: 'en',
                aiEnabled: true,
                features: {
                    chat: true, meetings: true, financials: true, polls: true,
                    events: true, announcements: true, documents: true, committees: true,
                },
            }),
        })
            .returning('*');
        // Make owner the org_admin
        await (0, db_1.default)('memberships').insert({
            user_id: owner.id,
            organization_id: org.id,
            role: 'org_admin',
        });
        // Create default General channel
        const [channel] = await (0, db_1.default)('channels')
            .insert({
            organization_id: org.id,
            name: 'General',
            type: 'general',
            description: 'General discussion',
        })
            .returning('*');
        await (0, db_1.default)('channel_members').insert({
            channel_id: channel.id,
            user_id: owner.id,
        });
        // Provision subscription
        const selectedPlan = await subSvc.getPlanBySlug(plan);
        if (selectedPlan) {
            await subSvc.createSubscription({
                organizationId: org.id,
                planId: selectedPlan.id,
                billingCycle: 'annual',
                currency,
                amountPaid: 0,
                createdBy: owner.id,
            });
        }
        // Provision wallets
        await subSvc.getAiWallet(org.id);
        await subSvc.getTranslationWallet(org.id);
        // Legacy ai_credits
        try {
            await (0, db_1.default)('ai_credits').insert({ organization_id: org.id, total_credits: 0, used_credits: 0 });
        }
        catch { /* ignore */ }
        // Generate invite link
        const invite = await subSvc.createInviteLink(org.id, owner.id, 'member');
        await (0, audit_1.writeAuditLog)({
            organizationId: org.id,
            userId: req.user.userId,
            action: 'admin_create_org',
            entityType: 'organization',
            entityId: org.id,
            newValue: { name, slug, ownerEmail, plan, currency },
            ipAddress: req.ip || '',
            userAgent: req.headers['user-agent'] || '',
        });
        logger_1.logger.info(`Admin created organization: ${name} (${slug}) for ${ownerEmail}`);
        res.status(201).json({
            success: true,
            organization: org,
            inviteCode: invite.code,
            message: `Organization "${name}" created. Owner: ${ownerEmail}. Plan: ${plan}.`,
        });
    }
    catch (err) {
        logger_1.logger.error('Admin create org error', err);
        res.status(500).json({ success: false, error: err.message || 'Failed to create organization' });
    }
});
// POST /admin/wallet/ai/adjust
router.post('/admin/wallet/ai/adjust', middleware_1.authenticate, (0, middleware_1.requireDeveloper)(), (0, middleware_1.validate)(adjustWalletSchema), async (req, res) => {
    try {
        const organizationId = req.body.organizationId || req.body.organization_id;
        const hours = req.body.hours;
        const description = req.body.description || req.body.reason;
        const minutes = hours * 60;
        const wallet = await subSvc.adminAdjustAiWallet(organizationId, minutes, description);
        await (0, audit_1.writeAuditLog)({
            organizationId,
            userId: req.user.userId,
            action: 'admin_adjust',
            entityType: 'ai_wallet',
            entityId: organizationId,
            newValue: { hours, minutes, description },
            ipAddress: req.ip || '',
            userAgent: req.headers['user-agent'] || '',
        });
        res.json({ success: true, data: wallet });
    }
    catch (err) {
        logger_1.logger.error('Admin adjust AI error', err);
        res.status(500).json({ success: false, error: err.message || 'Adjustment failed' });
    }
});
// POST /admin/wallet/translation/adjust
router.post('/admin/wallet/translation/adjust', middleware_1.authenticate, (0, middleware_1.requireDeveloper)(), (0, middleware_1.validate)(adjustWalletSchema), async (req, res) => {
    try {
        const organizationId = req.body.organizationId || req.body.organization_id;
        const hours = req.body.hours;
        const description = req.body.description || req.body.reason;
        const minutes = hours * 60;
        const wallet = await subSvc.adminAdjustTranslationWallet(organizationId, minutes, description);
        await (0, audit_1.writeAuditLog)({
            organizationId,
            userId: req.user.userId,
            action: 'admin_adjust',
            entityType: 'translation_wallet',
            entityId: organizationId,
            newValue: { hours, minutes, description },
            ipAddress: req.ip || '',
            userAgent: req.headers['user-agent'] || '',
        });
        res.json({ success: true, data: wallet });
    }
    catch (err) {
        logger_1.logger.error('Admin adjust translation error', err);
        res.status(500).json({ success: false, error: err.message || 'Adjustment failed' });
    }
});
// POST /admin/org/status — suspend or activate
router.post('/admin/org/status', middleware_1.authenticate, (0, middleware_1.requireDeveloper)(), async (req, res) => {
    try {
        // Accept both camelCase (organizationId, action) and snake_case (organization_id, status) from frontend
        const organizationId = req.body.organizationId || req.body.organization_id;
        const action = req.body.action || (req.body.status === 'suspended' ? 'suspend' : 'activate');
        const reason = req.body.reason || 'Admin action';
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
        await (0, audit_1.writeAuditLog)({
            organizationId,
            userId: req.user.userId,
            action: `admin_${action}`,
            entityType: 'organization',
            entityId: organizationId,
            newValue: { action, reason: reason || null, newStatus },
            ipAddress: req.ip || '',
            userAgent: req.headers['user-agent'] || '',
        });
        res.json({ success: true, message: `Organization ${action}d` });
    }
    catch (err) {
        logger_1.logger.error('Admin org status error', err);
        res.status(500).json({ success: false, error: 'Failed' });
    }
});
// POST /admin/subscription/override
router.post('/admin/subscription/override', middleware_1.authenticate, (0, middleware_1.requireDeveloper)(), (0, middleware_1.validate)(overrideSchema), async (req, res) => {
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
        await (0, audit_1.writeAuditLog)({
            organizationId,
            userId: req.user.userId,
            action: 'admin_override',
            entityType: 'subscription',
            entityId: sub.id,
            previousValue: { planId: sub.plan_id, status: sub.status, periodEnd: sub.current_period_end },
            newValue: { planSlug, status, periodEnd },
            ipAddress: req.ip || '',
            userAgent: req.headers['user-agent'] || '',
        });
        res.json({ success: true, message: 'Subscription overridden' });
    }
    catch (err) {
        logger_1.logger.error('Admin override error', err);
        res.status(500).json({ success: false, error: 'Override failed' });
    }
});
// GET /admin/wallet-analytics
router.get('/admin/wallet-analytics', middleware_1.authenticate, (0, middleware_1.requireDeveloper)(), async (_req, res) => {
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
router.get('/admin/plans', middleware_1.authenticate, (0, middleware_1.requireDeveloper)(), async (_req, res) => {
    try {
        const plans = await (0, db_1.default)('subscription_plans').orderBy('sort_order', 'asc');
        res.json({ success: true, data: plans });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});
// PUT /admin/plans/:planId
router.put('/admin/plans/:planId', middleware_1.authenticate, (0, middleware_1.requireDeveloper)(), async (req, res) => {
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
// ════════════════════════════════════════════════════════════
// RISK MONITORING ENDPOINTS
// ════════════════════════════════════════════════════════════
// GET /admin/risk/low-balances — orgs with wallets below threshold
router.get('/admin/risk/low-balances', middleware_1.authenticate, (0, middleware_1.requireDeveloper)(), async (req, res) => {
    try {
        const thresholdMinutes = parseFloat(req.query.threshold) || 60; // default 1 hour
        const lowAi = await (0, db_1.default)('ai_wallet')
            .join('organizations', 'ai_wallet.organization_id', 'organizations.id')
            .where('ai_wallet.balance_minutes', '<', thresholdMinutes)
            .where('ai_wallet.balance_minutes', '>', 0)
            .select('organizations.id as org_id', 'organizations.name as org_name', 'ai_wallet.balance_minutes', db_1.default.raw("'ai' as wallet_type"))
            .orderBy('ai_wallet.balance_minutes', 'asc');
        const lowTranslation = await (0, db_1.default)('translation_wallet')
            .join('organizations', 'translation_wallet.organization_id', 'organizations.id')
            .where('translation_wallet.balance_minutes', '<', thresholdMinutes)
            .where('translation_wallet.balance_minutes', '>', 0)
            .select('organizations.id as org_id', 'organizations.name as org_name', 'translation_wallet.balance_minutes', db_1.default.raw("'translation' as wallet_type"))
            .orderBy('translation_wallet.balance_minutes', 'asc');
        const emptyAi = await (0, db_1.default)('ai_wallet')
            .join('organizations', 'ai_wallet.organization_id', 'organizations.id')
            .where('ai_wallet.balance_minutes', '<=', 0)
            .select('organizations.id as org_id', 'organizations.name as org_name', 'ai_wallet.balance_minutes', db_1.default.raw("'ai' as wallet_type"));
        const emptyTranslation = await (0, db_1.default)('translation_wallet')
            .join('organizations', 'translation_wallet.organization_id', 'organizations.id')
            .where('translation_wallet.balance_minutes', '<=', 0)
            .select('organizations.id as org_id', 'organizations.name as org_name', 'translation_wallet.balance_minutes', db_1.default.raw("'translation' as wallet_type"));
        res.json({
            success: true,
            data: {
                thresholdMinutes,
                lowBalance: [...lowAi, ...lowTranslation],
                emptyWallets: [...emptyAi, ...emptyTranslation],
                summary: {
                    lowAiCount: lowAi.length,
                    lowTranslationCount: lowTranslation.length,
                    emptyAiCount: emptyAi.length,
                    emptyTranslationCount: emptyTranslation.length,
                },
            },
        });
    }
    catch (err) {
        logger_1.logger.error('Low balance check error', err);
        res.status(500).json({ success: false, error: 'Failed' });
    }
});
// GET /admin/risk/spikes — detect abnormal usage spikes
router.get('/admin/risk/spikes', middleware_1.authenticate, (0, middleware_1.requireDeveloper)(), async (req, res) => {
    try {
        const daysBack = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 365);
        const spikeMultiplier = Math.min(Math.max(parseFloat(req.query.multiplier) || 3, 1.5), 20);
        const lookbackDays = daysBack + 30;
        // Get daily AI usage per org for the analysis period + prior 30 days for baseline
        const aiDaily = await (0, db_1.default)('ai_wallet_transactions')
            .where('amount_minutes', '<', 0)
            .where('created_at', '>=', db_1.default.raw("NOW() - make_interval(days := ?)", [lookbackDays]))
            .select('organization_id', db_1.default.raw("DATE(created_at) as day"), db_1.default.raw('SUM(ABS(amount_minutes)) as daily_usage'))
            .groupBy('organization_id', db_1.default.raw('DATE(created_at)'))
            .orderBy('organization_id');
        // Get daily translation usage per org
        const transDaily = await (0, db_1.default)('translation_wallet_transactions')
            .where('amount_minutes', '<', 0)
            .where('created_at', '>=', db_1.default.raw("NOW() - make_interval(days := ?)", [lookbackDays]))
            .select('organization_id', db_1.default.raw("DATE(created_at) as day"), db_1.default.raw('SUM(ABS(amount_minutes)) as daily_usage'))
            .groupBy('organization_id', db_1.default.raw('DATE(created_at)'))
            .orderBy('organization_id');
        // Detect spikes: days in the recent period where usage > multiplier * average of prior period
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysBack);
        function detectSpikes(rows, walletType) {
            const byOrg = {};
            for (const r of rows) {
                if (!byOrg[r.organization_id])
                    byOrg[r.organization_id] = { baseline: [], recent: [] };
                const day = new Date(r.day);
                const usage = parseFloat(r.daily_usage);
                if (day >= cutoff) {
                    byOrg[r.organization_id].recent.push(usage);
                }
                else {
                    byOrg[r.organization_id].baseline.push(usage);
                }
            }
            const spikes = [];
            for (const [orgId, data] of Object.entries(byOrg)) {
                if (data.baseline.length === 0)
                    continue;
                const avg = data.baseline.reduce((a, b) => a + b, 0) / data.baseline.length;
                if (avg === 0)
                    continue;
                const maxRecent = Math.max(...data.recent, 0);
                if (maxRecent > avg * spikeMultiplier) {
                    spikes.push({
                        organization_id: orgId,
                        wallet_type: walletType,
                        baseline_avg_minutes: +avg.toFixed(1),
                        recent_max_minutes: +maxRecent.toFixed(1),
                        spike_ratio: +(maxRecent / avg).toFixed(1),
                    });
                }
            }
            return spikes;
        }
        const aiSpikes = detectSpikes(aiDaily, 'ai');
        const transSpikes = detectSpikes(transDaily, 'translation');
        // Get failed payments in recent period
        const failedPayments = await (0, db_1.default)('transactions')
            .where({ status: 'failed' })
            .where('created_at', '>=', db_1.default.raw("NOW() - make_interval(days := ?)", [daysBack]))
            .join('organizations', 'transactions.organization_id', 'organizations.id')
            .select('transactions.organization_id', 'organizations.name as org_name', db_1.default.raw('COUNT(*) as failed_count'), db_1.default.raw('SUM(transactions.amount) as failed_amount'))
            .groupBy('transactions.organization_id', 'organizations.name')
            .orderBy('failed_count', 'desc');
        // Enrich spikes with org names
        const orgIds = [...new Set([...aiSpikes, ...transSpikes].map(s => s.organization_id))];
        const orgNames = {};
        if (orgIds.length > 0) {
            const orgs = await (0, db_1.default)('organizations').whereIn('id', orgIds).select('id', 'name');
            orgs.forEach((o) => { orgNames[o.id] = o.name; });
        }
        aiSpikes.forEach(s => { s.org_name = orgNames[s.organization_id] || 'Unknown'; });
        transSpikes.forEach(s => { s.org_name = orgNames[s.organization_id] || 'Unknown'; });
        res.json({
            success: true,
            data: {
                period: { daysBack, spikeMultiplier },
                usageSpikes: [...aiSpikes, ...transSpikes],
                failedPayments,
                summary: {
                    aiSpikeCount: aiSpikes.length,
                    translationSpikeCount: transSpikes.length,
                    failedPaymentOrgs: failedPayments.length,
                },
            },
        });
    }
    catch (err) {
        logger_1.logger.error('Spike detection error', err);
        res.status(500).json({ success: false, error: 'Failed' });
    }
});
exports.default = router;
//# sourceMappingURL=subscriptions.js.map