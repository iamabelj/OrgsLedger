"use strict";
// ============================================================
// OrgsLedger API — Platform Admin Routes
// Subscription plan management, feature toggles, analytics
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = __importDefault(require("../db"));
const middleware_1 = require("../middleware");
const router = (0, express_1.Router)();
// ── Schemas ─────────────────────────────────────────────────
const updatePlanSchema = zod_1.z.object({
    maxMembers: zod_1.z.number().int().min(1).optional(),
    features: zod_1.z.record(zod_1.z.boolean()).optional(),
    priceUsdAnnual: zod_1.z.number().min(0).optional(),
    priceUsdMonthly: zod_1.z.number().min(0).optional(),
    priceNgnAnnual: zod_1.z.number().min(0).optional(),
    priceNgnMonthly: zod_1.z.number().min(0).optional(),
    isActive: zod_1.z.boolean().optional(),
    description: zod_1.z.string().optional(),
});
const updateConfigSchema = zod_1.z.object({
    key: zod_1.z.string().min(1),
    value: zod_1.z.any(),
    description: zod_1.z.string().optional(),
});
// ══════════════════════════════════════════════════════════════
// SUBSCRIPTION PLAN MANAGEMENT (Developer only)
// ══════════════════════════════════════════════════════════════
// ── List subscription plans ─────────────────────────────────
router.get('/plans', middleware_1.authenticate, (0, middleware_1.requireDeveloper)(), async (_req, res) => {
    try {
        const plans = await (0, db_1.default)('subscription_plans')
            .select('*')
            .orderBy('sort_order', 'asc');
        res.json({ success: true, data: plans });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to list plans' });
    }
});
// ── Update a subscription plan ──────────────────────────────
router.put('/plans/:planId', middleware_1.authenticate, (0, middleware_1.requireDeveloper)(), (0, middleware_1.validate)(updatePlanSchema), async (req, res) => {
    try {
        const previous = await (0, db_1.default)('subscription_plans').where({ id: req.params.planId }).first();
        if (!previous) {
            res.status(404).json({ success: false, error: 'Plan not found' });
            return;
        }
        const updates = {};
        if (req.body.maxMembers !== undefined)
            updates.max_members = req.body.maxMembers;
        if (req.body.features !== undefined)
            updates.features = JSON.stringify(req.body.features);
        if (req.body.priceUsdAnnual !== undefined)
            updates.price_usd_annual = req.body.priceUsdAnnual;
        if (req.body.priceUsdMonthly !== undefined)
            updates.price_usd_monthly = req.body.priceUsdMonthly;
        if (req.body.priceNgnAnnual !== undefined)
            updates.price_ngn_annual = req.body.priceNgnAnnual;
        if (req.body.priceNgnMonthly !== undefined)
            updates.price_ngn_monthly = req.body.priceNgnMonthly;
        if (req.body.isActive !== undefined)
            updates.is_active = req.body.isActive;
        if (req.body.description !== undefined)
            updates.description = req.body.description;
        if (Object.keys(updates).length === 0) {
            res.status(400).json({ success: false, error: 'No fields to update' });
            return;
        }
        await (0, db_1.default)('subscription_plans').where({ id: req.params.planId }).update(updates);
        await req.audit?.({
            action: 'update',
            entityType: 'subscription_plan',
            entityId: req.params.planId,
            previousValue: previous,
            newValue: updates,
        });
        res.json({ success: true, message: 'Plan updated' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update plan' });
    }
});
// ══════════════════════════════════════════════════════════════
// PLATFORM CONFIG (Developer)
// ══════════════════════════════════════════════════════════════
router.get('/config', middleware_1.authenticate, (0, middleware_1.requireDeveloper)(), async (req, res) => {
    try {
        const configs = await (0, db_1.default)('platform_config').select('*').orderBy('key');
        res.json({ success: true, data: configs });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get config' });
    }
});
// ══════════════════════════════════════════════════════════════
// GRANT AI WALLET MINUTES (Developer)
// ══════════════════════════════════════════════════════════════
router.post('/ai-credits/grant', middleware_1.authenticate, (0, middleware_1.requireDeveloper)(), async (req, res) => {
    try {
        const { organizationId, credits, reason } = req.body;
        if (!organizationId || !credits || credits < 1) {
            res.status(400).json({ success: false, error: 'organizationId and credits (>=1) required' });
            return;
        }
        // Ensure ai_wallet exists
        let wallet = await (0, db_1.default)('ai_wallet')
            .where({ organization_id: organizationId })
            .first();
        if (wallet) {
            await (0, db_1.default)('ai_wallet')
                .where({ organization_id: organizationId })
                .update({
                balance_minutes: db_1.default.raw('balance_minutes + ?', [credits]),
            });
        }
        else {
            await (0, db_1.default)('ai_wallet').insert({
                organization_id: organizationId,
                balance_minutes: credits,
            });
        }
        await (0, db_1.default)('ai_wallet_transactions').insert({
            organization_id: organizationId,
            type: 'bonus',
            amount_minutes: credits,
            cost: 0,
            description: reason || `Admin granted ${credits} AI minute${credits > 1 ? 's' : ''}`,
        });
        await req.audit?.({
            action: 'grant',
            entityType: 'ai_wallet',
            entityId: organizationId,
            newValue: { credits, reason },
        });
        res.json({ success: true, message: `${credits} credit(s) granted` });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to grant credits' });
    }
});
router.put('/config', middleware_1.authenticate, (0, middleware_1.requireDeveloper)(), (0, middleware_1.validate)(updateConfigSchema), async (req, res) => {
    try {
        const { key, value, description } = req.body;
        await (0, db_1.default)('platform_config')
            .insert({
            key,
            value: JSON.stringify(value),
            description: description || null,
        })
            .onConflict('key')
            .merge({ value: JSON.stringify(value) });
        await req.audit?.({
            action: 'settings_change',
            entityType: 'platform_config',
            entityId: key,
            newValue: { key, value },
        });
        res.json({ success: true, message: 'Config updated' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update config' });
    }
});
// ══════════════════════════════════════════════════════════════
// PLATFORM ANALYTICS (Super Admin)
// ══════════════════════════════════════════════════════════════
router.get('/analytics', middleware_1.authenticate, (0, middleware_1.requireDeveloper)(), async (req, res) => {
    try {
        const totalOrgs = await (0, db_1.default)('organizations').count('id as count').first();
        const totalUsers = await (0, db_1.default)('users').count('id as count').first();
        const activeOrgs = await (0, db_1.default)('organizations')
            .where({ status: 'active' })
            .count('id as count')
            .first();
        const totalRevenue = await (0, db_1.default)('transactions')
            .where({ status: 'completed' })
            .whereIn('type', ['ai_credit_purchase'])
            .select(db_1.default.raw('coalesce(sum(amount), 0) as total'))
            .first();
        const totalMeetings = await (0, db_1.default)('meetings').count('id as count').first();
        const aiMinutesUsed = await (0, db_1.default)('ai_wallet_transactions')
            .where('amount_minutes', '<', 0)
            .select(db_1.default.raw('coalesce(sum(abs(amount_minutes)), 0) as total'))
            .first();
        // Recent activity
        const recentAudit = await (0, db_1.default)('audit_logs')
            .join('users', 'audit_logs.user_id', 'users.id')
            .select('audit_logs.*', 'users.email', 'users.first_name', 'users.last_name')
            .orderBy('audit_logs.created_at', 'desc')
            .limit(20);
        res.json({
            success: true,
            data: {
                totalOrganizations: parseInt(totalOrgs?.count) || 0,
                activeOrganizations: parseInt(activeOrgs?.count) || 0,
                totalUsers: parseInt(totalUsers?.count) || 0,
                totalRevenue: totalRevenue?.total || 0,
                totalMeetings: parseInt(totalMeetings?.count) || 0,
                totalAIMinutesUsed: aiMinutesUsed?.total || 0,
                recentActivity: recentAudit,
            },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get analytics' });
    }
});
// ══════════════════════════════════════════════════════════════
// AUDIT LOGS (Admin)
// ══════════════════════════════════════════════════════════════
router.get('/audit-logs', middleware_1.authenticate, (0, middleware_1.requireDeveloper)(), async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const orgId = req.query.orgId;
        const action = req.query.action;
        const entityType = req.query.entityType;
        let query = (0, db_1.default)('audit_logs')
            .join('users', 'audit_logs.user_id', 'users.id')
            .select('audit_logs.*', 'users.email', 'users.first_name', 'users.last_name');
        if (orgId)
            query = query.where({ 'audit_logs.organization_id': orgId });
        if (action)
            query = query.where({ 'audit_logs.action': action });
        if (entityType)
            query = query.where({ 'audit_logs.entity_type': entityType });
        const total = await query.clone().clear('select').count('audit_logs.id as count').first();
        const logs = await query
            .orderBy('audit_logs.created_at', 'desc')
            .offset((page - 1) * limit)
            .limit(limit);
        res.json({
            success: true,
            data: logs,
            meta: { page, limit, total: parseInt(total?.count) || 0 },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get audit logs' });
    }
});
exports.default = router;
//# sourceMappingURL=admin.js.map