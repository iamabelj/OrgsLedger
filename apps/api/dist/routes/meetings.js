"use strict";
// ============================================================
// OrgsLedger API — Meetings Routes
// Scheduling, Live Meetings, Attendance, Agenda, Voting
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const db_1 = __importDefault(require("../db"));
const middleware_1 = require("../middleware");
const logger_1 = require("../logger");
const push_service_1 = require("../services/push.service");
const config_1 = require("../config");
const translation_service_1 = require("../services/translation.service");
const subscription_service_1 = require("../services/subscription.service");
const router = (0, express_1.Router)();
// ── Multer for audio uploads ────────────────────────────────
const audioStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, config_1.config.upload.dir),
    filename: (_req, file, cb) => {
        const unique = crypto_1.default.randomBytes(12).toString('hex');
        const ext = path_1.default.extname(file.originalname) || '.m4a';
        cb(null, `audio_${unique}${ext}`);
    },
});
const audioUpload = (0, multer_1.default)({
    storage: audioStorage,
    limits: { fileSize: 200 * 1024 * 1024 }, // 200MB max for long meetings
    fileFilter: (_req, file, cb) => {
        const allowed = /m4a|mp3|wav|ogg|webm|aac|mp4|flac/;
        const ext = path_1.default.extname(file.originalname).toLowerCase().replace('.', '');
        cb(null, allowed.test(ext));
    },
});
// ── Schemas ─────────────────────────────────────────────────
// Helper: accept ISO datetime OR date-only strings
const flexDateTime = zod_1.z.string().refine((s) => !isNaN(new Date(s).getTime()), { message: 'Invalid date/time string' });
const createMeetingSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(300),
    description: zod_1.z.string().max(5000).optional(),
    location: zod_1.z.string().max(500).optional(),
    scheduledStart: flexDateTime,
    scheduledEnd: flexDateTime.optional(),
    aiEnabled: zod_1.z.boolean().default(false),
    translationEnabled: zod_1.z.boolean().default(false),
    recurringPattern: zod_1.z.enum(['none', 'daily', 'weekly', 'biweekly', 'monthly']).default('none'),
    recurringEndDate: flexDateTime.optional(),
    agendaItems: zod_1.z
        .array(zod_1.z.object({
        title: zod_1.z.string().min(1),
        description: zod_1.z.string().optional(),
        durationMinutes: zod_1.z.number().min(1).optional(),
        presenterUserId: zod_1.z.string().uuid().optional(),
    }))
        .optional(),
});
const createVoteSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(300),
    description: zod_1.z.string().max(2000).optional(),
    options: zod_1.z.array(zod_1.z.string().min(1)).min(2).max(10),
});
// ── Create Meeting ──────────────────────────────────────────
router.post('/:orgId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), (0, middleware_1.validate)(createMeetingSchema), async (req, res) => {
    try {
        const { title, description, location, scheduledStart, scheduledEnd, aiEnabled, translationEnabled, agendaItems, recurringPattern, recurringEndDate } = req.body;
        // If AI enabled, check AI wallet balance (SaaS wallet, not legacy ai_credits)
        if (aiEnabled) {
            const wallet = await (0, subscription_service_1.getAiWallet)(req.params.orgId);
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
        const [meeting] = await (0, db_1.default)('meetings')
            .insert({
            organization_id: req.params.orgId,
            title,
            description: description || null,
            location: location || null,
            scheduled_start: scheduledStart,
            scheduled_end: scheduledEnd || null,
            created_by: req.user.userId,
            ai_enabled: aiEnabled,
            translation_enabled: translationEnabled || false,
            jitsi_room_id: jitsiRoomId,
            recurring_pattern: recurringPattern || 'none',
            recurring_end_date: recurringEndDate || null,
        })
            .returning('*');
        // Create agenda items
        if (agendaItems?.length) {
            await (0, db_1.default)('agenda_items').insert(agendaItems.map((item, idx) => ({
                meeting_id: meeting.id,
                title: item.title,
                description: item.description || null,
                order: idx + 1,
                duration_minutes: item.durationMinutes || null,
                presenter_user_id: item.presenterUserId || null,
            })));
        }
        await req.audit?.({
            organizationId: req.params.orgId,
            action: 'create',
            entityType: 'meeting',
            entityId: meeting.id,
            newValue: { title, scheduledStart },
        });
        // Notify all org members
        const members = await (0, db_1.default)('memberships')
            .where({ organization_id: req.params.orgId, is_active: true })
            .pluck('user_id');
        const notifications = members.map((userId) => ({
            user_id: userId,
            organization_id: req.params.orgId,
            type: 'meeting',
            title: 'New Meeting Scheduled',
            body: `${title} — ${new Date(scheduledStart).toLocaleString()}`,
            data: JSON.stringify({ meetingId: meeting.id }),
        }));
        await (0, db_1.default)('notifications').insert(notifications);
        // Push notification for new meeting
        (0, push_service_1.sendPushToOrg)(req.params.orgId, {
            title: 'New Meeting Scheduled',
            body: `${title} — ${new Date(scheduledStart).toLocaleString()}`,
            data: { meetingId: meeting.id, type: 'meeting' },
        }, req.user.userId).catch(err => logger_1.logger.warn('Push notification failed (new meeting)', err));
        res.status(201).json({ success: true, data: meeting });
    }
    catch (err) {
        logger_1.logger.error('Create meeting error', err);
        res.status(500).json({ success: false, error: 'Failed to create meeting' });
    }
});
// ── Update Meeting ──────────────────────────────────────────
const updateMeetingSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(300).optional(),
    description: zod_1.z.string().max(5000).optional().nullable(),
    location: zod_1.z.string().max(500).optional().nullable(),
    scheduledStart: flexDateTime.optional(),
    scheduledEnd: flexDateTime.optional().nullable(),
    aiEnabled: zod_1.z.boolean().optional(),
    translationEnabled: zod_1.z.boolean().optional(),
    recurringPattern: zod_1.z.enum(['none', 'daily', 'weekly', 'biweekly', 'monthly']).optional(),
    status: zod_1.z.enum(['scheduled', 'cancelled']).optional(),
    agendaItems: zod_1.z
        .array(zod_1.z.object({
        title: zod_1.z.string().min(1),
        description: zod_1.z.string().optional(),
        durationMinutes: zod_1.z.number().min(1).optional(),
        presenterUserId: zod_1.z.string().uuid().optional(),
    }))
        .optional(),
});
router.put('/:orgId/:meetingId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), (0, middleware_1.validate)(updateMeetingSchema), async (req, res) => {
    try {
        const meeting = await (0, db_1.default)('meetings')
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
            const wallet = await (0, subscription_service_1.getAiWallet)(req.params.orgId);
            const balance = parseFloat(wallet.balance_minutes) || 0;
            if (balance <= 0) {
                res.status(402).json({
                    success: false,
                    error: 'Insufficient AI wallet balance. Top up your AI hours.',
                });
                return;
            }
        }
        const updates = {};
        if (title !== undefined)
            updates.title = title;
        if (description !== undefined)
            updates.description = description;
        if (location !== undefined)
            updates.location = location;
        if (scheduledStart !== undefined)
            updates.scheduled_start = scheduledStart;
        if (scheduledEnd !== undefined)
            updates.scheduled_end = scheduledEnd;
        if (aiEnabled !== undefined)
            updates.ai_enabled = aiEnabled;
        if (translationEnabled !== undefined)
            updates.translation_enabled = translationEnabled;
        if (recurringPattern !== undefined)
            updates.recurring_pattern = recurringPattern;
        if (status !== undefined)
            updates.status = status;
        updates.updated_at = db_1.default.fn.now();
        const [updated] = await (0, db_1.default)('meetings')
            .where({ id: req.params.meetingId })
            .update(updates)
            .returning('*');
        // Replace agenda items if provided
        if (agendaItems !== undefined) {
            await (0, db_1.default)('agenda_items').where({ meeting_id: req.params.meetingId }).del();
            if (agendaItems.length > 0) {
                await (0, db_1.default)('agenda_items').insert(agendaItems.map((item, idx) => ({
                    meeting_id: req.params.meetingId,
                    title: item.title,
                    description: item.description || null,
                    order: idx + 1,
                    duration_minutes: item.durationMinutes || null,
                    presenter_user_id: item.presenterUserId || null,
                })));
            }
        }
        await req.audit?.({
            organizationId: req.params.orgId,
            action: 'update',
            entityType: 'meeting',
            entityId: req.params.meetingId,
            newValue: updates,
        });
        res.json({ success: true, data: updated });
    }
    catch (err) {
        logger_1.logger.error('Update meeting error', err);
        res.status(500).json({ success: false, error: 'Failed to update meeting' });
    }
});
// ── Toggle AI on existing meeting ───────────────────────────
router.post('/:orgId/:meetingId/toggle-ai', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), async (req, res) => {
    try {
        const meeting = await (0, db_1.default)('meetings')
            .where({ id: req.params.meetingId, organization_id: req.params.orgId })
            .first();
        if (!meeting) {
            res.status(404).json({ success: false, error: 'Meeting not found' });
            return;
        }
        const newState = !meeting.ai_enabled;
        // If enabling, check AI wallet balance
        if (newState) {
            const wallet = await (0, subscription_service_1.getAiWallet)(req.params.orgId);
            const balance = parseFloat(wallet.balance_minutes) || 0;
            if (balance <= 0) {
                res.status(402).json({
                    success: false,
                    error: 'Insufficient AI wallet balance. Top up your AI hours.',
                });
                return;
            }
        }
        await (0, db_1.default)('meetings')
            .where({ id: req.params.meetingId })
            .update({ ai_enabled: newState });
        res.json({
            success: true,
            data: { aiEnabled: newState },
            message: newState ? 'AI minutes enabled' : 'AI minutes disabled',
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to toggle AI' });
    }
});
// ── List Meetings ───────────────────────────────────────────
router.get('/:orgId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const status = req.query.status;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        let query = (0, db_1.default)('meetings')
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
        // Attach attendance count
        const enriched = await Promise.all(meetings.map(async (m) => {
            const attendeeCount = await (0, db_1.default)('meeting_attendance')
                .where({ meeting_id: m.id })
                .count('id as count')
                .first();
            return {
                ...m,
                attendeeCount: parseInt(attendeeCount?.count) || 0,
            };
        }));
        res.json({
            success: true,
            data: enriched,
            meta: { page, limit, total: parseInt(total?.count) || 0 },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to list meetings' });
    }
});
// ── Get Meeting Detail ──────────────────────────────────────
router.get('/:orgId/:meetingId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const meeting = await (0, db_1.default)('meetings')
            .where({ id: req.params.meetingId, organization_id: req.params.orgId })
            .first();
        if (!meeting) {
            res.status(404).json({ success: false, error: 'Meeting not found' });
            return;
        }
        // Get creator info (= default moderator)
        const creator = await (0, db_1.default)('users')
            .where({ id: meeting.created_by })
            .select('id', 'first_name', 'last_name', 'email')
            .first();
        const agendaItems = await (0, db_1.default)('agenda_items')
            .where({ meeting_id: meeting.id })
            .orderBy('order');
        const attendance = await (0, db_1.default)('meeting_attendance')
            .join('users', 'meeting_attendance.user_id', 'users.id')
            .where({ meeting_id: meeting.id })
            .select('meeting_attendance.*', 'users.first_name', 'users.last_name', 'users.email');
        const votes = await (0, db_1.default)('votes')
            .where({ meeting_id: meeting.id })
            .select('*');
        const minutes = await (0, db_1.default)('meeting_minutes')
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
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get meeting' });
    }
});
// ── Start Meeting (go LIVE) ─────────────────────────────────
router.post('/:orgId/:meetingId/start', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), async (req, res) => {
    try {
        const meeting = await (0, db_1.default)('meetings')
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
        await (0, db_1.default)('meetings')
            .where({ id: req.params.meetingId })
            .update({ status: 'live', actual_start: db_1.default.fn.now() });
        // Notify
        const io = req.app.get('io');
        if (io) {
            io.to(`org:${req.params.orgId}`).emit('meeting:started', {
                meetingId: req.params.meetingId,
                title: meeting.title,
            });
        }
        await req.audit?.({
            organizationId: req.params.orgId,
            action: 'update',
            entityType: 'meeting',
            entityId: req.params.meetingId,
            newValue: { status: 'live' },
        });
        res.json({ success: true, message: 'Meeting started' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to start meeting' });
    }
});
// ── End Meeting ─────────────────────────────────────────────
router.post('/:orgId/:meetingId/end', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), async (req, res) => {
    try {
        const meeting = await (0, db_1.default)('meetings')
            .where({ id: req.params.meetingId, organization_id: req.params.orgId })
            .first();
        if (!meeting || meeting.status !== 'live') {
            res.status(400).json({ success: false, error: 'Meeting is not live' });
            return;
        }
        await (0, db_1.default)('meetings')
            .where({ id: req.params.meetingId })
            .update({ status: 'ended', actual_end: db_1.default.fn.now() });
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
            await (0, db_1.default)('meeting_minutes').insert({
                meeting_id: req.params.meetingId,
                organization_id: req.params.orgId,
                status: 'processing',
            });
            // Queue AI processing (handled by AI service)
            const aiService = req.app.get('aiService');
            if (aiService) {
                aiService.processMinutes(req.params.meetingId, req.params.orgId).catch((err) => {
                    logger_1.logger.error('AI minutes processing failed', err);
                });
            }
        }
        await req.audit?.({
            organizationId: req.params.orgId,
            action: 'update',
            entityType: 'meeting',
            entityId: req.params.meetingId,
            newValue: { status: 'ended' },
        });
        res.json({ success: true, message: 'Meeting ended' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to end meeting' });
    }
});
// ── Record Attendance ───────────────────────────────────────
router.post('/:orgId/:meetingId/attendance', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const existing = await (0, db_1.default)('meeting_attendance')
            .where({ meeting_id: req.params.meetingId, user_id: req.user.userId })
            .first();
        if (existing) {
            res.json({ success: true, message: 'Already recorded', data: existing });
            return;
        }
        const meeting = await (0, db_1.default)('meetings')
            .where({ id: req.params.meetingId, organization_id: req.params.orgId })
            .first();
        let status = 'present';
        if (meeting?.actual_start) {
            const startTime = new Date(meeting.actual_start).getTime();
            const now = Date.now();
            if (now - startTime > 15 * 60 * 1000)
                status = 'late'; // 15 min grace
        }
        const [attendance] = await (0, db_1.default)('meeting_attendance')
            .insert({
            meeting_id: req.params.meetingId,
            user_id: req.user.userId,
            status,
            joined_at: db_1.default.fn.now(),
        })
            .returning('*');
        res.status(201).json({ success: true, data: attendance });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to record attendance' });
    }
});
// ── Bulk Attendance (Admin) ─────────────────────────────────
router.post('/:orgId/:meetingId/attendance/bulk', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), async (req, res) => {
    try {
        const { attendees } = req.body; // [{ userId, status }]
        if (!Array.isArray(attendees)) {
            res.status(400).json({ success: false, error: 'attendees array required' });
            return;
        }
        for (const a of attendees) {
            await (0, db_1.default)('meeting_attendance')
                .insert({
                meeting_id: req.params.meetingId,
                user_id: a.userId,
                status: a.status || 'present',
                joined_at: db_1.default.fn.now(),
            })
                .onConflict(['meeting_id', 'user_id'])
                .merge({ status: a.status || 'present' });
        }
        res.json({ success: true, message: 'Attendance updated' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update attendance' });
    }
});
// ── Create Vote ─────────────────────────────────────────────
router.post('/:orgId/:meetingId/votes', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), (0, middleware_1.validate)(createVoteSchema), async (req, res) => {
    try {
        const { title, description, options } = req.body;
        const [vote] = await (0, db_1.default)('votes')
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
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to create vote' });
    }
});
// ── Cast Vote ───────────────────────────────────────────────
router.post('/:orgId/:meetingId/votes/:voteId/cast', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const vote = await (0, db_1.default)('votes')
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
        await (0, db_1.default)('vote_ballots')
            .insert({
            vote_id: req.params.voteId,
            user_id: req.user.userId,
            selected_option: option,
        })
            .onConflict(['vote_id', 'user_id'])
            .merge({ selected_option: option });
        res.json({ success: true, message: 'Vote cast' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to cast vote' });
    }
});
// ── Close Vote ──────────────────────────────────────────────
router.post('/:orgId/:meetingId/votes/:voteId/close', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), async (req, res) => {
    try {
        await (0, db_1.default)('votes')
            .where({ id: req.params.voteId })
            .whereIn('meeting_id', (0, db_1.default)('meetings').where({ organization_id: req.params.orgId }).select('id'))
            .update({ status: 'closed', closed_at: db_1.default.fn.now() });
        // Get results
        const ballots = await (0, db_1.default)('vote_ballots')
            .where({ vote_id: req.params.voteId })
            .select('selected_option', db_1.default.raw('count(*) as count'))
            .groupBy('selected_option');
        const io = req.app.get('io');
        if (io) {
            io.to(`meeting:${req.params.meetingId}`).emit('vote:closed', {
                voteId: req.params.voteId,
                results: ballots,
            });
        }
        res.json({ success: true, data: { results: ballots } });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to close vote' });
    }
});
// ── Upload Audio for AI Processing ──────────────────────────
router.post('/:orgId/:meetingId/audio', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), audioUpload.single('audio'), async (req, res) => {
    try {
        let audioUrl;
        if (req.file) {
            // File uploaded via multipart
            audioUrl = `/uploads/${req.file.filename}`;
        }
        else if (req.body.audioUrl) {
            // URL passed directly (e.g., GCS URI)
            audioUrl = req.body.audioUrl;
        }
        else {
            res.status(400).json({ success: false, error: 'Audio file or audioUrl required' });
            return;
        }
        await (0, db_1.default)('meetings')
            .where({ id: req.params.meetingId })
            .update({ audio_storage_url: audioUrl });
        res.json({ success: true, data: { audioUrl }, message: 'Audio stored' });
    }
    catch (err) {
        logger_1.logger.error('Audio upload error', err);
        res.status(500).json({ success: false, error: 'Failed to store audio' });
    }
});
// ── Translation: Get supported languages ────────────────────
router.get('/translation/languages', middleware_1.authenticate, (_req, res) => {
    res.json({
        success: true,
        data: {
            languages: translation_service_1.SUPPORTED_LANGUAGES,
            speechCodes: translation_service_1.SPEECH_RECOGNITION_CODES,
        },
    });
});
// ── Translation: Translate a single text (REST fallback) ────
router.post('/translation/translate', middleware_1.authenticate, async (req, res) => {
    try {
        const { text, targetLang, sourceLang } = req.body;
        if (!text || !targetLang) {
            return res.status(400).json({ success: false, error: 'text and targetLang are required' });
        }
        const result = await (0, translation_service_1.translateText)(text, targetLang, sourceLang);
        res.json({ success: true, data: result });
    }
    catch (err) {
        logger_1.logger.error('Translation endpoint error', err);
        res.status(500).json({ success: false, error: 'Translation failed' });
    }
});
exports.default = router;
//# sourceMappingURL=meetings.js.map