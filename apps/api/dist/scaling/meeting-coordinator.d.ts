import * as client from 'prom-client';
import { EventEmitter } from 'events';
interface CoordinatorConfig {
    /** Worker heartbeat interval in ms */
    heartbeatIntervalMs: number;
    /** Meeting heartbeat interval in ms */
    meetingHeartbeatIntervalMs: number;
    /** Time before worker is considered dead */
    workerTimeoutMs: number;
    /** Time before meeting is considered stuck */
    meetingTimeoutMs: number;
    /** Health check interval in ms */
    healthCheckIntervalMs: number;
    /** Max meetings per worker (for load balancing) */
    maxMeetingsPerWorker: number;
    /** Enable auto-recovery of orphaned meetings */
    autoRecovery: boolean;
}
export type MeetingState = 'active' | 'ending' | 'ended';
export interface MeetingInfo {
    meetingId: string;
    ownerId: string;
    state: MeetingState;
    startedAt: number;
    lastHeartbeat: number;
    participantCount: number;
}
export interface WorkerInfo {
    workerId: string;
    meetingCount: number;
    lastHeartbeat: number;
    isHealthy: boolean;
    meetings: string[];
}
export interface ClusterHealth {
    timestamp: Date;
    activeWorkers: number;
    deadWorkers: number;
    activeMeetings: number;
    stuckMeetings: number;
    orphanedMeetings: number;
    totalParticipants: number;
    workers: WorkerInfo[];
}
export interface CoordinatorEvent {
    type: 'meeting_orphaned' | 'meeting_stuck' | 'worker_dead' | 'meeting_recovered';
    meetingId?: string;
    workerId?: string;
    timestamp: Date;
    details: Record<string, any>;
}
export declare const activeMeetingsGauge: client.Gauge<string>;
export declare const activeWorkersGauge: client.Gauge<string>;
export declare const stuckMeetingsGauge: client.Gauge<string>;
export declare const orphanedMeetingsGauge: client.Gauge<string>;
export declare const meetingRecoveriesCounter: client.Counter<string>;
export declare const workerFailuresCounter: client.Counter<string>;
export declare const coordinatorErrorsCounter: client.Counter<"operation">;
export declare class GlobalMeetingCoordinator extends EventEmitter {
    private config;
    private redis;
    private workerId;
    private heartbeatInterval;
    private healthCheckInterval;
    private isRunning;
    private claimMeetingSha;
    private releaseMeetingSha;
    constructor(workerId?: string, config?: Partial<CoordinatorConfig>);
    /**
     * Generate a unique worker ID.
     */
    private generateWorkerId;
    /**
     * Initialize and start the coordinator.
     */
    start(): Promise<void>;
    /**
     * Stop the coordinator.
     */
    stop(): Promise<void>;
    /**
     * Claim ownership of a meeting.
     */
    claimMeeting(meetingId: string): Promise<boolean>;
    /**
     * Release ownership of a meeting.
     */
    releaseMeeting(meetingId: string): Promise<boolean>;
    /**
     * Send heartbeat for a specific meeting.
     */
    sendMeetingHeartbeat(meetingId: string, participantCount?: number): Promise<void>;
    /**
     * Send worker heartbeat.
     */
    private sendWorkerHeartbeat;
    /**
     * Run health check and detect issues.
     */
    private runHealthCheck;
    /**
     * Recover an orphaned or stuck meeting.
     */
    private recoverMeeting;
    /**
     * Get meetings owned by a specific worker.
     */
    getWorkerMeetings(workerId: string): Promise<string[]>;
    /**
     * Get info about a specific meeting.
     */
    getMeetingInfo(meetingId: string): Promise<MeetingInfo | null>;
    /**
     * Get full cluster health report.
     */
    getClusterHealth(): Promise<ClusterHealth>;
    /**
     * Get current worker ID.
     */
    getWorkerId(): string;
    /**
     * Check if coordinator is running.
     */
    isCoordinatorRunning(): boolean;
}
export declare const globalMeetingCoordinator: GlobalMeetingCoordinator;
export declare function startMeetingCoordinator(): Promise<void>;
export declare function stopMeetingCoordinator(): Promise<void>;
export declare function claimMeeting(meetingId: string): Promise<boolean>;
export declare function releaseMeeting(meetingId: string): Promise<boolean>;
export declare function sendMeetingHeartbeat(meetingId: string, participantCount?: number): Promise<void>;
export declare function getMeetingInfo(meetingId: string): Promise<MeetingInfo | null>;
export declare function getClusterHealth(): Promise<ClusterHealth>;
export declare function onCoordinatorEvent(callback: (event: CoordinatorEvent) => void): () => void;
export {};
//# sourceMappingURL=meeting-coordinator.d.ts.map