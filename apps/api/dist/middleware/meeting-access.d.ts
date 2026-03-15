import { Request, Response, NextFunction } from 'express';
import { MeetingAccessCheckResult, MeetingVisibilityType } from '../modules/meeting/models';
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
/** Invalidate membership cache for a user/org */
export declare function invalidateMembershipCache(userId: string, orgId: string): void;
/**
 * Check if a user has access to a meeting.
 * This is the core logic shared by middleware and service functions.
 */
export declare function checkMeetingAccess(meetingId: string, userId: string): Promise<MeetingAccessCheckResult>;
/**
 * Middleware to validate meeting access.
 * Expects :meetingId param in the route.
 * Must be used AFTER authenticate middleware.
 *
 * Sets req.meetingAccess with access context if allowed.
 */
export declare function validateMeetingAccess(): (req: Request, res: Response, next: NextFunction) => Promise<void>;
/**
 * Middleware to validate meeting is active before joining.
 * Use after validateMeetingAccess.
 */
export declare function requireActiveMeeting(): (req: Request, res: Response, next: NextFunction) => Promise<void>;
/**
 * Middleware to require host role for an action.
 * Use after validateMeetingAccess.
 */
export declare function requireMeetingHost(): (req: Request, res: Response, next: NextFunction) => void;
/**
 * Quick check if user can view meeting minutes.
 * User must have been invited to the meeting.
 */
export declare function canViewMinutes(meetingId: string, userId: string): Promise<boolean>;
/**
 * Get all meetings a user has access to in an organization.
 */
export declare function getUserAccessibleMeetings(organizationId: string, userId: string, options?: {
    status?: string;
    limit?: number;
    offset?: number;
}): Promise<string[]>;
//# sourceMappingURL=meeting-access.d.ts.map