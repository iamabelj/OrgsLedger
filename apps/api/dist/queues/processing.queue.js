"use strict";
// ============================================================
// OrgsLedger API — Processing Queue
// Job queue for translation processing tasks
// Handles interim and final translation workflow
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.processingQueueManager = void 0;
exports.ensureProcessingQueue = ensureProcessingQueue;
exports.submitProcessingJob = submitProcessingJob;
const bullmq_1 = require("bullmq");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
class ProcessingQueueManager {
    queue = null;
    initialized = false;
    /**
     * Initialize processing queue
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
                        age: 3600, // Keep completed jobs for 1 hour
                    },
                    attempts: parseInt(process.env.PROCESSING_JOB_RETRIES || '3', 10),
                    backoff: {
                        type: 'exponential',
                        delay: 2000, // 2s backoff for processing (slower than broadcast)
                    },
                },
            };
            this.queue = new bullmq_1.Queue('translation-processing', queueOptions);
            // Setup event handlers
            this.queue.on('error', (err) => {
                logger_1.logger.error('Processing queue error', err);
            });
            // Verify queue is ready
            await this.queue.waitUntilReady();
            this.initialized = true;
            logger_1.logger.info('Processing queue initialized', {
                name: this.queue.name,
            });
            return this.queue;
        }
        catch (err) {
            logger_1.logger.error('Failed to initialize processing queue', err);
            throw err;
        }
    }
    /**
     * Add processing job to queue
     */
    async add(data) {
        try {
            if (!this.queue) {
                await this.initialize();
            }
            if (!this.queue) {
                throw new Error('Processing queue failed to initialize');
            }
            const jobId = `${data.meetingId}:${data.speakerId}:${Date.now()}`;
            const priority = data.isFinal ? 10 : 5; // Final translations get higher priority
            const job = await this.queue.add(jobId, data, {
                jobId,
                priority,
            });
            logger_1.logger.debug('Processing job enqueued', {
                jobId: job.id,
                meetingId: data.meetingId,
                speakerId: data.speakerId,
                isFinal: data.isFinal,
                priority,
                textLength: data.originalText.length,
            });
            return job.id || jobId;
        }
        catch (err) {
            logger_1.logger.error('Failed to enqueue processing job', err);
            throw err;
        }
    }
    /**
     * Bulk add processing jobs
     */
    async addBulk(dataArray) {
        try {
            if (!this.queue) {
                await this.initialize();
            }
            if (!this.queue) {
                throw new Error('Processing queue failed to initialize');
            }
            const jobs = dataArray.map((data, idx) => ({
                name: `${data.meetingId}:${data.speakerId}:${Date.now()}:${idx}`,
                data,
                opts: {
                    priority: data.isFinal ? 10 : 5,
                },
            }));
            const jobResults = await this.queue.addBulk(jobs);
            logger_1.logger.debug('Processing jobs bulk-enqueued', {
                count: dataArray.length,
                jobIds: jobResults.map((j) => j.id).slice(0, 5), // Log first 5
            });
            return jobResults.map((j) => j.id || 'unknown');
        }
        catch (err) {
            logger_1.logger.error('Failed to bulk enqueue processing jobs', err);
            throw err;
        }
    }
    /**
     * Get queue status
     */
    async getStatus() {
        try {
            if (!this.queue) {
                return {
                    size: 0,
                    activeCount: 0,
                    waitingCount: 0,
                    failedCount: 0,
                    delayedCount: 0,
                };
            }
            const [size, activeCount, waitingCount, failedCount, delayedCount] = await Promise.all([
                this.queue.count(),
                this.queue.getActiveCount(),
                this.queue.getWaitingCount(),
                this.queue.getFailedCount(),
                this.queue.getDelayedCount(),
            ]);
            return {
                size,
                activeCount,
                waitingCount,
                failedCount,
                delayedCount,
            };
        }
        catch (err) {
            logger_1.logger.error('Failed to get processing queue status', err);
            return {
                size: 0,
                activeCount: 0,
                waitingCount: 0,
                failedCount: 0,
                delayedCount: 0,
            };
        }
    }
    /**
     * Clear all jobs
     */
    async clear() {
        try {
            if (!this.queue) {
                return;
            }
            await this.queue.clean(0, 100000, 'completed');
            logger_1.logger.info('Processing queue cleared');
        }
        catch (err) {
            logger_1.logger.error('Failed to clear processing queue', err);
        }
    }
    /**
     * Close queue connection
     */
    async close() {
        try {
            if (this.queue) {
                await this.queue.close();
                this.queue = null;
                this.initialized = false;
                logger_1.logger.info('Processing queue closed');
            }
        }
        catch (err) {
            logger_1.logger.error('Error closing processing queue', err);
        }
    }
    /**
     * Get queue instance
     */
    getQueue() {
        return this.queue;
    }
    /**
     * Check if initialized
     */
    isInitialized() {
        return this.initialized;
    }
}
// Export singleton instance
exports.processingQueueManager = new ProcessingQueueManager();
/**
 * Helper to ensure queue is initialized
 */
async function ensureProcessingQueue() {
    const queue = exports.processingQueueManager.getQueue();
    if (queue) {
        return queue;
    }
    return exports.processingQueueManager.initialize();
}
/**
 * Convenience function to add a processing job
 */
async function submitProcessingJob(data) {
    return exports.processingQueueManager.add(data);
}
//# sourceMappingURL=processing.queue.js.map