// ============================================================
// OrgsLedger API — Meetings Routes
// Scheduling, Live Meetings, Attendance, Agenda, Voting
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import db from '../db';
import { authenticate, loadMembershipAndSub as loadMembership, requireRole, validate } from '../middleware';
import { logger } from '../logger';
import { sendPushToOrg } from '../services/push.service';
import { config } from '../config';
import { SUPPORTED_LANGUAGES, SPEECH_RECOGNITION_CODES, translateText } from '../services/translation.service';
import { getAiWallet } from '../services/subscription.service';

const router = Router();

// ── Multer for audio uploads ────────────────────────────────
const audioStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.upload.dir),
  filename: (_req, file, cb) => {
    const unique = crypto.randomBytes(12).toString('hex');
    const ext = path.extname(file.originalname) || '.m4a';
    cb(null, `audio_${unique}${ext}`);
  },
});
const audioUpload = multer({
  storage: audioStorage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB max for long meetings
  fileFilter: (_req, file, cb) => {
    const allowed = /m4a|mp3|wav|ogg|webm|aac|mp4|flac/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    cb(null, allowed.test(ext));
  },
});

// ── Schemas ─────────────────────────────────────────────────
// Helper: accept ISO datetime OR date-only strings
const flexDateTime = z.string().refine((s) => !isNaN(new Date(s).getTime()), { message: 'Invalid date/time string' });

const createMeetingSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  location: z.string().max(500).optional(),
  scheduledStart: flexDateTime,
  scheduledEnd: flexDateTime.optional(),
  aiEnabled: z.boolean().default(false),
  translationEnabled: z.boolean().default(false),
  recurringPattern: z.enum(['none', 'daily', 'weekly', 'biweekly', 'monthly']).default('none'),
  recurringEndDate: flexDateTime.optional(),
  agendaItems: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        durationMinutes: z.number().min(1).optional(),
        presenterUserId: z.string().uuid().optional(),
      })
    )
    .optional(),
});

const createVoteSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  options: z.array(z.string().min(1)).min(2).max(10),
});

// ── Create Meeting ──────────────────────────────────────────
router.post(
  '/:orgId',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  validate(createMeetingSchema),
  async (req: Request, res: Response) => {
    try {
      const { title, description, location, scheduledStart, scheduledEnd, aiEnabled, translationEnabled, agendaItems, recurringPattern, recurringEndDate } = req.body;

      // If AI enabled, check AI wallet balance (SaaS wallet, not legacy ai_credits)
      if (aiEnabled) {
        const wallet = await getAiWallet(req.params.orgId);
        const balance = parseFloat(wallet.balance_minutes) || 0;
        if (balance <= 0) {
          res.status(402).json({
            success: false,
            error: 'Insufficient AI wallet balance. Top up your AI hours to use AI features.',
          });
          return;
        }
      }

      // Generate a unique Jitsi room ID for video conferencing
      const jitsiRoomId = `orgsledger-${req.params.orgId.slice(0, 8)}-${Date.now().toString(36)}`;

      const [meeting] = await db('meetings')
        .insert({
          organization_id: req.params.orgId,
          title,
          description: description || null,
          location: location || null,
          scheduled_start: scheduledStart,
          scheduled_end: scheduledEnd || null,
          created_by: req.user!.userId,
          ai_enabled: aiEnabled,
          translation_enabled: translationEnabled || false,
          jitsi_room_id: jitsiRoomId,
          recurring_pattern: recurringPattern || 'none',
          recurring_end_date: recurringEndDate || null,
        })
        .returning('*');

      // Create agenda items
      if (agendaItems?.length) {
        await db('agenda_items').insert(
          agendaItems.map((item: any, idx: number) => ({
            meeting_id: meeting.id,
            title: item.title,
            description: item.description || null,
            order: idx + 1,
            duration_minutes: item.durationMinutes || null,
            presenter_user_id: item.presenterUserId || null,
          }))
        );
      }

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'create',
        entityType: 'meeting',
        entityId: meeting.id,
        newValue: { title, scheduledStart },
      });

      // Notify all org members
      const members = await db('memberships')
        .where({ organization_id: req.params.orgId, is_active: true })
        .pluck('user_id');

      const notifications = members.map((userId: string) => ({
        user_id: userId,
        organization_id: req.params.orgId,
        type: 'meeting',
        title: 'New Meeting Scheduled',
        body: `${title} — ${new Date(scheduledStart).toLocaleString()}`,
        data: JSON.stringify({ meetingId: meeting.id }),
      }));
      await db('notifications').insert(notifications);

      // Push notification for new meeting
      sendPushToOrg(req.params.orgId, {
        title: 'New Meeting Scheduled',
        body: `${title} — ${new Date(scheduledStart).toLocaleString()}`,
        data: { meetingId: meeting.id, type: 'meeting' },
      }, req.user!.userId).catch(err => logger.warn('Push notification failed (new meeting)', err));

      res.status(201).json({ success: true, data: meeting });
    } catch (err) {
      logger.error('Create meeting error', err);
      res.status(500).json({ success: false, error: 'Failed to create meeting' });
    }
  }
);

