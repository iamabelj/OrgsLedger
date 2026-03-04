// ============================================================
// OrgsLedger API — Announcements / Broadcast Routes
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import db from '../db';
import { authenticate, loadMembershipAndSub as loadMembership, requireRole, validate } from '../middleware';
import { logger } from '../logger';
import { sendPushToOrg } from '../services/push.service';
import { sendAnnouncementEmail } from '../services/email.service';

const router = Router();

// ── Schemas ─────────────────────────────────────────────────
const createAnnouncementSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(10000),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  pinned: z.boolean().default(false),
});

const updateAnnouncementSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  body: z.string().min(1).max(10000).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  pinned: z.boolean().optional(),
});

// ── Create Announcement ─────────────────────────────────────
router.post(
  '/:orgId',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  validate(createAnnouncementSchema),
  async (req: Request, res: Response) => {
    try {
      const { title, body, priority, pinned } = req.body;

      const [announcement] = await db('announcements')
        .insert({
          organization_id: req.params.orgId,
          title,
          body,
          priority,
          pinned: pinned || false,
          created_by: req.user!.userId,
        })
        .returning('*');

      // Notify all org members (except the creator)
      const members = await db('memberships')
        .where({ organization_id: req.params.orgId, is_active: true })
        .whereNot({ user_id: req.user!.userId })
        .pluck('user_id');

      if (members.length) {
        const notifications = members.map((userId: string) => ({
          user_id: userId,
          organization_id: req.params.orgId,
          type: 'announcement',
          title: `📢 ${title}`,
          body: body.substring(0, 200),
          data: JSON.stringify({ announcementId: announcement.id }),
        }));
        await db('notifications').insert(notifications);

        sendPushToOrg(req.params.orgId, {
          title: `📢 ${title}`,
          body: body.substring(0, 200),
          data: { announcementId: announcement.id, type: 'announcement' },
        }, req.user!.userId).catch(err => logger.warn('Push notification failed (announcement)', err));

        // Send announcement email (best-effort, non-blocking)
        try {
          const users = await db('users').whereIn('id', members).select('email');
          const emails = users.map((u: any) => u.email).filter(Boolean);
          if (emails.length > 0) {
            const org = await db('organizations')
              .where({ id: req.params.orgId })
              .select('settings')
              .first();
            const settings = typeof org?.settings === 'string' ? JSON.parse(org.settings) : org?.settings;
            if (settings?.notifications?.emailNotifications !== false) {
              await sendAnnouncementEmail(title, body, priority, emails)
                .catch((err) => logger.warn('Failed to send announcement email', err));
            }
          }
        } catch (emailErr) {
          logger.warn('Announcement email error (non-blocking)', emailErr);
        }
      }

      res.status(201).json({ success: true, data: announcement });
    } catch (err) {
      logger.error('Create announcement error', err);
      res.status(500).json({ success: false, error: 'Failed to create announcement' });
    }
  }
);

// ── List Announcements ──────────────────────────────────────
router.get(
  '/:orgId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const query = db('announcements')
        .where({ organization_id: req.params.orgId })
        .select('announcements.*');

      const total = await query.clone().clear('select').count('id as count').first();

      const announcements = await query
        .join('users', 'announcements.created_by', 'users.id')
        .select(
          'announcements.*',
          'users.first_name as author_first_name',
          'users.last_name as author_last_name'
        )
        .orderByRaw('pinned DESC, created_at DESC')
        .offset((page - 1) * limit)
        .limit(limit);

      res.json({
        success: true,
        data: announcements,
        meta: { page, limit, total: parseInt(total?.count as string) || 0 },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to list announcements' });
    }
  }
);

// ── Get Announcement ────────────────────────────────────────
router.get(
  '/:orgId/:announcementId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const announcement = await db('announcements')
        .join('users', 'announcements.created_by', 'users.id')
        .where({ 'announcements.id': req.params.announcementId, organization_id: req.params.orgId })
        .select(
          'announcements.*',
          'users.first_name as author_first_name',
          'users.last_name as author_last_name'
        )
        .first();

      if (!announcement) {
        res.status(404).json({ success: false, error: 'Announcement not found' });
        return;
      }

      res.json({ success: true, data: announcement });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get announcement' });
    }
  }
);

// ── Delete Announcement ─────────────────────────────────────
router.delete(
  '/:orgId/:announcementId',
  authenticate,
  loadMembership,
  requireRole('org_admin'),
  async (req: Request, res: Response) => {
    try {
      const deleted = await db('announcements')
        .where({ id: req.params.announcementId, organization_id: req.params.orgId })
        .delete();
      if (!deleted) {
        res.status(404).json({ success: false, error: 'Announcement not found' });
        return;
      }
      res.json({ success: true, message: 'Announcement deleted' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to delete announcement' });
    }
  }
);

// ── Edit Announcement ───────────────────────────────────────
router.put(
  '/:orgId/:announcementId',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  validate(updateAnnouncementSchema),
  async (req: Request, res: Response) => {
    try {
      const existing = await db('announcements')
        .where({ id: req.params.announcementId, organization_id: req.params.orgId })
        .first();

      if (!existing) {
        res.status(404).json({ success: false, error: 'Announcement not found' });
        return;
      }

      const updates: Record<string, any> = {};
      const oldValues: Record<string, any> = {};
      const newValues: Record<string, any> = {};

      for (const field of ['title', 'body', 'priority', 'pinned'] as const) {
        if (req.body[field] !== undefined && req.body[field] !== existing[field]) {
          updates[field] = req.body[field];
          oldValues[field] = existing[field];
          newValues[field] = req.body[field];
        }
      }

      if (!Object.keys(updates).length) {
        res.json({ success: true, data: existing, message: 'No changes' });
        return;
      }

      updates.updated_at = db.fn.now();
      await db('announcements').where({ id: existing.id }).update(updates);

      const updated = await db('announcements').where({ id: existing.id }).first();

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'update',
        entityType: 'announcement',
        entityId: existing.id,
        previousValue: oldValues,
        newValue: newValues,
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      logger.error('Update announcement error', err);
      res.status(500).json({ success: false, error: 'Failed to update announcement' });
    }
  }
);

// ── Toggle Pin ──────────────────────────────────────────────
router.put(
  '/:orgId/:announcementId/pin',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  async (req: Request, res: Response) => {
    try {
      const announcement = await db('announcements')
        .where({ id: req.params.announcementId, organization_id: req.params.orgId })
        .first();

      if (!announcement) {
        res.status(404).json({ success: false, error: 'Announcement not found' });
        return;
      }

      await db('announcements')
        .where({ id: req.params.announcementId })
        .update({ pinned: !announcement.pinned });

      res.json({ success: true, data: { pinned: !announcement.pinned } });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to toggle pin' });
    }
  }
);

export default router;
