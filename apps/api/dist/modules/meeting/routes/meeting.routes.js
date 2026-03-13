"use strict";
// ============================================================
// OrgsLedger API — Meeting Routes
// RESTful endpoints for meeting operations
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const middleware_1 = require("../../../middleware");
const controllers_1 = require("../controllers");
const router = (0, express_1.Router)();
// ── Validation Schemas ──────────────────────────────────────
const createMeetingSchema = zod_1.z.object({
    organizationId: zod_1.z.string().uuid('Invalid organization ID'),
    title: zod_1.z.string().max(255).optional(),
    description: zod_1.z.string().max(2000).optional(),
    scheduledAt: zod_1.z.string().datetime().optional(),
    settings: zod_1.z.object({
        maxParticipants: zod_1.z.number().min(2).max(1000).optional(),
        allowRecording: zod_1.z.boolean().optional(),
        waitingRoom: zod_1.z.boolean().optional(),
        muteOnEntry: zod_1.z.boolean().optional(),
        allowScreenShare: zod_1.z.boolean().optional(),
    }).optional(),
});
const joinMeetingSchema = zod_1.z.object({
    meetingId: zod_1.z.string().uuid('Invalid meeting ID'),
    displayName: zod_1.z.string().max(100).optional(),
});
const leaveMeetingSchema = zod_1.z.object({
    meetingId: zod_1.z.string().uuid('Invalid meeting ID'),
});
// ── Routes ──────────────────────────────────────────────────
/**
 * POST /meetings/create
 * Create a new meeting
 * Requires authentication
 * Blocked if AI budget is exceeded
 */
router.post('/create', middleware_1.authenticate, middleware_1.aiCostGuard, (0, middleware_1.validate)(createMeetingSchema), (req, res, next) => controllers_1.meetingController.create(req, res, next));
/**
 * POST /meetings/join
 * Join an existing meeting
 * Requires authentication
 */
router.post('/join', middleware_1.authenticate, (0, middleware_1.validate)(joinMeetingSchema), (req, res, next) => controllers_1.meetingController.join(req, res, next));
/**
 * POST /meetings/leave
 * Leave a meeting
 * Requires authentication
 */
router.post('/leave', middleware_1.authenticate, (0, middleware_1.validate)(leaveMeetingSchema), (req, res, next) => controllers_1.meetingController.leave(req, res, next));
/**
 * GET /meetings/:id
 * Get meeting details by ID
 * Requires authentication
 */
router.get('/:id', middleware_1.authenticate, (req, res, next) => controllers_1.meetingController.getById(req, res, next));
/**
 * GET /meetings
 * List meetings for an organization
 * Query params: organizationId (required), status, page, limit
 * Requires authentication
 */
router.get('/', middleware_1.authenticate, (req, res, next) => controllers_1.meetingController.list(req, res, next));
/**
 * POST /meetings/:id/start
 * Start a scheduled meeting
 * Requires authentication (host only)
 */
router.post('/:id/start', middleware_1.authenticate, (req, res, next) => controllers_1.meetingController.start(req, res, next));
/**
 * POST /meetings/:id/end
 * End an active meeting
 * Requires authentication (host only)
 */
router.post('/:id/end', middleware_1.authenticate, (req, res, next) => controllers_1.meetingController.end(req, res, next));
/**
 * POST /meetings/:id/cancel
 * Cancel a scheduled meeting
 * Requires authentication (host only)
 */
router.post('/:id/cancel', middleware_1.authenticate, (req, res, next) => controllers_1.meetingController.cancel(req, res, next));
/**
 * POST /meetings/:id/token
 * Generate LiveKit token for joining meeting media
 * Requires authentication
 */
router.post('/:id/token', middleware_1.authenticate, (req, res, next) => controllers_1.meetingController.getToken(req, res, next));
/**
 * GET /meetings/:id/minutes
 * Get AI-generated meeting minutes
 * Requires authentication
 */
router.get('/:id/minutes', middleware_1.authenticate, (req, res, next) => controllers_1.meetingController.getMinutes(req, res, next));
/**
 * POST /meetings/:id/minutes/regenerate
 * Force regeneration of meeting minutes (host only)
 * Requires authentication
 */
router.post('/:id/minutes/regenerate', middleware_1.authenticate, (req, res, next) => controllers_1.meetingController.regenerateMinutes(req, res, next));
exports.default = router;
//# sourceMappingURL=meeting.routes.js.map