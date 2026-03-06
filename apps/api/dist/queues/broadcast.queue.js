"use strict";
// ============================================================
// OrgsLedger API — Broadcast Queue
// Decouple translation results from Socket.IO broadcasting
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcastQueueManager = void 0;
exports.ensureBroadcastQueue = ensureBroadcastQueue;
exports.broadcastToQueue = broadcastToQueue;
const bullmq_1 = require("bullmq");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
class BroadcastQueueManager {
    queue = null;
    initialized = false;
    /**
     * Initialize broadcast queue
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
                    removeOnComplete: true, // Remove immediately after successful broadcast
                    attempts: 5, // More retries for broadcast (important for real-time)
                    backoff: {
                        type: 'exponential',
                        delay: 1000, // Start with 1s backoff
                    },
                },
            };
            this.queue = new bullmq_1.Queue('broadcast-events', queueOptions);
            // Setup event handlers
            this.queue.on('error', (err) => {
                logger_1.logger.error('Broadcast queue error', err);
            });
            // Verify queue is ready
            await this.queue.waitUntilReady();
            this.initialized = true;
            logger_1.logger.info('Broadcast queue initialized', {
                name: this.queue.name,
            });
            return this.queue;
        }
        catch (err) {
            logger_1.logger.error('Failed to initialize broadcast queue', err);
            throw err;
        }
    }
    /**
     * Add broadcast job to queue
     */
    async add(data) {
        try {
            if (!this.queue) {
                await this.initialize();
            }
            if (!this.queue) {
                throw new Error('Broadcast queue failed to initialize');
            }
            const jobId = `${data.meetingId}:${data.speakerId}:${Date.now()}`;
            const priority = data.isFinal ? 10 : 5; // Final transcripts get higher priority
            await this.queue.add(jobId, data, {
                jobId,
                priority, // Priority queue: final transcripts broadcast first
            });
            logger_1.logger.debug('Broadcast job enqueued', {
                jobId,
                meetingId: data.meetingId,
                speakerId: data.speakerId,
                isFinal: data.isFinal,
                priority,
            });
        }
        catch (err) {
            logger_1.logger.error('Failed to enqueue broadcast job', err);
            throw err;
        }
    }
    /**
     * Bulk add broadcast jobs
     */
    async addBulk(dataArray) {
        try {
            if (!this.queue) {
                await this.initialize();
            }
            if (!this.queue) {
                throw new Error('Broadcast queue failed to initialize');
            }
            const jobs = dataArray.map((data, idx) => ({
                name: `${data.meetingId}:${data.speakerId}:${Date.now()}:${idx}`,
                data,
                opts: {
                    priority: data.isFinal ? 10 : 5,
                },
            }));
            await this.queue.addBulk(jobs);
            logger_1.logger.debug('Broadcast jobs bulk-enqueued', {
                count: dataArray.length,
            });
        }
        catch (err) {
            logger_1.logger.error('Failed to bulk enqueue broadcast jobs', err);
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
            logger_1.logger.error('Failed to get broadcast queue status', err);
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
            logger_1.logger.info('Broadcast queue cleared');
        }
        catch (err) {
            logger_1.logger.error('Failed to clear broadcast queue', err);
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
                logger_1.logger.info('Broadcast queue closed');
            }
        }
        catch (err) {
            logger_1.logger.error('Error closing broadcast queue', err);
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
exports.broadcastQueueManager = new BroadcastQueueManager();
/**
 * Helper to ensure queue is initialized
 */
async function ensureBroadcastQueue() {
    const queue = exports.broadcastQueueManager.getQueue();
    if (queue) {
        return queue;
    }
    return exports.broadcastQueueManager.initialize();
}
/**
 * Convenience function to add a broadcast job
 */
async function broadcastToQueue(data) {
    await exports.broadcastQueueManager.add(data);
}
//# sourceMappingURL=broadcast.queue.js.map