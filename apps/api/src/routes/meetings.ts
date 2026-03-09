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
import { authenticate, loadMembership, requireRole, validate } from '../middleware';
import { logger } from '../logger';
import { sendPushToOrg } from '../services/push.service';
import { sendMeetingStartedEmail } from '../services/email.service';
import { config } from '../config';
import { translateText, LANGUAGES, SPEECH_CODES, ALL_LANGUAGES } from '../services/translation.service';
import { getAiWallet, getOrgSubscription } from '../services/subscription.service';
import { generateRoomName, generateLiveKitToken, buildJoinConfig } from '../services/livekit.service';
import { forceDisconnectMeeting } from '../socket';
import { getBotManager } from '../services/bot';
import { withTransaction } from '../utils/transaction';
import { cacheAside, cacheDel } from '../services/cache.service';
import { submitMinutesJob } from '../meeting-pipeline';
import { onMeetingCreated, onMeetingUpdated, onMeetingStarted, onMeetingEnded } from '../services/meeting-queue-integration.service';

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
  meetingType: z.enum(['video', 'audio']).default('video'),
  aiEnabled: z.boolean().default(false),
  translationEnabled: z.boolean().default(false),
  recurringPattern: z.enum(['none', 'daily', 'weekly', 'biweekly', 'monthly']).default('none'),
  recurringEndDate: flexDateTime.optional(),
  maxParticipants: z.number().int().min(0).max(1000).default(0),
  durationLimitMinutes: z.number().int().min(0).max(1440).default(0),
  lobbyEnabled: z.boolean().default(false),
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
      const { title, description, location, scheduledStart, scheduledEnd, meetingType, aiEnabled, translationEnabled, agendaItems, recurringPattern, recurringEndDate, maxParticipants, durationLimitMinutes, lobbyEnabled } = req.body;

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

      // Insert meeting + agenda in a single DB transaction for atomicity
      // Detect column name: migration 024 renames jitsi_room_id → room_id
      const hasRoomId = await db.schema.hasColumn('meetings', 'room_id');
      const roomCol = hasRoomId ? 'room_id' : 'jitsi_room_id';

      const meeting = await withTransaction(async (trx) => {
        const meetingInsert: Record<string, any> = {
          organization_id: req.params.orgId,
          title,
          description: description || null,
          location: location || null,
          scheduled_start: scheduledStart,
          scheduled_end: scheduledEnd || null,
          created_by: req.user!.userId,
          ai_enabled: aiEnabled,
          [roomCol]: 'pending', // placeholder, updated below
        };
        // Columns from migration 003
        meetingInsert.recurring_pattern = recurringPattern || 'none';
        meetingInsert.recurring_end_date = recurringEndDate || null;
        // Columns from migration 005
        meetingInsert.translation_enabled = translationEnabled || false;
        // Columns from migration 020 (may not exist on older DBs)
        try {
          const hasMeetingType = await db.schema.hasColumn('meetings', 'meeting_type');
          if (hasMeetingType) {
            meetingInsert.meeting_type = meetingType || 'video';
            meetingInsert.max_participants = maxParticipants || 0;
            meetingInsert.duration_limit_minutes = durationLimitMinutes || 0;
            meetingInsert.lobby_enabled = lobbyEnabled || false;
          }
        } catch { /* schema check failed — skip optional columns */ }

        const [inserted] = await trx('meetings')
          .insert(meetingInsert)
          .returning('*');

        // Generate tenant-isolated room name: org_<orgId>_meeting_<meetingId>
        const roomId = generateRoomName(req.params.orgId, inserted.id);
        await trx('meetings').where({ id: inserted.id }).update({ [roomCol]: roomId });
        inserted.room_id = roomId;
        inserted.jitsi_room_id = roomId; // back-compat until migration 024 runs

        // Create agenda items inside the same transaction
        if (agendaItems?.length) {
          await trx('agenda_items').insert(
            agendaItems.map((item: any, idx: number) => ({
              meeting_id: inserted.id,
              title: item.title,
              description: item.description || null,
              order: idx + 1,
              duration_minutes: item.durationMinutes || null,
              presenter_user_id: item.presenterUserId || null,
            }))
          );
        }

        return inserted;
      });

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'create',
        entityType: 'meeting',
        entityId: meeting.id,
        newValue: { title, scheduledStart },
      });

      // Invalidate meeting list cache for this org
      await cacheDel(`meetings:list:${req.params.orgId}:*`).catch(() => {});

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

      // Emit real-time socket event so meeting lists refresh
      const io = req.app.get('io');
      if (io) {
        io.to(`org:${req.params.orgId}`).emit('meeting:scheduled', meeting);
      }

      // Trigger async queue jobs for meeting setup (best-effort)
      onMeetingCreated(meeting.id, req.params.orgId, meeting)
        .catch(err => logger.warn('Meeting queue integration failed', err));

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
  meetingType: z.enum(['video', 'audio']).optional(),
  aiEnabled: z.boolean().optional(),
  translationEnabled: z.boolean().optional(),
  recurringPattern: z.enum(['none', 'daily', 'weekly', 'biweekly', 'monthly']).optional(),
  status: z.enum(['scheduled', 'cancelled']).optional(),
  maxParticipants: z.number().int().min(0).max(1000).optional(),
  durationLimitMinutes: z.number().int().min(0).max(1440).optional(),
  lobbyEnabled: z.boolean().optional(),
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

      const { title, description, location, scheduledStart, scheduledEnd, meetingType, aiEnabled, translationEnabled, recurringPattern, status, maxParticipants, durationLimitMinutes, lobbyEnabled, agendaItems } = req.body;

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
      if (meetingType !== undefined) updates.meeting_type = meetingType;
      if (maxParticipants !== undefined) updates.max_participants = maxParticipants;
      if (durationLimitMinutes !== undefined) updates.duration_limit_minutes = durationLimitMinutes;
      if (lobbyEnabled !== undefined) updates.lobby_enabled = lobbyEnabled;
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

      // Trigger async queue jobs for meeting update (best-effort)
      onMeetingUpdated(req.params.meetingId, req.params.orgId, meeting, updated)
        .catch(err => logger.warn('Meeting queue integration failed', err));

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

      const statusKey = status || 'all';
      const cacheKey = `meetings:list:${req.params.orgId}:${statusKey}:p${page}:l${limit}`;
      const result = await cacheAside(cacheKey, 15, async () => {
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
        return { data: enriched, meta: { page, limit, total: parseInt(total?.count as string) || 0 } };
      });

      res.json({
        success: true,
        ...result,
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

// ── Join Meeting (LiveKit Token Generation) ─────────────────
// Returns a short-lived LiveKit access token + connection config.
// No external login required — fully backend-controlled.
//
// Security checks performed:
//   1. User is authenticated
//   2. User belongs to the organization
//   3. Organization subscription is active (or in grace period)
//   4. Meeting exists and belongs to the organization
//   5. Meeting is in 'live' status
//   6. Max participants not exceeded
//   7. Meeting duration limit not exceeded
//
// Creator gets moderator=true, others get moderator=false.
// Org admins also receive moderator=true (fallback when creator leaves).

router.post(
  '/:orgId/:meetingId/join',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const { orgId, meetingId } = req.params;
      const userId = req.user!.userId;
      const joinType = (req.body?.joinType === 'audio' ? 'audio' : undefined); // override per-request

      // 1. Meeting must exist and belong to org
      const meeting = await db('meetings')
        .where({ id: meetingId, organization_id: orgId })
        .first();
      if (!meeting) {
        res.status(404).json({ success: false, error: 'Meeting not found' });
        return;
      }

      // 2. Meeting must be live
      if (meeting.status !== 'live') {
        res.status(400).json({ success: false, error: 'Meeting is not live. Cannot join.' });
        return;
      }

      // 3. Check subscription validity
      try {
        const sub = await getOrgSubscription(orgId);
        if (sub && sub.status !== 'active' && sub.status !== 'grace') {
          res.status(403).json({ success: false, error: 'Organization subscription is not active.' });
          return;
        }
      } catch {
        // If no subscription system or free tier, allow join
      }

      // 4. Check max participants (defensive — table may not exist if migration 020 not run)
      if (meeting.max_participants > 0) {
        try {
          const hasTable = await db.schema.hasTable('meeting_join_logs');
          if (hasTable) {
            const currentCount = await db('meeting_join_logs')
              .where({ meeting_id: meetingId })
              .whereNull('left_at')
              .count('id as count')
              .first();
            const count = parseInt(currentCount?.count as string) || 0;
            if (count >= meeting.max_participants) {
              res.status(403).json({ success: false, error: `Meeting has reached the maximum of ${meeting.max_participants} participants.` });
              return;
            }
          }
        } catch (e) {
          logger.warn('meeting_join_logs check skipped (table may not exist)', e);
        }
      }

      // 5. Check meeting duration limit
      if (meeting.duration_limit_minutes > 0 && meeting.actual_start) {
        const startTime = new Date(meeting.actual_start).getTime();
        const elapsed = (Date.now() - startTime) / (1000 * 60);
        if (elapsed >= meeting.duration_limit_minutes) {
          res.status(403).json({ success: false, error: 'Meeting has exceeded its duration limit.' });
          return;
        }
      }

      // 6. Get user info for JWT context
      const user = await db('users')
        .where({ id: userId })
        .select('id', 'first_name', 'last_name', 'email', 'avatar_url')
        .first();
      if (!user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      // 7. Get org info for branding
      const org = await db('organizations')
        .where({ id: orgId })
        .select('name')
        .first();

      // 8. Determine moderator status
      //    - Meeting creator = always moderator
      //    - Org admins/executives = moderator (fallback when creator leaves)
      const membership = await db('memberships')
        .where({ user_id: userId, organization_id: orgId, is_active: true })
        .select('role')
        .first();
      const isCreator = meeting.created_by === userId;
      const isOrgAdmin = membership && ['org_admin', 'executive'].includes(membership.role);
      const isModerator = isCreator || !!isOrgAdmin;

      // 9. Determine meeting type (allow per-request override to 'audio')
      const meetingType = joinType === 'audio' ? 'audio' : (meeting.meeting_type || 'video');

      // 10. Generate room name (deterministic, tenant-isolated)
      const roomName = meeting.room_id || meeting.jitsi_room_id || generateRoomName(orgId, meetingId);

      // 11. Generate LiveKit access token (REQUIRED — no public fallback)
      //     Every participant receives a backend-issued token.
      //     No external login is required.
      if (!config.livekit.apiKey || !config.livekit.apiSecret) {
        logger.error('LIVEKIT_API_KEY / LIVEKIT_API_SECRET not configured — cannot issue meeting tokens');
        res.status(503).json({
          success: false,
          error: 'Meeting service is not configured. Please contact your administrator.',
        });
        return;
      }

      const token = generateLiveKitToken({
        room: roomName,
        moderator: isModerator,
        user: {
          id: user.id,
          name: `${user.first_name} ${user.last_name}`.trim(),
          email: user.email,
          avatar: user.avatar_url || undefined,
        },
        meetingType,
        features: {
          recording: isModerator,
          transcription: meeting.ai_enabled || false,
        },
      });

      const joinConfig = buildJoinConfig({
        meetingType,
        roomName,
        token,
        userName: `${user.first_name} ${user.last_name}`.trim(),
        userEmail: user.email,
        isModerator,
      });

      // 12. Log join event (defensive — table may not exist if migration 020 not run)
      try {
        const hasJoinLogs = await db.schema.hasTable('meeting_join_logs');
        if (hasJoinLogs) {
          await db('meeting_join_logs').insert({
            meeting_id: meetingId,
            user_id: userId,
            organization_id: orgId,
            join_type: meetingType,
            is_moderator: isModerator,
            ip_address: req.ip || null,
            user_agent: (req.headers['user-agent'] || '').slice(0, 500) || null,
          });
        }
      } catch (e) {
        logger.warn('meeting_join_logs insert skipped', e);
      }

      // 13. Auto-record attendance on join
      await db('meeting_attendance')
        .insert({
          meeting_id: meetingId,
          user_id: userId,
          status: 'present',
          joined_at: db.fn.now(),
        })
        .onConflict(['meeting_id', 'user_id'])
        .ignore();

      // 14. Emit participant joined event
      const io = req.app.get('io');
      if (io) {
        io.to(`meeting:${meetingId}`).emit('meeting:participant-joined', {
          userId,
          name: `${user.first_name} ${user.last_name}`.trim(),
          isModerator,
          meetingType,
        });
      }

      logger.info(`User ${userId} joined meeting ${meetingId} as ${meetingType} (moderator=${isModerator})`);

      res.json({
        success: true,
        data: {
          ...joinConfig,
          meetingType,
          isModerator,
          meetingTitle: meeting.title,
          meetingStatus: meeting.status,
        },
      });
    } catch (err) {
      logger.error('Join meeting error', err);
      res.status(500).json({ success: false, error: 'Failed to join meeting' });
    }
  }
);

// ── Leave Meeting (update join log) ─────────────────────────
router.post(
  '/:orgId/:meetingId/leave',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    const { meetingId } = req.params;
    const userId = req.user!.userId;
    try {
      // Update the most recent join log entry without a left_at
      const logUpdateResult = await db('meeting_join_logs')
        .where({ meeting_id: meetingId, user_id: userId })
        .whereNull('left_at')
        .orderBy('joined_at', 'desc')
        .limit(1)
        .update({ left_at: db.fn.now() });

      if (logUpdateResult === 0) {
        logger.warn(
          `No active join log found for user ${userId} in meeting ${meetingId} to mark as left.`
        );
      }

      // Update attendance left_at
      const attendanceUpdateResult = await db('meeting_attendance')
        .where({ meeting_id: meetingId, user_id: userId })
        .whereNull('left_at')
        .update({ left_at: db.fn.now() });

      if (attendanceUpdateResult === 0) {
        logger.warn(
          `No active attendance record found for user ${userId} in meeting ${meetingId} to mark as left.`
        );
      }

      // Emit participant left event
      const io = req.app.get('io');
      const user = await db('users')
        .where({ id: userId })
        .select('id', 'full_name', 'avatar_url')
        .first();
      if (user) {
        io.to(`meeting:${meetingId}`).emit('participant:left', {
          meetingId,
          user,
        });
      }

      res.json({ success: true });
    } catch (err) {
      logger.error(`Failed to process leave for user ${userId} in meeting ${meetingId}`, err);
      res.status(500).json({ success: false, error: 'Failed to leave meeting' });
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

      // Broadcast meeting:ended to org room AND meeting room
      const io = req.app.get('io');
      if (io) {
        const endPayload = {
          meetingId: req.params.meetingId,
          title: meeting.title,
          status: 'ended',
        };
        io.to(`org:${req.params.orgId}`).emit('meeting:ended', endPayload);
        io.to(`meeting:${req.params.meetingId}`).emit('meeting:ended', endPayload);

        // NOTE: Do NOT force-disconnect sockets immediately.
        // Clients need to remain in the meeting room to receive
        // meeting:minutes:processing / meeting:minutes:ready / meeting:minutes:failed events.
        // GPT-4o summarization can take 10-30 seconds, so allow 60s before disconnect.
        // (Clients also receive events via org room, so this is a best-effort grace period.)
        setTimeout(() => {
          forceDisconnectMeeting(io, req.params.meetingId).catch((err) =>
            logger.warn('Force disconnect failed', err)
          );
        }, 60_000); // 60 seconds grace period — GPT-4o needs time
      }

      // ── Respond immediately so the client UI updates fast ──
      res.json({ success: true, message: 'Meeting ended' });

      // ── Everything below runs AFTER the response is sent ──
      // (best-effort: bot stop, transcript check, AI minutes, audit)

      // Stop transcription bot (best-effort)
      try {
        const botManager = getBotManager();
        const bot = botManager.getBot(req.params.meetingId);
        const sessionCount = bot?.activeSessionCount || 0;
        logger.info(`[MEETING_END] Stopping transcription bot: meeting=${req.params.meetingId}, activeSessions=${sessionCount}`);
        botManager.stopMeetingBot(req.params.meetingId).catch((err) =>
          logger.warn('[MEETING_END] Transcription bot failed to stop', { meetingId: req.params.meetingId, error: err.message })
        );
      } catch (_) { /* BotManager not initialized */ }

      // Trigger async queue jobs for meeting end (best-effort)
      // This handles:
      // - Broadcast end notification to org
      // - Create/update minutes record
      // - Queue AI minutes job
      // - Finalize translation pipeline
      onMeetingEnded(req.params.meetingId, req.params.orgId, meeting)
        .catch(err => logger.warn('Meeting queue integration failed', err));

      (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'update',
        entityType: 'meeting',
        entityId: req.params.meetingId,
        newValue: { status: 'ended' },
      }).catch(() => {});
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

      const attendanceRows = attendees.map((a: { userId: string; status?: string }) => ({
        meeting_id: req.params.meetingId,
        user_id: a.userId,
        status: a.status || 'present',
        joined_at: db.fn.now(),
      }));
      await db('meeting_attendance')
        .insert(attendanceRows)
        .onConflict(['meeting_id', 'user_id'])
        .merge(['status']);

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
        languages: LANGUAGES,
        speechCodes: SPEECH_CODES,
        allLanguages: ALL_LANGUAGES,
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

        const wallet = await db('wallet')
          .where({ organization_id: organizationId, service_type: 'translation' })
          .first();
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

// ── Get Meeting Transcripts ─────────────────────────────────
// Returns persisted live translation transcripts for a meeting.
// Supports pagination with ?limit=50&offset=0
router.get(
  '/:orgId/:meetingId/transcripts',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const { orgId, meetingId } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 500); // Cap at 500 per request
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

      // Verify meeting belongs to org
      const meeting = await db('meetings')
        .where({ id: meetingId, organization_id: orgId })
        .first();
      if (!meeting) {
        res.status(404).json({ success: false, error: 'Meeting not found' });
        return;
      }

      // Check if meeting_transcripts table exists
      const hasTable = await db.schema.hasTable('meeting_transcripts');
      if (!hasTable) {
        res.json({ 
          success: true, 
          data: [],
          limit,
          offset,
          total: 0
        });
        return;
      }

      // Get total count (cached result, not repeated per query)
      const countResult = await db('meeting_transcripts')
        .where({ meeting_id: meetingId, organization_id: orgId })
        .count('* as count')
        .first();
      const total = countResult?.count || 0;

      // Fetch paginated transcripts
      const transcripts = await db('meeting_transcripts')
        .where({ meeting_id: meetingId, organization_id: orgId })
        .orderBy('spoken_at', 'asc')
        .limit(limit)
        .offset(offset)
        .select('*');

      res.json({ 
        success: true, 
        data: transcripts,
        limit,
        offset,
        total
      });
    } catch (err) {
      logger.error('Get transcripts error', err);
      res.status(500).json({ success: false, error: 'Failed to get transcripts' });
    }
  }
);

