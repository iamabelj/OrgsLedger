"use strict";
// ============================================================
// OrgsLedger API — Bot Worker
// Manages transcription bot lifecycle
// Handles start, stop, reconnect, and health check operations
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.startBotWorker = startBotWorker;
exports.stopBotWorker = stopBotWorker;
exports.getBotWorker = getBotWorker;
const bullmq_1 = require("bullmq");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
const bot_1 = require("../services/bot");
class BotWorker {
    worker = null;
    isRunning = false;
    processedCount = 0;
    failedCount = 0;
    async initialize() {
        try {
            const redis = (0, redisClient_1.createBullMQConnection)();
            this.worker = new bullmq_1.Worker('bot-lifecycle', async (job) => {
                return this.processBotJob(job);
            }, {
                connection: redis,
                concurrency: parseInt(process.env.BOT_WORKER_CONCURRENCY || '3', 10),
                maxStalledCount: 2,
                stalledInterval: 5000,
                lockDuration: 120000, // 2 min lock for bot operations
                lockRenewTime: 30000,
            });
            this.worker.on('ready', () => {
                logger_1.logger.info('Bot worker ready');
                this.isRunning = true;
            });
            this.worker.on('error', (err) => {
                logger_1.logger.error('Bot worker error', err);
            });
            this.worker.on('failed', (job, err) => {
                this.failedCount++;
                logger_1.logger.warn(`Bot job ${job?.id} failed`, {
                    jobId: job?.id,
                    meetingId: job?.data.meetingId,
                    action: job?.data.action,
                    error: err.message,
                });
            });
            this.worker.on('completed', (job) => {
                this.processedCount++;
                logger_1.logger.debug(`Bot job completed`, {
                    jobId: job.id,
                    meetingId: job.data.meetingId,
                    action: job.data.action,
                });
            });
            logger_1.logger.info('Bot worker initialized');
        }
        catch (err) {
            logger_1.logger.error('Failed to initialize bot worker', err);
            throw err;
        }
    }
    async processBotJob(job) {
        const { meetingId, action } = job.data;
        const botManager = (0, bot_1.getBotManager)();
        try {
            logger_1.logger.debug('Processing bot job', {
                jobId: job.id,
                meetingId,
                action,
            });
            switch (action) {
                case 'start':
                    await botManager.startMeetingBot(meetingId);
                    break;
                case 'stop':
                    await botManager.stopMeetingBot(meetingId);
                    break;
                case 'reconnect':
                    await botManager.stopMeetingBot(meetingId);
                    await new Promise(r => setTimeout(r, 2000)); // Wait before restart
                    await botManager.startMeetingBot(meetingId);
                    break;
                case 'check_health':
                    const statusList = botManager.getStatus();
                    const status = statusList.find(s => s.meetingId === meetingId);
                    if (!status || status.activeSessions === 0) {
                        logger_1.logger.warn('[BOT_WORKER] Bot not running, attempting reconnect', { meetingId });
                        await botManager.startMeetingBot(meetingId);
                    }
                    break;
                default:
                    throw new Error(`Unknown bot action: ${action}`);
            }
            return { success: true };
        }
        catch (err) {
            logger_1.logger.error(`Bot job ${job.id} failed`, {
                jobId: job.id,
                meetingId,
                action,
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
                logger_1.logger.info('Bot worker stopped');
            }
        }
        catch (err) {
            logger_1.logger.error('Error stopping bot worker', err);
        }
    }
    async pause() {
        try {
            if (this.worker) {
                await this.worker.pause();
            }
        }
        catch (err) {
            logger_1.logger.error('Error pausing bot worker', err);
        }
    }
    async resume() {
        try {
            if (this.worker) {
                await this.worker.resume();
            }
        }
        catch (err) {
            logger_1.logger.error('Error resuming bot worker', err);
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
const botWorkerInstance = new BotWorker();
async function startBotWorker() {
    await botWorkerInstance.initialize();
}
async function stopBotWorker() {
    await botWorkerInstance.stop();
}
function getBotWorker() {
    return botWorkerInstance;
}
//# sourceMappingURL=bot.worker.js.map