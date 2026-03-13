"use strict";
// ============================================================
// OrgsLedger API — Notification Routes
// Thin route layer — logic in NotificationController.
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const middleware_1 = require("../middleware");
const error_handler_1 = require("../middleware/error-handler");
const controllers_1 = require("../controllers");
const router = (0, express_1.Router)();
// ── Get User Notifications ──────────────────────────────────
router.get('/', middleware_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    await controllers_1.notificationController.list(req, res);
}));
// ── Mark as Read ────────────────────────────────────────────
router.put('/:id/read', middleware_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    await controllers_1.notificationController.markRead(req, res);
}));
// ── Mark All as Read ────────────────────────────────────────
router.put('/read-all', middleware_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    await controllers_1.notificationController.markAllRead(req, res);
}));
// ── Get Notification Preferences ────────────────────────────
router.get('/preferences', middleware_1.authenticate, async (req, res) => {
    try {
        const user = await (0, db_1.default)('users')
            .where({ id: req.user.userId })
            .select('notification_preferences')
            .first();
        const defaults = {
            email_finances: true,
            email_announcements: true,
            push_finances: true,
            push_announcements: true,
            push_chat: true,
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
        const ALLOWED_KEYS = [
            'email_finances', 'email_announcements',
            'push_finances', 'push_announcements', 'push_chat',
        ];
        const raw = req.body;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return res.status(400).json({ success: false, error: 'Invalid preferences format' });
        }
        // Only allow known keys with boolean values
        const prefs = {};
        for (const key of ALLOWED_KEYS) {
            if (key in raw) {
                prefs[key] = !!raw[key];
            }
        }
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