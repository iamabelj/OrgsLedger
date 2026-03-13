import { EventEmitter } from 'events';
import { AICostAlert } from './ai-cost.monitor';
interface RedisHealth {
    connected: boolean;
    latencyMs: number;
    pubsubWorking: boolean;
    error?: string;
}
interface PostgresHealth {
    connected: boolean;
    latencyMs: number;
    error?: string;
}
interface StuckJobInfo {
    jobId: string;
    jobName: string;
    processedOn: number;
    activeForMs: number;
    meetingId?: string;
}
interface QueueHealth {
    name: string;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: boolean;
    avgProcessingTimeMs: number;
    queueLagMs: number;
    stuckJobs: number;
    stuckJobDetails: StuckJobInfo[];
    alerts: string[];
}
interface WorkerHealth {
    name: string;
    running: boolean;
    processed: number;
    failed: number;
    healthy: boolean;
    lastCompletedAt: number | null;
    timeSinceLastCompletedMs: number;
    lastHeartbeatAt: number | null;
    heartbeatAgeMs: number;
    activeJobsStuck: boolean;
    alerts: WorkerAlert[];
}
export interface WorkerAlert {
    type: 'WORKER_INACTIVE' | 'WORKER_HIGH_FAILURE_RATE' | 'WORKER_STUCK' | 'WORKER_CRASHED' | 'STUCK_JOB_FAILED';
    worker: string;
    lastCompletedAt: number | null;
    message: string;
}
export interface RecoveryResult {
    jobId: string;
    queueName: string;
    action: 'moved_to_waiting' | 'moved_to_failed';
    retryCount: number;
    reason: string;
}
interface PipelineMetrics {
    transcriptThroughputPerMin: number;
    translationThroughputPerMin: number;
    broadcastLatencyMs: number;
    minutesGenerationMs: number;
    transcriptPipelineDelayMs: number;
    translationDurationMs: number;
}
interface ApiLatencyMetrics {
    endpoint: string;
    avgLatencyMs: number;
    p95LatencyMs: number;
    requestCount: number;
}
interface AICostHealth {
    deepgramMinutes: number;
    openaiInputTokens: number;
    openaiOutputTokens: number;
    translationCharacters: number;
    translationRequests: number;
    estimatedCostUSD: number;
    alerts: AICostAlert[];
}
interface SystemHealthReport {
    timestamp: string;
    redis: RedisHealth;
    postgres: PostgresHealth;
    queues: QueueHealth[];
    workers: WorkerHealth[];
    pipeline: PipelineMetrics;
    apiLatency: ApiLatencyMetrics[];
    aiCost: AICostHealth;
    overallStatus: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
    alerts: string[];
}
declare class SystemMonitorClass extends EventEmitter {
    private intervalId;
    private redis;
    private queues;
    private queueEvents;
    private isRunning;
    private workerLastCompleted;
    private workerProcessedCounts;
    private workerFailedCounts;
    private stuckJobFailedAlerts;
    private metricsWindow;
    private apiLatencyWindow;
    private monitoredEndpoints;
    initialize(): Promise<void>;
    private handleJobCompleted;
    private handleJobFailed;
    private pruneMetricsWindow;
    /**
     * Check Redis connectivity and latency
     */
    checkRedisHealth(): Promise<RedisHealth>;
    /**
     * Check PostgreSQL connectivity and latency
     */
    checkPostgresHealth(): Promise<PostgresHealth>;
    /**
     * Check queue health for a specific queue
     */
    checkQueueHealth(queueName: string): Promise<QueueHealth>;
    /**
     * Check worker health
     *
     * Worker is considered running if it has completed a job within
     * the noCompletedTimeout threshold. This correctly detects frozen
     * or crashed workers that are no longer processing jobs.
     *
     * Also checks heartbeat timestamps in Redis - if heartbeat is older
     * than heartbeatTimeoutMs, worker is marked as CRITICAL with WORKER_CRASHED alert.
     */
    checkWorkerHealth(workerName: string): Promise<WorkerHealth>;
    /**
     * Send worker heartbeat to Redis
     * Workers should call this every 5 seconds.
     * Non-blocking - never throws.
     */
    sendWorkerHeartbeat(workerName: string): Promise<void>;
    /**
     * Get the retry count for a stuck job from Redis
     * Returns 0 if not found or on error (non-blocking)
     */
    private getJobRetryCount;
    /**
     * Increment the retry count for a stuck job in Redis
     * Returns the new count (non-blocking, returns 0 on error)
     */
    private incrementJobRetryCount;
    /**
     * Clear the retry count for a job (called when job completes)
     */
    private clearJobRetryCount;
    /**
     * Recover stuck jobs for a specific queue
     * - Jobs with retries < maxAutoRecoverRetries: move back to waiting
     * - Jobs with retries >= maxAutoRecoverRetries: move to failed, emit STUCK_JOB_FAILED alert
     *
     * Non-blocking - runs asynchronously.
     */
    recoverStuckJobs(queueName: string): Promise<RecoveryResult[]>;
    /**
     * Recover stuck jobs for all monitored queues (non-blocking)
     * Called by the monitoring loop but runs asynchronously to not block.
     */
    recoverAllStuckJobs(): void;
    /**
     * Get stuck job failed alerts
     */
    getStuckJobFailedAlerts(): WorkerAlert[];
    /**
     * Clear stuck job failed alerts (e.g., after they've been reported)
     */
    clearStuckJobFailedAlerts(): void;
    /**
     * Update Prometheus metrics from health report
     * Non-blocking - errors are logged but don't fail the monitor cycle
     */
    private updatePrometheusFromReport;
    /**
     * Get pipeline metrics
     */
    getPipelineMetrics(): PipelineMetrics;
    /**
     * Get API latency metrics
     */
    getApiLatencyMetrics(): ApiLatencyMetrics[];
    /**
     * Record broadcast latency (called from broadcast worker)
     */
    recordBroadcastLatency(latencyMs: number): void;
    /**
     * Record minutes generation time (called from minutes worker)
     */
    recordMinutesGenerationTime(durationMs: number): void;
    /**
     * Record pipeline delay (time from transcript to translation queue)
     */
    recordPipelineDelay(delayMs: number): void;
    /**
     * Record translation duration
     */
    recordTranslationDuration(durationMs: number): void;
    /**
     * Record API request latency
     */
    recordApiLatency(endpoint: string, latencyMs: number): void;
    /**
     * Generate comprehensive system health report
     */
    generateHealthReport(): Promise<SystemHealthReport>;
    /**
     * Print formatted health report to console
     */
    printHealthReport(report: SystemHealthReport): void;
    /**
     * Run a single monitoring cycle
     */
    runMonitorCycle(): Promise<SystemHealthReport>;
    /**
     * Start the monitoring loop
     */
    start(): Promise<void>;
    /**
     * Stop the monitoring loop
     */
    stop(): Promise<void>;
    /**
     * Get current running state
     */
    isActive(): boolean;
}
declare const systemMonitor: SystemMonitorClass;
/**
 * Express middleware to track API endpoint latency
 */
