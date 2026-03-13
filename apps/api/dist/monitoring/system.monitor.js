"use strict";
// ============================================================
// OrgsLedger API — System Health Monitor
// Comprehensive observability for the AI meeting architecture
// ============================================================
//
// Monitors:
//   - Redis connectivity and latency
//   - PostgreSQL connectivity and latency
//   - BullMQ queue health (4 queues)
//   - Worker activity and crash detection
//   - Transcript pipeline throughput
//   - Translation pipeline throughput
//   - Broadcast latency
//   - Minutes generation time
//   - API endpoint latency
//   - AI service costs (Deepgram, OpenAI, Translation)
//
// Run: Automatically starts with startSystemMonitor()
// Schedule: Every 30 seconds
//
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiLatencyMiddleware = apiLatencyMiddleware;
exports.startSystemMonitor = startSystemMonitor;
exports.stopSystemMonitor = stopSystemMonitor;
exports.getHealthReport = getHealthReport;
exports.recordBroadcastLatency = recordBroadcastLatency;
exports.recordMinutesGenerationTime = recordMinutesGenerationTime;
exports.recordPipelineDelay = recordPipelineDelay;
exports.recordTranslationDuration = recordTranslationDuration;
exports.recordApiLatency = recordApiLatency;
exports.sendWorkerHeartbeat = sendWorkerHeartbeat;
exports.triggerStuckJobRecovery = triggerStuckJobRecovery;
exports.recoverStuckJobs = recoverStuckJobs;
exports.getStuckJobFailedAlerts = getStuckJobFailedAlerts;
exports.getSystemMonitor = getSystemMonitor;
const bullmq_1 = require("bullmq");
const events_1 = require("events");
const logger_1 = require("../logger");
const db_1 = require("../db");
const redisClient_1 = require("../infrastructure/redisClient");
const transcript_queue_1 = require("../queues/transcript.queue");
const ai_cost_monitor_1 = require("./ai-cost.monitor");
const prometheus_metrics_1 = require("./prometheus.metrics");
// ── Configuration ───────────────────────────────────────────
const MONITOR_CONFIG = {
    interval: 30000, // 30 seconds
    thresholds: {
        redis: {
            maxLatencyMs: 100,
            pubsubTimeoutMs: 5000,
        },
        postgres: {
            maxLatencyMs: 200,
        },
        queue: {
            maxWaiting: 100,
            maxFailed: 10,
            maxProcessingLatencyMs: 5000,
            maxActiveJobDurationMs: 30000, // 30 seconds - jobs active longer are considered stuck
        },
        worker: {
            noCompletedTimeoutSec: 60,
            activeStuckTimeoutSec: 30,
            heartbeatIntervalMs: 5000, // Workers send heartbeat every 5 seconds
            heartbeatTimeoutMs: 10000, // Heartbeat older than 10 seconds = CRITICAL
        },
        recovery: {
            maxAutoRecoverRetries: 3, // Maximum times to auto-recover a stuck job
        },
        pipeline: {
            transcriptDelayMs: 2000,
            translationDurationMs: 3000,
            broadcastLatencyMs: 1000,
            minutesGenerationMs: 20000,
        },
        api: {
            maxLatencyMs: 500,
        },
    },
    queues: [
        transcript_queue_1.QUEUE_NAMES.TRANSCRIPT_EVENTS,
        transcript_queue_1.QUEUE_NAMES.TRANSLATION_JOBS,
        transcript_queue_1.QUEUE_NAMES.BROADCAST_EVENTS,
        transcript_queue_1.QUEUE_NAMES.MINUTES_GENERATION,
    ],
};
// ── System Monitor Class ────────────────────────────────────
class SystemMonitorClass extends events_1.EventEmitter {
    intervalId = null;
    redis = null;
    queues = new Map();
    queueEvents = new Map();
    isRunning = false;
    // Worker tracking
    workerLastCompleted = new Map();
    workerProcessedCounts = new Map();
    workerFailedCounts = new Map();
    // Recovery tracking - alerts for jobs that exceeded max retries
    stuckJobFailedAlerts = [];
    // Metrics windows (rolling 1-minute windows)
    metricsWindow = {
        transcriptEvents: [],
        translationEvents: [],
        broadcastLatencies: [],
        minutesGenerationTimes: [],
        pipelineDelays: [],
        translationDurations: [],
    };
    // API latency tracking
    apiLatencyWindow = {};
    monitoredEndpoints = [
        'POST /meetings/create',
        'POST /meetings/:id/token',
        'POST /meetings/join',
        'POST /meetings/leave',
    ];
    // ── Initialization ──────────────────────────────────────────
    async initialize() {
        try {
            // Get Redis connection
            this.redis = await (0, redisClient_1.getRedisClient)();
            logger_1.logger.info('[SYSTEM_MONITOR] Redis connection established');
            // Initialize queue instances for monitoring
            for (const queueName of MONITOR_CONFIG.queues) {
                const queue = new bullmq_1.Queue(queueName, {
                    connection: this.redis,
                });
                this.queues.set(queueName, queue);
                // Set up queue events for real-time metrics
                const queueEvents = new bullmq_1.QueueEvents(queueName, {
                    connection: this.redis,
                });
                queueEvents.on('completed', ({ jobId, returnvalue }) => {
                    this.handleJobCompleted(queueName, jobId);
                });
                queueEvents.on('failed', ({ jobId, failedReason }) => {
                    this.handleJobFailed(queueName, jobId, failedReason);
                });
                this.queueEvents.set(queueName, queueEvents);
            }
            // Initialize worker tracking
            for (const workerName of ['transcript', 'translation', 'broadcast', 'minutes']) {
                this.workerLastCompleted.set(workerName, Date.now());
                this.workerProcessedCounts.set(workerName, 0);
                this.workerFailedCounts.set(workerName, 0);
            }
            // Initialize API latency tracking
            for (const endpoint of this.monitoredEndpoints) {
                this.apiLatencyWindow[endpoint] = [];
            }
            logger_1.logger.info('[SYSTEM_MONITOR] Initialized successfully', {
                queues: MONITOR_CONFIG.queues,
            });
        }
        catch (err) {
            logger_1.logger.error('[SYSTEM_MONITOR] Initialization failed', err);
            throw err;
        }
    }
    // ── Job Event Handlers ──────────────────────────────────────
    handleJobCompleted(queueName, jobId) {
        const timestamp = Date.now();
        if (queueName === transcript_queue_1.QUEUE_NAMES.TRANSCRIPT_EVENTS) {
            this.metricsWindow.transcriptEvents.push(timestamp);
            this.workerLastCompleted.set('transcript', timestamp);
            this.workerProcessedCounts.set('transcript', (this.workerProcessedCounts.get('transcript') || 0) + 1);
        }
        else if (queueName === transcript_queue_1.QUEUE_NAMES.TRANSLATION_JOBS) {
            this.metricsWindow.translationEvents.push(timestamp);
            this.workerLastCompleted.set('translation', timestamp);
            this.workerProcessedCounts.set('translation', (this.workerProcessedCounts.get('translation') || 0) + 1);
        }
        else if (queueName === transcript_queue_1.QUEUE_NAMES.BROADCAST_EVENTS) {
            this.workerLastCompleted.set('broadcast', timestamp);
            this.workerProcessedCounts.set('broadcast', (this.workerProcessedCounts.get('broadcast') || 0) + 1);
        }
        else if (queueName === transcript_queue_1.QUEUE_NAMES.MINUTES_GENERATION) {
            this.workerLastCompleted.set('minutes', timestamp);
            this.workerProcessedCounts.set('minutes', (this.workerProcessedCounts.get('minutes') || 0) + 1);
        }
        // Prune old events (keep last 60 seconds)
        this.pruneMetricsWindow();
    }
    handleJobFailed(queueName, jobId, reason) {
        const workerMap = {
            [transcript_queue_1.QUEUE_NAMES.TRANSCRIPT_EVENTS]: 'transcript',
            [transcript_queue_1.QUEUE_NAMES.TRANSLATION_JOBS]: 'translation',
            [transcript_queue_1.QUEUE_NAMES.BROADCAST_EVENTS]: 'broadcast',
            [transcript_queue_1.QUEUE_NAMES.MINUTES_GENERATION]: 'minutes',
        };
        const workerName = workerMap[queueName];
        if (workerName) {
            this.workerFailedCounts.set(workerName, (this.workerFailedCounts.get(workerName) || 0) + 1);
        }
        logger_1.logger.warn('[SYSTEM_MONITOR] Job failed', {
            queue: queueName,
            jobId,
            reason: reason?.substring(0, 200),
        });
    }
    pruneMetricsWindow() {
        const cutoff = Date.now() - 60000; // 1 minute ago
        for (const key of Object.keys(this.metricsWindow)) {
            this.metricsWindow[key] = this.metricsWindow[key].filter(ts => ts > cutoff);
        }
        for (const endpoint of Object.keys(this.apiLatencyWindow)) {
            // Keep last 100 measurements per endpoint
            if (this.apiLatencyWindow[endpoint].length > 100) {
                this.apiLatencyWindow[endpoint] = this.apiLatencyWindow[endpoint].slice(-100);
            }
        }
    }
    // ── Health Checks ───────────────────────────────────────────
    /**
     * Check Redis connectivity and latency
     */
    async checkRedisHealth() {
        if (!this.redis) {
            return {
                connected: false,
                latencyMs: 0,
                pubsubWorking: false,
                error: 'Redis not initialized',
            };
        }
        try {
            // Measure ping latency
            const start = Date.now();
            await this.redis.ping();
            const latencyMs = Date.now() - start;
            // Test PubSub with a quick publish/subscribe cycle
            let pubsubWorking = false;
            let subscriber = null;
            try {
                const testChannel = `__monitor_test_${Date.now()}`;
                const testMessage = 'monitor_ping';
                // Create separate subscriber
                subscriber = this.redis.duplicate();
                const pubsubPromise = new Promise((resolve) => {
                    const timeout = setTimeout(() => {
                        // Timeout occurred - will cleanup in finally block
                        resolve(false);
                    }, MONITOR_CONFIG.thresholds.redis.pubsubTimeoutMs);
                    subscriber.subscribe(testChannel, (err) => {
                        if (err) {
                            clearTimeout(timeout);
                            resolve(false);
                            return;
                        }
                    });
                    subscriber.on('message', (channel, message) => {
                        if (channel === testChannel && message === testMessage) {
                            clearTimeout(timeout);
                            resolve(true);
                        }
                    });
                    // Publish after a small delay
                    setTimeout(() => {
                        this.redis.publish(testChannel, testMessage);
                    }, 50);
                });
                pubsubWorking = await pubsubPromise;
            }
            catch {
                pubsubWorking = false;
            }
            finally {
                // Guarantee subscriber cleanup regardless of success, failure, or timeout
                if (subscriber) {
                    try {
                        await subscriber.unsubscribe();
                        await subscriber.quit();
                        logger_1.logger.debug('[SYSTEM_MONITOR] Redis PubSub subscriber closed');
                    }
                    catch (cleanupErr) {
                        // Force disconnect if quit fails
                        try {
                            subscriber.disconnect();
                            logger_1.logger.debug('[SYSTEM_MONITOR] Redis PubSub subscriber force disconnected');
                        }
                        catch {
                            // Ignore disconnect errors
                        }
                    }
                }
            }
            const result = {
                connected: true,
                latencyMs,
                pubsubWorking,
            };
            if (latencyMs > MONITOR_CONFIG.thresholds.redis.maxLatencyMs) {
                result.error = `Latency ${latencyMs}ms exceeds threshold ${MONITOR_CONFIG.thresholds.redis.maxLatencyMs}ms`;
            }
            return result;
        }
        catch (err) {
            return {
                connected: false,
                latencyMs: 0,
                pubsubWorking: false,
                error: err.message,
            };
        }
    }
    /**
     * Check PostgreSQL connectivity and latency
     */
    async checkPostgresHealth() {
        try {
            const start = Date.now();
            await db_1.db.raw('SELECT 1');
            const latencyMs = Date.now() - start;
            const result = {
                connected: true,
                latencyMs,
            };
            if (latencyMs > MONITOR_CONFIG.thresholds.postgres.maxLatencyMs) {
                result.error = `Latency ${latencyMs}ms exceeds threshold ${MONITOR_CONFIG.thresholds.postgres.maxLatencyMs}ms`;
            }
            return result;
        }
        catch (err) {
            return {
                connected: false,
                latencyMs: 0,
                error: err.message,
            };
        }
    }
    /**
     * Check queue health for a specific queue
     */
    async checkQueueHealth(queueName) {
        const queue = this.queues.get(queueName);
        const alerts = [];
        if (!queue) {
            return {
                name: queueName,
                waiting: 0,
                active: 0,
                completed: 0,
                failed: 0,
                delayed: 0,
                paused: false,
                avgProcessingTimeMs: 0,
                queueLagMs: 0,
                stuckJobs: 0,
                stuckJobDetails: [],
                alerts: ['Queue not initialized'],
            };
        }
        try {
            // Get queue counts
            const [waiting, active, completed, failed, delayed] = await Promise.all([
                queue.getWaitingCount(),
                queue.getActiveCount(),
                queue.getCompletedCount(),
                queue.getFailedCount(),
                queue.getDelayedCount(),
            ]);
            const isPaused = await queue.isPaused();
            // Calculate average processing time from completed jobs
            let avgProcessingTimeMs = 0;
            try {
                const completedJobs = await queue.getCompleted(0, 10);
                if (completedJobs.length > 0) {
                    const processingTimes = completedJobs
                        .filter(job => job.finishedOn && job.processedOn)
                        .map(job => job.finishedOn - job.processedOn);
                    if (processingTimes.length > 0) {
                        avgProcessingTimeMs = processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length;
                    }
                }
            }
            catch {
                // Ignore errors fetching completed jobs
            }
            // Calculate queue lag (time oldest waiting job has been waiting)
            let queueLagMs = 0;
            try {
                const waitingJobs = await queue.getWaiting(0, 1);
                if (waitingJobs.length > 0 && waitingJobs[0].timestamp) {
                    queueLagMs = Date.now() - waitingJobs[0].timestamp;
                }
            }
            catch {
                // Ignore errors fetching waiting jobs
            }
            // Detect stuck jobs (jobs in active state longer than threshold)
            let stuckJobsCount = 0;
            const stuckJobDetails = [];
            try {
                const activeJobs = await queue.getActive();
                const now = Date.now();
                const maxDuration = MONITOR_CONFIG.thresholds.queue.maxActiveJobDurationMs;
                for (const job of activeJobs) {
                    if (!job.processedOn)
                        continue;
                    const activeForMs = now - job.processedOn;
                    if (activeForMs > maxDuration) {
                        stuckJobsCount++;
                        stuckJobDetails.push({
                            jobId: job.id || 'unknown',
                            jobName: job.name,
                            processedOn: job.processedOn,
                            activeForMs,
                            meetingId: job.data?.meetingId,
                        });
                    }
                }
                // Log details of stuck jobs
                if (stuckJobDetails.length > 0) {
                    logger_1.logger.warn('[SYSTEM_MONITOR] Stuck jobs detected', {
                        queue: queueName,
                        count: stuckJobDetails.length,
                        jobs: stuckJobDetails.map(j => ({
                            id: j.jobId,
                            name: j.jobName,
                            processedOn: new Date(j.processedOn).toISOString(),
                            activeForSec: Math.round(j.activeForMs / 1000),
                            meetingId: j.meetingId,
                        })),
                    });
                }
            }
            catch {
                // Ignore errors fetching active jobs
            }
            // Generate alerts
            if (waiting > MONITOR_CONFIG.thresholds.queue.maxWaiting) {
                alerts.push(`High waiting count: ${waiting} (threshold: ${MONITOR_CONFIG.thresholds.queue.maxWaiting})`);
            }
            if (failed > MONITOR_CONFIG.thresholds.queue.maxFailed) {
                alerts.push(`High failed count: ${failed} (threshold: ${MONITOR_CONFIG.thresholds.queue.maxFailed})`);
            }
            if (avgProcessingTimeMs > MONITOR_CONFIG.thresholds.queue.maxProcessingLatencyMs) {
                alerts.push(`High processing latency: ${avgProcessingTimeMs}ms (threshold: ${MONITOR_CONFIG.thresholds.queue.maxProcessingLatencyMs}ms)`);
            }
            // Alert on stuck jobs
            if (stuckJobsCount > 0) {
                alerts.push(`STUCK_JOBS: ${stuckJobsCount} job(s) stuck in active state > ${MONITOR_CONFIG.thresholds.queue.maxActiveJobDurationMs / 1000}s`);
            }
            return {
                name: queueName,
                waiting,
                active,
                completed,
                failed,
                delayed,
                paused: isPaused,
                avgProcessingTimeMs: Math.round(avgProcessingTimeMs),
                queueLagMs: Math.round(queueLagMs),
                stuckJobs: stuckJobsCount,
                stuckJobDetails,
                alerts,
            };
        }
        catch (err) {
            return {
                name: queueName,
                waiting: 0,
                active: 0,
                completed: 0,
                failed: 0,
                delayed: 0,
                paused: false,
                avgProcessingTimeMs: 0,
                queueLagMs: 0,
                stuckJobs: 0,
                stuckJobDetails: [],
                alerts: [`Error checking queue: ${err.message}`],
            };
        }
    }
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
    async checkWorkerHealth(workerName) {
        const alerts = [];
        const lastCompletedAt = this.workerLastCompleted.get(workerName) || 0;
        const processed = this.workerProcessedCounts.get(workerName) || 0;
        const failed = this.workerFailedCounts.get(workerName) || 0;
        const now = Date.now();
        const timeSinceLastCompletedMs = lastCompletedAt > 0 ? now - lastCompletedAt : 0;
        const noCompletedTimeout = MONITOR_CONFIG.thresholds.worker.noCompletedTimeoutSec * 1000;
        // Check heartbeat from Redis (non-blocking)
        let lastHeartbeatAt = null;
        let heartbeatAgeMs = 0;
        try {
            if (this.redis) {
                const heartbeatKey = `worker_heartbeat:${workerName}`;
                const heartbeatTs = await this.redis.get(heartbeatKey);
                if (heartbeatTs) {
                    lastHeartbeatAt = parseInt(heartbeatTs, 10);
                    heartbeatAgeMs = now - lastHeartbeatAt;
                }
            }
        }
        catch (err) {
            // Non-blocking - just log and continue
            logger_1.logger.debug('[SYSTEM_MONITOR] Failed to check heartbeat', { workerName, error: err.message });
        }
        // Check if heartbeat is stale (worker crashed)
        const heartbeatTimeout = MONITOR_CONFIG.thresholds.worker.heartbeatTimeoutMs;
        const heartbeatStale = lastHeartbeatAt !== null && heartbeatAgeMs > heartbeatTimeout;
        if (heartbeatStale) {
            alerts.push({
                type: 'WORKER_CRASHED',
                worker: workerName,
                lastCompletedAt: lastCompletedAt > 0 ? lastCompletedAt : null,
                message: `Worker ${workerName} heartbeat stale: last heartbeat ${Math.round(heartbeatAgeMs / 1000)}s ago (threshold: ${heartbeatTimeout / 1000}s)`,
            });
        }
        // Worker is running if it has completed a job recently AND heartbeat is fresh
        // A worker that has never processed jobs is not considered running
        const running = lastCompletedAt > 0 && timeSinceLastCompletedMs < noCompletedTimeout && !heartbeatStale;
        // Alert if worker is inactive (has processed jobs before but not recently)
        if (lastCompletedAt > 0 && timeSinceLastCompletedMs > noCompletedTimeout && !heartbeatStale) {
            alerts.push({
                type: 'WORKER_INACTIVE',
                worker: workerName,
                lastCompletedAt,
                message: `Worker ${workerName} has not completed a job in ${Math.round(timeSinceLastCompletedMs / 1000)}s (threshold: ${MONITOR_CONFIG.thresholds.worker.noCompletedTimeoutSec}s)`,
            });
        }
        // Alert if worker has never completed a job but has been initialized
        if (lastCompletedAt === 0 && processed === 0) {
            // This is expected for newly started workers, not an alert condition
            // Only alert if we expect activity (could add startup grace period here)
        }
        // Determine overall health
        // Worker is healthy if running and no alerts, OR if it's a new worker with no activity yet
        // Heartbeat stale = unhealthy regardless of other factors
        const healthy = !heartbeatStale && ((running && alerts.length === 0) || (lastCompletedAt === 0 && processed === 0));
        return {
            name: workerName,
            running,
            processed,
            failed,
            healthy,
            lastCompletedAt: lastCompletedAt > 0 ? lastCompletedAt : null,
            timeSinceLastCompletedMs,
            lastHeartbeatAt,
            heartbeatAgeMs,
            activeJobsStuck: false, // Would need more sophisticated tracking
            alerts,
        };
    }
    /**
     * Send worker heartbeat to Redis
     * Workers should call this every 5 seconds.
     * Non-blocking - never throws.
     */
    async sendWorkerHeartbeat(workerName) {
        try {
            if (!this.redis) {
                logger_1.logger.debug('[SYSTEM_MONITOR] Cannot send heartbeat - Redis not initialized');
                return;
            }
            const heartbeatKey = `worker_heartbeat:${workerName}`;
            const timestamp = Date.now().toString();
            // Set with expiry (3x heartbeat interval to handle missed beats)
            const expirySeconds = Math.ceil((MONITOR_CONFIG.thresholds.worker.heartbeatIntervalMs * 3) / 1000);
            await this.redis.set(heartbeatKey, timestamp, 'EX', expirySeconds);
            logger_1.logger.debug('[SYSTEM_MONITOR] Heartbeat sent', { workerName, timestamp });
        }
        catch (err) {
            // Non-blocking - just log the error
            logger_1.logger.debug('[SYSTEM_MONITOR] Failed to send heartbeat', {
                workerName,
                error: err.message
            });
        }
    }
    // ── Stuck Job Recovery Methods ──────────────────────────────
    /**
     * Get the retry count for a stuck job from Redis
     * Returns 0 if not found or on error (non-blocking)
     */
    async getJobRetryCount(jobId) {
        try {
            if (!this.redis)
                return 0;
            const key = `stuck_job_retries:${jobId}`;
            const count = await this.redis.get(key);
            return count ? parseInt(count, 10) : 0;
        }
        catch (err) {
            logger_1.logger.debug('[SYSTEM_MONITOR] Failed to get job retry count', {
                jobId,
                error: err.message
            });
            return 0;
        }
    }
    /**
     * Increment the retry count for a stuck job in Redis
     * Returns the new count (non-blocking, returns 0 on error)
     */
    async incrementJobRetryCount(jobId) {
        try {
            if (!this.redis)
                return 0;
            const key = `stuck_job_retries:${jobId}`;
            // Set expiry to 24 hours - cleanup old entries
            const newCount = await this.redis.incr(key);
            await this.redis.expire(key, 86400);
            return newCount;
        }
        catch (err) {
            logger_1.logger.debug('[SYSTEM_MONITOR] Failed to increment job retry count', {
                jobId,
                error: err.message
            });
            return 0;
        }
    }
    /**
     * Clear the retry count for a job (called when job completes)
     */
    async clearJobRetryCount(jobId) {
        try {
            if (!this.redis)
                return;
            const key = `stuck_job_retries:${jobId}`;
            await this.redis.del(key);
        }
        catch (err) {
            logger_1.logger.debug('[SYSTEM_MONITOR] Failed to clear job retry count', {
                jobId,
                error: err.message
            });
        }
    }
    /**
     * Recover stuck jobs for a specific queue
     * - Jobs with retries < maxAutoRecoverRetries: move back to waiting
     * - Jobs with retries >= maxAutoRecoverRetries: move to failed, emit STUCK_JOB_FAILED alert
     *
     * Non-blocking - runs asynchronously.
     */
    async recoverStuckJobs(queueName) {
        const results = [];
        const queue = this.queues.get(queueName);
        if (!queue) {
            logger_1.logger.debug('[SYSTEM_MONITOR] Cannot recover - queue not found', { queueName });
            return results;
        }
        try {
            const activeJobs = await queue.getActive();
            const now = Date.now();
            const maxDuration = MONITOR_CONFIG.thresholds.queue.maxActiveJobDurationMs;
            const maxRetries = MONITOR_CONFIG.thresholds.recovery.maxAutoRecoverRetries;
            for (const job of activeJobs) {
                if (!job.processedOn || !job.id)
                    continue;
                const activeForMs = now - job.processedOn;
                if (activeForMs <= maxDuration)
                    continue;
                // Job is stuck - check retry count
                const currentRetries = await this.getJobRetryCount(job.id);
                if (currentRetries >= maxRetries) {
                    // Exceeded max retries - move to failed
                    try {
                        await job.moveToFailed(new Error(`Stuck job exceeded max auto-recovery retries (${maxRetries})`), job.token || 'monitor-recovery');
                        const result = {
                            jobId: job.id,
                            queueName,
                            action: 'moved_to_failed',
                            retryCount: currentRetries,
                            reason: `Exceeded max auto-recovery retries (${maxRetries})`,
                        };
                        results.push(result);
                        // Update Prometheus counter
                        (0, prometheus_metrics_1.incrementRecoveryMetrics)(queueName, 'failed');
                        // Add STUCK_JOB_FAILED alert
                        const alert = {
                            type: 'STUCK_JOB_FAILED',
                            worker: queueName.replace('-events', '').replace('-jobs', '').replace('-generation', ''),
                            lastCompletedAt: null,
                            message: `Job ${job.id} in ${queueName} permanently failed after ${currentRetries} auto-recovery attempts`,
                        };
                        // Avoid duplicate alerts for same job
                        if (!this.stuckJobFailedAlerts.some(a => a.message.includes(job.id))) {
                            this.stuckJobFailedAlerts.push(alert);
                            // Keep only last 50 alerts
                            if (this.stuckJobFailedAlerts.length > 50) {
                                this.stuckJobFailedAlerts = this.stuckJobFailedAlerts.slice(-50);
                            }
                        }
                        logger_1.logger.error('[SYSTEM_MONITOR] Stuck job moved to failed', {
                            jobId: job.id,
                            queueName,
                            retryCount: currentRetries,
                            activeForMs,
                            meetingId: job.data?.meetingId,
                        });
                    }
                    catch (moveErr) {
                        logger_1.logger.error('[SYSTEM_MONITOR] Failed to move stuck job to failed', {
                            jobId: job.id,
                            queueName,
                            error: moveErr.message,
                        });
                    }
                }
                else {
                    // Retry the job - move back to waiting
                    try {
                        const newRetryCount = await this.incrementJobRetryCount(job.id);
                        // Use moveToDelayed to release the job and let it retry
                        // Adding a small delay to prevent immediate re-pickup by same worker
                        await job.moveToDelayed(now + 1000, job.token || 'monitor-recovery');
                        const result = {
                            jobId: job.id,
                            queueName,
                            action: 'moved_to_waiting',
                            retryCount: newRetryCount,
                            reason: `Auto-recovered stuck job (retry ${newRetryCount}/${maxRetries})`,
                        };
                        results.push(result);
                        // Update Prometheus counter
                        (0, prometheus_metrics_1.incrementRecoveryMetrics)(queueName, 'recovered');
                        logger_1.logger.warn('[SYSTEM_MONITOR] Stuck job recovered', {
                            jobId: job.id,
                            queueName,
                            retryCount: newRetryCount,
                            maxRetries,
                            activeForMs,
                            meetingId: job.data?.meetingId,
                        });
                    }
                    catch (moveErr) {
                        logger_1.logger.error('[SYSTEM_MONITOR] Failed to recover stuck job', {
                            jobId: job.id,
                            queueName,
                            error: moveErr.message,
                        });
                    }
                }
            }
            if (results.length > 0) {
                logger_1.logger.info('[SYSTEM_MONITOR] Stuck job recovery completed', {
                    queueName,
                    recoveredCount: results.filter(r => r.action === 'moved_to_waiting').length,
                    failedCount: results.filter(r => r.action === 'moved_to_failed').length,
                });
            }
        }
        catch (err) {
            logger_1.logger.error('[SYSTEM_MONITOR] Failed to recover stuck jobs', {
                queueName,
                error: err.message,
            });
        }
        return results;
    }
    /**
     * Recover stuck jobs for all monitored queues (non-blocking)
     * Called by the monitoring loop but runs asynchronously to not block.
     */
    recoverAllStuckJobs() {
        // Spawn async recovery for each queue - do not await
        for (const queueName of MONITOR_CONFIG.queues) {
            this.recoverStuckJobs(queueName).catch(err => {
                logger_1.logger.error('[SYSTEM_MONITOR] Queue recovery failed', {
                    queueName,
                    error: err.message,
                });
            });
        }
    }
    /**
     * Get stuck job failed alerts
     */
    getStuckJobFailedAlerts() {
        return [...this.stuckJobFailedAlerts];
    }
    /**
     * Clear stuck job failed alerts (e.g., after they've been reported)
     */
    clearStuckJobFailedAlerts() {
        this.stuckJobFailedAlerts = [];
    }
    /**
     * Update Prometheus metrics from health report
     * Non-blocking - errors are logged but don't fail the monitor cycle
     */
    updatePrometheusFromReport(report) {
        try {
            (0, prometheus_metrics_1.updatePrometheusMetrics)({
                // AI metrics from the report
                ai: {
                    deepgramMinutes: report.aiCost.deepgramMinutes,
                    openaiInputTokens: report.aiCost.openaiInputTokens,
                    openaiOutputTokens: report.aiCost.openaiOutputTokens,
                    translationCharacters: report.aiCost.translationCharacters,
                    estimatedCostUsd: report.aiCost.estimatedCostUSD,
                },
                // Queue metrics
                queues: report.queues.map(q => ({
                    name: q.name,
                    waiting: q.waiting,
                    active: q.active,
                    failed: q.failed,
                    stuckJobs: q.stuckJobs,
                })),
                // Worker metrics
                workers: report.workers.map(w => ({
                    name: w.name,
                    processed: w.processed,
                    failed: w.failed,
                    healthy: w.healthy,
                    heartbeatAgeMs: w.heartbeatAgeMs,
                })),
                // Pipeline metrics
                pipeline: {
                    broadcastLatencyMs: report.pipeline.broadcastLatencyMs,
                    minutesGenerationMs: report.pipeline.minutesGenerationMs,
                    transcriptThroughputPerMin: report.pipeline.transcriptThroughputPerMin,
                    translationThroughputPerMin: report.pipeline.translationThroughputPerMin,
                },
                // System health
                system: {
                    redisConnected: report.redis.connected,
                    redisLatencyMs: report.redis.latencyMs,
                    postgresConnected: report.postgres.connected,
                    postgresLatencyMs: report.postgres.latencyMs,
                    overallStatus: report.overallStatus,
                    alertCount: report.alerts.length,
                },
            });
        }
        catch (err) {
            logger_1.logger.error('[SYSTEM_MONITOR] Failed to update Prometheus metrics', err);
        }
    }
    /**
     * Get pipeline metrics
     */
    getPipelineMetrics() {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;
        // Calculate throughput (events per minute)
        const transcriptThroughputPerMin = this.metricsWindow.transcriptEvents.filter(ts => ts > oneMinuteAgo).length;
        const translationThroughputPerMin = this.metricsWindow.translationEvents.filter(ts => ts > oneMinuteAgo).length;
        // Calculate average latencies
        const broadcastLatencyMs = this.metricsWindow.broadcastLatencies.length > 0
            ? Math.round(this.metricsWindow.broadcastLatencies.reduce((a, b) => a + b, 0) / this.metricsWindow.broadcastLatencies.length)
            : 0;
        const minutesGenerationMs = this.metricsWindow.minutesGenerationTimes.length > 0
            ? Math.round(this.metricsWindow.minutesGenerationTimes.reduce((a, b) => a + b, 0) / this.metricsWindow.minutesGenerationTimes.length)
            : 0;
        const transcriptPipelineDelayMs = this.metricsWindow.pipelineDelays.length > 0
            ? Math.round(this.metricsWindow.pipelineDelays.reduce((a, b) => a + b, 0) / this.metricsWindow.pipelineDelays.length)
            : 0;
        const translationDurationMs = this.metricsWindow.translationDurations.length > 0
            ? Math.round(this.metricsWindow.translationDurations.reduce((a, b) => a + b, 0) / this.metricsWindow.translationDurations.length)
            : 0;
        return {
            transcriptThroughputPerMin,
            translationThroughputPerMin,
            broadcastLatencyMs,
            minutesGenerationMs,
            transcriptPipelineDelayMs,
            translationDurationMs,
        };
    }
    /**
     * Get API latency metrics
     */
    getApiLatencyMetrics() {
        const metrics = [];
        for (const endpoint of this.monitoredEndpoints) {
            const latencies = this.apiLatencyWindow[endpoint] || [];
            if (latencies.length === 0) {
                metrics.push({
                    endpoint,
                    avgLatencyMs: 0,
                    p95LatencyMs: 0,
                    requestCount: 0,
                });
                continue;
            }
            const sorted = [...latencies].sort((a, b) => a - b);
            const avgLatencyMs = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
            const p95Index = Math.floor(sorted.length * 0.95);
            const p95LatencyMs = sorted[p95Index] || sorted[sorted.length - 1];
            metrics.push({
                endpoint,
                avgLatencyMs,
                p95LatencyMs,
                requestCount: latencies.length,
            });
        }
        return metrics;
    }
    // ── External API for Recording Metrics ──────────────────────
    /**
     * Record broadcast latency (called from broadcast worker)
     */
    recordBroadcastLatency(latencyMs) {
        this.metricsWindow.broadcastLatencies.push(latencyMs);
        if (this.metricsWindow.broadcastLatencies.length > 100) {
            this.metricsWindow.broadcastLatencies = this.metricsWindow.broadcastLatencies.slice(-100);
        }
    }
    /**
     * Record minutes generation time (called from minutes worker)
     */
    recordMinutesGenerationTime(durationMs) {
        this.metricsWindow.minutesGenerationTimes.push(durationMs);
        if (this.metricsWindow.minutesGenerationTimes.length > 100) {
            this.metricsWindow.minutesGenerationTimes = this.metricsWindow.minutesGenerationTimes.slice(-100);
        }
    }
    /**
     * Record pipeline delay (time from transcript to translation queue)
     */
    recordPipelineDelay(delayMs) {
        this.metricsWindow.pipelineDelays.push(delayMs);
        if (this.metricsWindow.pipelineDelays.length > 100) {
            this.metricsWindow.pipelineDelays = this.metricsWindow.pipelineDelays.slice(-100);
        }
    }
    /**
     * Record translation duration
     */
    recordTranslationDuration(durationMs) {
        this.metricsWindow.translationDurations.push(durationMs);
        if (this.metricsWindow.translationDurations.length > 100) {
            this.metricsWindow.translationDurations = this.metricsWindow.translationDurations.slice(-100);
        }
    }
    /**
     * Record API request latency
     */
    recordApiLatency(endpoint, latencyMs) {
        if (!this.apiLatencyWindow[endpoint]) {
            this.apiLatencyWindow[endpoint] = [];
        }
        this.apiLatencyWindow[endpoint].push(latencyMs);
    }
    // ── Full Health Report ──────────────────────────────────────
    /**
     * Generate comprehensive system health report
     */
    async generateHealthReport() {
        const timestamp = new Date().toISOString();
        const alerts = [];
        // Check Redis
        const redis = await this.checkRedisHealth();
        if (!redis.connected) {
            alerts.push('Redis disconnected');
        }
        else if (redis.error) {
            alerts.push(`Redis: ${redis.error}`);
        }
        // Check PostgreSQL
        const postgres = await this.checkPostgresHealth();
        if (!postgres.connected) {
            alerts.push('PostgreSQL disconnected');
        }
        else if (postgres.error) {
            alerts.push(`PostgreSQL: ${postgres.error}`);
        }
        // Check all queues
        const queues = [];
        for (const queueName of MONITOR_CONFIG.queues) {
            const queueHealth = await this.checkQueueHealth(queueName);
            queues.push(queueHealth);
            alerts.push(...queueHealth.alerts.map(a => `${queueName}: ${a}`));
        }
        // Check all workers (async for heartbeat checks)
        const workers = [];
        for (const workerName of ['transcript', 'translation', 'broadcast', 'minutes']) {
            const workerHealth = await this.checkWorkerHealth(workerName);
            workers.push(workerHealth);
            // Map WorkerAlert objects to string messages for the top-level alerts array
            alerts.push(...workerHealth.alerts.map(a => a.message));
        }
        // Get pipeline metrics
        const pipeline = this.getPipelineMetrics();
        // Check pipeline thresholds
        if (pipeline.broadcastLatencyMs > MONITOR_CONFIG.thresholds.pipeline.broadcastLatencyMs) {
            alerts.push(`Broadcast latency high: ${pipeline.broadcastLatencyMs}ms (threshold: ${MONITOR_CONFIG.thresholds.pipeline.broadcastLatencyMs}ms)`);
        }
        if (pipeline.minutesGenerationMs > MONITOR_CONFIG.thresholds.pipeline.minutesGenerationMs) {
            alerts.push(`Minutes generation slow: ${pipeline.minutesGenerationMs}ms (threshold: ${MONITOR_CONFIG.thresholds.pipeline.minutesGenerationMs}ms)`);
        }
        if (pipeline.transcriptPipelineDelayMs > MONITOR_CONFIG.thresholds.pipeline.transcriptDelayMs) {
            alerts.push(`Transcript pipeline delay: ${pipeline.transcriptPipelineDelayMs}ms (threshold: ${MONITOR_CONFIG.thresholds.pipeline.transcriptDelayMs}ms)`);
        }
        if (pipeline.translationDurationMs > MONITOR_CONFIG.thresholds.pipeline.translationDurationMs) {
            alerts.push(`Translation duration high: ${pipeline.translationDurationMs}ms (threshold: ${MONITOR_CONFIG.thresholds.pipeline.translationDurationMs}ms)`);
        }
        // Get API latency metrics
        const apiLatency = this.getApiLatencyMetrics();
        // Check API thresholds
        for (const metric of apiLatency) {
            if (metric.avgLatencyMs > MONITOR_CONFIG.thresholds.api.maxLatencyMs) {
                alerts.push(`API ${metric.endpoint} slow: ${metric.avgLatencyMs}ms (threshold: ${MONITOR_CONFIG.thresholds.api.maxLatencyMs}ms)`);
            }
        }
        // Get AI cost metrics
        const aiCost = (0, ai_cost_monitor_1.getAICostHealthMetrics)();
        // Add AI cost alerts to top-level alerts
        for (const costAlert of aiCost.alerts) {
            alerts.push(`AI Cost: ${costAlert.message}`);
        }
        // Add stuck job failed alerts to top-level alerts
        for (const stuckAlert of this.stuckJobFailedAlerts) {
            alerts.push(`Recovery: ${stuckAlert.message}`);
        }
        // Determine overall status
        let overallStatus = 'HEALTHY';
        if (!redis.connected || !postgres.connected) {
            overallStatus = 'CRITICAL';
        }
        else if (alerts.length > 5) {
            overallStatus = 'CRITICAL';
        }
        else if (alerts.length > 0) {
            overallStatus = 'DEGRADED';
        }
        // AI cost critical alerts also trigger CRITICAL status
        if (aiCost.alerts.some(a => a.severity === 'CRITICAL')) {
            overallStatus = 'CRITICAL';
        }
        // Worker crash alerts trigger CRITICAL status
        if (workers.some(w => w.alerts.some(a => a.type === 'WORKER_CRASHED'))) {
            overallStatus = 'CRITICAL';
        }
        // Stuck job failed alerts trigger DEGRADED status (CRITICAL if many)
        if (this.stuckJobFailedAlerts.length >= 5) {
            overallStatus = 'CRITICAL';
        }
        else if (this.stuckJobFailedAlerts.length > 0 && overallStatus === 'HEALTHY') {
            overallStatus = 'DEGRADED';
        }
        return {
            timestamp,
            redis,
            postgres,
            queues,
            workers,
            pipeline,
            apiLatency,
            aiCost,
            overallStatus,
            alerts,
        };
    }
    // ── Output Formatting ───────────────────────────────────────
    /**
     * Print formatted health report to console
     */
    printHealthReport(report) {
        const colors = {
            reset: '\x1b[0m',
            green: '\x1b[32m',
            red: '\x1b[31m',
            yellow: '\x1b[33m',
            cyan: '\x1b[36m',
            dim: '\x1b[2m',
            bold: '\x1b[1m',
        };
        const statusColor = (ok) => ok ? colors.green : colors.red;
        const formatOk = (ok, latency) => {
            return ok
                ? `${colors.green}OK${colors.reset}${latency ? ` (${latency}ms)` : ''}`
                : `${colors.red}FAIL${colors.reset}`;
        };
        console.log(`\n${colors.cyan}${'═'.repeat(60)}${colors.reset}`);
        console.log(`${colors.bold}  SYSTEM HEALTH${colors.reset}  ${colors.dim}${report.timestamp}${colors.reset}`);
        console.log(`${colors.cyan}${'═'.repeat(60)}${colors.reset}`);
        // Core Services
        console.log(`\n${colors.bold}Core Services:${colors.reset}`);
        console.log(`  Redis:     ${formatOk(report.redis.connected, report.redis.latencyMs)}`);
        console.log(`  Postgres:  ${formatOk(report.postgres.connected, report.postgres.latencyMs)}`);
        // Queues
        console.log(`\n${colors.bold}Queue Status:${colors.reset}`);
        for (const q of report.queues) {
            const status = q.alerts.length === 0 ? colors.green + '●' : (q.stuckJobs > 0 ? colors.red + '●' : colors.yellow + '●');
            const stuckIndicator = q.stuckJobs > 0 ? ` ${colors.red}stuck=${q.stuckJobs}${colors.reset}` : '';
            console.log(`  ${status}${colors.reset} ${q.name}: waiting=${q.waiting} active=${q.active} failed=${q.failed}${stuckIndicator}`);
        }
        // Workers
        console.log(`\n${colors.bold}Worker Status:${colors.reset}`);
        for (const w of report.workers) {
            const hasCrashed = w.alerts.some(a => a.type === 'WORKER_CRASHED');
            const status = hasCrashed ? colors.red + '✗' : (w.healthy ? colors.green + '●' : colors.yellow + '●');
            const runningIndicator = hasCrashed ? 'CRASHED' : (w.running ? 'running' : 'inactive');
            const lastActivity = w.timeSinceLastCompletedMs > 0
                ? `last=${Math.round(w.timeSinceLastCompletedMs / 1000)}s ago`
                : 'no activity';
            const heartbeatInfo = w.lastHeartbeatAt !== null
                ? `hb=${Math.round(w.heartbeatAgeMs / 1000)}s`
                : 'no hb';
            console.log(`  ${status}${colors.reset} ${w.name}: ${runningIndicator} | processed=${w.processed} failed=${w.failed} | ${lastActivity} | ${heartbeatInfo}`);
        }
        // Pipeline Metrics
        console.log(`\n${colors.bold}Pipeline Metrics:${colors.reset}`);
        console.log(`  Transcript Throughput: ${report.pipeline.transcriptThroughputPerMin}/min`);
        console.log(`  Translation Throughput: ${report.pipeline.translationThroughputPerMin}/min`);
        if (report.pipeline.broadcastLatencyMs > 0) {
            console.log(`  Broadcast Latency: ${report.pipeline.broadcastLatencyMs}ms`);
        }
        if (report.pipeline.minutesGenerationMs > 0) {
            console.log(`  Minutes Generation: ${(report.pipeline.minutesGenerationMs / 1000).toFixed(1)}s`);
        }
        // API Latency
        const apiWithRequests = report.apiLatency.filter(a => a.requestCount > 0);
        if (apiWithRequests.length > 0) {
            const totalAvg = Math.round(apiWithRequests.reduce((sum, a) => sum + a.avgLatencyMs, 0) / apiWithRequests.length);
            console.log(`\n${colors.bold}API Latency:${colors.reset}`);
            console.log(`  Average: ${totalAvg}ms`);
        }
        // Alerts
        if (report.alerts.length > 0) {
            console.log(`\n${colors.yellow}${colors.bold}Alerts (${report.alerts.length}):${colors.reset}`);
            for (const alert of report.alerts.slice(0, 10)) {
                console.log(`  ${colors.yellow}⚠${colors.reset} ${alert}`);
            }
            if (report.alerts.length > 10) {
                console.log(`  ${colors.dim}...and ${report.alerts.length - 10} more${colors.reset}`);
            }
        }
        // Overall Status
        console.log(`\n${colors.cyan}${'─'.repeat(60)}${colors.reset}`);
        const statusText = report.overallStatus;
        const statusColorCode = statusText === 'HEALTHY' ? colors.green :
            statusText === 'DEGRADED' ? colors.yellow : colors.red;
        console.log(`${colors.bold}STATUS: ${statusColorCode}${statusText}${colors.reset}`);
        console.log(`${colors.cyan}${'═'.repeat(60)}${colors.reset}\n`);
    }
    // ── Monitor Loop ────────────────────────────────────────────
    /**
     * Run a single monitoring cycle
     */
    async runMonitorCycle() {
        try {
            const report = await this.generateHealthReport();
            // Print to console
            this.printHealthReport(report);
            // Update Prometheus metrics (non-blocking)
            this.updatePrometheusFromReport(report);
            // Trigger stuck job recovery (non-blocking)
            // This runs asynchronously and does not block the monitoring loop
            const hasStuckJobs = report.queues.some(q => q.stuckJobs > 0);
            if (hasStuckJobs) {
                this.recoverAllStuckJobs();
            }
            // Log to structured logger
            logger_1.logger.info('[SYSTEM_MONITOR] Health check completed', {
                status: report.overallStatus,
                alertCount: report.alerts.length,
                redis: { connected: report.redis.connected, latencyMs: report.redis.latencyMs },
                postgres: { connected: report.postgres.connected, latencyMs: report.postgres.latencyMs },
                queues: report.queues.map(q => ({
                    name: q.name,
                    waiting: q.waiting,
                    active: q.active,
                    failed: q.failed,
                })),
            });
            // Emit event for external listeners
            this.emit('health-report', report);
            return report;
        }
        catch (err) {
            logger_1.logger.error('[SYSTEM_MONITOR] Monitor cycle failed', err);
            throw err;
        }
    }
    /**
     * Start the monitoring loop
     */
    async start() {
        if (this.isRunning) {
            logger_1.logger.warn('[SYSTEM_MONITOR] Already running');
            return;
        }
        await this.initialize();
        // Run immediately
        await this.runMonitorCycle();
        // Schedule periodic runs
        this.intervalId = setInterval(async () => {
            try {
                await this.runMonitorCycle();
            }
            catch (err) {
                logger_1.logger.error('[SYSTEM_MONITOR] Scheduled cycle failed', err);
            }
        }, MONITOR_CONFIG.interval);
        this.isRunning = true;
        logger_1.logger.info('[SYSTEM_MONITOR] Started', {
            intervalMs: MONITOR_CONFIG.interval,
        });
    }
    /**
     * Stop the monitoring loop
     */
    async stop() {
        if (!this.isRunning) {
            return;
        }
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        // Close queue event listeners
        const queueEventEntries = Array.from(this.queueEvents.entries());
        for (const [name, queueEvents] of queueEventEntries) {
            try {
                await queueEvents.close();
            }
            catch (err) {
                logger_1.logger.warn(`[SYSTEM_MONITOR] Failed to close queue events for ${name}`, err);
            }
        }
        this.queueEvents.clear();
        // Close queue connections
        const queueEntries = Array.from(this.queues.entries());
        for (const [name, queue] of queueEntries) {
            try {
                await queue.close();
            }
            catch (err) {
                logger_1.logger.warn(`[SYSTEM_MONITOR] Failed to close queue ${name}`, err);
            }
        }
        this.queues.clear();
        this.isRunning = false;
        logger_1.logger.info('[SYSTEM_MONITOR] Stopped');
    }
    /**
     * Get current running state
     */
    isActive() {
        return this.isRunning;
    }
}
// ── Singleton Instance ──────────────────────────────────────
const systemMonitor = new SystemMonitorClass();
// ── Express Middleware for API Latency Tracking ─────────────
/**
 * Express middleware to track API endpoint latency
 */