// ── Update Meeting ──────────────────────────────────────────
const updateMeetingSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional().nullable(),
  location: z.string().max(500).optional().nullable(),
  scheduledStart: flexDateTime.optional(),
  scheduledEnd: flexDateTime.optional().nullable(),
  aiEnabled: z.boolean().optional(),
  translationEnabled: z.boolean().optional(),
  recurringPattern: z.enum(['none', 'daily', 'weekly', 'biweekly', 'monthly']).optional(),
  status: z.enum(['scheduled', 'cancelled']).optional(),
  agendaItems: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        durationMinutes: z.number().min(1).optional(),
        presenterUserId: z.string().uuid().optional(),
      })
    )
    .optional(),
});

router.put(
  '/:orgId/:meetingId',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  validate(updateMeetingSchema),
  async (req: Request, res: Response) => {
    try {
      const meeting = await db('meetings')
        .where({ id: req.params.meetingId, organization_id: req.params.orgId })
        .first();
      if (!meeting) {
        res.status(404).json({ success: false, error: 'Meeting not found' });
        return;
      }
      if (meeting.status === 'ended') {
        res.status(400).json({ success: false, error: 'Cannot edit an ended meeting' });
        return;
      }

      const { title, description, location, scheduledStart, scheduledEnd, aiEnabled, translationEnabled, recurringPattern, status, agendaItems } = req.body;

      // If enabling AI, check AI wallet balance
      if (aiEnabled === true && !meeting.ai_enabled) {
        const wallet = await getAiWallet(req.params.orgId);
        const balance = parseFloat(wallet.balance_minutes) || 0;
        if (balance <= 0) {
          res.status(402).json({
            success: false,
            error: 'Insufficient AI wallet balance. Top up your AI hours.',
          });
          return;
        }
      }

      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (location !== undefined) updates.location = location;
      if (scheduledStart !== undefined) updates.scheduled_start = scheduledStart;
      if (scheduledEnd !== undefined) updates.scheduled_end = scheduledEnd;
      if (aiEnabled !== undefined) updates.ai_enabled = aiEnabled;
      if (translationEnabled !== undefined) updates.translation_enabled = translationEnabled;
      if (recurringPattern !== undefined) updates.recurring_pattern = recurringPattern;
      if (status !== undefined) updates.status = status;
      updates.updated_at = db.fn.now();

      const [updated] = await db('meetings')
        .where({ id: req.params.meetingId })
        .update(updates)
        .returning('*');

      // Replace agenda items if provided
      if (agendaItems !== undefined) {
        await db('agenda_items').where({ meeting_id: req.params.meetingId }).del();
        if (agendaItems.length > 0) {
          await db('agenda_items').insert(
            agendaItems.map((item: any, idx: number) => ({
              meeting_id: req.params.meetingId,
              title: item.title,
              description: item.description || null,
              order: idx + 1,
              duration_minutes: item.durationMinutes || null,
              presenter_user_id: item.presenterUserId || null,
            }))
          );
        }
      }

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'update',
        entityType: 'meeting',
        entityId: req.params.meetingId,
        newValue: updates,
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      logger.error('Update meeting error', err);
      res.status(500).json({ success: false, error: 'Failed to update meeting' });
    }
  }
);

