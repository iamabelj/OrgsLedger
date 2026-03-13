import * as client from 'prom-client';
export declare const meetingCleanupDuration: client.Histogram<string>;
export declare const meetingCleanupStepDuration: client.Histogram<"step">;
export declare const meetingCleanupErrorsTotal: client.Counter<"step">;
export declare const meetingCleanupsTotal: client.Counter<"status">;
export interface CleanupResult {
    meetingId: string;
    success: boolean;
    durationMs: number;
    steps: StepResult[];
    errors: string[];
}
interface StepResult {
    name: string;
    success: boolean;
    durationMs: number;
    itemsRemoved?: number;
    error?: string;
}
/**
 * Perform full cleanup for a meeting that has ended
 * Removes all transient state, frees memory, and archives data
 *
 * @param meetingId - ID of the meeting to clean up
 * @param organizationId - Organization ID (for set cleanup)
 * @returns Cleanup result with timing and success status
 */
export declare function cleanupMeeting(meetingId: string, organizationId?: string): Promise<CleanupResult>;
/**
 * Cleanup multiple meetings in parallel
 * Useful for bulk eviction of stale meetings
 */
export declare function cleanupMeetings(meetings: Array<{
    meetingId: string;
    organizationId?: string;
}>): Promise<CleanupResult[]>;
/**
 * Find meetings that have been active too long without activity
 * Returns meeting IDs that should be cleaned up
 */
export declare function findStaleMeetings(maxAgeHours?: number): Promise<string[]>;
/**
 * Auto-cleanup stale meetings
 * Run periodically via scheduler
 */
export declare function autoCleanupStaleMeetings(maxAgeHours?: number): Promise<{
    cleaned: number;
    errors: number;
}>;
declare const _default: {
    cleanupMeeting: typeof cleanupMeeting;
    cleanupMeetings: typeof cleanupMeetings;
    findStaleMeetings: typeof findStaleMeetings;
    autoCleanupStaleMeetings: typeof autoCleanupStaleMeetings;
};
export default _default;
//# sourceMappingURL=meeting-cleanup.service.d.ts.map