// ── Get Meeting Chat Messages ───────────────────────────────
// Returns persisted in-meeting chat messages.
router.get(
  '/:orgId/:meetingId/chat',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const { orgId, meetingId } = req.params;

      const meeting = await db('meetings')
        .where({ id: meetingId, organization_id: orgId })
        .first();
      if (!meeting) {
        res.status(404).json({ success: false, error: 'Meeting not found' });
        return;
      }

      const hasTable = await db.schema.hasTable('meeting_messages');
      if (!hasTable) {
        res.json({ success: true, data: [] });
        return;
      }

      const messages = await db('meeting_messages')
        .where({ meeting_id: meetingId })
        .orderBy('created_at', 'asc')
        .limit(500)
        .select('id', 'meeting_id', 'sender_id', 'sender_name', 'message', 'created_at');

      res.json({ success: true, data: messages });
    } catch (err) {
      logger.error('Get chat messages error', err);
      res.status(500).json({ success: false, error: 'Failed to get chat messages' });
    }
  }
);

// ── Get Meeting Minutes ─────────────────────────────────────
router.get(
  '/:orgId/:meetingId/minutes',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const { orgId, meetingId } = req.params;

      const meeting = await db('meetings')
        .where({ id: meetingId, organization_id: orgId })
        .first();
      if (!meeting) {
        res.status(404).json({ success: false, error: 'Meeting not found' });
        return;
      }

      const minutes = await db('meeting_minutes')
        .where({ meeting_id: meetingId })
        .first();

      if (!minutes) {
        res.status(404).json({ success: false, error: 'Minutes not generated yet' });
        return;
      }

      // Parse JSON fields
      const parsed = {
        ...minutes,
        transcript: typeof minutes.transcript === 'string' ? JSON.parse(minutes.transcript) : minutes.transcript,
        decisions: typeof minutes.decisions === 'string' ? JSON.parse(minutes.decisions) : minutes.decisions,
        motions: typeof minutes.motions === 'string' ? JSON.parse(minutes.motions) : minutes.motions,
        action_items: typeof minutes.action_items === 'string' ? JSON.parse(minutes.action_items) : minutes.action_items,
        contributions: typeof minutes.contributions === 'string' ? JSON.parse(minutes.contributions) : minutes.contributions,
        download_formats: typeof minutes.download_formats === 'string' ? JSON.parse(minutes.download_formats) : (minutes.download_formats || {}),
      };

      res.json({ success: true, data: parsed });
    } catch (err) {
      logger.error('Get minutes error', err);
      res.status(500).json({ success: false, error: 'Failed to get minutes' });
    }
  }
);

