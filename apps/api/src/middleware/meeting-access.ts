// ============================================================
// OrgsLedger API — Meeting Access Middleware
// Validates user access to meetings based on org membership
// and meeting invitations. NO PASSWORD REQUIRED.
// ============================================================

import { Request, Response, NextFunction } from 'express';
import db from '../db';
import { logger } from '../logger';
import { 
  MeetingAccessCheckResult, 
  MeetingVisibilityType,
} from '../modules/meeting/models';
import { getActiveMeetingState } from '../modules/meeting/services/meeting-cache.service';

// ── Types ───────────────────────────────────────────────────

export interface MeetingAccessContext {
  meetingId: string;
  userId: string;
  organizationId: string;
  isHost: boolean;
  isMember: boolean;
  isInvited: boolean;
  role: string;
  visibilityType?: MeetingVisibilityType;
}

declare global {
  namespace Express {
    interface Request {
      meetingAccess?: MeetingAccessContext;
    }
  }
}

// ── Cache for membership checks (reduces DB queries) ────────

interface CachedMembership {
  isMember: boolean;
  role: string;
  cachedAt: number;
}

const MEMBERSHIP_CACHE = new Map<string, CachedMembership>();
const MEMBERSHIP_CACHE_TTL = 60_000; // 60 seconds
const MEMBERSHIP_CACHE_MAX = 5000;

function getMembershipCacheKey(userId: string, orgId: string): string {
  return `${userId}:${orgId}`;
}

function getCachedMembership(userId: string, orgId: string): CachedMembership | null {
  const key = getMembershipCacheKey(userId, orgId);
  const entry = MEMBERSHIP_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > MEMBERSHIP_CACHE_TTL) {
    MEMBERSHIP_CACHE.delete(key);
    return null;
  }
  return entry;
}

function cacheMembership(userId: string, orgId: string, isMember: boolean, role: string): void {
  if (MEMBERSHIP_CACHE.size >= MEMBERSHIP_CACHE_MAX) {
    const firstKey = MEMBERSHIP_CACHE.keys().next().value;
    if (firstKey) MEMBERSHIP_CACHE.delete(firstKey);
  }
  MEMBERSHIP_CACHE.set(getMembershipCacheKey(userId, orgId), {
    isMember,
    role,
    cachedAt: Date.now(),
  });
}

/** Invalidate membership cache for a user/org */
export function invalidateMembershipCache(userId: string, orgId: string): void {
  MEMBERSHIP_CACHE.delete(getMembershipCacheKey(userId, orgId));
}

// ── Core Access Check Function ──────────────────────────────

/**
 * Check if a user has access to a meeting.
 * This is the core logic shared by middleware and service functions.
 */
