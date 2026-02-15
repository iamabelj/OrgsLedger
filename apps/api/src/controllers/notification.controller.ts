// ============================================================
// OrgsLedger API — Notification Controller
// Handles request parsing ↔ response formatting.
// Business logic delegated to service layer.
// ============================================================

import { Request, Response } from 'express';
import db from '../db';
import { parsePagination } from '../utils/formatters';

export class NotificationController {
  /** GET / — list current user's notifications */
  async list(req: Request, res: Response): Promise<void> {
    const { page, limit, offset } = parsePagination(req.query);
    const unreadOnly = req.query.unread === 'true';
    const userId = req.user!.userId;

    let query = db('notifications').where({ user_id: userId });
    if (unreadOnly) query = query.where({ is_read: false });

    const total = await query.clone().clear('select').count('id as count').first();
    const notifications = await query
      .select('*')
      .orderBy('created_at', 'desc')
      .offset(offset)
      .limit(limit);

    const unreadCount = await db('notifications')
      .where({ user_id: userId, is_read: false })
      .count('id as count')
      .first();

    res.json({
      success: true,
      data: notifications,
      meta: {
        page,
        limit,
        total: parseInt(total?.count as string) || 0,
        unreadCount: parseInt(unreadCount?.count as string) || 0,
      },
    });
  }

  /** PUT /:id/read — mark single notification as read */
  async markRead(req: Request, res: Response): Promise<void> {
    await db('notifications')
      .where({ id: req.params.id, user_id: req.user!.userId })
      .update({ is_read: true });
    res.json({ success: true });
  }

  /** PUT /read-all — mark all notifications as read */
  async markAllRead(req: Request, res: Response): Promise<void> {
    const orgId = req.query.orgId as string;
    let query = db('notifications')
      .where({ user_id: req.user!.userId, is_read: false });
    if (orgId) query = query.where({ organization_id: orgId });
    await query.update({ is_read: true });
    res.json({ success: true });
  }
}

export const notificationController = new NotificationController();
