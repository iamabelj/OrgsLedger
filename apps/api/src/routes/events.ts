// ============================================================
// OrgsLedger API — Events / Calendar Routes
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import db from '../db';
import { authenticate, loadMembershipAndSub as loadMembership, requireRole, validate } from '../middleware';
import { logger } from '../logger';
import { sendPushToOrg } from '../services/push.service';

const router = Router();

// ── Schemas ─────────────────────────────────────────────────
const createEventSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  location: z.string().max(500).optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
  allDay: z.boolean().default(false),
  category: z.enum(['social', 'fundraiser', 'community', 'workshop', 'general']).default('general'),
  maxAttendees: z.number().int().min(0).optional(),
  rsvpRequired: z.boolean().default(false),
});

// ── Create Event ────────────────────────────────────────────
router.post(
  '/:orgId',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  validate(createEventSchema),
  async (req: Request, res: Response) => {
    try {
      const { title, description, location, startDate, endDate, allDay, category, maxAttendees, rsvpRequired } = req.body;

      const [event] = await db('events')
        .insert({
          organization_id: req.params.orgId,
          title,
          description: description || null,
          location: location || null,
          start_date: startDate,
          end_date: endDate || null,
          all_day: allDay,
          category,
          max_attendees: maxAttendees || null,
          rsvp_required: rsvpRequired,
          created_by: req.user!.userId,
        })
        .returning('*');

      // Notify org members
      sendPushToOrg(req.params.orgId, {
        title: 'New Event',
        body: `${title} — ${new Date(startDate).toLocaleDateString()}`,
        data: { eventId: event.id, type: 'event' },
      }, req.user!.userId).catch(err => logger.warn('Push notification failed (new event)', err));

      res.status(201).json({ success: true, data: event });
    } catch (err) {
      logger.error('Create event error', err);
      res.status(500).json({ success: false, error: 'Failed to create event' });
    }
  }
);

// ── List Events ─────────────────────────────────────────────
router.get(
  '/:orgId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const upcoming = req.query.upcoming === 'true';
      const category = req.query.category as string;

      let query = db('events')
        .where({ organization_id: req.params.orgId });

      if (upcoming) {
        query = query.where('start_date', '>=', new Date().toISOString());
      }
      if (category) {
        query = query.where({ category });
      }

      const total = await query.clone().clear('select').count('id as count').first();

      const events = await query
        .select('events.*')
        .orderBy('start_date', 'asc')
        .offset((page - 1) * limit)
        .limit(limit);

      // Attach RSVP counts
      const enriched = await Promise.all(
        events.map(async (evt: any) => {
          const rsvpCount = await db('event_rsvps')
            .where({ event_id: evt.id, status: 'attending' })
            .count('id as count')
            .first();
          return {
            ...evt,
            rsvpCount: parseInt(rsvpCount?.count as string) || 0,
          };
        })
      );

      res.json({
        success: true,
        data: enriched,
        meta: { page, limit, total: parseInt(total?.count as string) || 0 },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to list events' });
    }
  }
);

// ── Get Event Detail ────────────────────────────────────────
router.get(
  '/:orgId/:eventId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const event = await db('events')
        .where({ id: req.params.eventId, organization_id: req.params.orgId })
        .first();

      if (!event) {
        res.status(404).json({ success: false, error: 'Event not found' });
        return;
      }

      const rsvps = await db('event_rsvps')
        .join('users', 'event_rsvps.user_id', 'users.id')
        .where({ event_id: event.id })
        .select('event_rsvps.*', 'users.first_name', 'users.last_name');

      res.json({
        success: true,
        data: { ...event, rsvps },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get event' });
    }
  }
);

// ── RSVP to Event ───────────────────────────────────────────
router.post(
  '/:orgId/:eventId/rsvp',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const status = req.body.status || 'attending'; // attending, declined, maybe
      const validStatuses = ['attending', 'declined', 'maybe'];
      if (!validStatuses.includes(status)) {
        res.status(400).json({ success: false, error: `Invalid RSVP status. Must be one of: ${validStatuses.join(', ')}` });
        return;
      }

      const event = await db('events')
        .where({ id: req.params.eventId, organization_id: req.params.orgId })
        .first();

      if (!event) {
        res.status(404).json({ success: false, error: 'Event not found' });
        return;
      }

      // Check capacity
      if (event.max_attendees && status === 'attending') {
        const count = await db('event_rsvps')
          .where({ event_id: event.id, status: 'attending' })
          .count('id as count')
          .first();
        if ((parseInt(count?.count as string) || 0) >= event.max_attendees) {
          res.status(400).json({ success: false, error: 'Event is at full capacity' });
          return;
        }
      }

      // Upsert RSVP
      const existing = await db('event_rsvps')
        .where({ event_id: event.id, user_id: req.user!.userId })
        .first();

      if (existing) {
        await db('event_rsvps')
          .where({ id: existing.id })
          .update({ status, updated_at: db.fn.now() });
      } else {
        await db('event_rsvps').insert({
          event_id: event.id,
          user_id: req.user!.userId,
          status,
        });
      }

      res.json({ success: true, status });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to RSVP' });
    }
  }
);

// ── Delete Event ────────────────────────────────────────────
router.delete(
  '/:orgId/:eventId',
  authenticate,
  loadMembership,
  requireRole('org_admin'),
  async (req: Request, res: Response) => {
    try {
      await db('event_rsvps').where({ event_id: req.params.eventId }).delete();
      await db('events')
        .where({ id: req.params.eventId, organization_id: req.params.orgId })
        .delete();
      res.json({ success: true, message: 'Event deleted' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to delete event' });
    }
  }
);

export default router;
