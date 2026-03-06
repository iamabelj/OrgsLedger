"use strict";
// ============================================================
// OrgsLedger API — Notification Queue  
// Job queue for push notifications
// Handles real-time badges, alerts, and in-app messages
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeNotificationQueue = initializeNotificationQueue;
exports.submitNotificationJob = submitNotificationJob;
exports.getNotificationQueueManager = getNotificationQueueManager;
const bullmq_1 = require("bullmq");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
class NotificationQueueManager {
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
                        age: 43200, // Keep for 12 hours
                    },
                    attempts: parseInt(process.env.NOTIFICATION_JOB_RETRIES || '2', 10),
                    backoff: {
                        type: 'exponential',
                        delay: 1000, // 1s backoff
                    },
                },
            };
            this.queue = new bullmq_1.Queue('notifications', queueOptions);
            this.initialized = true;
            logger_1.logger.info('Notification queue initialized', {
                queue: 'notifications',
            });
            return this.queue;
        }
        catch (err) {
            logger_1.logger.error('Failed to initialize notification queue', err);
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
const notificationQueueManager = new NotificationQueueManager();
async function initializeNotificationQueue() {
    return notificationQueueManager.initialize();
}
async function submitNotificationJob(data) {
    const queue = notificationQueueManager.getQueue();
    if (!queue) {
        throw new Error('Notification queue not initialized');
    }
    try {
        const job = await queue.add('send-notification', data, {
            jobId: `notif:${data.organizationId}:${data.userId || 'broadcast'}:${Date.now()}`,
            priority: data.priority === 'high' ? 1 : (data.priority === 'low' ? 10 : 5),
        });
        logger_1.logger.debug('Notification job submitted', {
            jobId: job.id,
            organizationId: data.organizationId,
            userId: data.userId,
        });
        return job.id || '';
    }
    catch (err) {
        logger_1.logger.error('Failed to submit notification job', {
            organizationId: data.organizationId,
            error: err instanceof Error ? err.message : String(err),
        });
        throw err;
    }
}
function getNotificationQueueManager() {
    return notificationQueueManager;
}
//# sourceMappingURL=notification.queue.js.map