"use strict";
// ============================================================
// OrgsLedger API — Minutes Queue
// Job queue for AI minutes generation tasks
// Handles async processing of meeting transcripts into minutes
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeMinutesQueue = initializeMinutesQueue;
exports.submitMinutesJob = submitMinutesJob;
exports.getMinutesQueueManager = getMinutesQueueManager;
const bullmq_1 = require("bullmq");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
class MinutesQueueManager {
    queue = null;
    initialized = false;
    /**
     * Initialize minutes queue
     */
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
                        age: 86400, // Keep completed jobs for 24 hours
                    },
                    attempts: parseInt(process.env.MINUTES_JOB_RETRIES || '2', 10),
                    backoff: {
                        type: 'exponential',
                        delay: 5000, // 5s backoff for minutes (slower than translation due to API calls)
                    },
                },
            };
            this.queue = new bullmq_1.Queue('meeting-minutes', queueOptions);
            this.initialized = true;
            logger_1.logger.info('Minutes queue initialized', {
                queue: 'meeting-minutes',
            });
            return this.queue;
        }
        catch (err) {
            logger_1.logger.error('Failed to initialize minutes queue', err);
            throw err;
        }
    }
    /**
     * Get queue instance
     */
    getQueue() {
        return this.queue;
    }
    /**
     * Check if queue is initialized
     */
    isInitialized() {
        return this.initialized;
    }
}
// Singleton instance
const minutesQueueManager = new MinutesQueueManager();
/**
 * Initialize and return the minutes queue
 */
async function initializeMinutesQueue() {
    return minutesQueueManager.initialize();
}
/**
 * Submit a minutes generation job to the queue
 */
async function submitMinutesJob(data) {
    const queue = minutesQueueManager.getQueue();
    if (!queue) {
        throw new Error('Minutes queue not initialized. Call initializeMinutesQueue() first.');
    }
    try {
        const job = await queue.add('generate-minutes', data, {
            jobId: `minutes:${data.meetingId}`, // Unique job ID per meeting
            priority: 5, // Medium priority (lower number = higher priority)
        });
        logger_1.logger.debug('Minutes job submitted to queue', {
            jobId: job.id,
            meetingId: data.meetingId,
            organizationId: data.organizationId,
        });
        return job.id || '';
    }
    catch (err) {
        logger_1.logger.error('Failed to submit minutes job to queue', {
            meetingId: data.meetingId,
            error: err instanceof Error ? err.message : String(err),
        });
        throw err;
    }
}
/**
 * Get minutes queue manager
 */
function getMinutesQueueManager() {
    return minutesQueueManager;
}
//# sourceMappingURL=minutes.queue.js.map