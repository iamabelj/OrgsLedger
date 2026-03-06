"use strict";
// ============================================================
// OrgsLedger API — Dead Letter Queue
// Holds failed jobs that exceeded max retries
// Provides recovery and replay mechanism
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeDeadLetterQueue = initializeDeadLetterQueue;
exports.sendToDeadLetterQueue = sendToDeadLetterQueue;
exports.getDeadLetterJobs = getDeadLetterJobs;
exports.replayDeadLetterJob = replayDeadLetterJob;
exports.getDeadLetterQueueManager = getDeadLetterQueueManager;
const bullmq_1 = require("bullmq");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
class DeadLetterQueueManager {
    queue = null;
    initialized = false;
    async initialize() {
        if (this.queue) {
            return this.queue;
        }
        try {
            const redis = await (0, redisClient_1.getRedisClient)();
            const queueOptions = {
                connection: redis,
                defaultJobOptions: {
                    removeOnComplete: {
                        age: 604800, // Keep for 7 days
                    },
                },
            };
            this.queue = new bullmq_1.Queue('dlq-dead-letters', queueOptions);
            this.initialized = true;
            logger_1.logger.info('Dead Letter Queue initialized');
            return this.queue;
        }
        catch (err) {
            logger_1.logger.error('Failed to initialize dead letter queue', err);
            throw err;
        }
    }
    getQueue() {
        return this.queue;
    }
    isInitialized() {
        return this.initialized;
    }
}
const dlqManager = new DeadLetterQueueManager();
async function initializeDeadLetterQueue() {
    return dlqManager.initialize();
}
/**
 * Send a failed job to the dead letter queue
 */
async function sendToDeadLetterQueue(originalQueue, jobId, jobData, lastError, attempts, maxAttempts) {
    const queue = dlqManager.getQueue();
    if (!queue) {
        logger_1.logger.warn('DLQ not initialized, job lost', { jobId, originalQueue });
        return;
    }
    try {
        await queue.add('dead-letter', {
            originalQueue,
            jobId,
            data: jobData,
            lastError,
            failedAt: new Date().toISOString(),
            attempts,
            maxAttempts,
        }, {
            jobId: `dlq:${originalQueue}:${jobId}:${Date.now()}`,
        });
        logger_1.logger.error('[DLQ] Job moved to dead letter queue', {
            jobId,
            originalQueue,
            lastError,
        });
    }
    catch (err) {
        logger_1.logger.error('[DLQ] Failed to move job to DLQ', {
            jobId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
/**
 * Get dead letter jobs for a specific queue
 */
async function getDeadLetterJobs(originalQueue) {
    const queue = dlqManager.getQueue();
    if (!queue) {
        return [];
    }
    try {
        const allJobs = await queue.getWaiting();
        // Convert Job objects to data
        const jobsData = [];
        for (const job of allJobs) {
            const data = job.data;
            if (!originalQueue || data.originalQueue === originalQueue) {
                jobsData.push(data);
            }
        }
        return jobsData;
    }
    catch (err) {
        logger_1.logger.error('[DLQ] Failed to retrieve dead letter jobs', err);
        return [];
    }
}
/**
 * Replay a dead letter job back to its original queue
 */
async function replayDeadLetterJob(dlqJobId, targetQueue) {
    const queue = dlqManager.getQueue();
    if (!queue) {
        return false;
    }
    try {
        const job = await queue.getJob(dlqJobId);
        if (!job) {
            logger_1.logger.warn('[DLQ] Job not found for replay', { jobId: dlqJobId });
            return false;
        }
        const data = job.data;
        // Add back to original queue
        await targetQueue.add('replay', data.data, {
            jobId: `replay:${data.jobId}:${Date.now()}`,
            attempts: 3, // Reset attempts
        });
        // Remove from DLQ
        await job.remove();
        logger_1.logger.info('[DLQ] Job replayed successfully', {
            originalJobId: data.jobId,
            originalQueue: data.originalQueue,
        });
        return true;
    }
    catch (err) {
        logger_1.logger.error('[DLQ] Failed to replay job', {
            jobId: dlqJobId,
            error: err instanceof Error ? err.message : String(err),
        });
        return false;
    }
}
function getDeadLetterQueueManager() {
    return dlqManager;
}
//# sourceMappingURL=dlq.queue.js.map