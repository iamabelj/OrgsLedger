import { ActiveMeetingState, MeetingParticipant } from '../models';
/**
 * Store active meeting state in Redis
 */
export declare function setActiveMeetingState(state: ActiveMeetingState): Promise<void>;
/**
 * Get active meeting state from Redis
 */
export declare function getActiveMeetingState(meetingId: string): Promise<ActiveMeetingState | null>;
/**
 * Remove active meeting state from Redis
 */
export declare function removeActiveMeetingState(meetingId: string, organizationId: string): Promise<void>;
/**
 * Update participant list in active meeting state
 */
export declare function updateMeetingParticipants(meetingId: string, participants: MeetingParticipant[]): Promise<void>;
/**
 * Get all active meeting IDs for an organization
 */
export declare function getOrgActiveMeetings(organizationId: string): Promise<string[]>;
/**
 * Get count of active meetings globally
 */
export declare function getActiveMeetingsCount(): Promise<number>;
/**
 * Check if a meeting is currently active in cache
 */
export declare function isMeetingActive(meetingId: string): Promise<boolean>;
/**
 * Touch meeting to update last activity timestamp
 */
export declare function touchMeeting(meetingId: string): Promise<void>;
//# sourceMappingURL=meeting-cache.service.d.ts.map