"use strict";
// ============================================================
// OrgsLedger API — Email Queue
// Job queue for transactional and bulk email sending
// Handles notifications, reminders, and alerts
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeEmailQueue = initializeEmailQueue;
exports.submitEmailJob = submitEmailJob;
exports.getEmailQueueManager = getEmailQueueManager;
const bullmq_1 = require("bullmq");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
class EmailQueueManager {
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
                        age: 86400, // Keep completed jobs for 24 hours
                    },
                    attempts: parseInt(process.env.EMAIL_JOB_RETRIES || '3', 10),
                    backoff: {
                        type: 'exponential',
                        delay: 2000, // 2s backoff
                    },
                },
            };
            this.queue = new bullmq_1.Queue('email', queueOptions);
            this.initialized = true;
            logger_1.logger.info('Email queue initialized', {
                queue: 'email',
            });
            return this.queue;
        }
        catch (err) {
            logger_1.logger.error('Failed to initialize email queue', err);
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
const emailQueueManager = new EmailQueueManager();
async function initializeEmailQueue() {
    return emailQueueManager.initialize();
}
async function submitEmailJob(data) {
    const queue = emailQueueManager.getQueue();
    if (!queue) {
        throw new Error('Email queue not initialized. Call initializeEmailQueue() first.');
    }
    try {
        const job = await queue.add('send-email', data, {
            jobId: `email:${data.organizationId || 'system'}:${data.recipientEmail}:${Date.now()}`,
            priority: data.emailType === 'transactional' ? 1 : 5, // transactional=high priority
        });
        logger_1.logger.debug('Email job submitted to queue', {
            jobId: job.id,
            emailType: data.emailType,
            recipient: data.recipientEmail,
        });
        return job.id || '';
    }
    catch (err) {
        logger_1.logger.error('Failed to submit email job to queue', {
            emailType: data.emailType,
            recipient: data.recipientEmail,
            error: err instanceof Error ? err.message : String(err),
        });
        throw err;
    }
}
function getEmailQueueManager() {
    return emailQueueManager;
}
//# sourceMappingURL=email.queue.js.map