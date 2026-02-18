"use strict";
// ============================================================
// OrgsLedger API — Events / Calendar Routes
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = __importDefault(require("../db"));
const middleware_1 = require("../middleware");
const logger_1 = require("../logger");
const push_service_1 = require("../services/push.service");
const router = (0, express_1.Router)();
// ── Schemas ─────────────────────────────────────────────────
const createEventSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(300),
    description: zod_1.z.string().max(5000).optional(),
    location: zod_1.z.string().max(500).optional(),
    startDate: zod_1.z.string().datetime(),
    endDate: zod_1.z.string().datetime().optional(),
    allDay: zod_1.z.boolean().default(false),
    category: zod_1.z.enum(['social', 'fundraiser', 'community', 'workshop', 'general']).default('general'),
    maxAttendees: zod_1.z.number().int().min(0).optional(),
    rsvpRequired: zod_1.z.boolean().default(false),
});
// ── Create Event ────────────────────────────────────────────
router.post('/:orgId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), (0, middleware_1.validate)(createEventSchema), async (req, res) => {
    try {
        const { title, description, location, startDate, endDate, allDay, category, maxAttendees, rsvpRequired } = req.body;
        const [event] = await (0, db_1.default)('events')
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
            created_by: req.user.userId,
        })
            .returning('*');
        // Notify org members
        (0, push_service_1.sendPushToOrg)(req.params.orgId, {
            title: 'New Event',
            body: `${title} — ${new Date(startDate).toLocaleDateString()}`,
            data: { eventId: event.id, type: 'event' },
        }, req.user.userId).catch(err => logger_1.logger.warn('Push notification failed (new event)', err));
        res.status(201).json({ success: true, data: event });
    }
    catch (err) {
        logger_1.logger.error('Create event error', err);
        res.status(500).json({ success: false, error: 'Failed to create event' });
    }
});
// ── List Events ─────────────────────────────────────────────
router.get('/:orgId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const upcoming = req.query.upcoming === 'true';
        const category = req.query.category;
        let query = (0, db_1.default)('events')
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
        // Batch: RSVP counts for all events in one query (GROUP BY)
        let enriched = events;
        if (events.length) {
            const eventIds = events.map((e) => e.id);
            const rsvpCounts = await (0, db_1.default)('event_rsvps')
                .whereIn('event_id', eventIds)
                .where({ status: 'attending' })
                .select('event_id')
                .count('id as count')
                .groupBy('event_id');
            const rsvpMap = {};
            rsvpCounts.forEach((rc) => { rsvpMap[rc.event_id] = parseInt(rc.count) || 0; });
            enriched = events.map((evt) => ({
                ...evt,
                rsvpCount: rsvpMap[evt.id] || 0,
            }));
        }
        res.json({
            success: true,
            data: enriched,
            meta: { page, limit, total: parseInt(total?.count) || 0 },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to list events' });
    }
});
// ── Get Event Detail ────────────────────────────────────────
router.get('/:orgId/:eventId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const event = await (0, db_1.default)('events')
            .where({ id: req.params.eventId, organization_id: req.params.orgId })
            .first();
        if (!event) {
            res.status(404).json({ success: false, error: 'Event not found' });
            return;
        }
        const rsvps = await (0, db_1.default)('event_rsvps')
            .join('users', 'event_rsvps.user_id', 'users.id')
            .where({ event_id: event.id })
            .select('event_rsvps.*', 'users.first_name', 'users.last_name')
            .limit(500);
        res.json({
            success: true,
            data: { ...event, rsvps },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get event' });
    }
});
// ── RSVP to Event ───────────────────────────────────────────
router.post('/:orgId/:eventId/rsvp', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const status = req.body.status || 'attending'; // attending, declined, maybe
        const validStatuses = ['attending', 'declined', 'maybe'];
        if (!validStatuses.includes(status)) {
            res.status(400).json({ success: false, error: `Invalid RSVP status. Must be one of: ${validStatuses.join(', ')}` });
            return;
        }
        const event = await (0, db_1.default)('events')
            .where({ id: req.params.eventId, organization_id: req.params.orgId })
            .first();
        if (!event) {
            res.status(404).json({ success: false, error: 'Event not found' });
            return;
        }
        // Check capacity
        if (event.max_attendees && status === 'attending') {
            const count = await (0, db_1.default)('event_rsvps')
                .where({ event_id: event.id, status: 'attending' })
                .count('id as count')
                .first();
            if ((parseInt(count?.count) || 0) >= event.max_attendees) {
                res.status(400).json({ success: false, error: 'Event is at full capacity' });
                return;
            }
        }
        // Upsert RSVP
        const existing = await (0, db_1.default)('event_rsvps')
            .where({ event_id: event.id, user_id: req.user.userId })
            .first();
        if (existing) {
            await (0, db_1.default)('event_rsvps')
                .where({ id: existing.id })
                .update({ status, updated_at: db_1.default.fn.now() });
        }
        else {
            await (0, db_1.default)('event_rsvps').insert({
                event_id: event.id,
                user_id: req.user.userId,
                status,
            });
        }
        res.json({ success: true, status });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to RSVP' });
    }
});
// ── Delete Event ────────────────────────────────────────────
router.delete('/:orgId/:eventId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin'), async (req, res) => {
    try {
        const event = await (0, db_1.default)('events')
            .where({ id: req.params.eventId, organization_id: req.params.orgId })
            .first();
        if (!event) {
            res.status(404).json({ success: false, error: 'Event not found' });
            return;
        }
        await (0, db_1.default)('event_rsvps').where({ event_id: event.id }).delete();
        await (0, db_1.default)('events').where({ id: event.id }).delete();
        res.json({ success: true, message: 'Event deleted' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to delete event' });
    }
});
exports.default = router;
//# sourceMappingURL=events.js.map