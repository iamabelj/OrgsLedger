import { MeetingInvite, MeetingInviteStatus, MeetingVisibilityType } from '../models';
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
declare class MeetingInviteService {
    /**
     * Create a single invite
     */
    createInvite(request: CreateInviteRequest): Promise<MeetingInvite>;
    /**
     * Create multiple invites efficiently
     */
    createBulkInvites(request: BulkCreateInviteRequest): Promise<number>;
    /**
     * Get an invite by meeting and user
     */
    getInvite(meetingId: string, userId: string): Promise<MeetingInvite | null>;
    /**
     * Get all invites for a meeting
     */
    getMeetingInvites(meetingId: string): Promise<MeetingInvite[]>;
    /**
     * Get all meetings a user is invited to
     */
    getUserInvites(userId: string, options?: {
        status?: MeetingInviteStatus;
        limit?: number;
    }): Promise<MeetingInvite[]>;
    /**
     * Update invite status (accept/decline)
     */
    updateInviteStatus(meetingId: string, userId: string, status: MeetingInviteStatus): Promise<MeetingInvite>;
    /**
     * Check if user is invited to a meeting
     */
    isInvited(meetingId: string, userId: string): Promise<boolean>;
    /**
     * Delete invite
     */
    deleteInvite(meetingId: string, userId: string): Promise<void>;
    /**
     * Delete all invites for a meeting
     */
    deleteAllMeetingInvites(meetingId: string): Promise<void>;
    /**
     * Auto-populate invites based on visibility type.
     * This is called when creating a meeting with role-segmented access.
     */
    populateInvitesForVisibility(meetingId: string, organizationId: string, hostId: string, visibilityType: MeetingVisibilityType, options?: {
        committeeId?: string;
        customParticipants?: string[];
    }): Promise<number>;
    /**
     * Get invite count for a meeting
     */
    getInviteCount(meetingId: string): Promise<number>;
    /**
     * Get invited user IDs for minutes access check
     */
    getInvitedUserIds(meetingId: string): Promise<string[]>;
    private inviteFromRow;
}
export declare const meetingInviteService: MeetingInviteService;
export {};
//# sourceMappingURL=meeting-invite.service.d.ts.map