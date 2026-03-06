"use strict";
// ============================================================
// OrgsLedger API — Bot Lifecycle Queue
// Tracks transcription bot lifecycle events
// Ensures bots are properly managed and recoverable
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeBotQueue = initializeBotQueue;
exports.submitBotJob = submitBotJob;
exports.getBotQueueManager = getBotQueueManager;
const bullmq_1 = require("bullmq");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
class BotQueueManager {
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
                        age: 86400,
                    },
                    attempts: parseInt(process.env.BOT_JOB_RETRIES || '3', 10),
                    backoff: {
                        type: 'exponential',
                        delay: 3000, // 3s backoff for bot operations
                    },
                },
            };
            this.queue = new bullmq_1.Queue('bot-lifecycle', queueOptions);
            this.initialized = true;
            logger_1.logger.info('Bot queue initialized');
            return this.queue;
        }
        catch (err) {
            logger_1.logger.error('Failed to initialize bot queue', err);
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
const botQueueManager = new BotQueueManager();
async function initializeBotQueue() {
    return botQueueManager.initialize();
}
async function submitBotJob(data) {
    const queue = botQueueManager.getQueue();
    if (!queue) {
        throw new Error('Bot queue not initialized');
    }
    try {
        const job = await queue.add('bot-operation', data, {
            jobId: `bot:${data.meetingId}:${data.action}:${Date.now()}`,
        });
        logger_1.logger.debug('Bot job submitted', {
            jobId: job.id,
            meetingId: data.meetingId,
            action: data.action,
        });
        return job.id || '';
    }
    catch (err) {
        logger_1.logger.error('Failed to submit bot job', {
            meetingId: data.meetingId,
            error: err instanceof Error ? err.message : String(err),
        });
        throw err;
    }
}
function getBotQueueManager() {
    return botQueueManager;
}
//# sourceMappingURL=bot.queue.js.map