// ── Download Meeting Minutes as Text ────────────────────────
router.get(
  '/:orgId/:meetingId/minutes/download',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const { orgId, meetingId } = req.params;
      const format = (req.query.format as string) || 'txt';

      const meeting = await db('meetings')
        .where({ id: meetingId, organization_id: orgId })
        .first();
      if (!meeting) {
        res.status(404).json({ success: false, error: 'Meeting not found' });
        return;
      }

      const minutes = await db('meeting_minutes')
        .where({ meeting_id: meetingId })
        .first();
      if (!minutes || minutes.status !== 'completed') {
        res.status(404).json({ success: false, error: 'Completed minutes not available' });
        return;
      }

      // Parse fields
      const summary = minutes.summary || '';
      const decisions = typeof minutes.decisions === 'string' ? JSON.parse(minutes.decisions) : (minutes.decisions || []);
      const motions = typeof minutes.motions === 'string' ? JSON.parse(minutes.motions) : (minutes.motions || []);
      const actionItems = typeof minutes.action_items === 'string' ? JSON.parse(minutes.action_items) : (minutes.action_items || []);
      const contributions = typeof minutes.contributions === 'string' ? JSON.parse(minutes.contributions) : (minutes.contributions || []);

      // Get org name
      const org = await db('organizations').where({ id: orgId }).select('name').first();
      const orgName = org?.name || 'Organization';

      // Build text document
      const lines: string[] = [];
      lines.push('═'.repeat(60));
      lines.push(`MEETING MINUTES — ${meeting.title}`);
      lines.push('═'.repeat(60));
      lines.push('');
      lines.push(`Organization: ${orgName}`);
      lines.push(`Date: ${new Date(meeting.scheduled_start).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`);
      lines.push(`Time: ${new Date(meeting.scheduled_start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`);
      if (meeting.actual_start) lines.push(`Started: ${new Date(meeting.actual_start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`);
      if (meeting.actual_end) lines.push(`Ended: ${new Date(meeting.actual_end).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`);
      lines.push(`Type: ${meeting.meeting_type || 'video'}`);
      lines.push('');

      if (summary) {
        lines.push('── EXECUTIVE SUMMARY ──────────────────────────────────');
        lines.push('');
        lines.push(summary);
        lines.push('');
      }

      if (decisions.length > 0) {
        lines.push('── KEY DECISIONS ──────────────────────────────────────');
        lines.push('');
        decisions.forEach((d: string, i: number) => {
          lines.push(`  ${i + 1}. ${d}`);
        });
        lines.push('');
      }

      if (motions.length > 0) {
        lines.push('── MOTIONS ────────────────────────────────────────────');
        lines.push('');
        motions.forEach((m: any, i: number) => {
          const mText = typeof m === 'string' ? m : `${m.text}${m.movedBy ? ` (Moved by: ${m.movedBy})` : ''}${m.result ? ` — ${m.result}` : ''}`;
          lines.push(`  ${i + 1}. ${mText}`);
        });
        lines.push('');
      }

      if (actionItems.length > 0) {
        lines.push('── ACTION ITEMS ───────────────────────────────────────');
        lines.push('');
        actionItems.forEach((a: any, i: number) => {
          const aText = typeof a === 'string' ? a : `${a.description || a.task}${a.assigneeName || a.assignee ? ` → ${a.assigneeName || a.assignee}` : ''}${a.dueDate ? ` (Due: ${a.dueDate})` : ''}`;
          lines.push(`  ${i + 1}. ${aText}`);
        });
        lines.push('');
      }

      if (contributions.length > 0) {
        lines.push('── PARTICIPANT CONTRIBUTIONS ──────────────────────────');
        lines.push('');
        contributions.forEach((c: any) => {
          lines.push(`  ${c.userName}:`);
          if (c.speakingTimeSeconds) lines.push(`    Speaking time: ${Math.floor(c.speakingTimeSeconds / 60)} min ${c.speakingTimeSeconds % 60} sec`);
          if (c.keyPoints?.length) {
            c.keyPoints.forEach((kp: string) => lines.push(`    • ${kp}`));
          }
        });
        lines.push('');
      }

      // Get live transcripts if available
      const hasTranscriptTable = await db.schema.hasTable('meeting_transcripts');
      if (hasTranscriptTable) {
        const liveTranscripts = await db('meeting_transcripts')
          .where({ meeting_id: meetingId })
          .orderBy('spoken_at', 'asc')
          .select('speaker_name', 'original_text', 'source_lang', 'spoken_at');

        if (liveTranscripts.length > 0) {
          lines.push('── FULL TRANSCRIPT ────────────────────────────────────');
          lines.push('');
          liveTranscripts.forEach((t: any) => {
            const time = new Date(parseInt(t.spoken_at)).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            lines.push(`  [${time}] ${t.speaker_name}: ${t.original_text}`);
          });
          lines.push('');
        }
      }

      lines.push('═'.repeat(60));
      lines.push(`Generated by OrgsLedger AI — ${new Date().toISOString()}`);
      lines.push('═'.repeat(60));

      const content = lines.join('\n');

      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${meeting.title.replace(/[^a-zA-Z0-9 ]/g, '')}_minutes.json"`);
        res.json({
          meeting: {
            title: meeting.title,
            date: meeting.scheduled_start,
            startedAt: meeting.actual_start,
            endedAt: meeting.actual_end,
            type: meeting.meeting_type,
          },
          summary,
          decisions,
          motions,
          actionItems,
          contributions,
          generatedAt: minutes.generated_at,
        });
      } else {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${meeting.title.replace(/[^a-zA-Z0-9 ]/g, '')}_minutes.txt"`);
        res.send(content);
      }
    } catch (err) {
      logger.error('Download minutes error', err);
      res.status(500).json({ success: false, error: 'Failed to download minutes' });
    }
  }
);

