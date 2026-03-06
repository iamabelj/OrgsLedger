"use strict";
// ============================================================
// OrgsLedger API — Transcripts Routes & Controllers
// Meeting transcript ingestion and processing
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
const translation_service_1 = require("../services/translation.service");
const minutes_queue_1 = require("../queues/minutes.queue");
const meeting_queue_integration_service_1 = require("../services/meeting-queue-integration.service");
const router = (0, express_1.Router)();
// ── Schemas ─────────────────────────────────────────────────
const createTranscriptSchema = zod_1.z.object({
    speakerId: zod_1.z.string().uuid('Invalid speaker ID'),
    speakerName: zod_1.z.string().min(1).max(255),
    originalText: zod_1.z.string().min(1).max(100000, 'Transcript too large'),
    sourceLanguage: zod_1.z.string().length(2, 'Language code must be 2 characters'), // e.g., 'en', 'es'
    spokenAt: zod_1.z.number().int().min(0, 'Timestamp must be non-negative'), // milliseconds since meeting start
    isFinal: zod_1.z.boolean().default(false), // Is this the final version of this segment?
});
const listTranscriptsSchema = zod_1.z.object({
    limit: zod_1.z.number().int().min(1).max(1000).default(100),
    offset: zod_1.z.number().int().min(0).default(0),
    speakerId: zod_1.z.string().uuid().optional(),
    language: zod_1.z.string().length(2).optional(),
});
const generateMinutesSchema = zod_1.z.object({
    format: zod_1.z.enum(['text', 'structured']).default('structured'),
    includeAttendees: zod_1.z.boolean().default(true),
    includeTiming: zod_1.z.boolean().default(true),
});
// ── List All Transcripts for a Meeting ──────────────────────
router.get('/:meetingId', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.validate)(listTranscriptsSchema), async (req, res) => {
    try {
        const { meetingId } = req.params;
        const { limit, offset, speakerId, language } = req.query;
        // Verify meeting exists and user has access
        const meeting = await (0, db_1.default)('meetings')
            .where({ id: meetingId, organization_id: req.membership?.organizationId })
            .first();
        if (!meeting) {
            return res.status(404).json({ success: false, error: 'Meeting not found' });
        }
        // Build query
        let query = (0, db_1.default)('meeting_transcripts').where({ meeting_id: meetingId });
        if (speakerId) {
            query = query.where({ speaker_id: speakerId });
        }
        if (language) {
            query = query.where({ source_lang: language });
        }
        // Get total count
        const [{ count }] = await (0, db_1.default)(query.clone()).count('id as count');
        const total = parseInt(count);
        // Fetch paginated results
        const transcripts = await query
            .orderBy('spoken_at', 'asc')
            .limit(parseInt(limit || '100'))
            .offset(parseInt(offset || '0'))
            .select('id', 'speaker_id', 'speaker_name', 'original_text', 'source_lang', 'translations', 'spoken_at', 'created_at');
        res.json({
            success: true,
            data: transcripts,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset),
                total,
                hasMore: parseInt(offset) + parseInt(limit) < total,
            },
        });
    }
    catch (err) {
        logger_1.logger.error('Error fetching transcripts', err);
        res.status(500).json({ success: false, error: 'Failed to fetch transcripts' });
    }
});
// ── Get Specific Transcript ─────────────────────────────────
router.get('/:meetingId/:transcriptId', middleware_1.authenticate, middleware_1.loadMembership, async (req, res) => {
    try {
        const { meetingId, transcriptId } = req.params;
        // Verify meeting belongs to org
        const meeting = await (0, db_1.default)('meetings')
            .where({ id: meetingId, organization_id: req.membership?.organizationId })
            .first();
        if (!meeting) {
            return res.status(404).json({ success: false, error: 'Meeting not found' });
        }
        const transcript = await (0, db_1.default)('meeting_transcripts')
            .where({ id: transcriptId, meeting_id: meetingId })
            .first();
        if (!transcript) {
            return res.status(404).json({ success: false, error: 'Transcript not found' });
        }
        res.json({ success: true, data: transcript });
    }
    catch (err) {
        logger_1.logger.error('Error fetching transcript', err);
        res.status(500).json({ success: false, error: 'Failed to fetch transcript' });
    }
});
// ── Create Transcript ───────────────────────────────────────
// Called by transcription service (human-in-the-loop or bot)
router.post('/:meetingId', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.validate)(createTranscriptSchema), async (req, res) => {
    try {
        const { meetingId } = req.params;
        const { speakerId, speakerName, originalText, sourceLanguage, spokenAt, isFinal, } = req.body;
        // Verify meeting exists and user has access
        const meeting = await (0, db_1.default)('meetings')
            .where({ id: meetingId, organization_id: req.membership?.organizationId })
            .first();
        if (!meeting) {
            return res.status(404).json({ success: false, error: 'Meeting not found' });
        }
        // Check if meeting is live or recently ended (allow 30 min grace period)
        const now = Date.now();
        const meetingEndTime = meeting.actual_end ? new Date(meeting.actual_end).getTime() : now;
        const gracePeriodMs = 30 * 60 * 1000; // 30 minutes
        if (meeting.status !== 'live' && meeting.status !== 'ended') {
            return res.status(400).json({
                success: false,
                error: 'Meeting is not active or has ended beyond grace period',
            });
        }
        if (meeting.status === 'ended' && now - meetingEndTime > gracePeriodMs) {
            return res.status(400).json({
                success: false,
                error: 'Meeting ended too long ago to accept transcripts',
            });
        }
        // Verify speaker is a meeting attendee
        const attendee = await (0, db_1.default)('meeting_attendance')
            .where({
            meeting_id: meetingId,
            user_id: speakerId,
        })
            .first();
        if (!attendee && meeting.created_by !== speakerId) {
            // Allow meeting creator and explicit attendees
            return res.status(403).json({
                success: false,
                error: 'User is not an attendee of this meeting',
            });
        }
        // Initialize translations object
        let translations = {};
        // If meeting has translation enabled, translate to other languages
        if (meeting.translation_enabled && sourceLanguage !== 'en') {
            try {
                // Get other languages from organization preferences
                const prefs = await (0, db_1.default)('user_language_preferences')
                    .where('organization_id', req.membership?.organizationId)
                    .distinct('preferred_language');
                const targetLanguages = prefs
                    .map((p) => p.preferred_language)
                    .filter((lang) => lang !== sourceLanguage);
                if (targetLanguages.length > 0) {
                    logger_1.logger.info('[TRANSCRIPTS] Initiating translations', {
                        meetingId,
                        fromLang: sourceLanguage,
                        targetLanguages: targetLanguages.slice(0, 3), // Log first 3
                        textLen: originalText.length,
                    });
                    // Translate to each target language
                    for (const targetLang of targetLanguages.slice(0, 5)) { // Limit to 5 for cost
                        try {
                            const translationResult = await (0, translation_service_1.translateText)(originalText, sourceLanguage, targetLang);
                            // translateText returns { translatedText: string }
                            translations[targetLang] = translationResult.translatedText || translationResult;
                        }
                        catch (transErr) {
                            logger_1.logger.warn('[TRANSCRIPTS] Translation failed for language', {
                                language: targetLang,
                                error: transErr,
                            });
                            // Continue with other languages
                        }
                    }
                }
            }
            catch (transErr) {
                logger_1.logger.warn('[TRANSCRIPTS] Translation initialization error (non-blocking)', transErr);
                // Don't block transcript ingestion on translation errors
            }
        }
        // Insert transcript
        const transcript = await (0, db_1.default)('meeting_transcripts').insert({
            meeting_id: meetingId,
            organization_id: req.membership?.organizationId,
            speaker_id: speakerId,
            speaker_name: speakerName,
            original_text: originalText,
            source_lang: sourceLanguage,
            translations: JSON.stringify(translations),
            spoken_at: spokenAt,
            created_at: new Date(),
            updated_at: new Date(),
        }).returning('*');
        logger_1.logger.info('[TRANSCRIPTS] Transcript ingested', {
            meetingId,
            transcriptId: transcript[0]?.id,
            speakerId,
            isFinal,
            textLength: originalText.length,
        });
        // Trigger any post-ingestion processing (best-effort)
        (0, meeting_queue_integration_service_1.onTranscriptReceived)(meetingId, req.membership?.organizationId || '', {
            speaker_id: speakerId,
            speaker_name: speakerName,
            original_text: originalText,
            source_language: sourceLanguage,
            translations,
            spoken_at: spokenAt,
            is_final: isFinal,
        }).catch((err) => {
            logger_1.logger.warn('[TRANSCRIPTS] Post-ingestion processing error', err);
        });
        // If this is the final transcript segment, notify that transcripts are complete
        if (isFinal) {
            logger_1.logger.info('[TRANSCRIPTS] Final segment received — transcription complete', {
                meetingId,
            });
            // Could trigger minute generation here if needed
            // For now, meeting end handler will trigger it
        }
        res.status(201).json({ success: true, data: transcript[0] });
    }
    catch (err) {
        logger_1.logger.error('Error creating transcript', err);
        res.status(500).json({ success: false, error: 'Failed to ingest transcript' });
    }
});
// ── Delete Transcript ───────────────────────────────────────
// Admin only - for corrections
router.delete('/:meetingId/:transcriptId', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin', 'executive'), async (req, res) => {
    try {
        const { meetingId, transcriptId } = req.params;
        // Verify meeting belongs to org
        const meeting = await (0, db_1.default)('meetings')
            .where({ id: meetingId, organization_id: req.membership?.organizationId })
            .first();
        if (!meeting) {
            return res.status(404).json({ success: false, error: 'Meeting not found' });
        }
        const deleted = await (0, db_1.default)('meeting_transcripts')
            .where({ id: transcriptId, meeting_id: meetingId })
            .delete();
        if (!deleted) {
            return res.status(404).json({ success: false, error: 'Transcript not found' });
        }
        logger_1.logger.info('[TRANSCRIPTS] Transcript deleted', {
            meetingId,
            transcriptId,
            userId: req.user?.userId,
        });
        res.json({ success: true, message: 'Transcript deleted' });
    }
    catch (err) {
        logger_1.logger.error('Error deleting transcript', err);
        res.status(500).json({ success: false, error: 'Failed to delete transcript' });
    }
});
// ── Generate Minutes from Transcripts ───────────────────────
// Manually trigger minute generation (automatic trigger happens on meeting end)
router.post('/:meetingId/generate-minutes', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin', 'executive'), (0, middleware_1.validate)(generateMinutesSchema), async (req, res) => {
    try {
        const { meetingId } = req.params;
        const { format, includeAttendees, includeTiming } = req.body;
        // Verify meeting exists
        const meeting = await (0, db_1.default)('meetings')
            .where({ id: meetingId, organization_id: req.membership?.organizationId })
            .first();
        if (!meeting) {
            return res.status(404).json({ success: false, error: 'Meeting not found' });
        }
        // Check if transcripts exist
        const transcriptCount = await (0, db_1.default)('meeting_transcripts')
            .where({ meeting_id: meetingId })
            .count('id as count')
            .first();
        const count = parseInt(transcriptCount?.count);
        if (count === 0) {
            return res.status(400).json({
                success: false,
                error: 'No transcripts available for this meeting',
            });
        }
        // Check if minutes are already being processed
        const existing = await (0, db_1.default)('meeting_minutes').where({ meeting_id: meetingId }).first();
        if (existing && existing.status === 'processing') {
            return res.status(400).json({
                success: false,
                error: 'Minutes are already being processed',
            });
        }
        // Create or reset minutes record
        const now = new Date();
        await (0, db_1.default)('meeting_minutes')
            .where({ meeting_id: meetingId })
            .update({
            status: 'processing',
            error_message: null,
            updated_at: now,
        })
            .catch(async () => {
            // Record doesn't exist, create it
            await (0, db_1.default)('meeting_minutes').insert({
                meeting_id: meetingId,
                organization_id: req.membership?.organizationId,
                status: 'processing',
                created_at: now,
                updated_at: now,
            });
        });
        // Queue minute generation job
        try {
            logger_1.logger.info('[MINUTES] Manual generation triggered', {
                meetingId,
                initiatedBy: req.user?.userId,
                format,
            });
            await (0, minutes_queue_1.submitMinutesJob)({
                meetingId,
                organizationId: req.membership?.organizationId || '',
            });
            res.json({
                success: true,
                message: 'Minute generation queued',
                data: { meetingId, status: 'processing' },
            });
        }
        catch (jobErr) {
            logger_1.logger.error('[MINUTES] Failed to queue generation job', {
                meetingId,
                error: jobErr.message,
            });
            // Update status to failed
            await (0, db_1.default)('meeting_minutes')
                .where({ meeting_id: meetingId })
                .update({
                status: 'failed',
                error_message: 'Failed to queue processing: ' + jobErr.message,
            });
            res.status(500).json({
                success: false,
                error: 'Failed to queue minute generation',
            });
        }
    }
    catch (err) {
        logger_1.logger.error('Error triggering minute generation', err);
        res.status(500).json({ success: false, error: 'Failed to generate minutes' });
    }
});
// ── Get Minutes Status ──────────────────────────────────────
router.get('/:meetingId/minutes', middleware_1.authenticate, middleware_1.loadMembership, async (req, res) => {
    try {
        const { meetingId } = req.params;
        // Verify meeting exists
        const meeting = await (0, db_1.default)('meetings')
            .where({ id: meetingId, organization_id: req.membership?.organizationId })
            .first();
        if (!meeting) {
            return res.status(404).json({ success: false, error: 'Meeting not found' });
        }
        const minutes = await (0, db_1.default)('meeting_minutes')
            .where({ meeting_id: meetingId })
            .first();
        if (!minutes) {
            return res.status(404).json({ success: false, error: 'No minutes found for this meeting' });
        }
        res.json({ success: true, data: minutes });
    }
    catch (err) {
        logger_1.logger.error('Error fetching minutes', err);
        res.status(500).json({ success: false, error: 'Failed to fetch minutes' });
    }
});
exports.default = router;
//# sourceMappingURL=transcripts.js.map