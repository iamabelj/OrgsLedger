"use strict";
// ============================================================
// OrgsLedger API — Minutes Worker
// Processes AI minutes generation jobs from queue
// Calls minutes service and manages job lifecycle
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.startMinutesWorker = startMinutesWorker;
exports.stopMinutesWorker = stopMinutesWorker;
exports.getMinutesWorker = getMinutesWorker;
const bullmq_1 = require("bullmq");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
class MinutesWorker {
    worker = null;
    minutesService = null;
    isRunning = false;
    processedCount = 0;
    failedCount = 0;
    /**
     * Initialize minutes worker
     */
    async initialize(minutesService) {
        try {
            this.minutesService = minutesService;
            const redis = await (0, redisClient_1.getRedisClient)();
            this.worker = new bullmq_1.Worker('meeting-minutes', async (job) => {
                return this.processMinutesJob(job);
            }, {
                connection: redis,
                concurrency: parseInt(process.env.MINUTES_WORKER_CONCURRENCY || '2', 10),
                maxStalledCount: 2,
                stalledInterval: 5000,
                lockDuration: 300000, // 5 min lock for minutes (slower API calls)
                lockRenewTime: 60000,
            });
            // Setup event handlers
            this.worker.on('ready', () => {
                logger_1.logger.info('Minutes worker ready');
                this.isRunning = true;
            });
            this.worker.on('error', (err) => {
                logger_1.logger.error('Minutes worker error', err);
            });
            this.worker.on('failed', (job, err) => {
                this.failedCount++;
                logger_1.logger.warn(`Minutes job ${job?.id} failed after max retries`, {
                    jobId: job?.id,
                    meetingId: job?.data.meetingId,
                    organizationId: job?.data.organizationId,
                    error: err.message,
                    attempt: job?.attemptsMade,
                });
            });
            this.worker.on('completed', (job) => {
                this.processedCount++;
                logger_1.logger.debug(`Minutes job ${job.id} completed`, {
                    jobId: job.id,
                    meetingId: job.data.meetingId,
                    organizationId: job.data.organizationId,
                });
            });
            logger_1.logger.info('Minutes worker initialized', {
                concurrency: this.worker.opts.concurrency,
            });
        }
        catch (err) {
            logger_1.logger.error('Failed to initialize minutes worker', err);
            throw err;
        }
    }
    /**
     * Process a single minutes job
     */
    async processMinutesJob(job) {
        const startTime = Date.now();
        const { meetingId, organizationId } = job.data;
        try {
            if (!this.minutesService) {
                throw new Error('Minutes service not initialized');
            }
            logger_1.logger.debug('Processing minutes job', {
                jobId: job.id,
                meetingId,
                organizationId,
            });
            const result = await this.minutesService.processMinutes(meetingId, organizationId);
            const processingTime = Date.now() - startTime;
            logger_1.logger.info('Minutes job processed', {
                jobId: job.id,
                meetingId,
                organizationId,
                processingTimeMs: processingTime,
                success: result.success,
            });
            if (processingTime > 60000) {
                logger_1.logger.warn('Slow minutes processing', {
                    jobId: job.id,
                    meetingId,
                    processingTimeMs: processingTime,
                    threshold: 60000,
                });
            }
            return result;
        }
        catch (err) {
            logger_1.logger.error(`Minutes job ${job.id} error`, {
                jobId: job.id,
                meetingId,
                organizationId,
                error: err instanceof Error ? err.message : String(err),
                attempt: job.attemptsMade,
                maxAttempts: job.opts.attempts,
            });
            throw err;
        }
    }
    /**
     * Stop the worker
     */
    async stop() {
        try {
            if (this.worker) {
                await this.worker.close();
                this.isRunning = false;
                logger_1.logger.info('Minutes worker stopped');
            }
        }
        catch (err) {
            logger_1.logger.error('Error stopping minutes worker', err);
        }
    }
    /**
     * Pause the worker (stop accepting new jobs but finish current ones)
     */
    async pause() {
        try {
            if (this.worker) {
                await this.worker.pause();
                logger_1.logger.info('Minutes worker paused');
            }
        }
        catch (err) {
            logger_1.logger.error('Error pausing minutes worker', err);
        }
    }
    /**
     * Resume the worker (start accepting new jobs again)
     */
    async resume() {
        try {
            if (this.worker) {
                await this.worker.resume();
                logger_1.logger.info('Minutes worker resumed');
            }
        }
        catch (err) {
            logger_1.logger.error('Error resuming minutes worker', err);
        }
    }
    /**
     * Get worker health status
     */
    async getStatus() {
        return {
            running: this.isRunning,
            processed: this.processedCount,
            failed: this.failedCount,
        };
    }
    /**
     * Check if worker is healthy
     */
    isHealthy() {
        return this.isRunning && this.worker !== null;
    }
}
// Singleton instance
const minutesWorkerInstance = new MinutesWorker();
/**
 * Start the minutes worker
 */
async function startMinutesWorker(minutesService) {
    await minutesWorkerInstance.initialize(minutesService);
}
/**
 * Stop the minutes worker
 */
async function stopMinutesWorker() {
    await minutesWorkerInstance.stop();
}
/**
 * Get minutes worker instance
 */
function getMinutesWorker() {
    return minutesWorkerInstance;
}
//# sourceMappingURL=minutes.worker.js.map