// ── Generate Minutes from Live Transcripts ──────────────────
// Allows manual triggering of AI minutes from persisted transcripts
// (alternative to uploading audio file)
router.post(
  '/:orgId/:meetingId/generate-minutes',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  async (req: Request, res: Response) => {
    try {
      const { orgId, meetingId } = req.params;

      const meeting = await db('meetings')
        .where({ id: meetingId, organization_id: orgId })
        .first();
      if (!meeting) {
        res.status(404).json({ success: false, error: 'Meeting not found' });
        return;
      }

      // Check if minutes already exist and are completed
      const existing = await db('meeting_minutes').where({ meeting_id: meetingId }).first();
      if (existing?.status === 'completed') {
        res.status(400).json({ success: false, error: 'Minutes have already been generated' });
        return;
      }

      // Verify that transcripts or audio actually exist before triggering
      const hasAudio = !!meeting.audio_storage_url;
      let hasTranscripts = false;
      try {
        const transcriptCount = await db('meeting_transcripts')
          .where({ meeting_id: meetingId })
          .count('id as count')
          .first();
        hasTranscripts = parseInt(transcriptCount?.count as string) > 0;
      } catch {
        // Table may not exist
      }
      if (!hasAudio && !hasTranscripts) {
        res.status(400).json({ success: false, error: 'No audio recording or transcripts available for this meeting' });
        return;
      }

      // Check AI wallet
      const wallet = await getAiWallet(orgId);
      const balance = parseFloat(wallet.balance_minutes) || 0;
      if (balance <= 0) {
        res.status(402).json({ success: false, error: 'Insufficient AI wallet balance' });
        return;
      }

      // Create or update minutes record
      if (existing) {
        await db('meeting_minutes').where({ meeting_id: meetingId }).update({ status: 'processing', error_message: null });
      } else {
        await db('meeting_minutes').insert({
          meeting_id: meetingId,
          organization_id: orgId,
          status: 'processing',
        });
      }

      // Emit processing event
      const io = req.app.get('io');
      if (io) {
        io.to(`org:${orgId}`).emit('meeting:minutes:processing', { meetingId });
      }

      // Queue AI processing via minutes worker
      try {
        logger.info('[MINUTES] Submitting minutes job to queue', { meetingId, orgId });
        await submitMinutesJob({
          meetingId,
          organizationId: orgId,
        });
      } catch (err: any) {
        logger.error('[MINUTES] Failed to submit job to queue', {
          meetingId,
          error: err.message,
        });
      }

      res.json({ success: true, message: 'Minutes generation started' });
    } catch (err) {
      logger.error('Generate minutes error', err);
      res.status(500).json({ success: false, error: 'Failed to start minutes generation' });
    }
  }
);