export async function checkMeetingAccess(
  meetingId: string,
  userId: string
): Promise<MeetingAccessCheckResult> {
  try {
    // 1. Get meeting info
    const meeting = await db('meetings')
      .where({ id: meetingId })
      .select(
        'id',
        'organization_id',
        'host_id',
        'status',
        'visibility_type',
        'target_role_id'
      )
      .first();

    if (!meeting) {
      return { allowed: false, reason: 'Meeting not found' };
    }

    // Meeting status check
    if (meeting.status === 'cancelled') {
      return { allowed: false, reason: 'Meeting has been cancelled' };
    }

    // 2. Check if user is the host
    const isHost = meeting.host_id === userId;
    if (isHost) {
      return {
        allowed: true,
        role: 'host',
        isHost: true,
        isMember: true,
        isInvited: true,
      };
    }

    // 3. Check organization membership (cached)
    let membership = getCachedMembership(userId, meeting.organization_id);
    if (!membership) {
      const dbMembership = await db('memberships')
        .where({
          user_id: userId,
          organization_id: meeting.organization_id,
          is_active: true,
        })
        .select('role')
        .first();

      membership = {
        isMember: !!dbMembership,
        role: dbMembership?.role || 'none',
        cachedAt: Date.now(),
      };
      cacheMembership(userId, meeting.organization_id, membership.isMember, membership.role);
    }

    if (!membership.isMember) {
      return { allowed: false, reason: 'Not a member of this organization', isMember: false };
    }

    // 4. Check visibility-based access
    const visibilityType = meeting.visibility_type as MeetingVisibilityType || 'ALL_MEMBERS';

    if (visibilityType === 'ALL_MEMBERS') {
      // All org members can access
      return {
        allowed: true,
        role: 'participant',
        isHost: false,
        isMember: true,
        isInvited: true,
      };
    }

    // 5. For restricted meetings, check invite or role membership
    // Check direct invite first
    const invite = await db('meeting_invites')
      .where({
        meeting_id: meetingId,
        user_id: userId,
      })
      .select('role', 'status')
      .first();

    if (invite) {
      return {
        allowed: true,
        role: invite.role || 'participant',
        isHost: false,
        isMember: true,
        isInvited: true,
      };
    }

    // 6. Check role-based access for EXECUTIVES or COMMITTEE
    if (visibilityType === 'EXECUTIVES') {
      const isExecutive = await db('organization_role_members')
        .join('organization_roles', 'organization_roles.id', 'organization_role_members.role_id')
        .where({
          'organization_roles.organization_id': meeting.organization_id,
          'organization_roles.role_type': 'EXECUTIVE',
          'organization_role_members.user_id': userId,
          'organization_role_members.is_active': true,
          'organization_roles.is_active': true,
        })
        .first();

      if (isExecutive) {
        return {
          allowed: true,
          role: 'participant',
          isHost: false,
          isMember: true,
          isInvited: true,
        };
      }
    }

    if (visibilityType === 'COMMITTEE' && meeting.target_role_id) {
      const isCommitteeMember = await db('organization_role_members')
        .where({
          role_id: meeting.target_role_id,
          user_id: userId,
          is_active: true,
        })
        .first();

      if (isCommitteeMember) {
        return {
          allowed: true,
          role: 'participant',
          isHost: false,
          isMember: true,
          isInvited: true,
        };
      }
    }

    // Not invited and doesn't meet role criteria
    return {
      allowed: false,
      reason: 'Not invited to this meeting',
      isMember: true,
      isInvited: false,
    };
  } catch (err: any) {
    logger.error('[MEETING_ACCESS] Check failed', { meetingId, userId, error: err.message });
    throw err;
  }
}

// ── Middleware ──────────────────────────────────────────────

/**
 * Middleware to validate meeting access.
 * Expects :meetingId param in the route.
 * Must be used AFTER authenticate middleware.
 * 
 * Sets req.meetingAccess with access context if allowed.
 */
export function validateMeetingAccess() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      const meetingId = req.params.meetingId || req.params.id || req.body.meetingId;
      if (!meetingId) {
        res.status(400).json({ success: false, error: 'Meeting ID required' });
        return;
      }

      const userId = req.user.userId;

      // Super admins and developers bypass access checks
      if (req.user.globalRole === 'super_admin' || req.user.globalRole === 'developer') {
        const meeting = await db('meetings')
          .where({ id: meetingId })
          .select('organization_id', 'visibility_type')
          .first();

        if (!meeting) {
          res.status(404).json({ success: false, error: 'Meeting not found' });
          return;
        }

        req.meetingAccess = {
          meetingId,
          userId,
          organizationId: meeting.organization_id,
          isHost: true, // Treat as host for access purposes
          isMember: true,
          isInvited: true,
          role: 'host',
          visibilityType: meeting.visibility_type,
        };
        return next();
      }

      const access = await checkMeetingAccess(meetingId, userId);

      if (!access.allowed) {
        logger.warn('[MEETING_ACCESS] Access denied', {
          meetingId,
          userId,
          reason: access.reason,
        });
        res.status(403).json({
          success: false,
          error: access.reason || 'Access denied',
        });
        return;
      }

      // Get full meeting info for context
      const meeting = await db('meetings')
        .where({ id: meetingId })
        .select('organization_id', 'visibility_type')
        .first();

      req.meetingAccess = {
        meetingId,
        userId,
        organizationId: meeting.organization_id,
        isHost: access.isHost || false,
        isMember: access.isMember || false,
        isInvited: access.isInvited || false,
        role: access.role || 'participant',
        visibilityType: meeting.visibility_type,
      };

      logger.debug('[MEETING_ACCESS] Access granted', {
        meetingId,
        userId,
        role: req.meetingAccess.role,
      });

      next();
    } catch (err: any) {
      logger.error('[MEETING_ACCESS] Middleware error', { error: err.message });
      next(err);
    }
  };
}

