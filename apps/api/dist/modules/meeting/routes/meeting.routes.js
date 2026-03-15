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
const translation_api_service_1 = require("../services/translation-api.service");
const logger_1 = require("../../../logger");
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
    agenda: zod_1.z.array(zod_1.z.string().max(500)).max(50).optional(),
});
const createMeetingWithVisibilitySchema = zod_1.z.object({
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
        enableTranscription: zod_1.z.boolean().optional(),
    }).optional(),
    agenda: zod_1.z.array(zod_1.z.string().max(500)).max(50).optional(),
    visibilityType: zod_1.z.enum(['ALL_MEMBERS', 'EXECUTIVES', 'COMMITTEE', 'CUSTOM']).optional(),
    committeeId: zod_1.z.string().uuid('Invalid committee ID').optional(),
    participants: zod_1.z.array(zod_1.z.string().uuid('Invalid user ID')).optional(),
});
const joinMeetingSchema = zod_1.z.object({
    meetingId: zod_1.z.string().uuid('Invalid meeting ID'),
    displayName: zod_1.z.string().max(100).optional(),
});
const leaveMeetingSchema = zod_1.z.object({
    meetingId: zod_1.z.string().uuid('Invalid meeting ID'),
});
const updateMeetingSchema = zod_1.z.object({
    title: zod_1.z.string().max(255).optional(),
    description: zod_1.z.string().max(2000).optional(),
    scheduledAt: zod_1.z.string().datetime().optional().nullable(),
    settings: zod_1.z.object({
        maxParticipants: zod_1.z.number().min(2).max(1000).optional(),
        allowRecording: zod_1.z.boolean().optional(),
        waitingRoom: zod_1.z.boolean().optional(),
        muteOnEntry: zod_1.z.boolean().optional(),
        allowScreenShare: zod_1.z.boolean().optional(),
    }).optional(),
    agenda: zod_1.z.array(zod_1.z.string().max(500)).max(50).optional(),
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
 * POST /meetings/create-with-visibility
 * Create a new meeting with role-segmented visibility.
 * Supports visibility types: ALL_MEMBERS, EXECUTIVES, COMMITTEE, CUSTOM.
 * Auto-populates meeting_invites based on visibility type.
 * Requires authentication
 * Blocked if AI budget is exceeded
 */
router.post('/create-with-visibility', middleware_1.authenticate, middleware_1.aiCostGuard, (0, middleware_1.validate)(createMeetingWithVisibilitySchema), (req, res, next) => controllers_1.meetingController.createWithVisibility(req, res, next));
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
// ── Translation Routes ──────────────────────────────────────
// NOTE: These must be BEFORE /:id routes to avoid 'translation' being parsed as an ID
/**
 * GET /meetings/translation/languages
 * Get list of supported translation languages
 * Public endpoint (no auth required for language list)
 */
router.get('/translation/languages', (_req, res) => {
    res.json({
        success: true,
        data: translation_api_service_1.SUPPORTED_LANGUAGES,
    });
});
/**
 * POST /meetings/translation/translate
 * Translate text on-demand for meeting captions
 * Requires authentication
 */
router.post('/translation/translate', middleware_1.authenticate, async (req, res) => {
    try {
        const { text, targetLang, sourceLang } = req.body;
        if (!text || typeof text !== 'string') {
            res.status(400).json({
                success: false,
                error: 'text is required and must be a string',
            });
            return;
        }
        if (!targetLang || typeof targetLang !== 'string') {
            res.status(400).json({
                success: false,
                error: 'targetLang is required and must be a string',
            });
            return;
        }
        const result = await translation_api_service_1.translationApiService.translate(text, targetLang, sourceLang || 'en');
        res.json({
            success: true,
            data: result,
        });
    }
    catch (err) {
        logger_1.logger.error('[TRANSLATION_ROUTE] Translation failed', {
            error: err.message,
            userId: req.user?.userId,
        });
        res.status(500).json({
            success: false,
            error: 'Translation failed. Please try again.',
        });
    }
});
/**
 * PATCH /meetings/:id
 * Update a scheduled meeting
 * Requires authentication (host only)
 */
router.patch('/:id', middleware_1.authenticate, (0, middleware_1.validate)(updateMeetingSchema), (req, res, next) => controllers_1.meetingController.update(req, res, next));
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