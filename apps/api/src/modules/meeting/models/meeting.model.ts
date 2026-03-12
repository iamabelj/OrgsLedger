// ============================================================
// OrgsLedger API — Meeting Model
// Type definitions for meeting entities
// ============================================================

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
export function meetingFromRow(row: MeetingRow): Meeting {
  return {
    id: row.id,
    organizationId: row.organization_id,
    hostId: row.host_id,
    title: row.title,
    description: row.description,
    status: row.status,
    participants: typeof row.participants === 'string' 
      ? JSON.parse(row.participants) 
      : row.participants,
    settings: typeof row.settings === 'string'
      ? JSON.parse(row.settings)
      : row.settings,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Convert Meeting entity to database row format
 */
export function meetingToRow(meeting: Partial<Meeting>): Partial<MeetingRow> {
  const row: Partial<MeetingRow> = {};
  
  if (meeting.id !== undefined) row.id = meeting.id;
  if (meeting.organizationId !== undefined) row.organization_id = meeting.organizationId;
  if (meeting.hostId !== undefined) row.host_id = meeting.hostId;
  if (meeting.title !== undefined) row.title = meeting.title;
  if (meeting.description !== undefined) row.description = meeting.description;
  if (meeting.status !== undefined) row.status = meeting.status;
  if (meeting.participants !== undefined) {
    row.participants = JSON.stringify(meeting.participants);
  }
  if (meeting.settings !== undefined) {
    row.settings = JSON.stringify(meeting.settings);
  }
  if (meeting.scheduledAt !== undefined) row.scheduled_at = meeting.scheduledAt;
  if (meeting.startedAt !== undefined) row.started_at = meeting.startedAt;
  if (meeting.endedAt !== undefined) row.ended_at = meeting.endedAt;
  
  return row;
}
