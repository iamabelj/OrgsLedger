"use strict";
// ============================================================
// OrgsLedger API — Transcript Processing Queue
// Receives transcript segments from Deepgram for async processing
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.transcriptQueueManager = void 0;
exports.ensureTranscriptQueue = ensureTranscriptQueue;
const bullmq_1 = require("bullmq");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
class TranscriptQueueManager {
    queue = null;
    initialized = false;
    /**
     * Initialize transcript queue
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
                        age: 3600, // Remove completed jobs after 1 hour
                    },
                    removeOnFail: {
                        age: 86400, // Keep failed jobs for 24 hours for inspection
                    },
                    attempts: 3, // Retry up to 3 times
                    backoff: {
                        type: 'exponential',
                        delay: 2000, // Start with 2s backoff
                    },
                },
            };
            this.queue = new bullmq_1.Queue('transcript-processing', queueOptions);
            // Setup event handlers
            this.queue.on('error', (err) => {
                logger_1.logger.error('Transcript queue error', err);
            });
            // Verify queue is ready
            await this.queue.waitUntilReady();
            this.initialized = true;
            logger_1.logger.info('Transcript queue initialized', {
                name: this.queue.name,
            });
            return this.queue;
        }
        catch (err) {
            logger_1.logger.error('Failed to initialize transcript queue', err);
            throw err;
        }
    }
    /**
     * Add transcript job to queue
     */
    async add(data) {
        try {
            if (!this.queue) {
                await this.initialize();
            }
            if (!this.queue) {
                throw new Error('Transcript queue failed to initialize');
            }
            const jobId = `${data.meetingId}:${data.speakerId}:${Date.now()}`;
            await this.queue.add(jobId, data, {
                jobId, // Use predictable ID for deduplication
            });
            logger_1.logger.debug('Transcript job enqueued', {
                jobId,
                meetingId: data.meetingId,
                speakerId: data.speakerId,
                textLength: data.originalText.length,
            });
        }
        catch (err) {
            logger_1.logger.error('Failed to enqueue transcript job', err);
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
            logger_1.logger.error('Failed to get transcript queue status', err);
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
     * Clear all jobs (use with caution)
     */
    async clear() {
        try {
            if (!this.queue) {
                return;
            }
            await this.queue.clean(0, 100000, 'completed');
            logger_1.logger.info('Transcript queue cleared');
        }
        catch (err) {
            logger_1.logger.error('Failed to clear transcript queue', err);
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
                logger_1.logger.info('Transcript queue closed');
            }
        }
        catch (err) {
            logger_1.logger.error('Error closing transcript queue', err);
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
exports.transcriptQueueManager = new TranscriptQueueManager();
/**
 * Helper to ensure queue is initialized
 */
async function ensureTranscriptQueue() {
    const queue = exports.transcriptQueueManager.getQueue();
    if (queue) {
        return queue;
    }
    return exports.transcriptQueueManager.initialize();
}
//# sourceMappingURL=transcript.queue.js.map