// ── Toggle AI on existing meeting ───────────────────────────
router.post(
  '/:orgId/:meetingId/toggle-ai',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  async (req: Request, res: Response) => {
    try {
      const meeting = await db('meetings')
        .where({ id: req.params.meetingId, organization_id: req.params.orgId })
        .first();
      if (!meeting) {
        res.status(404).json({ success: false, error: 'Meeting not found' });
        return;
      }

      const newState = !meeting.ai_enabled;

      // If enabling, check AI wallet balance
      if (newState) {
        const wallet = await getAiWallet(req.params.orgId);
        const balance = parseFloat(wallet.balance_minutes) || 0;
        if (balance <= 0) {
          res.status(402).json({
            success: false,
            error: 'Insufficient AI wallet balance. Top up your AI hours.',
          });
          return;
        }
      }

      await db('meetings')
        .where({ id: req.params.meetingId })
        .update({ ai_enabled: newState });

      res.json({
        success: true,
        data: { aiEnabled: newState },
        message: newState ? 'AI minutes enabled' : 'AI minutes disabled',
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to toggle AI' });
    }
  }
);

// ── List Meetings ───────────────────────────────────────────
router.get(
  '/:orgId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      let query = db('meetings')
        .where({ organization_id: req.params.orgId })
        .select('*');

      if (status) {
        query = query.where({ status });
      }

      const total = await query.clone().clear('select').count('id as count').first();
      const meetings = await query
        .orderBy('scheduled_start', 'desc')
        .offset((page - 1) * limit)
        .limit(limit);

      // Batch: attendance counts for all meetings in one query (GROUP BY)
      let enriched = meetings;
      if (meetings.length) {
        const meetingIds = meetings.map((m: any) => m.id);
        const attendanceCounts = await db('meeting_attendance')
          .whereIn('meeting_id', meetingIds)
          .select('meeting_id')
          .count('id as count')
          .groupBy('meeting_id');

        const attendanceMap: Record<string, number> = {};
        attendanceCounts.forEach((ac: any) => { attendanceMap[ac.meeting_id] = parseInt(ac.count as string) || 0; });

        enriched = meetings.map((m: any) => ({
          ...m,
          attendeeCount: attendanceMap[m.id] || 0,
        }));
      }

      res.json({
        success: true,
        data: enriched,
        meta: { page, limit, total: parseInt(total?.count as string) || 0 },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to list meetings' });
    }
  }
);

// ── Get Meeting Detail ──────────────────────────────────────
router.get(
  '/:orgId/:meetingId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const meeting = await db('meetings')
        .where({ id: req.params.meetingId, organization_id: req.params.orgId })
        .first();
      if (!meeting) {
        res.status(404).json({ success: false, error: 'Meeting not found' });
        return;
      }

      // Get creator info (= default moderator)
      const creator = await db('users')
        .where({ id: meeting.created_by })
        .select('id', 'first_name', 'last_name', 'email')
        .first();

      const agendaItems = await db('agenda_items')
        .where({ meeting_id: meeting.id })
        .orderBy('order');

      const attendance = await db('meeting_attendance')
        .join('users', 'meeting_attendance.user_id', 'users.id')
        .where({ meeting_id: meeting.id })
        .select(
          'meeting_attendance.*',
          'users.first_name',
          'users.last_name',
          'users.email'
        );

      const votes = await db('votes')
        .where({ meeting_id: meeting.id })
        .select('*');

      const minutes = await db('meeting_minutes')
        .where({ meeting_id: meeting.id })
        .first();

      res.json({
        success: true,
        data: {
          ...meeting,
          moderator: creator || null,
          agendaItems,
          attendance,
          votes,
          minutes: minutes || null,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get meeting' });
    }
  }
);

// ── Start Meeting (go LIVE) ─────────────────────────────────
router.post(
  '/:orgId/:meetingId/start',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  async (req: Request, res: Response) => {
    try {
      const meeting = await db('meetings')
        .where({ id: req.params.meetingId, organization_id: req.params.orgId })
        .first();
      if (!meeting) {
        res.status(404).json({ success: false, error: 'Meeting not found' });
        return;
      }
      if (meeting.status !== 'scheduled') {
        res.status(400).json({ success: false, error: 'Meeting can only be started from scheduled state' });
        return;
      }

      await db('meetings')
        .where({ id: req.params.meetingId })
        .update({ status: 'live', actual_start: db.fn.now() });

      // Notify
      const io = req.app.get('io');
      if (io) {
        io.to(`org:${req.params.orgId}`).emit('meeting:started', {
          meetingId: req.params.meetingId,
          title: meeting.title,
        });
      }

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'update',
        entityType: 'meeting',
        entityId: req.params.meetingId,
        newValue: { status: 'live' },
      });

      res.json({ success: true, message: 'Meeting started' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to start meeting' });
    }
  }
);

// ── End Meeting ─────────────────────────────────────────────
router.post(
  '/:orgId/:meetingId/end',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  async (req: Request, res: Response) => {
    try {
      const meeting = await db('meetings')
        .where({ id: req.params.meetingId, organization_id: req.params.orgId })
        .first();
      if (!meeting || meeting.status !== 'live') {
        res.status(400).json({ success: false, error: 'Meeting is not live' });
        return;
      }

      await db('meetings')
        .where({ id: req.params.meetingId })
        .update({ status: 'ended', actual_end: db.fn.now() });

      // If AI enabled, trigger AI minutes generation
      if (meeting.ai_enabled && meeting.audio_storage_url) {
        // The AI service will be triggered asynchronously
        const io = req.app.get('io');
        if (io) {
          io.to(`org:${req.params.orgId}`).emit('meeting:minutes:processing', {
            meetingId: req.params.meetingId,
          });
        }

        // Create pending minutes record
        await db('meeting_minutes').insert({
          meeting_id: req.params.meetingId,
          organization_id: req.params.orgId,
          status: 'processing',
        });

        // Queue AI processing (handled by AI service)
        const aiService = req.app.get('aiService');
        if (aiService) {
          aiService.processMinutes(req.params.meetingId, req.params.orgId).catch((err: any) => {
            logger.error('AI minutes processing failed', err);
          });
        }
      }

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'update',
        entityType: 'meeting',
        entityId: req.params.meetingId,
        newValue: { status: 'ended' },
      });

      res.json({ success: true, message: 'Meeting ended' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to end meeting' });
    }
  }
);

// ── Record Attendance ───────────────────────────────────────
router.post(
  '/:orgId/:meetingId/attendance',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const existing = await db('meeting_attendance')
        .where({ meeting_id: req.params.meetingId, user_id: req.user!.userId })
        .first();

      if (existing) {
        res.json({ success: true, message: 'Already recorded', data: existing });
        return;
      }

      const meeting = await db('meetings')
        .where({ id: req.params.meetingId, organization_id: req.params.orgId })
        .first();

      let status = 'present';
      if (meeting?.actual_start) {
        const startTime = new Date(meeting.actual_start).getTime();
        const now = Date.now();
        if (now - startTime > 15 * 60 * 1000) status = 'late'; // 15 min grace
      }

      const [attendance] = await db('meeting_attendance')
        .insert({
          meeting_id: req.params.meetingId,
          user_id: req.user!.userId,
          status,
          joined_at: db.fn.now(),
        })
        .returning('*');

      res.status(201).json({ success: true, data: attendance });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to record attendance' });
    }
  }
);

// ── Bulk Attendance (Admin) ─────────────────────────────────
router.post(
  '/:orgId/:meetingId/attendance/bulk',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  async (req: Request, res: Response) => {
    try {
      const { attendees } = req.body; // [{ userId, status }]
      if (!Array.isArray(attendees)) {
        res.status(400).json({ success: false, error: 'attendees array required' });
        return;
      }

      const validStatuses = ['present', 'absent', 'late', 'excused'];
      for (const a of attendees) {
        if (!a.userId || typeof a.userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.userId)) {
          res.status(400).json({ success: false, error: 'Invalid userId in attendees' });
          return;
        }
        if (a.status && !validStatuses.includes(a.status)) {
          res.status(400).json({ success: false, error: `Invalid status: ${a.status}` });
          return;
        }
      }

      for (const a of attendees) {
        await db('meeting_attendance')
          .insert({
            meeting_id: req.params.meetingId,
            user_id: a.userId,
            status: a.status || 'present',
            joined_at: db.fn.now(),
          })
          .onConflict(['meeting_id', 'user_id'])
          .merge({ status: a.status || 'present' });
      }

      res.json({ success: true, message: 'Attendance updated' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to update attendance' });
    }
  }
);

// ── Create Vote ─────────────────────────────────────────────
router.post(
  '/:orgId/:meetingId/votes',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  validate(createVoteSchema),
  async (req: Request, res: Response) => {
    try {
      const { title, description, options } = req.body;

      // Verify meeting belongs to this org
      const meeting = await db('meetings')
        .where({ id: req.params.meetingId, organization_id: req.params.orgId })
        .first();
      if (!meeting) {
        return res.status(404).json({ success: false, error: 'Meeting not found' });
      }

      const [vote] = await db('votes')
        .insert({
          meeting_id: req.params.meetingId,
          title,
          description: description || null,
          options,
          status: 'open',
        })
        .returning('*');

      const io = req.app.get('io');
      if (io) {
        io.to(`meeting:${req.params.meetingId}`).emit('vote:created', vote);
      }

      res.status(201).json({ success: true, data: vote });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to create vote' });
    }
  }
);

// ── Cast Vote ───────────────────────────────────────────────
router.post(
  '/:orgId/:meetingId/votes/:voteId/cast',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const vote = await db('votes')
        .join('meetings', 'votes.meeting_id', 'meetings.id')
        .where({ 'votes.id': req.params.voteId, 'meetings.organization_id': req.params.orgId })
        .select('votes.*')
        .first();
      if (!vote || vote.status !== 'open') {
        res.status(400).json({ success: false, error: 'Vote not found or closed' });
        return;
      }

      const { option } = req.body;
      const options = typeof vote.options === 'string' ? JSON.parse(vote.options) : vote.options;
      if (!options.includes(option)) {
        res.status(400).json({ success: false, error: 'Invalid option' });
        return;
      }

      await db('vote_ballots')
        .insert({
          vote_id: req.params.voteId,
          user_id: req.user!.userId,
          selected_option: option,
        })
        .onConflict(['vote_id', 'user_id'])
        .merge({ selected_option: option });

      res.json({ success: true, message: 'Vote cast' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to cast vote' });
    }
  }
);

// ── Close Vote ──────────────────────────────────────────────
router.post(
  '/:orgId/:meetingId/votes/:voteId/close',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  async (req: Request, res: Response) => {
    try {
      await db('votes')
        .where({ id: req.params.voteId })
        .whereIn('meeting_id', db('meetings').where({ organization_id: req.params.orgId }).select('id'))
        .update({ status: 'closed', closed_at: db.fn.now() });

      // Get results
      const ballots = await db('vote_ballots')
        .where({ vote_id: req.params.voteId })
        .select('selected_option', db.raw('count(*) as count'))
        .groupBy('selected_option');

      const io = req.app.get('io');
      if (io) {
        io.to(`meeting:${req.params.meetingId}`).emit('vote:closed', {
          voteId: req.params.voteId,
          results: ballots,
        });
      }

      res.json({ success: true, data: { results: ballots } });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to close vote' });
    }
  }
);

// ── Upload Audio for AI Processing ──────────────────────────
router.post(
  '/:orgId/:meetingId/audio',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  audioUpload.single('audio'),
  async (req: Request, res: Response) => {
    try {
      let audioUrl: string;

      if (req.file) {
        // File uploaded via multipart
        audioUrl = `/uploads/${req.file.filename}`;
      } else if (req.body.audioUrl) {
        // URL passed directly (e.g., GCS URI)
        audioUrl = req.body.audioUrl;
      } else {
        res.status(400).json({ success: false, error: 'Audio file or audioUrl required' });
        return;
      }

      await db('meetings')
        .where({ id: req.params.meetingId })
        .update({ audio_storage_url: audioUrl });

      res.json({ success: true, data: { audioUrl }, message: 'Audio stored' });
    } catch (err) {
      logger.error('Audio upload error', err);
      res.status(500).json({ success: false, error: 'Failed to store audio' });
    }
  }
);

// ── Translation: Get supported languages ────────────────────
router.get(
  '/translation/languages',
  authenticate,
  (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        languages: SUPPORTED_LANGUAGES,
        speechCodes: SPEECH_RECOGNITION_CODES,
      },
    });
  }
);

// ── Translation: Translate a single text (REST fallback) ────
router.post(
  '/translation/translate',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const { text, targetLang, sourceLang, organizationId } = req.body;
      if (!text || !targetLang) {
        return res.status(400).json({ success: false, error: 'text and targetLang are required' });
      }

      // Check translation wallet if org context is provided
      if (organizationId) {
        // Verify user is a member of this org
        const userMembership = await db('memberships')
          .where({ user_id: req.user!.userId, organization_id: organizationId, is_active: true })
          .first();
        if (!userMembership) {
          return res.status(403).json({ success: false, error: 'You are not a member of this organization' });
        }

        const wallet = await db('translation_wallet').where({ organization_id: organizationId }).first();
        if (wallet && parseFloat(wallet.balance_minutes) <= 0) {
          return res.status(402).json({ success: false, error: 'Translation wallet balance is zero. Please contact your administrator.' });
        }
      }

      const result = await translateText(text, targetLang, sourceLang);
      res.json({ success: true, data: result });
    } catch (err: any) {
      logger.error('Translation endpoint error', err);
      res.status(500).json({ success: false, error: 'Translation failed' });
    }
  }
);

export default router;
