"use strict";
// ============================================================
// OrgsLedger API — Translation Worker
// Processes transcripts from queue, performs translation
// Horizontally scalable: multiple instances can run simultaneously
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.translationWorker = void 0;
exports.startTranslationWorker = startTranslationWorker;
exports.stopTranslationWorker = stopTranslationWorker;
const bullmq_1 = require("bullmq");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
const multilingualTranslation_service_1 = require("../services/multilingualTranslation.service");
const broadcast_queue_1 = require("../queues/broadcast.queue");
class TranslationWorker {
    worker = null;
    isRunning = false;
    /**
     * Initialize translation worker
     */
    async initialize() {
        try {
            const redis = (0, redisClient_1.createBullMQConnection)();
            this.worker = new bullmq_1.Worker('transcript-processing', async (job) => {
                return this.processTranscript(job);
            }, {
                connection: redis,
                concurrency: parseInt(process.env.TRANSLATION_WORKER_CONCURRENCY || '10', 10),
                maxStalledCount: 3,
                stalledInterval: 5000, // Check for stalled jobs every 5s
                lockDuration: 30000, // Hold lock for 30s
                lockRenewTime: 15000, // Renew lock every 15s
            });
            // Setup event handlers
            this.worker.on('ready', () => {
                logger_1.logger.info('Translation worker ready');
                this.isRunning = true;
            });
            this.worker.on('error', (err) => {
                logger_1.logger.error('Translation worker error', err);
            });
            this.worker.on('failed', (job, err) => {
                if (job) {
                    logger_1.logger.error(`Translation worker job ${job.id} failed`, {
                        jobId: job.id,
                        error: err.message,
                    });
                }
                else {
                    logger_1.logger.error('Translation worker job failed', { error: err.message });
                }
            });
            this.worker.on('completed', (job) => {
                logger_1.logger.debug(`Translation worker job ${job.id} completed`, {
                    jobId: job.id,
                    meetingId: job.data.meetingId,
                });
            });
            logger_1.logger.info('Translation worker initialized', {
                concurrency: this.worker.opts.concurrency,
            });
        }
        catch (err) {
            logger_1.logger.error('Failed to initialize translation worker', err);
            throw err;
        }
    }
    /**
     * Process a single transcript job
     */
    async processTranscript(job) {
        const startTime = Date.now();
        const { meetingId, speakerId, speakerName, originalText, language, timestamp, isFinal } = job.data;
        try {
            // Step 1: Translate to all participant languages
            const translationResult = await multilingualTranslation_service_1.multilingualTranslationPipeline.translateToParticipants(originalText, language, meetingId);
            // Step 2: Build broadcast job data
            const broadcastData = {
                meetingId,
                speakerId,
                speakerName,
                originalText,
                sourceLanguage: language,
                translations: translationResult.translations,
                timestamp: timestamp instanceof Date ? timestamp.toISOString() : String(timestamp),
                isFinal,
            };
            // Step 3: Enqueue to broadcast queue
            await broadcast_queue_1.broadcastQueueManager.add(broadcastData);
            const processingTime = Date.now() - startTime;
            logger_1.logger.info('Transcript translation completed', {
                jobId: job.id,
                meetingId,
                speakerId,
                textLength: originalText.length,
                targetLanguages: Object.keys(translationResult.translations).length,
                processingTimeMs: processingTime,
                isFinal,
            });
        }
        catch (err) {
            logger_1.logger.error(`Translation job ${job.id} error`, {
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
     * Pause worker (stop processing new jobs)
     */
    async pause() {
        try {
            if (this.worker) {
                await this.worker.pause();
                logger_1.logger.info('Translation worker paused');
            }
        }
        catch (err) {
            logger_1.logger.error('Failed to pause translation worker', err);
        }
    }
    /**
     * Resume worker
     */
    async resume() {
        try {
            if (this.worker) {
                await this.worker.resume();
                logger_1.logger.info('Translation worker resumed');
            }
        }
        catch (err) {
            logger_1.logger.error('Failed to resume translation worker', err);
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
                logger_1.logger.info('Translation worker closed');
            }
        }
        catch (err) {
            logger_1.logger.error('Error closing translation worker', err);
        }
    }
    /**
     * Check if worker is running
     */
    isHealthy() {
        return this.isRunning && this.worker !== null;
    }
}
// Export singleton instance
exports.translationWorker = new TranslationWorker();
/**
 * Initialize and start translation worker
 */
async function startTranslationWorker() {
    await exports.translationWorker.initialize();
}
/**
 * Gracefully shutdown translation worker
 */
async function stopTranslationWorker() {
    await exports.translationWorker.close();
}
//# sourceMappingURL=translation.worker.js.map