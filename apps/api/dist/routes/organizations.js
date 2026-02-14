"use strict";
// ============================================================
// OrgsLedger API — Organization Routes
// CRUD, settings, member management
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const multer_1 = __importDefault(require("multer"));
const db_1 = __importDefault(require("../db"));
const middleware_1 = require("../middleware");
const logger_1 = require("../logger");
const config_1 = require("../config");
const subscription_service_1 = require("../services/subscription.service");
const router = (0, express_1.Router)();
// ── Multer for logo uploads ────────────────────────────────
const logoStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        const dir = path_1.default.resolve(config_1.config.upload.dir, 'logos');
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase() || '.png';
        cb(null, `org_${req.params.orgId}_${Date.now()}${ext}`);
    },
});
const logoUpload = (0, multer_1.default)({
    storage: logoStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
        if (allowed.includes(file.mimetype))
            cb(null, true);
        else
            cb(new Error('Only JPEG, PNG, WebP, GIF, and SVG images are allowed'));
    },
});
// ── Schemas ─────────────────────────────────────────────────
const createOrgSchema = zod_1.z.object({
    name: zod_1.z.string().min(2).max(200),
    slug: zod_1.z
        .string()
        .min(2)
        .max(100)
        .regex(/^[a-z0-9-]+$/),
    currency: zod_1.z.string().length(3).default('USD'),
    timezone: zod_1.z.string().default('UTC'),
});
const addMemberSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    role: zod_1.z.enum(['org_admin', 'executive', 'member', 'guest']).default('member'),
});
// ── Create Organization ─────────────────────────────────────
router.post('/', middleware_1.authenticate, (0, middleware_1.validate)(createOrgSchema), async (req, res) => {
    try {
        const { name, slug, currency, timezone } = req.body;
        // Check slug uniqueness
        const existing = await (0, db_1.default)('organizations').where({ slug }).first();
        if (existing) {
            res.status(409).json({ success: false, error: 'Slug already taken' });
            return;
        }
        // Create org (SaaS — no legacy license)
        const [org] = await (0, db_1.default)('organizations')
            .insert({
            name,
            slug,
            status: 'active',
            subscription_status: 'active',
            billing_currency: currency === 'NGN' ? 'NGN' : 'USD',
            settings: JSON.stringify({
                currency,
                timezone,
                locale: 'en',
                aiEnabled: true,
                features: {
                    chat: true,
                    meetings: true,
                    financials: true,
                    polls: true,
                    events: true,
                    announcements: true,
                    documents: true,
                    committees: true,
                },
            }),
        })
            .returning('*');
        // Make creator org_admin
        await (0, db_1.default)('memberships').insert({
            user_id: req.user.userId,
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
            user_id: req.user.userId,
        });
        // Provision SaaS: Standard plan subscription + wallets
        const standardPlan = await (0, subscription_service_1.getPlanBySlug)('standard');
        if (standardPlan) {
            await (0, subscription_service_1.createSubscription)({
                organizationId: org.id,
                planId: standardPlan.id,
                billingCycle: 'annual',
                currency: currency === 'NGN' ? 'NGN' : 'USD',
                amountPaid: 0,
                createdBy: req.user.userId,
            });
        }
        await (0, subscription_service_1.getAiWallet)(org.id); // auto-creates
        await (0, subscription_service_1.getTranslationWallet)(org.id); // auto-creates
        // Generate initial invite link for org admin
        const invite = await (0, subscription_service_1.createInviteLink)(org.id, req.user.userId, 'member');
        // Keep legacy ai_credits for backward compatibility
        try {
            await (0, db_1.default)('ai_credits').insert({
                organization_id: org.id,
                total_credits: 0,
                used_credits: 0,
            });
        }
        catch { /* ignore if exists */ }
        await req.audit?.({
            organizationId: org.id,
            action: 'create',
            entityType: 'organization',
            entityId: org.id,
            newValue: { name, slug },
        });
        logger_1.logger.info(`Organization created: ${name} (${slug})`);
        res.status(201).json({ success: true, data: org });
    }
    catch (err) {
        logger_1.logger.error('Create org error', err);
        res.status(500).json({ success: false, error: 'Failed to create organization' });
    }
});
// ── List User's Organizations ───────────────────────────────
router.get('/', middleware_1.authenticate, async (req, res) => {
    try {
        let query = (0, db_1.default)('organizations');
        // Super admin sees all
        if (req.user.globalRole !== 'super_admin') {
            const orgIds = await (0, db_1.default)('memberships')
                .where({ user_id: req.user.userId, is_active: true })
                .pluck('organization_id');
            query = query.whereIn('id', orgIds);
        }
        const orgs = await query.select('*').orderBy('name');
        res.json({ success: true, data: orgs });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to list organizations' });
    }
});
// ── Get Organization Detail ─────────────────────────────────
router.get('/:orgId', middleware_1.authenticate, middleware_1.loadMembership, async (req, res) => {
    try {
        const org = await (0, db_1.default)('organizations').where({ id: req.params.orgId }).first();
        if (!org) {
            res.status(404).json({ success: false, error: 'Organization not found' });
            return;
        }
        const memberCount = await (0, db_1.default)('memberships')
            .where({ organization_id: req.params.orgId, is_active: true })
            .count('id as count')
            .first();
        // SaaS subscription + wallet info
        const subscription = await (0, subscription_service_1.getOrgSubscription)(req.params.orgId);
        const [aiWallet, translationWallet] = await Promise.all([
            (0, subscription_service_1.getAiWallet)(req.params.orgId),
            (0, subscription_service_1.getTranslationWallet)(req.params.orgId),
        ]);
        res.json({
            success: true,
            data: {
                ...org,
                memberCount: parseInt(memberCount?.count) || 0,
                subscription,
                aiWallet,
                translationWallet,
            },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get organization' });
    }
});
// ── Update Organization Settings ────────────────────────────
router.put('/:orgId/settings', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin'), async (req, res) => {
    try {
        const previous = await (0, db_1.default)('organizations').where({ id: req.params.orgId }).first();
        const { name, settings } = req.body;
        const updates = {};
        if (name)
            updates.name = name;
        if (settings)
            updates.settings = JSON.stringify(settings);
        await (0, db_1.default)('organizations').where({ id: req.params.orgId }).update(updates);
        await req.audit?.({
            organizationId: req.params.orgId,
            action: 'settings_change',
            entityType: 'organization',
            entityId: req.params.orgId,
            previousValue: { name: previous.name, settings: previous.settings },
            newValue: updates,
        });
        res.json({ success: true, message: 'Settings updated' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update settings' });
    }
});
// ── List Members ────────────────────────────────────────────
router.get('/:orgId/members', middleware_1.authenticate, middleware_1.loadMembership, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const search = req.query.search;
        let query = (0, db_1.default)('memberships')
            .join('users', 'memberships.user_id', 'users.id')
            .where({
            'memberships.organization_id': req.params.orgId,
            'memberships.is_active': true,
        })
            .select('memberships.id', 'memberships.role', 'memberships.joined_at', 'users.id as userId', 'users.email', 'users.first_name', 'users.last_name', 'users.avatar_url');
        if (search) {
            // Escape LIKE special characters to prevent injection
            const escapedSearch = search.replace(/[%_\\]/g, '\\$&');
            query = query.where((qb) => {
                qb.where('users.email', 'ilike', `%${escapedSearch}%`)
                    .orWhere('users.first_name', 'ilike', `%${escapedSearch}%`)
                    .orWhere('users.last_name', 'ilike', `%${escapedSearch}%`);
            });
        }
        const total = await query.clone().clear('select').count('memberships.id as count').first();
        const members = await query
            .orderBy('users.first_name')
            .offset((page - 1) * limit)
            .limit(limit);
        res.json({
            success: true,
            data: members,
            meta: {
                page,
                limit,
                total: parseInt(total?.count) || 0,
            },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to list members' });
    }
});
// ── Look Up Organization by Slug ────────────────────────────
router.get('/lookup/:slug', middleware_1.authenticate, async (req, res) => {
    try {
        const org = await (0, db_1.default)('organizations').where({ slug: req.params.slug }).first();
        if (!org) {
            res.status(404).json({ success: false, error: 'Organization not found' });
            return;
        }
        const memberCount = await (0, db_1.default)('memberships')
            .where({ organization_id: org.id, is_active: true })
            .count('id as count').first();
        res.json({
            success: true,
            data: { id: org.id, name: org.name, slug: org.slug, memberCount: parseInt(memberCount?.count) || 0 },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to look up organization' });
    }
});
// ── Join Organization (Self-join) ───────────────────────────
router.post('/:orgId/join', middleware_1.authenticate, async (req, res) => {
    try {
        const userId = req.user.userId;
        const orgId = req.params.orgId;
        const org = await (0, db_1.default)('organizations').where({ id: orgId }).first();
        if (!org) {
            res.status(404).json({ success: false, error: 'Organization not found' });
            return;
        }
        // Check if already a member
        const existing = await (0, db_1.default)('memberships')
            .where({ user_id: userId, organization_id: orgId })
            .first();
        if (existing) {
            if (existing.is_active) {
                res.status(409).json({ success: false, error: 'You are already a member of this organization' });
                return;
            }
            // Reactivate
            await (0, db_1.default)('memberships').where({ id: existing.id }).update({ is_active: true, role: 'member' });
        }
        else {
            // Check member limit from subscription plan
            const sub = await (0, subscription_service_1.getOrgSubscription)(orgId);
            const maxMembers = sub?.plan?.max_members || 100;
            const memberCount = await (0, db_1.default)('memberships')
                .where({ organization_id: orgId, is_active: true })
                .count('id as count').first();
            if (parseInt(memberCount?.count) >= maxMembers) {
                res.status(403).json({ success: false, error: 'Organization has reached its member limit. An admin needs to upgrade the plan.' });
                return;
            }
            await (0, db_1.default)('memberships').insert({
                user_id: userId,
                organization_id: orgId,
                role: 'member',
            });
        }
        // Add to general channel
        const generalChannel = await (0, db_1.default)('channels')
            .where({ organization_id: orgId, type: 'general' })
            .first();
        if (generalChannel) {
            await (0, db_1.default)('channel_members')
                .insert({ channel_id: generalChannel.id, user_id: userId })
                .onConflict(['channel_id', 'user_id'])
                .ignore();
        }
        res.status(201).json({ success: true, message: 'Successfully joined organization', data: { organizationId: orgId, name: org.name } });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to join organization' });
    }
});
// ── Get Single Member Detail ────────────────────────────────
router.get('/:orgId/members/:userId', middleware_1.authenticate, middleware_1.loadMembership, async (req, res) => {
    try {
        const member = await (0, db_1.default)('memberships')
            .join('users', 'memberships.user_id', 'users.id')
            .where({
            'memberships.organization_id': req.params.orgId,
            'memberships.user_id': req.params.userId,
        })
            .select('memberships.id', 'memberships.role', 'memberships.joined_at', 'memberships.is_active', 'users.id as userId', 'users.email', 'users.first_name', 'users.last_name', 'users.phone', 'users.avatar_url')
            .first();
        if (!member) {
            res.status(404).json({ success: false, error: 'Member not found' });
            return;
        }
        // Get committees
        const committees = await (0, db_1.default)('committee_members')
            .join('committees', 'committee_members.committee_id', 'committees.id')
            .where({ 'committee_members.user_id': req.params.userId, 'committees.organization_id': req.params.orgId })
            .select('committees.id', 'committees.name');
        // Get financial info
        const dues = await (0, db_1.default)('transactions')
            .where({ user_id: req.params.userId, organization_id: req.params.orgId, type: 'due' })
            .select('id', 'description as title', 'amount', 'status', 'created_at as dueDate')
            .orderBy('created_at', 'desc')
            .limit(20);
        const fines = await (0, db_1.default)('transactions')
            .where({ user_id: req.params.userId, organization_id: req.params.orgId, type: 'fine' })
            .select('id', 'description as reason', 'amount', 'status', 'created_at')
            .orderBy('created_at', 'desc')
            .limit(20);
        const donations = await (0, db_1.default)('donations')
            .join('donation_campaigns', 'donations.campaign_id', 'donation_campaigns.id')
            .where({ 'donations.user_id': req.params.userId, 'donation_campaigns.organization_id': req.params.orgId })
            .select('donations.id', 'donation_campaigns.title as campaignTitle', 'donations.amount', 'donations.created_at')
            .orderBy('donations.created_at', 'desc')
            .limit(20);
        const totalPaid = await (0, db_1.default)('transactions')
            .where({ user_id: req.params.userId, organization_id: req.params.orgId, status: 'completed' })
            .sum('amount as total')
            .first();
        const totalOwed = await (0, db_1.default)('transactions')
            .where({ user_id: req.params.userId, organization_id: req.params.orgId, status: 'pending' })
            .sum('amount as total')
            .first();
        res.json({
            success: true,
            data: {
                id: member.userId,
                fullName: `${member.first_name} ${member.last_name}`,
                email: member.email,
                phone: member.phone,
                role: member.role,
                joinedAt: member.joined_at,
                avatarUrl: member.avatar_url,
                committees,
                financials: {
                    totalPaid: parseFloat(totalPaid?.total) || 0,
                    totalOwed: parseFloat(totalOwed?.total) || 0,
                    dues,
                    fines,
                    donations,
                },
            },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get member detail' });
    }
});
// ── Add Member ──────────────────────────────────────────────
router.post('/:orgId/members', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin', 'executive'), (0, middleware_1.validate)(addMemberSchema), async (req, res) => {
    try {
        const { email, role } = req.body;
        const user = await (0, db_1.default)('users').where({ email }).first();
        if (!user) {
            res.status(404).json({ success: false, error: 'User not found. They must register first.' });
            return;
        }
        const existing = await (0, db_1.default)('memberships')
            .where({ user_id: user.id, organization_id: req.params.orgId })
            .first();
        if (existing) {
            if (existing.is_active) {
                res.status(409).json({ success: false, error: 'User is already a member' });
                return;
            }
            // Reactivate
            await (0, db_1.default)('memberships').where({ id: existing.id }).update({ is_active: true, role });
        }
        else {
            // Check member limit
            const org = await (0, db_1.default)('organizations').where({ id: req.params.orgId }).first();
            const settings = typeof org.settings === 'string' ? JSON.parse(org.settings) : org.settings;
            const memberCount = await (0, db_1.default)('memberships')
                .where({ organization_id: req.params.orgId, is_active: true })
                .count('id as count')
                .first();
            if (parseInt(memberCount?.count) >= settings.maxMembers) {
                res.status(403).json({ success: false, error: 'Member limit reached for this license' });
                return;
            }
            await (0, db_1.default)('memberships').insert({
                user_id: user.id,
                organization_id: req.params.orgId,
                role,
            });
        }
        // Add to general channel
        const generalChannel = await (0, db_1.default)('channels')
            .where({ organization_id: req.params.orgId, type: 'general' })
            .first();
        if (generalChannel) {
            await (0, db_1.default)('channel_members')
                .insert({ channel_id: generalChannel.id, user_id: user.id })
                .onConflict(['channel_id', 'user_id'])
                .ignore();
        }
        await req.audit?.({
            organizationId: req.params.orgId,
            action: 'create',
            entityType: 'membership',
            entityId: user.id,
            newValue: { email, role },
        });
        res.status(201).json({ success: true, message: 'Member added' });
    }
    catch (err) {
        logger_1.logger.error('Add member error', err);
        res.status(500).json({ success: false, error: 'Failed to add member' });
    }
});
// ── Update Member Role ──────────────────────────────────────
router.put('/:orgId/members/:userId', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin'), async (req, res) => {
    try {
        const { role, isActive } = req.body;
        const membership = await (0, db_1.default)('memberships')
            .where({ user_id: req.params.userId, organization_id: req.params.orgId })
            .first();
        if (!membership) {
            res.status(404).json({ success: false, error: 'Membership not found' });
            return;
        }
        const updates = {};
        if (role)
            updates.role = role;
        if (isActive !== undefined)
            updates.is_active = isActive;
        const previousValue = { role: membership.role, is_active: membership.is_active };
        await (0, db_1.default)('memberships').where({ id: membership.id }).update(updates);
        await req.audit?.({
            organizationId: req.params.orgId,
            action: 'role_change',
            entityType: 'membership',
            entityId: membership.id,
            previousValue,
            newValue: updates,
        });
        res.json({ success: true, message: 'Member updated' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update member' });
    }
});
// ── Remove Member ───────────────────────────────────────────
router.delete('/:orgId/members/:userId', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin'), async (req, res) => {
    try {
        await (0, db_1.default)('memberships')
            .where({ user_id: req.params.userId, organization_id: req.params.orgId })
            .update({ is_active: false });
        await req.audit?.({
            organizationId: req.params.orgId,
            action: 'delete',
            entityType: 'membership',
            entityId: req.params.userId,
        });
        res.json({ success: true, message: 'Member removed' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to remove member' });
    }
});
// ── Platform: List All Orgs (Super Admin) ───────────────────
router.get('/platform/all', middleware_1.authenticate, (0, middleware_1.requireSuperAdmin)(), async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const orgs = await (0, db_1.default)('organizations')
            .leftJoin('licenses', 'organizations.license_id', 'licenses.id')
            .select('organizations.*', 'licenses.type as licenseType', 'licenses.max_members as licenseMaxMembers')
            .orderBy('organizations.created_at', 'desc')
            .offset((page - 1) * limit)
            .limit(limit);
        const total = await (0, db_1.default)('organizations').count('id as count').first();
        res.json({
            success: true,
            data: orgs,
            meta: { page, limit, total: parseInt(total?.count) || 0 },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to list all organizations' });
    }
});
// ── Get Member Activity Log ─────────────────────────────────
router.get('/:orgId/members/:userId/activity', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin', 'executive'), async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 30;
        const activities = await (0, db_1.default)('audit_logs')
            .where({
            user_id: req.params.userId,
            organization_id: req.params.orgId,
        })
            .select('id', 'action', 'entity_type', 'entity_id', 'new_value', 'ip_address', 'created_at')
            .orderBy('created_at', 'desc')
            .offset((page - 1) * limit)
            .limit(limit);
        const total = await (0, db_1.default)('audit_logs')
            .where({ user_id: req.params.userId, organization_id: req.params.orgId })
            .count('id as count')
            .first();
        res.json({
            success: true,
            data: activities,
            meta: { page, limit, total: parseInt(total?.count) || 0 },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get member activity' });
    }
});
// ── Get Organization Subscription ───────────────────────────
router.get('/:orgId/subscription', middleware_1.authenticate, middleware_1.loadMembership, async (req, res) => {
    try {
        const org = await (0, db_1.default)('organizations')
            .where({ id: req.params.orgId })
            .first();
        if (!org) {
            res.status(404).json({ success: false, error: 'Organization not found' });
            return;
        }
        const license = await (0, db_1.default)('licenses')
            .where({ id: org.license_id })
            .first();
        res.json({
            success: true,
            data: {
                id: license?.id || 'free',
                planId: license?.type || 'free',
                status: license?.is_active ? 'active' : 'expired',
                maxMembers: license?.max_members || 50,
                features: license?.features || {},
                aiCreditsIncluded: license?.ai_credits_included || 0,
                priceMonthly: parseFloat(license?.price_monthly) || 0,
                currentPeriodEnd: license?.valid_until || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get subscription' });
    }
});
// ── Upload Organization Logo ──────────────────────────────
router.post('/:orgId/logo', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin'), (req, res, next) => {
    logoUpload.single('logo')(req, res, (err) => {
        if (err)
            return res.status(400).json({ success: false, error: err.message });
        next();
    });
}, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No image file provided' });
        }
        const logoUrl = `/uploads/logos/${req.file.filename}`;
        await (0, db_1.default)('organizations').where({ id: req.params.orgId }).update({ logo_url: logoUrl });
        logger_1.logger.info(`Logo uploaded for org ${req.params.orgId}: ${logoUrl}`);
        res.json({
            success: true,
            data: { logoUrl },
            message: 'Logo uploaded successfully',
        });
    }
    catch (err) {
        logger_1.logger.error('Logo upload error:', err);
        res.status(500).json({ success: false, error: 'Failed to upload logo' });
    }
});
// ── Update Organization Branding ──────────────────────────
router.put('/:orgId/branding', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin'), async (req, res) => {
    try {
        const { primaryColor, secondaryColor, accentColor, tagline, description, website } = req.body;
        const org = await (0, db_1.default)('organizations').where({ id: req.params.orgId }).first();
        if (!org) {
            return res.status(404).json({ success: false, error: 'Organization not found' });
        }
        // Merge branding into settings JSON
        const settings = typeof org.settings === 'string' ? JSON.parse(org.settings) : (org.settings || {});
        settings.branding = {
            ...(settings.branding || {}),
            primaryColor: primaryColor || settings.branding?.primaryColor || '#6366f1',
            secondaryColor: secondaryColor || settings.branding?.secondaryColor || '#8b5cf6',
            accentColor: accentColor || settings.branding?.accentColor || '#f59e0b',
            tagline: tagline !== undefined ? tagline : (settings.branding?.tagline || ''),
            description: description !== undefined ? description : (settings.branding?.description || ''),
            website: website !== undefined ? website : (settings.branding?.website || ''),
        };
        await (0, db_1.default)('organizations')
            .where({ id: req.params.orgId })
            .update({ settings: JSON.stringify(settings) });
        await req.audit?.({
            organizationId: req.params.orgId,
            action: 'settings_change',
            entityType: 'organization',
            entityId: req.params.orgId,
            newValue: { branding: settings.branding },
        });
        res.json({
            success: true,
            data: { branding: settings.branding },
            message: 'Branding updated successfully',
        });
    }
    catch (err) {
        logger_1.logger.error('Branding update error:', err);
        res.status(500).json({ success: false, error: 'Failed to update branding' });
    }
});
exports.default = router;
//# sourceMappingURL=organizations.js.map