/**
 * When a meeting is created, trigger initial setup
 */
export declare function onMeetingCreated(meetingId: string, orgId: string, meetingData: any): Promise<void>;
/**
 * When a meeting is updated, determine what jobs to trigger
 */
export declare function onMeetingUpdated(meetingId: string, orgId: string, oldData: any, newData: any): Promise<void>;
/**
 * When a meeting starts, trigger initialization
 */
export declare function onMeetingStarted(meetingId: string, orgId: string, meeting: any): Promise<void>;
/**
 * When a meeting ends, trigger:
 * - Broadcast notification
 * - AI minute generation
 * - Transcript finalization
 */
export declare function onMeetingEnded(meetingId: string, orgId: string, meeting: any): Promise<void>;
/**
 * When attendees are added to a meeting, notify them
 */
export declare function onAttendeesAdded(meetingId: string, orgId: string, attendeeUserIds: string[]): Promise<void>;
/**
 * When a transcript is received, it's already being handled by the transcript queue
 * This is a hook for future extensions
 */
export declare function onTranscriptReceived(meetingId: string, orgId: string, transcriptData: any): Promise<void>;
declare const _default: {
    onMeetingCreated: typeof onMeetingCreated;
    onMeetingUpdated: typeof onMeetingUpdated;
    onMeetingStarted: typeof onMeetingStarted;
    onMeetingEnded: typeof onMeetingEnded;
    onAttendeesAdded: typeof onAttendeesAdded;
    onTranscriptReceived: typeof onTranscriptReceived;
};
export default _default;
//# sourceMappingURL=meeting-queue-integration.service.d.ts.map