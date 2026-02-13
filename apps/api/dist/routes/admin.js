"use strict";
// ============================================================
// OrgsLedger API — Licensing & Platform Admin Routes
// License management, reselling, feature toggles, analytics
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = __importDefault(require("../db"));
const middleware_1 = require("../middleware");
const logger_1 = require("../logger");
const router = (0, express_1.Router)();
// ── Schemas ─────────────────────────────────────────────────
const createLicenseSchema = zod_1.z.object({
    organizationId: zod_1.z.string().uuid(),
    type: zod_1.z.enum(['free', 'basic', 'professional', 'enterprise']),
    maxMembers: zod_1.z.number().int().min(1),
    features: zod_1.z.object({
        chat: zod_1.z.boolean().default(true),
        meetings: zod_1.z.boolean().default(true),
        aiMinutes: zod_1.z.boolean().default(false),
        financials: zod_1.z.boolean().default(true),
        donations: zod_1.z.boolean().default(true),
        voting: zod_1.z.boolean().default(true),
    }),
    aiCreditsIncluded: zod_1.z.number().int().default(0),
    priceMonthly: zod_1.z.number().min(0),
    validFrom: zod_1.z.string().datetime(),
    validUntil: zod_1.z.string().datetime().optional(),
    resellerId: zod_1.z.string().uuid().optional(),
});
const updateConfigSchema = zod_1.z.object({
    key: zod_1.z.string().min(1),
    value: zod_1.z.any(),
    description: zod_1.z.string().optional(),
});
// ══════════════════════════════════════════════════════════════
// LICENSE MANAGEMENT (Super Admin only)
// ══════════════════════════════════════════════════════════════
router.post('/licenses', middleware_1.authenticate, (0, middleware_1.requireSuperAdmin)(), (0, middleware_1.validate)(createLicenseSchema), async (req, res) => {
    try {
        const data = req.body;
        const [license] = await (0, db_1.default)('licenses')
            .insert({
            type: data.type,
            max_members: data.maxMembers,
            features: JSON.stringify(data.features),
            ai_credits_included: data.aiCreditsIncluded,
            price_monthly: data.priceMonthly,
            valid_from: data.validFrom,
            valid_until: data.validUntil || null,
            is_active: true,
            reseller_id: data.resellerId || null,
        })
            .returning('*');
        // Assign to organization
        await (0, db_1.default)('organizations')
            .where({ id: data.organizationId })
            .update({
            license_id: license.id,
            settings: db_1.default.raw(`jsonb_set(settings, '{features}', ?::jsonb)`, [JSON.stringify(data.features)]),
        });
        // If includes AI credits, add them
        if (data.aiCreditsIncluded > 0) {
            await (0, db_1.default)('ai_credits')
                .where({ organization_id: data.organizationId })
                .update({
                total_credits: db_1.default.raw('total_credits + ?', [data.aiCreditsIncluded]),
            });
            await (0, db_1.default)('ai_credit_transactions').insert({
                organization_id: data.organizationId,
                type: 'bonus',
                amount: data.aiCreditsIncluded,
                description: `License activation: ${data.aiCreditsIncluded} AI minutes included`,
            });
        }
        await req.audit?.({
            action: 'create',
            entityType: 'license',
            entityId: license.id,
            newValue: { type: data.type, organizationId: data.organizationId },
        });
        res.status(201).json({ success: true, data: license });
    }
    catch (err) {
        logger_1.logger.error('Create license error', err);
        res.status(500).json({ success: false, error: 'Failed to create license' });
    }
});
router.get('/licenses', middleware_1.authenticate, (0, middleware_1.requireSuperAdmin)(), async (req, res) => {
    try {
        const licenses = await (0, db_1.default)('licenses')
            .leftJoin('organizations', 'licenses.id', 'organizations.license_id')
            .select('licenses.*', 'organizations.name as organizationName', 'organizations.slug as organizationSlug')
            .orderBy('licenses.created_at', 'desc');
        res.json({ success: true, data: licenses });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to list licenses' });
    }
});
router.put('/licenses/:licenseId', middleware_1.authenticate, (0, middleware_1.requireSuperAdmin)(), async (req, res) => {
    try {
        const { type, maxMembers, features, isActive, priceMonthly } = req.body;
        const previous = await (0, db_1.default)('licenses').where({ id: req.params.licenseId }).first();
        const updates = {};
        if (type)
            updates.type = type;
        if (maxMembers)
            updates.max_members = maxMembers;
        if (features)
            updates.features = JSON.stringify(features);
        if (isActive !== undefined)
            updates.is_active = isActive;
        if (priceMonthly !== undefined)
            updates.price_monthly = priceMonthly;
        await (0, db_1.default)('licenses').where({ id: req.params.licenseId }).update(updates);
        // Sync features to org settings
        if (features) {
            const org = await (0, db_1.default)('organizations').where({ license_id: req.params.licenseId }).first();
            if (org) {
                const settings = typeof org.settings === 'string' ? JSON.parse(org.settings) : org.settings;
                settings.features = features;
                settings.maxMembers = maxMembers || settings.maxMembers;
                await (0, db_1.default)('organizations')
                    .where({ id: org.id })
                    .update({ settings: JSON.stringify(settings) });
            }
        }
        await req.audit?.({
            action: 'update',
            entityType: 'license',
            entityId: req.params.licenseId,
            previousValue: previous,
            newValue: updates,
        });
        res.json({ success: true, message: 'License updated' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update license' });
    }
});
// ══════════════════════════════════════════════════════════════
// PLATFORM CONFIG (Super Admin)
// ══════════════════════════════════════════════════════════════
router.get('/config', middleware_1.authenticate, (0, middleware_1.requireSuperAdmin)(), async (req, res) => {
    try {
        const configs = await (0, db_1.default)('platform_config').select('*').orderBy('key');
        res.json({ success: true, data: configs });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get config' });
    }
});
// ══════════════════════════════════════════════════════════════
// GRANT AI CREDITS (Super Admin)
// ══════════════════════════════════════════════════════════════
router.post('/ai-credits/grant', middleware_1.authenticate, (0, middleware_1.requireSuperAdmin)(), async (req, res) => {
    try {
        const { organizationId, credits, reason } = req.body;
        if (!organizationId || !credits || credits < 1) {
            res.status(400).json({ success: false, error: 'organizationId and credits (>=1) required' });
            return;
        }
        // Ensure ai_credits row exists
        const existing = await (0, db_1.default)('ai_credits')
            .where({ organization_id: organizationId })
            .first();
        if (existing) {
            await (0, db_1.default)('ai_credits')
                .where({ organization_id: organizationId })
                .update({
                total_credits: db_1.default.raw('total_credits + ?', [credits]),
            });
        }
        else {
            await (0, db_1.default)('ai_credits').insert({
                organization_id: organizationId,
                total_credits: credits,
                used_credits: 0,
            });
        }
        await (0, db_1.default)('ai_credit_transactions').insert({
            organization_id: organizationId,
            type: 'bonus',
            amount: credits,
            description: reason || `Admin granted ${credits} AI credit${credits > 1 ? 's' : ''}`,
        });
        await req.audit?.({
            action: 'grant',
            entityType: 'ai_credits',
            entityId: organizationId,
            newValue: { credits, reason },
        });
        res.json({ success: true, message: `${credits} credit(s) granted` });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to grant credits' });
    }
});
router.put('/config', middleware_1.authenticate, (0, middleware_1.requireSuperAdmin)(), (0, middleware_1.validate)(updateConfigSchema), async (req, res) => {
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
router.get('/analytics', middleware_1.authenticate, (0, middleware_1.requireSuperAdmin)(), async (req, res) => {
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
        const aiMinutesUsed = await (0, db_1.default)('ai_credits')
            .select(db_1.default.raw('coalesce(sum(used_credits), 0) as total'))
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
router.get('/audit-logs', middleware_1.authenticate, (0, middleware_1.requireSuperAdmin)(), async (req, res) => {
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