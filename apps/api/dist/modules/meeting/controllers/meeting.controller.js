"use strict";
// ============================================================
// OrgsLedger API — Meeting Controller
// Handles HTTP request/response for meeting operations
// Delegates business logic to service layer
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.meetingController = exports.MeetingController = void 0;
const services_1 = require("../services");
const formatters_1 = require("../../../utils/formatters");
const logger_1 = require("../../../logger");
const livekit_token_service_1 = require("../services/livekit-token.service");
/**
 * Format meeting for API response
 */
function formatMeetingResponse(meeting) {
    return {
        id: meeting.id,
        organizationId: meeting.organizationId,
        hostId: meeting.hostId,
        title: meeting.title,
        description: meeting.description,
        status: meeting.status,
        participants: meeting.participants.map((p) => ({
            userId: p.userId,
            role: p.role,
            joinedAt: p.joinedAt,
            leftAt: p.leftAt,
            displayName: p.displayName,
        })),
        settings: meeting.settings,
        scheduledAt: meeting.scheduledAt,
        startedAt: meeting.startedAt,
        endedAt: meeting.endedAt,
        createdAt: meeting.createdAt,
        updatedAt: meeting.updatedAt,
        // Computed fields
        participantCount: meeting.participants.filter((p) => !p.leftAt).length,
        isActive: meeting.status === 'active',
    };
}
class MeetingController {
    /**
     * POST /meetings/create
     * Create a new meeting
     */
    async create(req, res, next) {
        try {
            const userId = req.user.userId;
            const { organizationId, title, description, scheduledAt, settings } = req.body;
            if (!organizationId) {
                res.status(400).json({
                    success: false,
                    error: 'organizationId is required',
                });
                return;
            }
            const request = {
                organizationId,
                title,
                description,
                scheduledAt,
                settings,
            };
            const meeting = await services_1.meetingService.create(userId, request);
            res.status(201).json({
                success: true,
                data: formatMeetingResponse(meeting),
            });
        }
        catch (error) {
            logger_1.logger.error('[MEETING_CONTROLLER] Create failed', {
                error: error.message,
                userId: req.user?.userId,
            });
            next(error);
        }
    }
    /**
     * POST /meetings/join
     * Join an existing meeting
     */
    async join(req, res, next) {
        try {
            const userId = req.user.userId;
            const { meetingId, displayName } = req.body;
            if (!meetingId) {
                res.status(400).json({
                    success: false,
                    error: 'meetingId is required',
                });
                return;
            }
            const meeting = await services_1.meetingService.join(meetingId, userId, displayName);
            res.json({
                success: true,
                data: formatMeetingResponse(meeting),
            });
        }
        catch (error) {
            logger_1.logger.error('[MEETING_CONTROLLER] Join failed', {
                error: error.message,
                userId: req.user?.userId,
            });
            // Handle specific errors
            if (error.message === 'Meeting not found') {
                res.status(404).json({ success: false, error: error.message });
                return;
            }
            if (error.message.includes('Cannot join') || error.message === 'Meeting is at capacity') {
                res.status(400).json({ success: false, error: error.message });
                return;
            }
            next(error);
        }
    }
    /**
     * POST /meetings/leave
     * Leave a meeting
     */
    async leave(req, res, next) {
        try {
            const userId = req.user.userId;
            const { meetingId } = req.body;
            if (!meetingId) {
                res.status(400).json({
                    success: false,
                    error: 'meetingId is required',
                });
                return;
            }
            const meeting = await services_1.meetingService.leave(meetingId, userId);
            res.json({
                success: true,
                data: formatMeetingResponse(meeting),
            });
        }
        catch (error) {
            logger_1.logger.error('[MEETING_CONTROLLER] Leave failed', {
                error: error.message,
                userId: req.user?.userId,
            });
            if (error.message === 'Meeting not found') {
                res.status(404).json({ success: false, error: error.message });
                return;
            }
            if (error.message.includes('Cannot leave')) {
                res.status(400).json({ success: false, error: error.message });
                return;
            }
            next(error);
        }
    }
    /**
     * GET /meetings/:id
     * Get meeting details
     */
    async getById(req, res, next) {
        try {
            const { id } = req.params;
            const meeting = await services_1.meetingService.getByIdWithState(id);
            if (!meeting) {
                res.status(404).json({
                    success: false,
                    error: 'Meeting not found',
                });
                return;
            }
            res.json({
                success: true,
                data: formatMeetingResponse(meeting),
            });
        }
        catch (error) {
            logger_1.logger.error('[MEETING_CONTROLLER] GetById failed', {
                error: error.message,
                meetingId: req.params.id,
            });
            next(error);
        }
    }
    /**
     * GET /meetings
     * List meetings for an organization
     */
    async list(req, res, next) {
        try {
            const { organizationId, status } = req.query;
            const { page, limit } = (0, formatters_1.parsePagination)(req.query);
            if (!organizationId) {
                res.status(400).json({
                    success: false,
                    error: 'organizationId query parameter is required',
                });
                return;
            }
            const result = await services_1.meetingService.listByOrganization(organizationId, {
                status: status,
                page,
                limit,
            });
            res.json({
                success: true,
                data: result.meetings.map(formatMeetingResponse),
                meta: {
                    page,
                    limit,
                    total: result.total,
                    totalPages: Math.ceil(result.total / limit),
                },
            });
        }
        catch (error) {
            logger_1.logger.error('[MEETING_CONTROLLER] List failed', { error: error.message });
            next(error);
        }
    }
    /**
     * POST /meetings/:id/start
     * Start a scheduled meeting
     */
    async start(req, res, next) {
        try {
            const userId = req.user.userId;
            const { id } = req.params;
            const meeting = await services_1.meetingService.start(id, userId);
            res.json({
                success: true,
                data: formatMeetingResponse(meeting),
            });
        }
        catch (error) {
            logger_1.logger.error('[MEETING_CONTROLLER] Start failed', {
                error: error.message,
                meetingId: req.params.id,
            });
            if (error.message === 'Meeting not found') {
                res.status(404).json({ success: false, error: error.message });
                return;
            }
            if (error.message.includes('Only the host') || error.message.includes('Cannot start')) {
                res.status(403).json({ success: false, error: error.message });
                return;
            }
            next(error);
        }
    }
    /**
     * POST /meetings/:id/end
     * End an active meeting
     */
    async end(req, res, next) {
        try {
            const userId = req.user.userId;
            const { id } = req.params;
            const meeting = await services_1.meetingService.end(id, userId);
            res.json({
                success: true,
                data: formatMeetingResponse(meeting),
            });
        }
        catch (error) {
            logger_1.logger.error('[MEETING_CONTROLLER] End failed', {
                error: error.message,
                meetingId: req.params.id,
            });
            if (error.message === 'Meeting not found') {
                res.status(404).json({ success: false, error: error.message });
                return;
            }
            if (error.message.includes('Only the host') || error.message.includes('already')) {
                res.status(403).json({ success: false, error: error.message });
                return;
            }
            next(error);
        }
    }
    /**
     * POST /meetings/:id/cancel
     * Cancel a scheduled meeting
     */
    async cancel(req, res, next) {
        try {
            const userId = req.user.userId;
            const { id } = req.params;
            const meeting = await services_1.meetingService.cancel(id, userId);
            res.json({
                success: true,
                data: formatMeetingResponse(meeting),
            });
        }
        catch (error) {
            logger_1.logger.error('[MEETING_CONTROLLER] Cancel failed', {
                error: error.message,
                meetingId: req.params.id,
            });
            if (error.message === 'Meeting not found') {
                res.status(404).json({ success: false, error: error.message });
                return;
            }
            if (error.message.includes('Only the host') || error.message.includes('Can only cancel')) {
                res.status(403).json({ success: false, error: error.message });
                return;
            }
            next(error);
        }
    }
    /**
     * POST /meetings/:id/token
     * Generate LiveKit token for joining meeting media
     */
    async getToken(req, res, next) {
        try {
            const userId = req.user.userId;
            const { id } = req.params;
            const { displayName } = req.body;
            // Verify meeting exists and user has access
            const meeting = await services_1.meetingService.getByIdWithState(id);
            if (!meeting) {
                res.status(404).json({
                    success: false,
                    error: 'Meeting not found',
                });
                return;
            }
            // Check if meeting is in a joinable state
            if (meeting.status !== 'active' && meeting.status !== 'scheduled') {
                res.status(400).json({
                    success: false,
                    error: `Cannot join meeting with status: ${meeting.status}`,
                });
                return;
            }
            // Determine participant role
            const isHost = meeting.hostId === userId;
            const role = isHost ? 'host' : 'participant';
            // Ensure LiveKit room exists
            await (0, livekit_token_service_1.createRoomIfNotExists)(id);
            // Generate token
            const tokenResponse = await (0, livekit_token_service_1.generateParticipantToken)({
                meetingId: id,
                userId,
                name: displayName || `User-${userId.slice(0, 8)}`,
                role,
            });
            logger_1.logger.info('[MEETING_CONTROLLER] Token generated', {
                meetingId: id,
                userId,
                role,
            });
            res.json({
                success: true,
                data: {
                    token: tokenResponse.token,
                    url: tokenResponse.url,
                    roomName: tokenResponse.roomName,
                    role,
                },
            });
        }
        catch (error) {
            logger_1.logger.error('[MEETING_CONTROLLER] GetToken failed', {
                error: error.message,
                meetingId: req.params.id,
                userId: req.user?.userId,
            });
            if (error.message.includes('not configured')) {
                res.status(503).json({
                    success: false,
                    error: 'LiveKit service not configured',
                });
                return;
            }
            next(error);
        }
    }
    /**
     * GET /meetings/:id/minutes
     * Get AI-generated meeting minutes
     * Requires authentication + meeting access
     */
    async getMinutes(req, res, next) {
        try {
            const userId = req.user.userId;
            const { id } = req.params;
            // Verify meeting exists
            const meeting = await services_1.meetingService.getByIdWithState(id);
            if (!meeting) {
                res.status(404).json({
                    success: false,
                    error: 'Meeting not found',
                });
                return;
            }
            // Get minutes from service
            const minutes = await services_1.meetingService.getMinutes(id);
            if (!minutes) {
                // Check if meeting has ended (minutes only generated after end)
                if (meeting.status === 'active' || meeting.status === 'scheduled') {
                    res.status(400).json({
                        success: false,
                        error: 'Minutes are generated after the meeting ends',
                        data: { meetingStatus: meeting.status },
                    });
                    return;
                }
                // Meeting ended but minutes not yet generated
                res.status(202).json({
                    success: true,
                    error: null,
                    data: {
                        status: 'pending',
                        message: 'Minutes generation in progress',
                        meetingStatus: meeting.status,
                    },
                });
                return;
            }
            logger_1.logger.info('[MEETING_CONTROLLER] Minutes retrieved', {
                meetingId: id,
                userId,
                wordCount: minutes.wordCount,
            });
            res.json({
                success: true,
                data: {
                    meetingId: id,
                    summary: minutes.summary,
                    keyTopics: minutes.keyTopics || [],
                    decisions: minutes.decisions || [],
                    actionItems: minutes.actionItems || [],
                    participants: minutes.participants || [],
                    wordCount: minutes.wordCount,
                    generatedAt: minutes.generatedAt,
                },
            });
        }
        catch (error) {
            logger_1.logger.error('[MEETING_CONTROLLER] GetMinutes failed', {
                error: error.message,
                meetingId: req.params.id,
                userId: req.user?.userId,
            });
            next(error);
        }
    }
    /**
     * POST /meetings/:id/minutes/regenerate
     * Force regeneration of meeting minutes (admin/host only)
     * Requires authentication + host/admin role
     */
    async regenerateMinutes(req, res, next) {
        try {
            const userId = req.user.userId;
            const { id } = req.params;
            // Verify meeting exists
            const meeting = await services_1.meetingService.getByIdWithState(id);
            if (!meeting) {
                res.status(404).json({
                    success: false,
                    error: 'Meeting not found',
                });
                return;
            }
            // Check if user is host
            if (meeting.hostId !== userId) {
                res.status(403).json({
                    success: false,
                    error: 'Only the meeting host can regenerate minutes',
                });
                return;
            }
            // Check if meeting has ended
            if (meeting.status !== 'ended') {
                res.status(400).json({
                    success: false,
                    error: 'Minutes can only be regenerated for ended meetings',
                });
                return;
            }
            // Delete existing minutes and resubmit job
            await services_1.meetingService.resubmitMinutesJob(id, meeting.organizationId);
            logger_1.logger.info('[MEETING_CONTROLLER] Minutes regeneration requested', {
                meetingId: id,
                userId,
            });
            res.json({
                success: true,
                data: {
                    status: 'submitted',
                    message: 'Minutes regeneration job submitted',
                },
            });
        }
        catch (error) {
            logger_1.logger.error('[MEETING_CONTROLLER] RegenerateMinutes failed', {
                error: error.message,
                meetingId: req.params.id,
                userId: req.user?.userId,
            });
            next(error);
        }
    }
}
exports.MeetingController = MeetingController;
// Export singleton instance
exports.meetingController = new MeetingController();
//# sourceMappingURL=meeting.controller.js.map