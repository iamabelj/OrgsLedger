interface ThrottleDecision {
    allowed: boolean;
    tokensRemaining: number;
    droppedCount: number;
}
interface ThrottleStats {
    activeMeetings: number;
    totalPassed: number;
    totalDropped: number;
    dropRate: number;
}
declare class WebSocketThrottleManager {
    /** Token buckets per meeting: Map<meetingId, TokenBucket> */
    private buckets;
    /** Cleanup timer */
    private cleanupTimer;
    /** Tokens added per refill interval */
    private tokensPerRefill;
    /** Global stats */
    private globalStats;
    constructor();
    /**
     * Initialize the throttle manager.
     */
    initialize(): void;
    /**
     * Check if an event should be allowed for a meeting.
     * Returns true if allowed, false if throttled (dropped).
     */
    shouldAllow(meetingId: string): ThrottleDecision;
    /**
     * Quick check without consuming a token.
     */
    canAccept(meetingId: string): boolean;
    /**
     * Remove oldest buckets to free memory.
     */
    private cleanupOldestBuckets;
    /**
     * Start periodic cleanup of inactive meetings.
     */
    private startCleanupTimer;
    /**
     * Get statistics.
     */
    getStats(): ThrottleStats;
    /**
     * Get stats for a specific meeting.
     */
    getMeetingStats(meetingId: string): {
        tokensRemaining: number;
        passedCount: number;
        droppedCount: number;
        dropRate: number;
    } | null;
    /**
     * Clean up bucket for a specific meeting (call on meeting end).
     */
    cleanupMeeting(meetingId: string): void;
    /**
     * Reset all throttle state (for testing).
     */
    reset(): void;
    /**
     * Shutdown the throttle manager.
     */
    shutdown(): void;
}
export declare const wsThrottleManager: WebSocketThrottleManager;
/**
 * Initialize WebSocket throttling.
 */
export declare function initializeWSThrottling(): void;
/**
 * Check if an event should be allowed for a meeting.
 * Consumes a token if allowed.
 */
export declare function throttleCheck(meetingId: string): ThrottleDecision;
/**
 * Quick check without consuming a token.
 */
export declare function canAcceptEvent(meetingId: string): boolean;
/**
 * Get global throttle statistics.
 */
export declare function getWSThrottleStats(): ThrottleStats;
/**
 * Get throttle stats for a specific meeting.
 */
export declare function getMeetingThrottleStats(meetingId: string): {
    tokensRemaining: number;
    passedCount: number;
    droppedCount: number;
    dropRate: number;
} | null;
/**
 * Clean up throttle data for a meeting.
 */
export declare function cleanupMeetingThrottle(meetingId: string): void;
/**
 * Shutdown WebSocket throttling.
 */
export declare function shutdownWSThrottling(): void;
export {};
//# sourceMappingURL=ws-throttle.d.ts.map