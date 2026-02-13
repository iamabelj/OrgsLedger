"use strict";
// ============================================================
// OrgsLedger API — Announcements / Broadcast Routes
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
const push_service_1 = require("../services/push.service");
const router = (0, express_1.Router)();
// ── Schemas ─────────────────────────────────────────────────
const createAnnouncementSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(300),
    body: zod_1.z.string().min(1).max(10000),
    priority: zod_1.z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
    pinned: zod_1.z.boolean().default(false),
});
// ── Create Announcement ─────────────────────────────────────
router.post('/:orgId', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin', 'executive'), (0, middleware_1.validate)(createAnnouncementSchema), async (req, res) => {
    try {
        const { title, body, priority, pinned } = req.body;
        const [announcement] = await (0, db_1.default)('announcements')
            .insert({
            organization_id: req.params.orgId,
            title,
            body,
            priority,
            pinned: pinned || false,
            created_by: req.user.userId,
        })
            .returning('*');
        // Notify all org members
        const members = await (0, db_1.default)('memberships')
            .where({ organization_id: req.params.orgId, is_active: true })
            .pluck('user_id');
        if (members.length) {
            const notifications = members.map((userId) => ({
                user_id: userId,
                organization_id: req.params.orgId,
                type: 'announcement',
                title: `📢 ${title}`,
                body: body.substring(0, 200),
                data: JSON.stringify({ announcementId: announcement.id }),
            }));
            await (0, db_1.default)('notifications').insert(notifications);
            (0, push_service_1.sendPushToOrg)(req.params.orgId, {
                title: `📢 ${title}`,
                body: body.substring(0, 200),
                data: { announcementId: announcement.id, type: 'announcement' },
            }, req.user.userId).catch(() => { });
        }
        res.status(201).json({ success: true, data: announcement });
    }
    catch (err) {
        logger_1.logger.error('Create announcement error', err);
        res.status(500).json({ success: false, error: 'Failed to create announcement' });
    }
});
// ── List Announcements ──────────────────────────────────────
router.get('/:orgId', middleware_1.authenticate, middleware_1.loadMembership, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const query = (0, db_1.default)('announcements')
            .where({ organization_id: req.params.orgId })
            .select('announcements.*');
        const total = await query.clone().clear('select').count('id as count').first();
        const announcements = await query
            .join('users', 'announcements.created_by', 'users.id')
            .select('announcements.*', 'users.first_name as author_first_name', 'users.last_name as author_last_name')
            .orderByRaw('pinned DESC, created_at DESC')
            .offset((page - 1) * limit)
            .limit(limit);
        res.json({
            success: true,
            data: announcements,
            meta: { page, limit, total: parseInt(total?.count) || 0 },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to list announcements' });
    }
});
// ── Get Announcement ────────────────────────────────────────
router.get('/:orgId/:announcementId', middleware_1.authenticate, middleware_1.loadMembership, async (req, res) => {
    try {
        const announcement = await (0, db_1.default)('announcements')
            .join('users', 'announcements.created_by', 'users.id')
            .where({ 'announcements.id': req.params.announcementId, organization_id: req.params.orgId })
            .select('announcements.*', 'users.first_name as author_first_name', 'users.last_name as author_last_name')
            .first();
        if (!announcement) {
            res.status(404).json({ success: false, error: 'Announcement not found' });
            return;
        }
        res.json({ success: true, data: announcement });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get announcement' });
    }
});
// ── Delete Announcement ─────────────────────────────────────
router.delete('/:orgId/:announcementId', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin'), async (req, res) => {
    try {
        await (0, db_1.default)('announcements')
            .where({ id: req.params.announcementId, organization_id: req.params.orgId })
            .delete();
        res.json({ success: true, message: 'Announcement deleted' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to delete announcement' });
    }
});
// ── Toggle Pin ──────────────────────────────────────────────
router.put('/:orgId/:announcementId/pin', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin', 'executive'), async (req, res) => {
    try {
        const announcement = await (0, db_1.default)('announcements')
            .where({ id: req.params.announcementId, organization_id: req.params.orgId })
            .first();
        if (!announcement) {
            res.status(404).json({ success: false, error: 'Announcement not found' });
            return;
        }
        await (0, db_1.default)('announcements')
            .where({ id: req.params.announcementId })
            .update({ pinned: !announcement.pinned });
        res.json({ success: true, pinned: !announcement.pinned });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to toggle pin' });
    }
});
exports.default = router;
//# sourceMappingURL=announcements.js.map