import { EventEmitter } from 'events';
import * as client from 'prom-client';
export interface HeartbeatData {
    lastHeartbeat: number;
    activeJobs: number;
    queueName: string;
    workerId: string;
    workerName: string;
    hostname?: string;
    pid?: number;
    uptime?: number;
}
export interface WorkerStatus {
    workerName: string;
    workerId: string;
    queueName: string;
    status: 'alive' | 'unhealthy' | 'dead';
    lastHeartbeat: number;
    lastHeartbeatAge: number;
    activeJobs: number;
    unhealthySince?: number;
    hostname?: string;
    pid?: number;
}
export interface WorkerHeartbeatEvent {
    type: 'WORKER_UNHEALTHY' | 'WORKER_DEAD' | 'WORKER_RECOVERED';
    workerName: string;
    workerId: string;
    queueName: string;
    lastHeartbeat: number;
    unhealthyDuration?: number;
    timestamp: string;
}
export interface WorkerHeartbeatStats {
    totalWorkers: number;
    aliveWorkers: number;
    unhealthyWorkers: number;
    deadWorkers: number;
    workers: WorkerStatus[];
}
export declare const workerAliveGauge: client.Gauge<"queue" | "worker_name">;
export declare const workerUnhealthyGauge: client.Gauge<"queue" | "worker_name">;
export declare const workerDeadGauge: client.Gauge<"queue" | "worker_name">;
export declare const workerHeartbeatLatencyMs: client.Gauge<"worker_id" | "worker_name">;
export declare const workerActiveJobsGauge: client.Gauge<"worker_id" | "worker_name">;
declare class WorkerHeartbeatMonitor extends EventEmitter {
    private redis;
    private monitorInterval;
    private isRunning;
    private unhealthyTimestamps;
    private workerStates;
    constructor();
    /**
     * Send heartbeat from a worker
     * Workers should call this every 5 seconds
     * Non-blocking - never throws
     *
     * @param workerName - Logical worker name (e.g., 'transcript', 'translation')
     * @param workerId - Unique worker instance ID (e.g., UUID or pod name)
     * @param activeJobs - Number of jobs currently processing
     * @param queueName - Queue the worker is consuming from
     */
    sendHeartbeat(workerName: string, workerId: string, activeJobs: number, queueName: string): Promise<void>;
    /**
     * Create a heartbeat sender function for a worker
     * Returns a function that can be called periodically
     */
    createHeartbeatSender(workerName: string, workerId: string, queueName: string): (activeJobs: number) => Promise<void>;
    /**
     * Start automatic heartbeat for a worker
     * Returns cleanup function to stop heartbeat
     */
    startAutomaticHeartbeat(workerName: string, workerId: string, queueName: string, getActiveJobs: () => number): () => void;
    /**
     * Start the heartbeat monitor
     * Scans all worker heartbeats every 10 seconds
     */
    start(): Promise<void>;
    /**
     * Stop the heartbeat monitor
     */
    stop(): void;
    /**
     * Run a single monitoring cycle
     * Scans all heartbeats and emits events
     */
    private runMonitorCycle;
    /**
     * Emit worker health event
     */
    private emitWorkerEvent;
    /**
     * Scan all worker heartbeat keys from Redis
     */
    private scanAllHeartbeats;
    /**
     * Get current worker statistics
     */
    getStats(): Promise<WorkerHeartbeatStats>;
    /**
     * Get workers by name
     */
    getWorkersByName(workerName: string): Promise<WorkerStatus[]>;
    /**
     * Get workers by queue
     */
    getWorkersByQueue(queueName: string): Promise<WorkerStatus[]>;
    /**
     * Check if a specific worker is healthy
     */
    isWorkerHealthy(workerName: string, workerId: string): Promise<boolean>;
    /**
     * Manually remove a worker's heartbeat (for cleanup)
     */
    removeWorkerHeartbeat(workerName: string, workerId: string): Promise<void>;
    /**
     * Check if monitor is running
     */
    isMonitorRunning(): boolean;
    private getHeartbeatKey;
    private getRedis;
}
declare const workerHeartbeatMonitor: WorkerHeartbeatMonitor;
export { workerHeartbeatMonitor };
/**
 * Start the heartbeat monitor
 */
export declare function startWorkerHeartbeatMonitor(): Promise<void>;
/**
 * Stop the heartbeat monitor
 */
export declare function stopWorkerHeartbeatMonitor(): void;
/**
 * Send a single heartbeat from a worker
 */
export declare function sendWorkerHeartbeat(workerName: string, workerId: string, activeJobs: number, queueName: string): Promise<void>;
/**
 * Start automatic heartbeat for a worker
 * Returns cleanup function
 */
export declare function startAutomaticHeartbeat(workerName: string, workerId: string, queueName: string, getActiveJobs: () => number): () => void;
/**
 * Get current worker heartbeat statistics
 */
export declare function getWorkerHeartbeatStats(): Promise<WorkerHeartbeatStats>;
/**
 * Get workers by name
 */
export declare function getWorkersByName(workerName: string): Promise<WorkerStatus[]>;
/**
 * Get workers by queue
 */
export declare function getWorkersByQueue(queueName: string): Promise<WorkerStatus[]>;
/**
 * Check if a specific worker is healthy
 */
export declare function isWorkerHealthy(workerName: string, workerId: string): Promise<boolean>;
/**
 * Register event listener for worker events
 */
export declare function onWorkerEvent(event: 'WORKER_UNHEALTHY' | 'WORKER_DEAD' | 'WORKER_RECOVERED' | 'worker-event', listener: (event: WorkerHeartbeatEvent) => void): void;
/**
 * Remove event listener
 */
export declare function offWorkerEvent(event: 'WORKER_UNHEALTHY' | 'WORKER_DEAD' | 'WORKER_RECOVERED' | 'worker-event', listener: (event: WorkerHeartbeatEvent) => void): void;
export declare const HEARTBEAT_INTERVALS: {
    heartbeatIntervalMs: number;
    heartbeatTtlMs: number;
    monitorIntervalMs: number;
    deadThresholdMs: number;
};
//# sourceMappingURL=worker-heartbeat.monitor.d.ts.map