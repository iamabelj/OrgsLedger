"use strict";
// ============================================================
// OrgsLedger API — Meeting Service
// Core business logic for meeting operations
// Event-driven architecture with Redis state management
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.meetingService = exports.MeetingService = void 0;
const db_1 = __importDefault(require("../../../db"));
const logger_1 = require("../../../logger");
const models_1 = require("../models");
const meeting_cache_service_1 = require("./meeting-cache.service");
const event_bus_service_1 = require("./event-bus.service");
const livekit_audio_bot_service_1 = require("./livekit-audio-bot.service");
const livekit_token_service_1 = require("./livekit-token.service");
const transcript_queue_1 = require("../../../queues/transcript.queue");
const backpressure_1 = require("../../../scaling/backpressure");
const meeting_cleanup_service_1 = require("../../../services/meeting-cleanup.service");
// ── Constants ───────────────────────────────────────────────
const MAX_PARTICIPANTS_DEFAULT = 100;
/**
 * Emit a meeting event via Redis PubSub event bus
 * WebSocket gateway subscribes and broadcasts to Socket.IO
 */
async function emitMeetingEvent(event) {
    try {
        await (0, event_bus_service_1.publishEvent)(event_bus_service_1.EVENT_CHANNELS.MEETING_EVENTS, {
            type: event.type,
            timestamp: event.timestamp,
            data: {
                meetingId: event.meetingId,
                organizationId: event.organizationId,
                ...event.data,
            },
        });
    }
    catch (err) {
        logger_1.logger.warn('[MEETING] Failed to publish event', {
            type: event.type,
            error: err.message
        });
    }
}
// ── Service Class ───────────────────────────────────────────
class MeetingService {
    /**
     * Create a new meeting
     */
    async create(hostId, request) {
        const settings = {
            maxParticipants: MAX_PARTICIPANTS_DEFAULT,
            allowRecording: false,
            waitingRoom: false,
            muteOnEntry: true,
            allowScreenShare: true,
            ...request.settings,
        };
        const hostParticipant = {
            userId: hostId,
            role: 'host',
            joinedAt: new Date().toISOString(),
        };
        const [row] = await (0, db_1.default)('meetings')
            .insert({
            organization_id: request.organizationId,
            host_id: hostId,
            title: request.title || null,
            description: request.description || null,
            status: 'scheduled',
            participants: JSON.stringify([hostParticipant]),
            settings: JSON.stringify(settings),
            scheduled_at: request.scheduledAt || null,
        })
            .returning('*');
        const meeting = (0, models_1.meetingFromRow)(row);
        logger_1.logger.info('[MEETING] Created', {
            meetingId: meeting.id,
            orgId: meeting.organizationId,
            hostId: meeting.hostId,
        });
        // Emit event
        await emitMeetingEvent({
            type: 'meeting:created',
            meetingId: meeting.id,
            organizationId: meeting.organizationId,
            timestamp: meeting.createdAt,
            data: { hostId, title: meeting.title },
        });
        return meeting;
    }
    /**
     * Get meeting by ID
     */
    async getById(meetingId) {
        const row = await (0, db_1.default)('meetings')
            .where({ id: meetingId })
            .first();
        if (!row)
            return null;
        return (0, models_1.meetingFromRow)(row);
    }
    /**
     * Get meeting by ID with active state from Redis
     * Returns fresh participant list from cache if meeting is active
     */
    async getByIdWithState(meetingId) {
        const meeting = await this.getById(meetingId);
        if (!meeting)
            return null;
        // If meeting is active, overlay real-time state from Redis
        if (meeting.status === 'active') {
            const activeState = await (0, meeting_cache_service_1.getActiveMeetingState)(meetingId);
            if (activeState) {
                meeting.participants = activeState.participants;
            }
        }
        return meeting;
    }
    /**
     * List meetings for an organization
     */
    async listByOrganization(organizationId, options = {}) {
        const { status, page = 1, limit = 20 } = options;
        const offset = (page - 1) * limit;
        let query = (0, db_1.default)('meetings').where({ organization_id: organizationId });
        if (status) {
            query = query.where({ status });
        }
        // Safe count query pattern
        const countResult = await query.clone().count({ count: '*' }).first();
        const total = parseInt(String(countResult?.count ?? '0'), 10);
        const rows = await query
            .orderBy('created_at', 'desc')
            .offset(offset)
            .limit(limit);
        return {
            meetings: rows.map(models_1.meetingFromRow),
            total,
        };
    }
    /**
     * Start a meeting (transition from scheduled to active)
     */
    async start(meetingId, userId) {
        const meeting = await this.getById(meetingId);
        if (!meeting) {
            throw new Error('Meeting not found');
        }
        if (meeting.hostId !== userId) {
            throw new Error('Only the host can start the meeting');
        }
        if (meeting.status !== 'scheduled') {
            throw new Error(`Cannot start meeting with status: ${meeting.status}`);
        }
        const now = new Date().toISOString();
        // Update in database
        const [row] = await (0, db_1.default)('meetings')
            .where({ id: meetingId })
            .update({
            status: 'active',
            started_at: now,
        })
            .returning('*');
        const updatedMeeting = (0, models_1.meetingFromRow)(row);
        // Store active state in Redis for real-time access
        const activeState = {
            meetingId: updatedMeeting.id,
            organizationId: updatedMeeting.organizationId,
            hostId: updatedMeeting.hostId,
            status: 'active',
            participants: updatedMeeting.participants,
            startedAt: now,
            lastActivityAt: now,
        };
        await (0, meeting_cache_service_1.setActiveMeetingState)(activeState);
        logger_1.logger.info('[MEETING] Started', {
            meetingId,
            orgId: updatedMeeting.organizationId,
        });
        // Emit event
        await emitMeetingEvent({
            type: 'meeting:started',
            meetingId,
            organizationId: updatedMeeting.organizationId,
            timestamp: now,
            data: { startedBy: userId },
        });
        // Start LiveKit room and audio bot (async, don't block)
        this.initializeLiveMedia(meetingId, updatedMeeting.organizationId).catch((err) => {
            logger_1.logger.warn('[MEETING] Failed to initialize live media', {
                meetingId,
                error: err.message,
            });
        });
        return updatedMeeting;
    }
    /**
     * Initialize LiveKit room and audio bot for transcription
     */
    async initializeLiveMedia(meetingId, organizationId) {
        try {
            // Create LiveKit room if credentials are configured
            await (0, livekit_token_service_1.createRoomIfNotExists)(meetingId);
            // Start audio bot for transcription
            await (0, livekit_audio_bot_service_1.startAudioBot)({
                meetingId,
                organizationId,
            });
            logger_1.logger.info('[MEETING] Live media initialized', { meetingId });
        }
        catch (err) {
            logger_1.logger.warn('[MEETING] Live media init failed (optional)', {
                meetingId,
                error: err.message,
            });
            // Don't throw - live media is optional
        }
    }
    /**
     * Join an active meeting
     */
    async join(meetingId, userId, displayName) {
        const meeting = await this.getByIdWithState(meetingId);
        if (!meeting) {
            throw new Error('Meeting not found');
        }
        // If meeting is scheduled and user is host, auto-start it
        if (meeting.status === 'scheduled' && meeting.hostId === userId) {
            const startedMeeting = await this.start(meetingId, userId);
            return startedMeeting;
        }
        if (meeting.status !== 'active') {
            throw new Error(`Cannot join meeting with status: ${meeting.status}`);
        }
        // Check if user is already in meeting
        const existingParticipant = meeting.participants.find(p => p.userId === userId);
        if (existingParticipant && !existingParticipant.leftAt) {
            // Already in meeting, just return current state
            return meeting;
        }
        // Check max participants
        const activeParticipants = meeting.participants.filter(p => !p.leftAt);
        const maxParticipants = meeting.settings.maxParticipants || MAX_PARTICIPANTS_DEFAULT;
        if (activeParticipants.length >= maxParticipants) {
            throw new Error('Meeting is at capacity');
        }
        const now = new Date().toISOString();
        // Add or update participant
        let participants;
        if (existingParticipant) {
            // User rejoining - update their record
            participants = meeting.participants.map(p => p.userId === userId
                ? { ...p, joinedAt: now, leftAt: undefined, displayName }
                : p);
        }
        else {
            // New participant
            const newParticipant = {
                userId,
                role: 'participant',
                joinedAt: now,
                displayName,
            };
            participants = [...meeting.participants, newParticipant];
        }
        // Update Redis state only (no database write during active meeting)
        await (0, meeting_cache_service_1.updateMeetingParticipants)(meetingId, participants);
        // Update meeting object with new participants for response
        const updatedMeeting = {
            ...meeting,
            participants,
        };
        logger_1.logger.info('[MEETING] Participant joined', {
            meetingId,
            userId,
            participantCount: participants.filter(p => !p.leftAt).length,
        });
        // Emit event via Redis PubSub
        await emitMeetingEvent({
            type: 'meeting:participant:joined',
            meetingId,
            organizationId: updatedMeeting.organizationId,
            timestamp: now,
            data: { userId, displayName },
        });
        return updatedMeeting;
    }
    /**
     * Leave a meeting
     */
    async leave(meetingId, userId) {
        const meeting = await this.getByIdWithState(meetingId);
        if (!meeting) {
            throw new Error('Meeting not found');
        }
        if (meeting.status !== 'active') {
            throw new Error(`Cannot leave meeting with status: ${meeting.status}`);
        }
        const now = new Date().toISOString();
        // Mark participant as left
        const participants = meeting.participants.map(p => p.userId === userId ? { ...p, leftAt: now } : p);
        // Update Redis state only (no database write during active meeting)
        await (0, meeting_cache_service_1.updateMeetingParticipants)(meetingId, participants);
        // Check if all participants have left (auto-end meeting)
        const activeParticipants = participants.filter(p => !p.leftAt);
        if (activeParticipants.length === 0) {
            // End meeting if everyone left
            return this.end(meetingId, userId);
        }
        // If host left, the meeting continues but could transfer host
        // For now, meeting continues until ended explicitly
        // Update meeting object with new participants for response
        const updatedMeeting = {
            ...meeting,
            participants,
        };
        logger_1.logger.info('[MEETING] Participant left', {
            meetingId,
            userId,
            remainingParticipants: activeParticipants.length,
        });
        // Emit event via Redis PubSub
        await emitMeetingEvent({
            type: 'meeting:participant:left',
            meetingId,
            organizationId: updatedMeeting.organizationId,
            timestamp: now,
            data: { userId, remainingCount: activeParticipants.length },
        });
        return updatedMeeting;
    }
    /**
     * End a meeting
     * Persists participants from Redis to meeting_participants table
     */
    async end(meetingId, userId) {
        const meeting = await this.getById(meetingId);
        if (!meeting) {
            throw new Error('Meeting not found');
        }
        if (meeting.status === 'ended' || meeting.status === 'cancelled') {
            throw new Error(`Meeting already ${meeting.status}`);
        }
        // Only host can end a meeting
        if (meeting.hostId !== userId) {
            throw new Error('Only the host can end the meeting');
        }
        const now = new Date().toISOString();
        // Get final participant state from Redis (source of truth during active meeting)
        const activeState = await (0, meeting_cache_service_1.getActiveMeetingState)(meetingId);
        const participants = activeState?.participants || meeting.participants;
        // Mark all participants as left
        const finalParticipants = participants.map(p => p.leftAt ? p : { ...p, leftAt: now });
        // Bulk insert participants to relational table
        await this.persistParticipants(meetingId, finalParticipants);
        // Update meeting status in database (no longer storing participants JSON)
        const [row] = await (0, db_1.default)('meetings')
            .where({ id: meetingId })
            .update({
            status: 'ended',
            ended_at: now,
            // Keep JSON for backward compatibility but mark as archived
            participants: JSON.stringify(finalParticipants),
        })
            .returning('*');
        // Remove from Redis active state
        await (0, meeting_cache_service_1.removeActiveMeetingState)(meetingId, meeting.organizationId);
        const updatedMeeting = (0, models_1.meetingFromRow)(row);
        logger_1.logger.info('[MEETING] Ended', {
            meetingId,
            orgId: meeting.organizationId,
            participantCount: finalParticipants.length,
            duration: meeting.startedAt
                ? (new Date(now).getTime() - new Date(meeting.startedAt).getTime()) / 1000
                : 0,
        });
        // Emit event via Redis PubSub
        await emitMeetingEvent({
            type: 'meeting:ended',
            meetingId,
            organizationId: updatedMeeting.organizationId,
            timestamp: now,
            data: { endedBy: userId, participantCount: finalParticipants.length },
        });
        // Cleanup live media and trigger minutes generation (async, don't block)
        this.finalizeLiveMedia(meetingId, meeting.organizationId).catch((err) => {
            logger_1.logger.warn('[MEETING] Failed to finalize live media', {
                meetingId,
                error: err.message,
            });
        });
        return updatedMeeting;
    }
    /**
     * Finalize live media: stop audio bot, delete room, generate minutes, cleanup
     */
    async finalizeLiveMedia(meetingId, organizationId) {
        try {
            // Stop audio bot
            await (0, livekit_audio_bot_service_1.stopAudioBot)(meetingId);
            // Delete LiveKit room
            await (0, livekit_token_service_1.deleteRoom)(meetingId);
            // Check backpressure before queueing minutes
            const backpressureStatus = await (0, backpressure_1.checkMinutesBackpressure)();
            if (!backpressureStatus.allowed) {
                logger_1.logger.warn('[MEETING] Backpressure triggered, delaying minutes generation', {
                    meetingId,
                    queueUtilization: backpressureStatus.utilizationPercent.toFixed(1) + '%',
                    retryAfter: backpressureStatus.retryAfter,
                });
                // Still queue with a delay based on retry hint
                await (0, transcript_queue_1.submitMinutesJob)({
                    meetingId,
                    organizationId,
                }, { delay: (backpressureStatus.retryAfter || 30) * 1000 });
                // Perform cold meeting eviction (cleanup Redis, WebSocket rooms, queue jobs)
                await (0, meeting_cleanup_service_1.cleanupMeeting)(meetingId, organizationId);
                return;
            }
            // Queue minutes generation
            await (0, transcript_queue_1.submitMinutesJob)({
                meetingId,
                organizationId,
            });
            // Perform cold meeting eviction (cleanup Redis, WebSocket rooms, queue jobs)
            const cleanupResult = await (0, meeting_cleanup_service_1.cleanupMeeting)(meetingId, organizationId);
            if (!cleanupResult.success) {
                logger_1.logger.warn('[MEETING] Partial cleanup', {
                    meetingId,
                    errors: cleanupResult.errors,
                    durationMs: cleanupResult.durationMs,
                });
            }
            logger_1.logger.info('[MEETING] Live media finalized', { meetingId });
        }
        catch (err) {
            if ((0, backpressure_1.isBackpressureError)(err)) {
                logger_1.logger.warn('[MEETING] Backpressure error during finalization', {
                    meetingId,
                    retryAfter: err.retryAfter,
                });
                // Attempt delayed submission
                try {
                    await (0, transcript_queue_1.submitMinutesJob)({
                        meetingId,
                        organizationId,
                    }, { delay: err.retryAfter * 1000 });
                }
                catch {
                    // Ignore - we tried our best
                }
                // Still perform cleanup even on backpressure
                await (0, meeting_cleanup_service_1.cleanupMeeting)(meetingId, organizationId).catch(() => { });
                return;
            }
            logger_1.logger.warn('[MEETING] Live media finalization failed', {
                meetingId,
                error: err.message,
            });
            // Still attempt cleanup even if finalization failed
            await (0, meeting_cleanup_service_1.cleanupMeeting)(meetingId, organizationId).catch(() => { });
            // Don't throw - finalization errors shouldn't affect meeting end
        }
    }
    /**
     * Persist participants to relational table (called when meeting ends)
     */
    async persistParticipants(meetingId, participants) {
        if (participants.length === 0)
            return;
        const records = participants.map(p => ({
            meeting_id: meetingId,
            user_id: p.userId,
            role: p.role,
            display_name: p.displayName || null,
            joined_at: p.joinedAt,
            left_at: p.leftAt || null,
        }));
        try {
            // Bulk insert for efficiency
            await (0, db_1.default)('meeting_participants').insert(records);
            logger_1.logger.info('[MEETING] Persisted participants', {
                meetingId,
                count: records.length,
            });
        }
        catch (err) {
            logger_1.logger.error('[MEETING] Failed to persist participants', {
                meetingId,
                error: err.message,
            });
            // Don't throw - meeting should still end even if persistence fails
            // Participants are still in JSON column as backup
        }
    }
    /**
     * Cancel a scheduled meeting
     */
    async cancel(meetingId, userId) {
        const meeting = await this.getById(meetingId);
        if (!meeting) {
            throw new Error('Meeting not found');
        }
        if (meeting.status !== 'scheduled') {
            throw new Error('Can only cancel scheduled meetings');
        }
        if (meeting.hostId !== userId) {
            throw new Error('Only the host can cancel the meeting');
        }
        const now = new Date().toISOString();
        const [row] = await (0, db_1.default)('meetings')
            .where({ id: meetingId })
            .update({
            status: 'cancelled',
            ended_at: now,
        })
            .returning('*');
        const updatedMeeting = (0, models_1.meetingFromRow)(row);
        logger_1.logger.info('[MEETING] Cancelled', { meetingId });
        // Emit event
        await emitMeetingEvent({
            type: 'meeting:cancelled',
            meetingId,
            organizationId: updatedMeeting.organizationId,
            timestamp: now,
            data: { cancelledBy: userId },
        });
        return updatedMeeting;
    }
    /**
     * Get active participant count for a meeting
     */
    async getParticipantCount(meetingId) {
        const meeting = await this.getByIdWithState(meetingId);
        if (!meeting)
            return 0;
        return meeting.participants.filter(p => !p.leftAt).length;
    }
    /**
     * Check if user is participant in meeting
     */
    async isParticipant(meetingId, userId) {
        const meeting = await this.getByIdWithState(meetingId);
        if (!meeting)
            return false;
        const participant = meeting.participants.find(p => p.userId === userId);
        return !!participant && !participant.leftAt;
    }
    /**
     * Get meeting minutes
     * Returns null if minutes haven't been generated yet
     */
    async getMinutes(meetingId) {
        try {
            // Use actual DB schema columns:
            // summary, decisions, action_items, contributions, generated_at
            const row = await (0, db_1.default)('meeting_minutes')
                .where('meeting_id', meetingId)
                .select('summary', 'decisions', 'action_items', 'contributions', 'generated_at')
                .first();
            if (!row) {
                return null;
            }
            // Parse contributions to extract participant names
            const contributions = typeof row.contributions === 'string'
                ? JSON.parse(row.contributions)
                : (row.contributions || []);
            const participants = contributions.map((c) => c.speaker || c.name).filter(Boolean);
            return {
                summary: row.summary,
                keyTopics: [], // Not stored in current schema
                decisions: typeof row.decisions === 'string'
                    ? JSON.parse(row.decisions)
                    : (row.decisions || []),
                actionItems: typeof row.action_items === 'string'
                    ? JSON.parse(row.action_items)
                    : (row.action_items || []),
                participants,
                wordCount: 0, // Not stored in current schema
                generatedAt: row.generated_at,
            };
        }
        catch (err) {
            // Table might not exist yet
            if (err.message?.includes('does not exist') || err.message?.includes('no such table')) {
                logger_1.logger.warn('[MEETING] meeting_minutes table not found');
                return null;
            }
            throw err;
        }
    }
    /**
     * Resubmit a minutes generation job
     * Deletes existing minutes first for regeneration
     */
    async resubmitMinutesJob(meetingId, organizationId) {
        // Check backpressure first - for manual resubmission, we want to fail early
        const backpressureStatus = await (0, backpressure_1.checkMinutesBackpressure)();
        if (!backpressureStatus.allowed) {
            const error = new Error(`System overloaded. Please retry after ${backpressureStatus.retryAfter} seconds.`);
            error.code = 'SYSTEM_OVERLOADED';
            error.retryAfter = backpressureStatus.retryAfter;
            throw error;
        }
        try {
            // Delete existing minutes
            await (0, db_1.default)('meeting_minutes')
                .where('meeting_id', meetingId)
                .del();
            logger_1.logger.info('[MEETING] Deleted existing minutes for regeneration', { meetingId });
        }
        catch (err) {
            // Table might not exist - that's fine
            if (!err.message?.includes('does not exist') && !err.message?.includes('no such table')) {
                throw err;
            }
        }
        // Submit new job
        await (0, transcript_queue_1.submitMinutesJob)({
            meetingId,
            organizationId,
        });
        logger_1.logger.info('[MEETING] Resubmitted minutes generation job', { meetingId });
    }
}
exports.MeetingService = MeetingService;
// Export singleton instance
exports.meetingService = new MeetingService();
//# sourceMappingURL=meeting.service.js.map