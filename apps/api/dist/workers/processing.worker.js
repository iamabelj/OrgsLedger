"use strict";
// ============================================================
// OrgsLedger API — Processing Worker
// Processes translation jobs from processing queue
// Calls translation service and manages job lifecycle
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.processingWorker = void 0;
exports.startProcessingWorker = startProcessingWorker;
exports.stopProcessingWorker = stopProcessingWorker;
const bullmq_1 = require("bullmq");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
class ProcessingWorker {
    worker = null;
    processingService = null;
    isRunning = false;
    /**
     * Initialize processing worker
     */
    async initialize(processingService) {
        try {
            this.processingService = processingService;
            const redis = await (0, redisClient_1.getRedisClient)();
            this.worker = new bullmq_1.Worker('translation-processing', async (job) => {
                return this.processTranslation(job);
            }, {
                connection: redis,
                concurrency: parseInt(process.env.PROCESSING_WORKER_CONCURRENCY || '10', 10),
                maxStalledCount: 2,
                stalledInterval: 5000,
                lockDuration: 30000, // Longer lock for processing
                lockRenewTime: 10000,
            });
            // Setup event handlers
            this.worker.on('ready', () => {
                logger_1.logger.info('Processing worker ready');
                this.isRunning = true;
            });
            this.worker.on('error', (err) => {
                logger_1.logger.error('Processing worker error', err);
            });
            this.worker.on('failed', (job, err) => {
                logger_1.logger.warn(`Processing job ${job?.id} failed after max retries`, {
                    jobId: job?.id,
                    meetingId: job?.data.meetingId,
                    speakerId: job?.data.speakerId,
                    error: err.message,
                });
            });
            this.worker.on('completed', (job) => {
                logger_1.logger.debug(`Processing job ${job.id} completed`, {
                    jobId: job.id,
                    meetingId: job.data.meetingId,
                    speakerId: job.data.speakerId,
                });
            });
            logger_1.logger.info('Processing worker initialized', {
                concurrency: this.worker.opts.concurrency,
            });
        }
        catch (err) {
            logger_1.logger.error('Failed to initialize processing worker', err);
            throw err;
        }
    }
    /**
     * Process translation job
     */
    async processTranslation(job) {
        const startTime = Date.now();
        const { meetingId, speakerId, originalText, sourceLanguage, targetLanguages, isFinal, organizationId, chunkIndex, } = job.data;
        try {
            if (!this.processingService) {
                throw new Error('Processing service not initialized');
            }
            logger_1.logger.debug('Processing translation', {
                jobId: job.id,
                meetingId,
                speakerId,
                sourceLanguage,
                targetLanguages,
                isFinal,
                organizationId,
                chunkIndex,
                textLength: originalText.length,
            });
            // Call processing service to handle translation
            const result = await this.processingService.processTranslation(meetingId, speakerId, originalText, sourceLanguage, targetLanguages, isFinal, organizationId);
            const processingTime = Date.now() - startTime;
            logger_1.logger.debug('Translation processed', {
                jobId: job.id,
                meetingId,
                speakerId,
                processingTimeMs: processingTime,
                hasFinalTranslations: !!result.finalTranslations,
            });
            // Track processing duration
            if (processingTime > 5000) {
                logger_1.logger.warn('Slow translation processing', {
                    jobId: job.id,
                    meetingId,
                    processingTimeMs: processingTime,
                    textLength: originalText.length,
                    threshold: 5000,
                });
            }
            return result;
        }
        catch (err) {
            logger_1.logger.error(`Processing job ${job.id} error`, {
                jobId: job.id,
                meetingId,
                speakerId,
                error: err instanceof Error ? err.message : String(err),
                attempt: job.attemptsMade,
                maxAttempts: job.opts.attempts,
            });
            throw err; // Re-throw to trigger BullMQ retry logic
        }
    }
    /**
     * Get worker status
     */
    async getStatus() {
        return {
            running: this.isRunning,
            processed: 0,
            failed: 0,
            paused: this.worker?.isPaused() || false,
        };
    }
    /**
     * Pause worker
     */
    async pause() {
        try {
            if (this.worker) {
                await this.worker.pause();
                logger_1.logger.info('Processing worker paused');
            }
        }
        catch (err) {
            logger_1.logger.error('Failed to pause processing worker', err);
        }
    }
    /**
     * Resume worker
     */
    async resume() {
        try {
            if (this.worker) {
                await this.worker.resume();
                logger_1.logger.info('Processing worker resumed');
            }
        }
        catch (err) {
            logger_1.logger.error('Failed to resume processing worker', err);
        }
    }
    /**
     * Close worker gracefully
     */
    async close() {
        try {
            if (this.worker) {
                await this.worker.close();
                this.worker = null;
                this.isRunning = false;
                logger_1.logger.info('Processing worker closed');
            }
        }
        catch (err) {
            logger_1.logger.error('Error closing processing worker', err);
        }
    }
    /**
     * Check if worker is healthy
     */
    isHealthy() {
        return this.isRunning && this.worker !== null && this.processingService !== null;
    }
}
// Export singleton instance
exports.processingWorker = new ProcessingWorker();
/**
 * Initialize and start processing worker
 */
async function startProcessingWorker(processingService) {
    await exports.processingWorker.initialize(processingService);
}
/**
 * Gracefully shutdown processing worker
 */
async function stopProcessingWorker() {
    await exports.processingWorker.close();
}
//# sourceMappingURL=processing.worker.js.map