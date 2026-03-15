"use strict";
// ============================================================
// OrgsLedger API — Meeting Invite Service
// Manages meeting invitations and access
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.meetingInviteService = void 0;
const db_1 = __importDefault(require("../../../db"));
const logger_1 = require("../../../logger");
const organization_role_service_1 = require("./organization-role.service");
const error_handler_1 = require("../../../middleware/error-handler");
// ── Service Class ───────────────────────────────────────────
class MeetingInviteService {
    /**
     * Create a single invite
     */
    async createInvite(request) {
        try {
            const [row] = await (0, db_1.default)('meeting_invites')
                .insert({
                meeting_id: request.meetingId,
                user_id: request.userId,
                role: request.role || 'participant',
                invited_by: request.invitedBy,
                status: 'pending',
            })
                .returning('*');
            logger_1.logger.debug('[MEETING_INVITE] Invite created', {
                meetingId: request.meetingId,
                userId: request.userId,
            });
            return this.inviteFromRow(row);
        }
        catch (err) {
            if (err.code === '23505') { // Unique violation
                // Already invited, just return existing
                const existing = await this.getInvite(request.meetingId, request.userId);
                if (existing)
                    return existing;
            }
            throw err;
        }
    }
    /**
     * Create multiple invites efficiently
     */
    async createBulkInvites(request) {
        if (request.userIds.length === 0)
            return 0;
        const invites = request.userIds.map(userId => ({
            meeting_id: request.meetingId,
            user_id: userId,
            role: request.role || 'participant',
            invited_by: request.invitedBy,
            status: 'pending',
        }));
        // Use ON CONFLICT DO NOTHING to ignore duplicates
        const result = await db_1.default.raw(`
      INSERT INTO meeting_invites (meeting_id, user_id, role, invited_by, status)
      SELECT * FROM UNNEST(
        ?::uuid[],
        ?::uuid[],
        ?::text[],
        ?::uuid[],
        ?::text[]
      ) AS t(meeting_id, user_id, role, invited_by, status)
      ON CONFLICT (meeting_id, user_id) DO NOTHING
    `, [
            invites.map(i => i.meeting_id),
            invites.map(i => i.user_id),
            invites.map(i => i.role),
            invites.map(i => i.invited_by),
            invites.map(i => i.status),
        ]);
        const insertedCount = result.rowCount || request.userIds.length;
        logger_1.logger.info('[MEETING_INVITE] Bulk invites created', {
            meetingId: request.meetingId,
            requestedCount: request.userIds.length,
            insertedCount,
        });
        return insertedCount;
    }
    /**
     * Get an invite by meeting and user
     */
    async getInvite(meetingId, userId) {
        const row = await (0, db_1.default)('meeting_invites')
            .where({ meeting_id: meetingId, user_id: userId })
            .first();
        return row ? this.inviteFromRow(row) : null;
    }
    /**
     * Get all invites for a meeting
     */
    async getMeetingInvites(meetingId) {
        const rows = await (0, db_1.default)('meeting_invites')
            .where({ meeting_id: meetingId })
            .orderBy('invited_at');
        return rows.map((r) => this.inviteFromRow(r));
    }
    /**
     * Get all meetings a user is invited to
     */
    async getUserInvites(userId, options) {
        const { status, limit = 50 } = options || {};
        let query = (0, db_1.default)('meeting_invites')
            .where({ user_id: userId })
            .orderBy('invited_at', 'desc')
            .limit(limit);
        if (status) {
            query = query.where('status', status);
        }
        const rows = await query;
        return rows.map((r) => this.inviteFromRow(r));
    }
    /**
     * Update invite status (accept/decline)
     */
    async updateInviteStatus(meetingId, userId, status) {
        const [row] = await (0, db_1.default)('meeting_invites')
            .where({ meeting_id: meetingId, user_id: userId })
            .update({
            status,
            responded_at: db_1.default.fn.now(),
        })
            .returning('*');
        if (!row) {
            throw new error_handler_1.AppError('Invite not found', 404);
        }
        logger_1.logger.info('[MEETING_INVITE] Status updated', {
            meetingId,
            userId,
            status,
        });
        return this.inviteFromRow(row);
    }
    /**
     * Check if user is invited to a meeting
     */
    async isInvited(meetingId, userId) {
        const invite = await this.getInvite(meetingId, userId);
        return !!invite;
    }
    /**
     * Delete invite
     */
    async deleteInvite(meetingId, userId) {
        await (0, db_1.default)('meeting_invites')
            .where({ meeting_id: meetingId, user_id: userId })
            .delete();
        logger_1.logger.debug('[MEETING_INVITE] Invite deleted', { meetingId, userId });
    }
    /**
     * Delete all invites for a meeting
     */
    async deleteAllMeetingInvites(meetingId) {
        await (0, db_1.default)('meeting_invites')
            .where({ meeting_id: meetingId })
            .delete();
        logger_1.logger.debug('[MEETING_INVITE] All meeting invites deleted', { meetingId });
    }
    /**
     * Auto-populate invites based on visibility type.
     * This is called when creating a meeting with role-segmented access.
     */
    async populateInvitesForVisibility(meetingId, organizationId, hostId, visibilityType, options) {
        // Resolve participants based on visibility
        const resolved = await organization_role_service_1.organizationRoleService.resolveParticipants(organizationId, visibilityType, options);
        // Always include the host
        const allParticipants = new Set(resolved.userIds);
        allParticipants.add(hostId);
        // Create bulk invites
        const userIds = Array.from(allParticipants);
        // Set host role for host, participant for others
        const hostInvite = {
            meetingId,
            userId: hostId,
            role: 'host',
            invitedBy: hostId,
        };
        const participantIds = userIds.filter(id => id !== hostId);
        // Create host invite first
        await this.createInvite(hostInvite);
        // Create participant invites
        if (participantIds.length > 0) {
            await this.createBulkInvites({
                meetingId,
                userIds: participantIds,
                role: 'participant',
                invitedBy: hostId,
            });
        }
        logger_1.logger.info('[MEETING_INVITE] Invites populated', {
            meetingId,
            visibilityType,
            totalInvites: userIds.length,
        });
        return userIds.length;
    }
    /**
     * Get invite count for a meeting
     */
    async getInviteCount(meetingId) {
        const [result] = await (0, db_1.default)('meeting_invites')
            .where({ meeting_id: meetingId })
            .count('id as count');
        return parseInt(result.count, 10);
    }
    /**
     * Get invited user IDs for minutes access check
     */
    async getInvitedUserIds(meetingId) {
        const rows = await (0, db_1.default)('meeting_invites')
            .where({ meeting_id: meetingId })
            .select('user_id');
        return rows.map((r) => r.user_id);
    }
    // ── Row Converter ───────────────────────────────────────────
    inviteFromRow(row) {
        return {
            id: row.id,
            meetingId: row.meeting_id,
            userId: row.user_id,
            role: row.role,
            invitedBy: row.invited_by,
            status: row.status,
            invitedAt: row.invited_at,
            respondedAt: row.responded_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
// ── Singleton Export ────────────────────────────────────────
exports.meetingInviteService = new MeetingInviteService();
//# sourceMappingURL=meeting-invite.service.js.map