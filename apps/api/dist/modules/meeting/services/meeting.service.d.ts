import { Meeting, MeetingStatus, CreateMeetingRequest } from '../models';
export type MeetingEventType = 'meeting:created' | 'meeting:started' | 'meeting:ended' | 'meeting:cancelled' | 'meeting:participant:joined' | 'meeting:participant:left';
export interface MeetingEvent {
    type: MeetingEventType;
    meetingId: string;
    organizationId: string;
    timestamp: string;
    data: Record<string, any>;
}
export declare class MeetingService {
    /**
     * Create a new meeting
     */
    create(hostId: string, request: CreateMeetingRequest): Promise<Meeting>;
    /**
     * Get meeting by ID
     */
    getById(meetingId: string): Promise<Meeting | null>;
    /**
     * Get meeting by ID with active state from Redis
     * Returns fresh participant list from cache if meeting is active
     */
    getByIdWithState(meetingId: string): Promise<Meeting | null>;
    /**
     * List meetings for an organization
     */
    listByOrganization(organizationId: string, options?: {
        status?: MeetingStatus;
        page?: number;
        limit?: number;
    }): Promise<{
        meetings: Meeting[];
        total: number;
    }>;
    /**
     * Start a meeting (transition from scheduled to active)
     */
    start(meetingId: string, userId: string): Promise<Meeting>;
    /**
     * Initialize LiveKit room and audio bot for transcription
     */
    private initializeLiveMedia;
    /**
     * Join an active meeting
     */
    join(meetingId: string, userId: string, displayName?: string): Promise<Meeting>;
    /**
     * Leave a meeting
     */
    leave(meetingId: string, userId: string): Promise<Meeting>;
    /**
     * End a meeting
     * Persists participants from Redis to meeting_participants table
     */
    end(meetingId: string, userId: string): Promise<Meeting>;
    /**
     * Finalize live media: stop audio bot, delete room, generate minutes, cleanup
     */
    private finalizeLiveMedia;
    /**
     * Persist participants to relational table (called when meeting ends)
     */
    private persistParticipants;
    /**
     * Cancel a scheduled meeting
     */
    cancel(meetingId: string, userId: string): Promise<Meeting>;
    /**
     * Get active participant count for a meeting
     */
    getParticipantCount(meetingId: string): Promise<number>;
    /**
     * Check if user is participant in meeting
     */
    isParticipant(meetingId: string, userId: string): Promise<boolean>;
    /**
     * Get meeting minutes
     * Returns null if minutes haven't been generated yet
     */
    getMinutes(meetingId: string): Promise<{
        summary: string;
        keyTopics: string[];
        decisions: string[];
        actionItems: Array<{
            task: string;
            owner?: string;
            deadline?: string;
        }>;
        participants: string[];
        wordCount: number;
        generatedAt: string;
    } | null>;
    /**
     * Resubmit a minutes generation job
     * Deletes existing minutes first for regeneration
     */
    resubmitMinutesJob(meetingId: string, organizationId: string): Promise<void>;
}
export declare const meetingService: MeetingService;
//# sourceMappingURL=meeting.service.d.ts.map