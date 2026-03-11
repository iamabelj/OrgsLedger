// ============================================================
// OrgsLedger API — Notification Routes
// Thin route layer — logic in NotificationController.
// ============================================================

import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticate } from '../middleware';
import { asyncHandler } from '../middleware/error-handler';
import { notificationController } from '../controllers';

const router = Router();

// ── Get User Notifications ──────────────────────────────────
router.get('/', authenticate, asyncHandler(async (req, res) => {
  await notificationController.list(req, res);
}));

// ── Mark as Read ────────────────────────────────────────────
router.put('/:id/read', authenticate, asyncHandler(async (req, res) => {
  await notificationController.markRead(req, res);
}));

// ── Mark All as Read ────────────────────────────────────────
router.put('/read-all', authenticate, asyncHandler(async (req, res) => {
  await notificationController.markAllRead(req, res);
}));

// ── Get Notification Preferences ────────────────────────────
router.get('/preferences', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await db('users')
      .where({ id: req.user!.userId })
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
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get preferences' });
  }
});

// ── Update Notification Preferences ─────────────────────────
router.put('/preferences', authenticate, async (req: Request, res: Response) => {
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
    const prefs: Record<string, boolean> = {};
    for (const key of ALLOWED_KEYS) {
      if (key in raw) {
        prefs[key] = !!raw[key];
      }
    }
    await db('users')
      .where({ id: req.user!.userId })
      .update({ notification_preferences: JSON.stringify(prefs) });
    res.json({ success: true, message: 'Preferences updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update preferences' });
  }
});

export default router;