export declare function apiLatencyMiddleware(): (req: any, res: any, next: any) => void;
/**
 * Start the system health monitor
 * Runs health checks every 30 seconds
 */
export declare function startSystemMonitor(): Promise<void>;
/**
 * Stop the system health monitor
 */
export declare function stopSystemMonitor(): Promise<void>;
/**
 * Get a single health report (for health check endpoints)
 */
export declare function getHealthReport(): Promise<SystemHealthReport>;
/**
 * Record broadcast latency metric
 */
export declare function recordBroadcastLatency(latencyMs: number): void;
/**
 * Record minutes generation time metric
 */
export declare function recordMinutesGenerationTime(durationMs: number): void;
/**
 * Record pipeline delay metric
 */
export declare function recordPipelineDelay(delayMs: number): void;
/**
 * Record translation duration metric
 */
export declare function recordTranslationDuration(durationMs: number): void;
/**
 * Record API latency (use middleware instead when possible)
 */
export declare function recordApiLatency(endpoint: string, latencyMs: number): void;
/**
 * Send worker heartbeat to Redis
 * Workers should call this every 5 seconds.
 * Non-blocking - never throws.
 *
 * @param workerName - Name of the worker (e.g., 'transcript', 'translation', 'broadcast', 'minutes')
 */
export declare function sendWorkerHeartbeat(workerName: string): Promise<void>;
/**
 * Manually trigger stuck job recovery for all queues
 * Normally called automatically by the monitor cycle, but available for manual intervention.
 * Non-blocking - spawns async recovery tasks.
 */
export declare function triggerStuckJobRecovery(): void;
/**
 * Recover stuck jobs for a specific queue
 * Returns results of recovery actions.
 *
 * @param queueName - Name of the queue to recover
 * @returns Array of recovery results
 */
export declare function recoverStuckJobs(queueName: string): Promise<RecoveryResult[]>;
/**
 * Get stuck job failed alerts (jobs that exceeded max auto-recovery retries)
 */
export declare function getStuckJobFailedAlerts(): WorkerAlert[];
/**
 * Get the monitor instance for event subscriptions
 */
export declare function getSystemMonitor(): SystemMonitorClass;
export default systemMonitor;
//# sourceMappingURL=system.monitor.d.ts.map