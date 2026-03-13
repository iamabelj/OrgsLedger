"use strict";
// ============================================================
// OrgsLedger API — Audit Log Queue
// Async queue for audit logging
// Ensures audit logs are captured even under high load
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeAuditQueue = initializeAuditQueue;
exports.submitAuditJob = submitAuditJob;
exports.getAuditQueueManager = getAuditQueueManager;
const bullmq_1 = require("bullmq");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
class AuditQueueManager {
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
                        age: 259200, // Keep for 3 days
                    },
                    attempts: parseInt(process.env.AUDIT_JOB_RETRIES || '5', 10),
                    backoff: {
                        type: 'exponential',
                        delay: 500, // Fast backoff for audits
                    },
                },
            };
            this.queue = new bullmq_1.Queue('audit-logs', queueOptions);
            this.initialized = true;
            logger_1.logger.info('Audit queue initialized');
            return this.queue;
        }
        catch (err) {
            logger_1.logger.error('Failed to initialize audit queue', err);
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
const auditQueueManager = new AuditQueueManager();
async function initializeAuditQueue() {
    return auditQueueManager.initialize();
}
async function submitAuditJob(data) {
    const queue = auditQueueManager.getQueue();
    if (!queue) {
        logger_1.logger.warn('Audit queue not initialized, falling back to direct write');
        return;
    }
    try {
        await queue.add('write-audit-log', data, {
            jobId: `audit:${data.userId}:${data.action}:${Date.now()}`,
        });
    }
    catch (err) {
        logger_1.logger.error('Failed to submit audit job', {
            userId: data.userId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}
function getAuditQueueManager() {
    return auditQueueManager;
}
//# sourceMappingURL=audit.queue.js.map