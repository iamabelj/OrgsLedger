// ============================================================
// OrgsLedger API — Notification Routes
// ============================================================

import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticate } from '../middleware';

const router = Router();

// ── Get User Notifications ──────────────────────────────────
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 30;
    const unreadOnly = req.query.unread === 'true';

    let query = db('notifications')
      .where({ user_id: req.user!.userId })
      .select('*');

    if (unreadOnly) {
      query = query.where({ is_read: false });
    }

    const total = await query.clone().clear('select').count('id as count').first();
    const notifications = await query
      .orderBy('created_at', 'desc')
      .offset((page - 1) * limit)
      .limit(limit);

    const unreadCount = await db('notifications')
      .where({ user_id: req.user!.userId, is_read: false })
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
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get notifications' });
  }
});

// ── Mark as Read ────────────────────────────────────────────
router.put('/:id/read', authenticate, async (req: Request, res: Response) => {
  try {
    await db('notifications')
      .where({ id: req.params.id, user_id: req.user!.userId })
      .update({ is_read: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to mark notification as read' });
  }
});

// ── Mark All as Read ────────────────────────────────────────
router.put('/read-all', authenticate, async (req: Request, res: Response) => {
  try {
    const orgId = req.query.orgId as string;
    let query = db('notifications')
      .where({ user_id: req.user!.userId, is_read: false });
    if (orgId) query = query.where({ organization_id: orgId });
    await query.update({ is_read: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to mark all as read' });
  }
});

// ── Get Notification Preferences ────────────────────────────
router.get('/preferences', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await db('users')
      .where({ id: req.user!.userId })
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
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get preferences' });
  }
});

// ── Update Notification Preferences ─────────────────────────
router.put('/preferences', authenticate, async (req: Request, res: Response) => {
  try {
    const prefs = req.body;
    await db('users')
      .where({ id: req.user!.userId })
      .update({ notification_preferences: JSON.stringify(prefs) });
    res.json({ success: true, message: 'Preferences updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update preferences' });
  }
});

export default router;