// ── Sign Meeting Minutes (Professional+ only) ───────────────
const signMinutesSchema = z.object({
  signatureData: z.string().optional(), // base64 encoded signature
  metadata: z.record(z.any()).optional(),
});

router.post(
  '/:orgId/:meetingId/minutes/sign',
  authenticate,
  loadMembership,
  validate(signMinutesSchema),
  async (req: Request, res: Response) => {
    try {
      const { orgId, meetingId } = req.params;
      const { signatureData, metadata } = req.body;

      // Import plan check function
      const { supportsDigitalSignatures, getLatestPlanSlugForOrg } = await import('../services/subscription.service');
      const planSlug = await getLatestPlanSlugForOrg(orgId);
      
      if (!supportsDigitalSignatures(planSlug)) {
        res.status(403).json({
          success: false,
          error: 'Digital signatures require Professional plan or higher',
        });
        return;
      }

      // Verify meeting exists and belongs to org
      const meeting = await db('meetings')
        .where({ id: meetingId, organization_id: orgId })
        .first();
      if (!meeting) {
        res.status(404).json({ success: false, error: 'Meeting not found' });
        return;
      }

      // Verify minutes exist
      const minutes = await db('meeting_minutes')
        .where({ meeting_id: meetingId, status: 'completed' })
        .first();
      if (!minutes) {
        res.status(400).json({ success: false, error: 'Meeting minutes must be completed before signing' });
        return;
      }

      // Get user full name from database
      const user = req.user!;
      const userRecord = await db('users').where({ id: user.userId }).select('first_name', 'last_name').first();
      const fullName = (userRecord?.first_name && userRecord?.last_name)
        ? `${userRecord.first_name} ${userRecord.last_name}`
        : user.email;

      const signatureHash = crypto
        .createHash('sha256')
        .update(`${meetingId}${user.userId}${Date.now()}${signatureData || ''}`)
        .digest('hex');

      // Insert signature (upsert - one signature per user per meeting)
      const [signature] = await db('meeting_signatures')
        .insert({
          meeting_id: meetingId,
          organization_id: orgId,
          signed_by_user_id: user.userId,
          signed_by_name: fullName,
          signed_by_email: user.email,
          signature_hash: signatureHash,
          signature_data: signatureData || null,
          metadata: metadata ? JSON.stringify(metadata) : null,
          signed_at: db.fn.now(),
        })
        .onConflict(['meeting_id', 'signed_by_user_id'])
        .merge(['signature_hash', 'signature_data', 'metadata', 'signed_at'])
        .returning('*');

      // Update signature_count on meeting_minutes
      const sigCount = await db('meeting_signatures')
        .where({ meeting_id: meetingId })
        .count('id as count')
        .first();
      
      await db('meeting_minutes')
        .where({ meeting_id: meetingId })
        .update({ signature_count: sigCount?.count || 0 });

      // Audit log
      await (req as any).audit?.({
        organizationId: orgId,
        action: 'create',
        entityType: 'meeting_signature',
        entityId: signature.id,
        newValue: { signedBy: user.email, signedAt: new Date() },
      }).catch(() => {});

      res.status(201).json({ success: true, data: signature });
    } catch (err) {
      logger.error('Sign minutes error', err);
      res.status(500).json({ success: false, error: 'Failed to sign minutes' });
    }
  }
);

