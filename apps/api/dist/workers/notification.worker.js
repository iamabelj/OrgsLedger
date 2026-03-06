"use strict";
// ============================================================
// OrgsLedger API — Notification Worker
// Processes push notifications from queue
// Integrates with Firebase Cloud Messaging
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.startNotificationWorker = startNotificationWorker;
exports.stopNotificationWorker = stopNotificationWorker;
exports.getNotificationWorker = getNotificationWorker;
const bullmq_1 = require("bullmq");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
const push_service_1 = require("../services/push.service");
class NotificationWorker {
    worker = null;
    isRunning = false;
    processedCount = 0;
    failedCount = 0;
    async initialize() {
        try {
            const redis = await (0, redisClient_1.getRedisClient)();
            this.worker = new bullmq_1.Worker('notifications', async (job) => {
                return this.processNotificationJob(job);
            }, {
                connection: redis,
                concurrency: parseInt(process.env.NOTIFICATION_WORKER_CONCURRENCY || '10', 10),
                maxStalledCount: 1,
                stalledInterval: 5000,
                lockDuration: 30000,
                lockRenewTime: 5000,
            });
            this.worker.on('ready', () => {
                logger_1.logger.info('Notification worker ready');
                this.isRunning = true;
            });
            this.worker.on('error', (err) => {
                logger_1.logger.error('Notification worker error', err);
            });
            this.worker.on('failed', (job, err) => {
                this.failedCount++;
                logger_1.logger.warn(`Notification job ${job?.id} failed`, {
                    jobId: job?.id,
                    organizationId: job?.data.organizationId,
                    error: err.message,
                });
            });
            this.worker.on('completed', (job) => {
                this.processedCount++;
            });
            logger_1.logger.info('Notification worker initialized', {
                concurrency: this.worker.opts.concurrency,
            });
        }
        catch (err) {
            logger_1.logger.error('Failed to initialize notification worker', err);
            throw err;
        }
    }
    async processNotificationJob(job) {
        const { organizationId, title, body, data } = job.data;
        try {
            // Send FCM notification
            await (0, push_service_1.sendPushToOrg)(organizationId, {
                title,
                body,
                data: data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) : {},
            });
            logger_1.logger.debug('Notification sent', {
                jobId: job.id,
                organizationId,
            });
            return { success: true };
        }
        catch (err) {
            logger_1.logger.error(`Notification job ${job.id} error`, {
                jobId: job.id,
                organizationId,
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    }
    async stop() {
        try {
            if (this.worker) {
                await this.worker.close();
                this.isRunning = false;
                logger_1.logger.info('Notification worker stopped');
            }
        }
        catch (err) {
            logger_1.logger.error('Error stopping notification worker', err);
        }
    }
    async pause() {
        try {
            if (this.worker) {
                await this.worker.pause();
            }
        }
        catch (err) {
            logger_1.logger.error('Error pausing notification worker', err);
        }
    }
    async resume() {
        try {
            if (this.worker) {
                await this.worker.resume();
            }
        }
        catch (err) {
            logger_1.logger.error('Error resuming notification worker', err);
        }
    }
    async getStatus() {
        return {
            running: this.isRunning,
            processed: this.processedCount,
            failed: this.failedCount,
        };
    }
    isHealthy() {
        return this.isRunning && this.worker !== null;
    }
}
const notificationWorkerInstance = new NotificationWorker();
async function startNotificationWorker() {
    await notificationWorkerInstance.initialize();
}
async function stopNotificationWorker() {
    await notificationWorkerInstance.stop();
}
function getNotificationWorker() {
    return notificationWorkerInstance;
}
//# sourceMappingURL=notification.worker.js.map