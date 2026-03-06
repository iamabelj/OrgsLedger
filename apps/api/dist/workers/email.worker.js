"use strict";
// ============================================================
// OrgsLedger API — Email Worker
// Processes email jobs from queue
// Integrates with sendgrid / SMTP service
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.startEmailWorker = startEmailWorker;
exports.stopEmailWorker = stopEmailWorker;
exports.getEmailWorker = getEmailWorker;
const bullmq_1 = require("bullmq");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
const email_service_1 = require("../services/email.service");
class EmailWorker {
    worker = null;
    isRunning = false;
    processedCount = 0;
    failedCount = 0;
    async initialize() {
        try {
            const redis = await (0, redisClient_1.getRedisClient)();
            this.worker = new bullmq_1.Worker('email', async (job) => {
                return this.processEmailJob(job);
            }, {
                connection: redis,
                concurrency: parseInt(process.env.EMAIL_WORKER_CONCURRENCY || '5', 10),
                maxStalledCount: 2,
                stalledInterval: 5000,
                lockDuration: 60000, // SMTP timeout: 60s
                lockRenewTime: 15000,
            });
            this.worker.on('ready', () => {
                logger_1.logger.info('Email worker ready');
                this.isRunning = true;
            });
            this.worker.on('error', (err) => {
                logger_1.logger.error('Email worker error', err);
            });
            this.worker.on('failed', (job, err) => {
                this.failedCount++;
                logger_1.logger.warn(`Email job ${job?.id} failed`, {
                    jobId: job?.id,
                    emailType: job?.data.emailType,
                    recipient: job?.data.recipientEmail,
                    error: err.message,
                    attempt: job?.attemptsMade,
                });
            });
            this.worker.on('completed', (job) => {
                this.processedCount++;
                logger_1.logger.debug(`Email job ${job.id} completed`, {
                    jobId: job.id,
                    emailType: job.data.emailType,
                    recipient: job.data.recipientEmail,
                });
            });
            logger_1.logger.info('Email worker initialized', {
                concurrency: this.worker.opts.concurrency,
            });
        }
        catch (err) {
            logger_1.logger.error('Failed to initialize email worker', err);
            throw err;
        }
    }
    async processEmailJob(job) {
        const { recipientEmail, subject, htmlBody, textBody, emailType } = job.data;
        try {
            logger_1.logger.debug('Processing email job', {
                jobId: job.id,
                emailType,
                recipient: recipientEmail,
            });
            // Call email service
            await (0, email_service_1.sendEmail)({
                to: recipientEmail,
                subject,
                html: htmlBody,
                text: textBody,
            });
            logger_1.logger.info('Email sent successfully', {
                jobId: job.id,
                emailType,
                recipient: recipientEmail,
            });
            return { success: true };
        }
        catch (err) {
            logger_1.logger.error(`Email job ${job.id} error`, {
                jobId: job.id,
                emailType,
                recipient: recipientEmail,
                error: err instanceof Error ? err.message : String(err),
                attempt: job.attemptsMade,
            });
            throw err; // Let BullMQ handle retry
        }
    }
    async stop() {
        try {
            if (this.worker) {
                await this.worker.close();
                this.isRunning = false;
                logger_1.logger.info('Email worker stopped');
            }
        }
        catch (err) {
            logger_1.logger.error('Error stopping email worker', err);
        }
    }
    async pause() {
        try {
            if (this.worker) {
                await this.worker.pause();
                logger_1.logger.info('Email worker paused');
            }
        }
        catch (err) {
            logger_1.logger.error('Error pausing email worker', err);
        }
    }
    async resume() {
        try {
            if (this.worker) {
                await this.worker.resume();
                logger_1.logger.info('Email worker resumed');
            }
        }
        catch (err) {
            logger_1.logger.error('Error resuming email worker', err);
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
const emailWorkerInstance = new EmailWorker();
async function startEmailWorker() {
    await emailWorkerInstance.initialize();
}
async function stopEmailWorker() {
    await emailWorkerInstance.stop();
}
function getEmailWorker() {
    return emailWorkerInstance;
}
//# sourceMappingURL=email.worker.js.map