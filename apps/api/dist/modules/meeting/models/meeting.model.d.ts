/**
 * Meeting participant role
 */
export type MeetingParticipantRole = 'host' | 'co-host' | 'participant';
/**
 * Meeting status enum
 */
export type MeetingStatus = 'scheduled' | 'active' | 'ended' | 'cancelled';
/**
 * Individual meeting participant
 */
export interface MeetingParticipant {
    userId: string;
    role: MeetingParticipantRole;
    joinedAt: string;
    leftAt?: string;
    displayName?: string;
}
/**
 * Meeting settings (extensible configuration)
 */
export interface MeetingSettings {
    maxParticipants?: number;
    allowRecording?: boolean;
    waitingRoom?: boolean;
    muteOnEntry?: boolean;
    allowScreenShare?: boolean;
    [key: string]: any;
}
/**
 * Meeting entity from database
 */
export interface Meeting {
    id: string;
    organizationId: string;
    hostId: string;
    title?: string;
    description?: string;
    status: MeetingStatus;
    participants: MeetingParticipant[];
    settings: MeetingSettings;
    scheduledAt?: string;
    startedAt?: string;
    endedAt?: string;
    createdAt: string;
    updatedAt: string;
    visibilityType?: string;
}
/**
 * Database row representation (snake_case)
 */
export interface MeetingRow {
    id: string;
    organization_id: string;
    host_id: string;
    title?: string;
    description?: string;
    status: MeetingStatus;
    participants: string | MeetingParticipant[];
    settings: string | MeetingSettings;
    scheduled_at?: string;
    visibility_type?: string;
    started_at?: string;
    ended_at?: string;
    created_at: string;
    updated_at: string;
}
/**
 * Create meeting request payload
 */
export interface CreateMeetingRequest {
    organizationId: string;
    title?: string;
    description?: string;
    scheduledAt?: string;
    settings?: MeetingSettings;
    agenda?: string[];
}
/**
 * Join meeting request payload
 */
export interface JoinMeetingRequest {
    meetingId: string;
    displayName?: string;
}
/**
 * Leave meeting request payload
 */
export interface LeaveMeetingRequest {
    meetingId: string;
}
/**
 * Update meeting request payload
 */
export interface UpdateMeetingRequest {
    title?: string;
    description?: string;
    scheduledAt?: string | null;
    settings?: Partial<MeetingSettings>;
    agenda?: string[];
}
/**
 * Active meeting state stored in Redis
 * Contains real-time information about active meetings
 */
export interface ActiveMeetingState {
    meetingId: string;
    organizationId: string;
    hostId: string;
    status: MeetingStatus;
    participants: MeetingParticipant[];
    startedAt: string;
    lastActivityAt: string;
}
/**
 * Convert database row to Meeting entity
 */
export declare function meetingFromRow(row: MeetingRow): Meeting;
/**
 * Convert Meeting entity to database row format
 */
export declare function meetingToRow(meeting: Partial<Meeting>): Partial<MeetingRow>;
//# sourceMappingURL=meeting.model.d.ts.map