/**
 * Middleware to validate meeting is active before joining.
 * Use after validateMeetingAccess.
 */
export function requireActiveMeeting() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const meetingId = req.meetingAccess?.meetingId || req.params.meetingId || req.params.id;
      if (!meetingId) {
        res.status(400).json({ success: false, error: 'Meeting ID required' });
        return;
      }

      // Check Redis first for active state
      const activeState = await getActiveMeetingState(meetingId);
      if (activeState && activeState.status === 'active') {
        return next();
      }

      // Fall back to DB check
      const meeting = await db('meetings')
        .where({ id: meetingId })
        .select('status')
        .first();

      if (!meeting) {
        res.status(404).json({ success: false, error: 'Meeting not found' });
        return;
      }

      if (meeting.status !== 'active') {
        res.status(400).json({
          success: false,
          error: meeting.status === 'scheduled'
            ? 'Meeting has not started yet'
            : meeting.status === 'ended'
            ? 'Meeting has ended'
            : 'Meeting is not active',
        });
        return;
      }

      next();
    } catch (err: any) {
      logger.error('[MEETING_ACCESS] Active check failed', { error: err.message });
      next(err);
    }
  };
}

/**
 * Middleware to require host role for an action.
 * Use after validateMeetingAccess.
 */
export function requireMeetingHost() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.meetingAccess) {
      res.status(500).json({ success: false, error: 'Meeting access context missing' });
      return;
    }

    if (!req.meetingAccess.isHost && req.meetingAccess.role !== 'co-host') {
      res.status(403).json({ success: false, error: 'Only the host can perform this action' });
      return;
    }

    next();
  };
}

// ── Helper Functions ────────────────────────────────────────

/**
 * Quick check if user can view meeting minutes.
 * User must have been invited to the meeting.
 */
export async function canViewMinutes(meetingId: string, userId: string): Promise<boolean> {
  const access = await checkMeetingAccess(meetingId, userId);
  return access.allowed && access.isInvited === true;
}

/**
 * Get all meetings a user has access to in an organization.
 */
export async function getUserAccessibleMeetings(
  organizationId: string,
  userId: string,
  options?: { status?: string; limit?: number; offset?: number }
): Promise<string[]> {
  const { status, limit = 50, offset = 0 } = options || {};

  // Check membership first
  const membership = await db('memberships')
    .where({
      user_id: userId,
      organization_id: organizationId,
      is_active: true,
    })
    .first();

  if (!membership) {
    return [];
  }

  // Get meetings user can access
  let query = db('meetings')
    .where('organization_id', organizationId)
    .where(function() {
      // Host can always see
      this.where('host_id', userId)
        // ALL_MEMBERS visibility
        .orWhere(function() {
          this.where('visibility_type', 'ALL_MEMBERS')
            .orWhereNull('visibility_type');
        })
        // Has direct invite
        .orWhereExists(function() {
          this.select(db.raw(1))
            .from('meeting_invites')
            .whereRaw('meeting_invites.meeting_id = meetings.id')
            .where('meeting_invites.user_id', userId);
        });
    })
    .select('id')
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset);

  if (status) {
    query = query.where('status', status);
  }

  const meetings = await query;
  return meetings.map((m: any) => m.id);
}
