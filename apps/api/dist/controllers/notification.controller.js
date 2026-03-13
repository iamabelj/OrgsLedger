"use strict";
// ============================================================
// OrgsLedger API — Notification Controller
// Handles request parsing ↔ response formatting.
// Business logic delegated to service layer.
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationController = exports.NotificationController = void 0;
const db_1 = __importDefault(require("../db"));
const formatters_1 = require("../utils/formatters");
class NotificationController {
    /** GET / — list current user's notifications */
    async list(req, res) {
        const { page, limit, offset } = (0, formatters_1.parsePagination)(req.query);
        const unreadOnly = req.query.unread === 'true';
        const userId = req.user.userId;
        let query = (0, db_1.default)('notifications').where({ user_id: userId });
        if (unreadOnly)
            query = query.where({ is_read: false });
        const total = await query.clone().clear('select').count('id as count').first();
        const rows = await query
            .select('*')
            .orderBy('created_at', 'desc')
            .offset(offset)
            .limit(limit);
        // Map snake_case DB columns → camelCase for frontend
        const notifications = rows.map((r) => ({
            id: r.id,
            type: r.type,
            title: r.title,
            message: r.body,
            read: r.is_read,
            createdAt: r.created_at,
            data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
            userId: r.user_id,
            organizationId: r.organization_id,
        }));
        const unreadCount = await (0, db_1.default)('notifications')
            .where({ user_id: userId, is_read: false })
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
    /** PUT /:id/read — mark single notification as read */
    async markRead(req, res) {
        await (0, db_1.default)('notifications')
            .where({ id: req.params.id, user_id: req.user.userId })
            .update({ is_read: true });
        res.json({ success: true });
    }
    /** PUT /read-all — mark all notifications as read */
    async markAllRead(req, res) {
        const orgId = req.query.orgId;
        let query = (0, db_1.default)('notifications')
            .where({ user_id: req.user.userId, is_read: false });
        if (orgId)
            query = query.where({ organization_id: orgId });
        await query.update({ is_read: true });
        res.json({ success: true });
    }
}
exports.NotificationController = NotificationController;
exports.notificationController = new NotificationController();
//# sourceMappingURL=notification.controller.js.map