// ============================================================
// OrgsLedger API — Meeting Routes
// RESTful endpoints for meeting operations
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, validate, loadMembership, aiCostGuard } from '../../../middleware';
import { meetingController } from '../controllers';
import { translationApiService, SUPPORTED_LANGUAGES } from '../services/translation-api.service';
import { logger } from '../../../logger';

const router = Router();

// ── Validation Schemas ──────────────────────────────────────

const createMeetingSchema = z.object({
  organizationId: z.string().uuid('Invalid organization ID'),
  title: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
  scheduledAt: z.string().datetime().optional(),
  settings: z.object({
    maxParticipants: z.number().min(2).max(1000).optional(),
    allowRecording: z.boolean().optional(),
    waitingRoom: z.boolean().optional(),
    muteOnEntry: z.boolean().optional(),
    allowScreenShare: z.boolean().optional(),
  }).optional(),
  agenda: z.array(z.string().max(500)).max(50).optional(),
});

const createMeetingWithVisibilitySchema = z.object({
  organizationId: z.string().uuid('Invalid organization ID'),
  title: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
  scheduledAt: z.string().datetime().optional(),
  settings: z.object({
    maxParticipants: z.number().min(2).max(1000).optional(),
    allowRecording: z.boolean().optional(),
    waitingRoom: z.boolean().optional(),
    muteOnEntry: z.boolean().optional(),
    allowScreenShare: z.boolean().optional(),
    enableTranscription: z.boolean().optional(),
  }).optional(),
  agenda: z.array(z.string().max(500)).max(50).optional(),
  visibilityType: z.enum(['ALL_MEMBERS', 'EXECUTIVES', 'COMMITTEE', 'CUSTOM']).optional(),
  committeeId: z.string().uuid('Invalid committee ID').optional(),
  participants: z.array(z.string().uuid('Invalid user ID')).optional(),
});

const joinMeetingSchema = z.object({
  meetingId: z.string().uuid('Invalid meeting ID'),
  displayName: z.string().max(100).optional(),
});

const leaveMeetingSchema = z.object({
  meetingId: z.string().uuid('Invalid meeting ID'),
});

const updateMeetingSchema = z.object({
  title: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
  scheduledAt: z.string().datetime().optional().nullable(),
  settings: z.object({
    maxParticipants: z.number().min(2).max(1000).optional(),
    allowRecording: z.boolean().optional(),
    waitingRoom: z.boolean().optional(),
    muteOnEntry: z.boolean().optional(),
    allowScreenShare: z.boolean().optional(),
  }).optional(),
  agenda: z.array(z.string().max(500)).max(50).optional(),
});

// ── Routes ──────────────────────────────────────────────────

/**
 * POST /meetings/create
 * Create a new meeting
 * Requires authentication
 * Blocked if AI budget is exceeded
 */
router.post(
  '/create',
  authenticate,
  aiCostGuard,
  validate(createMeetingSchema),
  (req, res, next) => meetingController.create(req, res, next)
);

/**
 * POST /meetings/create-with-visibility
 * Create a new meeting with role-segmented visibility.
 * Supports visibility types: ALL_MEMBERS, EXECUTIVES, COMMITTEE, CUSTOM.
 * Auto-populates meeting_invites based on visibility type.
 * Requires authentication
 * Blocked if AI budget is exceeded
 */
router.post(
  '/create-with-visibility',
  authenticate,
  aiCostGuard,
  validate(createMeetingWithVisibilitySchema),
  (req, res, next) => meetingController.createWithVisibility(req, res, next)
);

/**
 * POST /meetings/join
 * Join an existing meeting
 * Requires authentication
 */
router.post(
  '/join',
  authenticate,
  validate(joinMeetingSchema),
  (req, res, next) => meetingController.join(req, res, next)
);

/**
 * POST /meetings/leave
 * Leave a meeting
 * Requires authentication
 */
router.post(
  '/leave',
  authenticate,
  validate(leaveMeetingSchema),
  (req, res, next) => meetingController.leave(req, res, next)
);

// ── Translation Routes ──────────────────────────────────────
// NOTE: These must be BEFORE /:id routes to avoid 'translation' being parsed as an ID

/**
 * GET /meetings/translation/languages
 * Get list of supported translation languages
 * Public endpoint (no auth required for language list)
 */
router.get('/translation/languages', (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: SUPPORTED_LANGUAGES,
  });
});

/**
 * POST /meetings/translation/translate
 * Translate text on-demand for meeting captions
 * Requires authentication
 */
router.post(
  '/translation/translate',
  authenticate,
  async (req: Request, res: Response) => {
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

      const result = await translationApiService.translate(
        text,
        targetLang,
        sourceLang || 'en'
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      logger.error('[TRANSLATION_ROUTE] Translation failed', {
        error: err.message,
        userId: req.user?.userId,
      });
      res.status(500).json({
        success: false,
        error: 'Translation failed. Please try again.',
      });
    }
  }
);

/**
 * PATCH /meetings/:id
 * Update a scheduled meeting
 * Requires authentication (host only)
 */
router.patch(
  '/:id',
  authenticate,
  validate(updateMeetingSchema),
  (req, res, next) => meetingController.update(req, res, next)
);

/**
 * GET /meetings/:id
 * Get meeting details by ID
 * Requires authentication
 */
router.get(
  '/:id',
  authenticate,
  (req, res, next) => meetingController.getById(req, res, next)
);

/**
 * GET /meetings
 * List meetings for an organization
 * Query params: organizationId (required), status, page, limit
 * Requires authentication
 */
router.get(
  '/',
  authenticate,
  (req, res, next) => meetingController.list(req, res, next)
);

/**
 * POST /meetings/:id/start
 * Start a scheduled meeting
 * Requires authentication (host only)
 */
router.post(
  '/:id/start',
  authenticate,
  (req, res, next) => meetingController.start(req, res, next)
);

/**
 * POST /meetings/:id/end
 * End an active meeting
 * Requires authentication (host only)
 */
router.post(
  '/:id/end',
  authenticate,
  (req, res, next) => meetingController.end(req, res, next)
);

/**
 * POST /meetings/:id/cancel
 * Cancel a scheduled meeting
 * Requires authentication (host only)
 */
router.post(
  '/:id/cancel',
  authenticate,
  (req, res, next) => meetingController.cancel(req, res, next)
);

/**
 * POST /meetings/:id/token
 * Generate LiveKit token for joining meeting media
 * Requires authentication
 */
router.post(
  '/:id/token',
  authenticate,
  (req, res, next) => meetingController.getToken(req, res, next)
);

/**
 * GET /meetings/:id/minutes
 * Get AI-generated meeting minutes
 * Requires authentication
 */
router.get(
  '/:id/minutes',
  authenticate,
  (req, res, next) => meetingController.getMinutes(req, res, next)
);

/**
 * POST /meetings/:id/minutes/regenerate
 * Force regeneration of meeting minutes (host only)
 * Requires authentication
 */
router.post(
  '/:id/minutes/regenerate',
  authenticate,
  (req, res, next) => meetingController.regenerateMinutes(req, res, next)
);

export default router;