function apiLatencyMiddleware() {
    return (req, res, next) => {
        const start = Date.now();
        // Hook into response finish
        res.on('finish', () => {
            const duration = Date.now() - start;
            const endpoint = `${req.method} ${req.route?.path || req.path}`;
            // Record latency
            systemMonitor.recordApiLatency(endpoint, duration);
            // Alert on slow requests
            if (duration > MONITOR_CONFIG.thresholds.api.maxLatencyMs) {
                logger_1.logger.warn('[API_LATENCY] Slow request detected', {
                    endpoint,
                    duration,
                    threshold: MONITOR_CONFIG.thresholds.api.maxLatencyMs,
                });
            }
        });
        next();
    };
}
// ── Exports ─────────────────────────────────────────────────
/**
 * Start the system health monitor
 * Runs health checks every 30 seconds
 */
async function startSystemMonitor() {
    await systemMonitor.start();
}
/**
 * Stop the system health monitor
 */
async function stopSystemMonitor() {
    await systemMonitor.stop();
}
/**
 * Get a single health report (for health check endpoints)
 */
async function getHealthReport() {
    return systemMonitor.generateHealthReport();
}
/**
 * Record broadcast latency metric
 */
function recordBroadcastLatency(latencyMs) {
    systemMonitor.recordBroadcastLatency(latencyMs);
}
/**
 * Record minutes generation time metric
 */
