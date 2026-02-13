"use strict";
// ============================================================
// OrgsLedger API — Notification Routes
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const middleware_1 = require("../middleware");
const router = (0, express_1.Router)();
// ── Get User Notifications ──────────────────────────────────
router.get('/', middleware_1.authenticate, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 30;
        const unreadOnly = req.query.unread === 'true';
        let query = (0, db_1.default)('notifications')
            .where({ user_id: req.user.userId })
            .select('*');
        if (unreadOnly) {
            query = query.where({ is_read: false });
        }
        const total = await query.clone().clear('select').count('id as count').first();
        const notifications = await query
            .orderBy('created_at', 'desc')
            .offset((page - 1) * limit)
            .limit(limit);
        const unreadCount = await (0, db_1.default)('notifications')
            .where({ user_id: req.user.userId, is_read: false })
            .count('id as count')
            .first();
        res.json({
            success: true,
            data: notifications,
            meta: {
                page,
                limit,
                total: parseInt(total?.count) || 0,
                unreadCount: parseInt(unreadCount?.count) || 0,
            },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get notifications' });
    }
});
// ── Mark as Read ────────────────────────────────────────────
router.put('/:id/read', middleware_1.authenticate, async (req, res) => {
    try {
        await (0, db_1.default)('notifications')
            .where({ id: req.params.id, user_id: req.user.userId })
            .update({ is_read: true });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to mark notification as read' });
    }
});
// ── Mark All as Read ────────────────────────────────────────
router.put('/read-all', middleware_1.authenticate, async (req, res) => {
    try {
        const orgId = req.query.orgId;
        let query = (0, db_1.default)('notifications')
            .where({ user_id: req.user.userId, is_read: false });
        if (orgId)
            query = query.where({ organization_id: orgId });
        await query.update({ is_read: true });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to mark all as read' });
    }
});
// ── Get Notification Preferences ────────────────────────────
router.get('/preferences', middleware_1.authenticate, async (req, res) => {
    try {
        const user = await (0, db_1.default)('users')
            .where({ id: req.user.userId })
            .select('notification_preferences')
            .first();
        const defaults = {
            email_enabled: true,
            push_enabled: true,
            dues_reminders: true,
            meeting_reminders: true,
            fine_notifications: true,
            announcement_notifications: true,
            chat_notifications: true,
        };
        res.json({
            success: true,
            data: { ...defaults, ...(user?.notification_preferences || {}) },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get preferences' });
    }
});
// ── Update Notification Preferences ─────────────────────────
router.put('/preferences', middleware_1.authenticate, async (req, res) => {
    try {
        const prefs = req.body;
        await (0, db_1.default)('users')
            .where({ id: req.user.userId })
            .update({ notification_preferences: JSON.stringify(prefs) });
        res.json({ success: true, message: 'Preferences updated' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update preferences' });
    }
});
exports.default = router;
//# sourceMappingURL=notifications.js.map