// ── Get Meeting Signatures ──────────────────────────────────
router.get(
  '/:orgId/:meetingId/minutes/signatures',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const { orgId, meetingId } = req.params;

      // Verify meeting exists
      const meeting = await db('meetings')
        .where({ id: meetingId, organization_id: orgId })
        .first();
      if (!meeting) {
        res.status(404).json({ success: false, error: 'Meeting not found' });
        return;
      }

      const signatures = await db('meeting_signatures')
        .where({ meeting_id: meetingId })
        .orderBy('signed_at', 'desc')
        .select(
          'id',
          'signed_by_user_id',
          'signed_by_name',
          'signed_by_email',
          'signed_at',
          'created_at'
        );

      res.json({ success: true, data: signatures });
    } catch (err) {
      logger.error('Get signatures error', err);
      res.status(500).json({ success: false, error: 'Failed to get signatures' });
    }
  }
);

// ── Remove Meeting Signature (by signer or admin) ──────────
router.delete(
  '/:orgId/:meetingId/minutes/signatures/:signatureId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const { orgId, meetingId, signatureId } = req.params;
      const user = req.user!;

      // Get the signature
      const signature = await db('meeting_signatures')
        .where({ id: signatureId, meeting_id: meetingId, organization_id: orgId })
        .first();
      if (!signature) {
        res.status(404).json({ success: false, error: 'Signature not found' });
        return;
      }

      // Only allow the signer or admin to remove
      const isAdmin = (req as any).membership?.role === 'org_admin';
      const isSigner = signature.signed_by_user_id === user.userId;
      
      if (!isAdmin && !isSigner) {
        res.status(403).json({ success: false, error: 'Only the signer or admin can remove a signature' });
        return;
      }

      // Delete signature
      await db('meeting_signatures').where({ id: signatureId }).delete();

      // Update signature_count
      const sigCount = await db('meeting_signatures')
        .where({ meeting_id: meetingId })
        .count('id as count')
        .first();
      
      await db('meeting_minutes')
        .where({ meeting_id: meetingId })
        .update({ signature_count: sigCount?.count || 0 });

      // Audit log
      await (req as any).audit?.({
        organizationId: orgId,
        action: 'delete',
        entityType: 'meeting_signature',
        entityId: signatureId,
        newValue: { removedBy: user.email },
      }).catch(() => {});

      res.json({ success: true, message: 'Signature removed' });
    } catch (err) {
      logger.error('Remove signature error', err);
      res.status(500).json({ success: false, error: 'Failed to remove signature' });
    }
  }
);

export default router;
