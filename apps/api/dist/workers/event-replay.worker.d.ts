declare const REPLAY_CONFIG: {
    /** Interval between replay cycles (default: 30 seconds) */
    intervalMs: number;
    /** Maximum events to process per cycle */
    batchSize: number;
    /** Maximum retry attempts before giving up */
    maxRetries: number;
    /** Minimum delay between retries for same event (exponential backoff base) */
    baseBackoffMs: number;
    /** Leader election key for distributed deployments */
    leaderKey: string;
    /** Leader lock TTL in seconds */
    leaderTtlSeconds: number;
};
declare class EventReplayWorker {
    private isRunning;
    private intervalHandle;
    private redis;
    private isLeader;
    private leaderCheckInterval;
    private cycleCount;
    private totalReplayed;
    private totalFailed;
    /**
     * Initialize and start the replay worker.
     */
    start(): Promise<void>;
    /**
     * Stop the replay worker.
     */
    stop(): Promise<void>;
    /**
     * Start leader election for distributed deployments.
     * Only the leader instance processes replay events.
     */
    private startLeaderElection;
    private tryBecomeLeader;
    /**
     * Run a single replay cycle.
     */
    private runReplayCycle;
    /**
     * Check if an event is eligible for retry based on exponential backoff.
     */
    private isEligibleForRetry;
    /**
     * Replay a single event.
     */
    private replayEvent;
    /**
     * Get worker status.
     */
    getStatus(): {
        isRunning: boolean;
        isLeader: boolean;
        cycleCount: number;
        totalReplayed: number;
        totalFailed: number;
    };
}
declare const eventReplayWorker: EventReplayWorker;
export { eventReplayWorker, EventReplayWorker, REPLAY_CONFIG, };
export default eventReplayWorker;
//# sourceMappingURL=event-replay.worker.d.ts.map