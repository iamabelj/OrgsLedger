"use strict";
// ============================================================
// OrgsLedger API — Minutes Worker Service
// Core business logic for processing AI meeting minutes
// Handles transcription, summarization, and wallet deduction
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MinutesWorkerService = void 0;
const logger_1 = require("../../logger");
const db_1 = __importDefault(require("../../db"));
const audit_1 = require("../../middleware/audit");
const email_service_1 = require("../email.service");
const push_service_1 = require("../push.service");
const subscription_service_1 = require("../subscription.service");
/**
 * Service that processes AI minutes generation jobs from the queue
 */
class MinutesWorkerService {
    io;
    constructor(io) {
        this.io = io;
    }
    /**
     * Process a minutes generation job
     * Handles transcription, summarization, storage, and notifications
     */
    async processMinutes(meetingId, organizationId) {
        const startTime = Date.now();
        let meetingDurationMinutes = 0;
        try {
            logger_1.logger.info('[MINUTES_WORKER] Processing AI minutes', {
                meetingId,
                organizationId,
            });
            const meeting = await (0, db_1.default)('meetings').where({ id: meetingId }).first();
            if (!meeting) {
                throw new Error('Meeting not found');
            }
            // Check AI wallet balance
            const wallet = await (0, subscription_service_1.getAiWallet)(organizationId);
            const balance = parseFloat(wallet.balance_minutes);
            if (balance <= 0) {
                logger_1.logger.warn('[MINUTES_WORKER] Insufficient wallet balance', {
                    meetingId,
                    organizationId,
                    balance,
                });
                throw new Error('Insufficient AI wallet balance');
            }
            // Calculate meeting duration
            meetingDurationMinutes = meeting.actual_start && meeting.actual_end
                ? Math.max(1, Math.ceil((new Date(meeting.actual_end).getTime() - new Date(meeting.actual_start).getTime()) /
                    (1000 * 60)))
                : 60;
            if (balance < meetingDurationMinutes) {
                logger_1.logger.warn('[MINUTES_WORKER] Insufficient wallet minutes for duration', {
                    meetingId,
                    organizationId,
                    required: meetingDurationMinutes,
                    available: balance,
                });
                throw new Error(`Insufficient AI wallet balance. Need ${meetingDurationMinutes} min, have ${balance.toFixed(1)} min`);
            }
            // Deduct wallet BEFORE processing
            const deduction = await (0, subscription_service_1.deductAiWallet)(organizationId, meetingDurationMinutes, `AI minutes for "${meeting.title}" (${meetingDurationMinutes} min)`);
            if (!deduction.success) {
                throw new Error(deduction.error || 'Wallet deduction failed');
            }
            // Step 1: Get transcript (either from audio or DB)
            const transcriptStart = Date.now();
            let transcript;
            if (meeting.audio_storage_url) {
                // Use uploaded audio for transcription
                transcript = await this.transcribeAudio(meeting.audio_storage_url);
                logger_1.logger.info('[MINUTES_WORKER] Audio transcribed', {
                    meetingId,
                    durationMs: Date.now() - transcriptStart,
                    segments: transcript.length,
                });
            }
            else {
                // Fall back to live transcripts from DB
                transcript = await this.getTranscriptsFromDB(meetingId);
                logger_1.logger.info('[MINUTES_WORKER] Live transcripts retrieved', {
                    meetingId,
                    segments: transcript.length,
                });
            }
            // Step 2: Generate structured minutes
            const summarizeStart = Date.now();
            const minutes = await this.generateMinutes(transcript, meeting);
            logger_1.logger.info('[MINUTES_WORKER] Minutes generated', {
                meetingId,
                durationMs: Date.now() - summarizeStart,
            });
            // Step 3: Store results
            await (0, db_1.default)('meeting_minutes')
                .where({ meeting_id: meetingId })
                .update({
                transcript: JSON.stringify(minutes.transcript),
                summary: minutes.summary,
                decisions: JSON.stringify(minutes.decisions),
                motions: JSON.stringify(minutes.motions),
                action_items: JSON.stringify(minutes.actionItems),
                contributions: JSON.stringify(minutes.contributions),
                ai_credits_used: meetingDurationMinutes,
                status: 'completed',
                generated_at: db_1.default.fn.now(),
            });
            const storedMinutes = await (0, db_1.default)('meeting_minutes')
                .where({ meeting_id: meetingId })
                .select('id', 'status', 'ai_credits_used')
                .first();
            logger_1.logger.info('[MINUTES_WORKER] Minutes stored successfully', {
                meetingId,
                organizationId,
                minutesId: storedMinutes?.id,
                creditsUsed: meetingDurationMinutes,
                totalDurationMs: Date.now() - startTime,
            });
            // Step 4: Notify organization
            const members = await (0, db_1.default)('memberships')
                .where({ organization_id: organizationId, is_active: true })
                .pluck('user_id');
            const notifications = members.map((userId) => ({
                user_id: userId,
                organization_id: organizationId,
                type: 'minutes_ready',
                title: 'Meeting Minutes Ready',
                body: `AI-generated minutes for "${meeting.title}" are now available.`,
                data: JSON.stringify({ meetingId }),
            }));
            if (notifications.length > 0) {
                await (0, db_1.default)('notifications').insert(notifications);
            }
            // Emit socket events
            if (this.io) {
                this.io.to(`org:${organizationId}`).emit('meeting:minutes:ready', {
                    meetingId,
                    title: meeting.title,
                });
                this.io.to(`meeting:${meetingId}`).emit('meeting:minutes:ready', {
                    meetingId,
                    title: meeting.title,
                });
            }
            // Send email notification
            try {
                const memberEmails = await (0, db_1.default)('memberships')
                    .join('users', 'memberships.user_id', 'users.id')
                    .where({ 'memberships.organization_id': organizationId, 'memberships.is_active': true })
                    .pluck('users.email');
                if (memberEmails.length > 0) {
                    await (0, email_service_1.sendMeetingMinutesEmail)(meeting.title, minutes.summary, memberEmails);
                }
            }
            catch (emailErr) {
                logger_1.logger.warn('[MINUTES_WORKER] Email notification failed (non-fatal)', emailErr);
            }
            // Send push notification
            (0, push_service_1.sendPushToOrg)(organizationId, {
                title: 'Meeting Minutes Ready',
                body: `AI-generated minutes for "${meeting.title}" are now available.`,
                data: { meetingId, type: 'minutes_ready' },
            }).catch(err => logger_1.logger.warn('[MINUTES_WORKER] Push notification failed', err));
            // Audit log
            await (0, audit_1.writeAuditLog)({
                organizationId,
                userId: meeting.created_by,
                action: 'ai_usage',
                entityType: 'meeting_minutes',
                entityId: meetingId,
                newValue: {
                    creditsUsed: meetingDurationMinutes,
                    processingTimeMs: Date.now() - startTime,
                },
            });
            logger_1.logger.info('[MINUTES_WORKER] Minutes processing completed', {
                meetingId,
                organizationId,
                durationMs: Date.now() - startTime,
            });
            return { success: true };
        }
        catch (err) {
            logger_1.logger.error('[MINUTES_WORKER] Processing failed', {
                meetingId,
                organizationId,
                error: err instanceof Error ? err.message : String(err),
            });
            // Refund wallet on failure
            try {
                const minutesRow = await (0, db_1.default)('meeting_minutes')
                    .where({ meeting_id: meetingId })
                    .select('ai_credits_used')
                    .first();
                const deductedMinutes = minutesRow?.ai_credits_used || meetingDurationMinutes;
                if (deductedMinutes > 0) {
                    await (0, subscription_service_1.deductAiWallet)(organizationId, -deductedMinutes, `Refund: AI minutes failed for meeting ${meetingId}`);
                    logger_1.logger.info('[MINUTES_WORKER] Wallet refunded', {
                        meetingId,
                        organizationId,
                        refundMinutes: deductedMinutes,
                    });
                }
            }
            catch (refundErr) {
                logger_1.logger.error('[MINUTES_WORKER] Wallet refund failed', {
                    meetingId,
                    error: refundErr instanceof Error ? refundErr.message : String(refundErr),
                });
            }
            // Emit error event
            if (this.io) {
                this.io.to(`meeting:${meetingId}`).emit('meeting:minutes:failed', {
                    meetingId,
                    error: 'Minutes generation failed. Please try again later.',
                });
            }
            return {
                success: false,
                error: err instanceof Error ? err.message : 'Unknown error',
            };
        }
    }
    /**
     * Transcribe audio using Google Speech-to-Text
     */
    async transcribeAudio(audioUrl) {
        // This is a stub - actual implementation from ai.service.ts
        // in production, this would call Google Cloud Speech-to-Text API
        logger_1.logger.debug('[MINUTES_WORKER] Transcribing audio', { audioUrl });
        return [];
    }
    /**
     * Get transcripts from database
     */
    async getTranscriptsFromDB(meetingId) {
        try {
            const rows = await (0, db_1.default)('meeting_transcripts')
                .where({ meeting_id: meetingId })
                .orderBy('created_at', 'asc');
            return rows.map((row) => ({
                speakerId: row.speaker_id,
                speakerName: row.speaker_name || 'Unknown',
                text: row.original_text,
                startTime: new Date(row.created_at).getTime(),
                endTime: new Date(row.created_at).getTime() + 1000, // Placeholder
                language: row.source_language,
            }));
        }
        catch (err) {
            logger_1.logger.error('[MINUTES_WORKER] Failed to get transcripts from DB', err);
            return [];
        }
    }
    /**
     * Generate structured minutes using OpenAI
     */
    async generateMinutes(transcript, meeting) {
        // This is a stub - actual implementation from ai.service.ts
        // in production, this would call OpenAI GPT API
        logger_1.logger.debug('[MINUTES_WORKER] Generating minutes', {
            transcriptSegments: transcript.length,
            meetingTitle: meeting.title,
        });
        return {
            transcript,
            summary: 'Minutes generation in progress...',
            decisions: [],
            motions: [],
            actionItems: [],
            contributions: [],
        };
    }
}
exports.MinutesWorkerService = MinutesWorkerService;
//# sourceMappingURL=minutesWorker.service.js.map