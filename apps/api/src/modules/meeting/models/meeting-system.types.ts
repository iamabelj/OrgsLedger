// ============================================================
// OrgsLedger API — Meeting System Types
// Extended types for role-segmented meetings, transcription, etc.
// ============================================================

// ── Visibility Types ────────────────────────────────────────

/**
 * Meeting visibility type - determines who can see/join the meeting
 */
export type MeetingVisibilityType = 
  | 'ALL_MEMBERS'    // All organization members
  | 'EXECUTIVES'     // Executive role members only
  | 'COMMITTEE'      // Specific committee members
  | 'CUSTOM';        // Custom participant list

/**
 * Organization role type
 */
export type OrganizationRoleType = 'EXECUTIVE' | 'COMMITTEE';

// ── Organization Roles ──────────────────────────────────────

/**
 * Organization role entity
 */
export interface OrganizationRole {
  id: string;
  organizationId: string;
  roleName: string;
  roleType: OrganizationRoleType;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Organization role member mapping
 */
export interface OrganizationRoleMember {
  id: string;
  roleId: string;
  userId: string;
  addedAt: string;
  addedBy?: string;
  isActive: boolean;
  createdAt: string;
}

// ── Meeting Invites ─────────────────────────────────────────

/**
 * Meeting invite status
 */
export type MeetingInviteStatus = 'pending' | 'accepted' | 'declined';

/**
 * Meeting invite entity
 */
export interface MeetingInvite {
  id: string;
  meetingId: string;
  userId: string;
  role: string;
  invitedBy?: string;
  status: MeetingInviteStatus;
  invitedAt: string;
  respondedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Meeting invite row (snake_case)
 */
export interface MeetingInviteRow {
  id: string;
  meeting_id: string;
  user_id: string;
  role: string;
  invited_by?: string;
  status: string;
  invited_at: string;
  responded_at?: string;
  created_at: string;
  updated_at: string;
}

// ── Extended Meeting Types ──────────────────────────────────

/**
 * Extended create meeting request with visibility
 */
export interface CreateMeetingWithVisibilityRequest {
  organizationId: string;
  title?: string;
  description?: string;
  scheduledAt?: string;
  settings?: MeetingSettingsExtended;
  agenda?: string[];
  
  // Visibility controls
  visibilityType: MeetingVisibilityType;
  committeeId?: string;          // For COMMITTEE visibility
  participants?: string[];       // For CUSTOM visibility
}

/**
 * Extended meeting settings
 */
export interface MeetingSettingsExtended {
  maxParticipants?: number;
  allowRecording?: boolean;
  waitingRoom?: boolean;
  muteOnEntry?: boolean;
  allowScreenShare?: boolean;
  enableTranscription?: boolean;
  enableTranslation?: boolean;
  recordingEnabled?: boolean;
  agenda?: string[];
  [key: string]: any;
}

/**
 * Extended meeting entity with visibility
 */
export interface MeetingWithVisibility {
  id: string;
  organizationId: string;
  hostId: string;
  title?: string;
  description?: string;
  status: MeetingStatus;
  participants: MeetingParticipantExtended[];
  settings: MeetingSettingsExtended;
  scheduledAt?: string;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
  
  // Visibility
  visibilityType: MeetingVisibilityType;
  targetRoleId?: string;
  inviteCount?: number;
}

// Import base types
import { MeetingStatus, MeetingParticipant } from './meeting.model';

/**
 * Extended participant info
 */
export interface MeetingParticipantExtended extends MeetingParticipant {
  displayName?: string;
  avatarUrl?: string;
  isMuted?: boolean;
  isVideoOn?: boolean;
  isScreenSharing?: boolean;
  isHandRaised?: boolean;
}

// ── Transcript Types ────────────────────────────────────────

/**
 * Transcript event type
 */
export type TranscriptEventType = 'partial' | 'final';

/**
 * Transcript entry (single utterance)
 */
export interface TranscriptEntry {
  id?: string;
  meetingId: string;
  speakerId?: string;
  speakerName: string;
  text: string;
  timestamp: string;
  durationMs?: number;
  confidence?: number;
  language?: string;
  isFinal: boolean;
  sequence: number;
}

/**
 * Transcript event payload for Redis/WebSocket
 */
export interface TranscriptEventPayload {
  type: TranscriptEventType;
  meetingId: string;
  organizationId: string;
  speakerId?: string;
  speakerName: string;
  text: string;
  timestamp: number;
  confidence?: number;
  language?: string;
  isFinal: boolean;
  sequence: number;
}

/**
 * Transcript broadcast event for WebSocket
 */
export interface TranscriptBroadcastEvent {
  meetingId: string;
  speaker: string;
  speakerId?: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
  language?: string;
}

// ── Minutes Types ───────────────────────────────────────────

/**
 * Structured meeting minutes
 */
export interface StructuredMeetingMinutes {
  meetingId: string;
  organizationId: string;
  generatedAt: string;
  
