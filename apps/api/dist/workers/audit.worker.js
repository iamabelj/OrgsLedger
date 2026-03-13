"use strict";
// ============================================================
// OrgsLedger API — Audit Worker
// Processes audit log jobs from queue
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startAuditWorker = startAuditWorker;
exports.stopAuditWorker = stopAuditWorker;
exports.getAuditWorker = getAuditWorker;
const bullmq_1 = require("bullmq");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
const db_1 = __importDefault(require("../db"));
class AuditWorker {
    worker = null;
    isRunning = false;
    processedCount = 0;
    failedCount = 0;
    async initialize() {
        try {
            const redis = (0, redisClient_1.createBullMQConnection)();
            this.worker = new bullmq_1.Worker('audit-logs', async (job) => {
                return this.processAuditJob(job);
            }, {
                connection: redis,
                concurrency: parseInt(process.env.AUDIT_WORKER_CONCURRENCY || '10', 10),
                maxStalledCount: 3,
                stalledInterval: 2000,
                lockDuration: 10000,
                lockRenewTime: 2000,
            });
            this.worker.on('ready', () => {
                logger_1.logger.info('Audit worker ready');
                this.isRunning = true;
            });
            this.worker.on('error', (err) => {
                logger_1.logger.error('Audit worker error', err);
            });
            this.worker.on('failed', (job, err) => {
                this.failedCount++;
                logger_1.logger.error(`Audit job ${job?.id} permanently failed after retries`, {
                    jobId: job?.id,
                    userId: job?.data.userId,
                    action: job?.data.action,
                    error: err.message,
                });
            });
            this.worker.on('completed', (job) => {
                this.processedCount++;
            });
            logger_1.logger.info('Audit worker initialized');
        }
        catch (err) {
            logger_1.logger.error('Failed to initialize audit worker', err);
            throw err;
        }
    }
    async processAuditJob(job) {
        const { organizationId, userId, action, entityType, entityId, previousValue, newValue, ipAddress, userAgent } = job.data;
        try {
            await (0, db_1.default)('audit_logs').insert({
                organization_id: organizationId || null,
                user_id: userId,
                action,
                entity_type: entityType,
                entity_id: entityId,
                previous_value: previousValue ? JSON.stringify(previousValue) : null,
                new_value: newValue ? JSON.stringify(newValue) : null,
                ip_address: ipAddress || null,
                user_agent: userAgent || null,
            });
            return { success: true };
        }
        catch (err) {
            logger_1.logger.error(`Audit job ${job.id} error`, {
                jobId: job.id,
                userId,
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
                logger_1.logger.info('Audit worker stopped');
            }
        }
        catch (err) {
            logger_1.logger.error('Error stopping audit worker', err);
        }
    }
    async pause() {
        try {
            if (this.worker) {
                await this.worker.pause();
            }
        }
        catch (err) {
            logger_1.logger.error('Error pausing audit worker', err);
        }
    }
    async resume() {
        try {
            if (this.worker) {
                await this.worker.resume();
            }
        }
        catch (err) {
            logger_1.logger.error('Error resuming audit worker', err);
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
const auditWorkerInstance = new AuditWorker();
async function startAuditWorker() {
    await auditWorkerInstance.initialize();
}
async function stopAuditWorker() {
    await auditWorkerInstance.stop();
}
function getAuditWorker() {
    return auditWorkerInstance;
}
//# sourceMappingURL=audit.worker.js.map