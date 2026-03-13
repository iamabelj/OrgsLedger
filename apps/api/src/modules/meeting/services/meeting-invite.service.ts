// ============================================================
// OrgsLedger API — Meeting Invite Service
// Manages meeting invitations and access
// ============================================================

import db from '../../../db';
import { logger } from '../../../logger';
import {
  MeetingInvite,
  MeetingInviteRow,
  MeetingInviteStatus,
  MeetingVisibilityType,
  ResolvedParticipants,
} from '../models';
import { organizationRoleService } from './organization-role.service';
import { publishEvent, EVENT_CHANNELS } from './event-bus.service';
import { AppError } from '../../../middleware/error-handler';

// ── Types ───────────────────────────────────────────────────

interface CreateInviteRequest {
  meetingId: string;
  userId: string;
  role?: string;
  invitedBy: string;
}

interface BulkCreateInviteRequest {
  meetingId: string;
  userIds: string[];
  role?: string;
  invitedBy: string;
}

// ── Service Class ───────────────────────────────────────────

class MeetingInviteService {
  /**
   * Create a single invite
   */
  async createInvite(request: CreateInviteRequest): Promise<MeetingInvite> {
    try {
      const [row] = await db('meeting_invites')
        .insert({
          meeting_id: request.meetingId,
          user_id: request.userId,
          role: request.role || 'participant',
          invited_by: request.invitedBy,
          status: 'pending',
        })
        .returning('*');

      logger.debug('[MEETING_INVITE] Invite created', {
        meetingId: request.meetingId,
        userId: request.userId,
      });

      return this.inviteFromRow(row);
    } catch (err: any) {
      if (err.code === '23505') { // Unique violation
        // Already invited, just return existing
        const existing = await this.getInvite(request.meetingId, request.userId);
        if (existing) return existing;
      }
      throw err;
    }
  }

  /**
   * Create multiple invites efficiently
   */
  async createBulkInvites(request: BulkCreateInviteRequest): Promise<number> {
    if (request.userIds.length === 0) return 0;

    const invites = request.userIds.map(userId => ({
      meeting_id: request.meetingId,
      user_id: userId,
      role: request.role || 'participant',
      invited_by: request.invitedBy,
      status: 'pending',
    }));

    // Use ON CONFLICT DO NOTHING to ignore duplicates
    const result = await db.raw(`
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

    logger.info('[MEETING_INVITE] Bulk invites created', {
      meetingId: request.meetingId,
      requestedCount: request.userIds.length,
      insertedCount,
    });

    return insertedCount;
  }

  /**
   * Get an invite by meeting and user
   */
  async getInvite(meetingId: string, userId: string): Promise<MeetingInvite | null> {
    const row = await db('meeting_invites')
      .where({ meeting_id: meetingId, user_id: userId })
      .first();

    return row ? this.inviteFromRow(row) : null;
  }

  /**
   * Get all invites for a meeting
   */
  async getMeetingInvites(meetingId: string): Promise<MeetingInvite[]> {
    const rows = await db('meeting_invites')
      .where({ meeting_id: meetingId })
      .orderBy('invited_at');

    return rows.map((r: any) => this.inviteFromRow(r));
  }

  /**
   * Get all meetings a user is invited to
   */
  async getUserInvites(
    userId: string,
    options?: { status?: MeetingInviteStatus; limit?: number }
  ): Promise<MeetingInvite[]> {
    const { status, limit = 50 } = options || {};

    let query = db('meeting_invites')
      .where({ user_id: userId })
      .orderBy('invited_at', 'desc')
      .limit(limit);

    if (status) {
      query = query.where('status', status);
    }

    const rows = await query;
    return rows.map((r: any) => this.inviteFromRow(r));
  }

  /**
   * Update invite status (accept/decline)
   */
  async updateInviteStatus(
    meetingId: string,
    userId: string,
    status: MeetingInviteStatus
  ): Promise<MeetingInvite> {
    const [row] = await db('meeting_invites')
      .where({ meeting_id: meetingId, user_id: userId })
      .update({
        status,
        responded_at: db.fn.now(),
      })
      .returning('*');

    if (!row) {
      throw new AppError('Invite not found', 404);
    }

    logger.info('[MEETING_INVITE] Status updated', {
      meetingId,
      userId,
      status,
    });

    return this.inviteFromRow(row);
  }

  /**
   * Check if user is invited to a meeting
   */
  async isInvited(meetingId: string, userId: string): Promise<boolean> {
    const invite = await this.getInvite(meetingId, userId);
    return !!invite;
  }

  /**
   * Delete invite
   */
  async deleteInvite(meetingId: string, userId: string): Promise<void> {
    await db('meeting_invites')
      .where({ meeting_id: meetingId, user_id: userId })
      .delete();

    logger.debug('[MEETING_INVITE] Invite deleted', { meetingId, userId });
  }

  /**
   * Delete all invites for a meeting
   */
  async deleteAllMeetingInvites(meetingId: string): Promise<void> {
    await db('meeting_invites')
      .where({ meeting_id: meetingId })
      .delete();

    logger.debug('[MEETING_INVITE] All meeting invites deleted', { meetingId });
  }

  /**
   * Auto-populate invites based on visibility type.
   * This is called when creating a meeting with role-segmented access.
   */
  async populateInvitesForVisibility(
    meetingId: string,
    organizationId: string,
    hostId: string,
    visibilityType: MeetingVisibilityType,
    options?: {
      committeeId?: string;
      customParticipants?: string[];
    }
  ): Promise<number> {
    // Resolve participants based on visibility
    const resolved = await organizationRoleService.resolveParticipants(
      organizationId,
      visibilityType,
      options
    );

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

    logger.info('[MEETING_INVITE] Invites populated', {
      meetingId,
      visibilityType,
      totalInvites: userIds.length,
    });

    return userIds.length;
  }

  /**
   * Get invite count for a meeting
   */
  async getInviteCount(meetingId: string): Promise<number> {
    const [result] = await db('meeting_invites')
      .where({ meeting_id: meetingId })
      .count('id as count');

    return parseInt(result.count as string, 10);
  }

  /**
   * Get invited user IDs for minutes access check
   */
  async getInvitedUserIds(meetingId: string): Promise<string[]> {
    const rows = await db('meeting_invites')
      .where({ meeting_id: meetingId })
      .select('user_id');

    return rows.map((r: any) => r.user_id);
  }

  // ── Row Converter ───────────────────────────────────────────

  private inviteFromRow(row: MeetingInviteRow): MeetingInvite {
    return {
      id: row.id,
      meetingId: row.meeting_id,
      userId: row.user_id,
      role: row.role,
      invitedBy: row.invited_by,
      status: row.status as MeetingInviteStatus,
      invitedAt: row.invited_at,
      respondedAt: row.responded_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// ── Singleton Export ────────────────────────────────────────

export const meetingInviteService = new MeetingInviteService();