  // Content sections
  agenda: string[];
  summary: string;
  keyDecisions: KeyDecision[];
  actionItems: ActionItem[];
  votes?: Vote[];
  participants: ParticipantSummary[];
  
  // Metadata
  wordCount: number;
  durationMinutes?: number;
  transcriptEntryCount: number;
}

/**
 * Key decision from meeting
 */
export interface KeyDecision {
  topic: string;
  decision: string;
  decidedBy?: string;
  timestamp?: string;
}

/**
 * Action item from meeting
 */
export interface ActionItem {
  task: string;
  assignee?: string;
  dueDate?: string;
  priority?: 'low' | 'medium' | 'high';
  status?: 'pending' | 'in-progress' | 'completed';
}

/**
 * Vote record from meeting
 */
export interface Vote {
  topic: string;
  result: string;
  votesFor: number;
  votesAgainst: number;
  abstentions: number;
  timestamp?: string;
}

/**
 * Participant summary for minutes
 */
export interface ParticipantSummary {
  userId: string;
  displayName: string;
  role: string;
  joinedAt: string;
  leftAt?: string;
  speakingTime?: number;  // in seconds
}

// ── Redis State Types ───────────────────────────────────────

/**
 * Extended active meeting state with transcription info
 */
export interface ActiveMeetingStateExtended {
  meetingId: string;
  organizationId: string;
  hostId: string;
  status: MeetingStatus;
  participants: MeetingParticipantExtended[];
  startedAt: string;
  lastActivityAt: string;
  
  // Transcription state
  transcriptionEnabled: boolean;
  transcriptionLanguage?: string;
  transcriptCount: number;
  lastTranscriptAt?: string;
  
  // Recording state
  isRecording: boolean;
  recordingStartedAt?: string;
}

/**
 * Participant state in Redis (lightweight)
 */
export interface RedisParticipantState {
  odbyteuserId: string;
  displayName: string;
  role: string;
  joinedAt: string;
  leftAt?: string;
  isMuted: boolean;
  isVideoOn: boolean;
  lastActivityAt: string;
}

// ── Access Control Types ────────────────────────────────────

// Note: MeetingEventType and MeetingEvent are defined in meeting.service.ts
// to avoid circular dependency issues. Import them from ./services if needed.

/**
 * Meeting access check result
 */
export interface MeetingAccessCheckResult {
  allowed: boolean;
  reason?: string;
  role?: string;
  isHost?: boolean;
  isMember?: boolean;
  isInvited?: boolean;
}

/**
 * Participant resolution result (for visibility types)
 */
export interface ResolvedParticipants {
  userIds: string[];
  count: number;
  visibilityType: MeetingVisibilityType;
  sourceRoleId?: string;
}

// ── Worker Job Types ────────────────────────────────────────

/**
 * Transcript storage job data
 */
export interface TranscriptStorageJobData {
  meetingId: string;
  organizationId: string;
  entries: TranscriptEntry[];
}

/**
 * Minutes generation job data
 */
export interface MinutesGenerationJobData {
  meetingId: string;
  organizationId: string;
  hostId: string;
  title?: string;
  startedAt: string;
  endedAt: string;
  participantCount: number;
}

/**
 * Transcript broadcast job data
 */
export interface TranscriptBroadcastJobData {
  meetingId: string;
  organizationId: string;
  event: TranscriptBroadcastEvent;
}