function recordMinutesGenerationTime(durationMs) {
    systemMonitor.recordMinutesGenerationTime(durationMs);
}
/**
 * Record pipeline delay metric
 */
function recordPipelineDelay(delayMs) {
    systemMonitor.recordPipelineDelay(delayMs);
}
/**
 * Record translation duration metric
 */
function recordTranslationDuration(durationMs) {
    systemMonitor.recordTranslationDuration(durationMs);
}
/**
 * Record API latency (use middleware instead when possible)
 */
function recordApiLatency(endpoint, latencyMs) {
    systemMonitor.recordApiLatency(endpoint, latencyMs);
}
/**
 * Send worker heartbeat to Redis
 * Workers should call this every 5 seconds.
 * Non-blocking - never throws.
 *
 * @param workerName - Name of the worker (e.g., 'transcript', 'translation', 'broadcast', 'minutes')
 */
async function sendWorkerHeartbeat(workerName) {
    await systemMonitor.sendWorkerHeartbeat(workerName);
}
/**
 * Manually trigger stuck job recovery for all queues
 * Normally called automatically by the monitor cycle, but available for manual intervention.
 * Non-blocking - spawns async recovery tasks.
 */
function triggerStuckJobRecovery() {
    systemMonitor.recoverAllStuckJobs();
}
/**
 * Recover stuck jobs for a specific queue
 * Returns results of recovery actions.
 *
 * @param queueName - Name of the queue to recover
 * @returns Array of recovery results
 */
async function recoverStuckJobs(queueName) {
    return systemMonitor.recoverStuckJobs(queueName);
}
/**
 * Get stuck job failed alerts (jobs that exceeded max auto-recovery retries)
 */
function getStuckJobFailedAlerts() {
    return systemMonitor.getStuckJobFailedAlerts();
}
/**
 * Get the monitor instance for event subscriptions
 */
function getSystemMonitor() {
    return systemMonitor;
}
exports.default = systemMonitor;
//# sourceMappingURL=system.monitor.js.map