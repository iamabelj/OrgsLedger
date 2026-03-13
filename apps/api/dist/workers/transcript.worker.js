"use strict";
// ============================================================
// OrgsLedger API — Transcript Worker (Scaled)
// Processes transcript events from SHARDED queues
// Supports 50k+ meetings via horizontal scaling
// ============================================================
//
// Scaling features:
//   - Subscribes to ALL 32 transcript shards
//   - CPU-based dynamic concurrency (CPU_CORES * 4)
//   - Sliding window transcript storage (max 300 entries)
//   - Worker identity for distributed tracing
//   - DLQ support for failed jobs
//
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.startTranscriptWorker = startTranscriptWorker;
exports.stopTranscriptWorker = stopTranscriptWorker;
exports.getTranscriptWorker = getTranscriptWorker;
exports.getMeetingTranscripts = getMeetingTranscripts;
const bullmq_1 = require("bullmq");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
const queue_manager_1 = require("../queues/queue-manager");
const config_1 = require("../config");
const meeting_metrics_1 = require("../monitoring/meeting-metrics");
const worker_identity_1 = require("../scaling/worker-identity");
const idempotency_1 = require("./idempotency");
// ── Configuration ───────────────────────────────────────────
const TRANSCRIPT_CONFIG = {
    /** Maximum transcript entries per meeting (sliding window) */
    maxTranscripts: parseInt(process.env.TRANSCRIPT_MAX_ENTRIES || '300', 10),
    /** TTL for transcript data in Redis (24 hours) */
    transcriptTtlSeconds: 86400,
    /** Worker lock duration (for long processing) */
    lockDuration: 60000,
    /** Stalled job detection interval */
    stalledInterval: 30000,
    /** Maximum times a job can stall before moving to DLQ */
    maxStalledCount: 3,
};
// ── Redis Key for Transcript Storage ────────────────────────
const TRANSCRIPT_KEY_PREFIX = 'meeting:transcript:';
function transcriptKey(meetingId) {
    return `${TRANSCRIPT_KEY_PREFIX}${meetingId}`;
}
// ── Worker Class ────────────────────────────────────────────
class TranscriptWorker {
    workers = [];
    isRunning = false;
    processedCount = 0;
    failedCount = 0;
    redis = null;
    async initialize() {
        try {
            // Initialize queue manager first
            await (0, queue_manager_1.initializeQueueManager)();
            const connection = (0, redisClient_1.createBullMQConnection)();
            this.redis = connection;
            // Calculate CPU-based concurrency
            const concurrency = worker_identity_1.WORKER_CONCURRENCY.transcript();
            // Get all sharded queues for transcript processing
            const queues = queue_manager_1.queueManager.getAllTranscriptQueues();
            (0, worker_identity_1.logWorkerIdentity)('TRANSCRIPT_WORKER');
            logger_1.logger.info('[TRANSCRIPT_WORKER] Starting workers for all shards', {
                workerId: worker_identity_1.WORKER_ID,
                shardCount: queues.length,
                concurrencyPerShard: concurrency,
                totalConcurrency: concurrency * queues.length,
            });
            // Create a worker for EACH shard queue
            for (const queue of queues) {
                const worker = new bullmq_1.Worker(queue.name, async (job) => {
                    return this.processTranscriptEvent(job);
                }, {
                    connection: connection,
                    concurrency,
                    maxStalledCount: TRANSCRIPT_CONFIG.maxStalledCount,
                    stalledInterval: TRANSCRIPT_CONFIG.stalledInterval,
                    lockDuration: TRANSCRIPT_CONFIG.lockDuration,
                });
                worker.on('ready', () => {
                    logger_1.logger.debug('[TRANSCRIPT_WORKER] Shard ready', {
                        queue: queue.name,
                        workerId: worker_identity_1.WORKER_ID,
                    });
                });
                worker.on('error', (err) => {
                    logger_1.logger.error('[TRANSCRIPT_WORKER] Worker error', {
                        queue: queue.name,
                        error: err.message,
                        workerId: worker_identity_1.WORKER_ID,
                    });
                });
                worker.on('failed', async (job, err) => {
                    this.failedCount++;
                    const maxAttempts = job?.opts?.attempts || 3;
                    const attemptsMade = job?.attemptsMade || 0;
                    logger_1.logger.warn('[TRANSCRIPT_WORKER] Job failed', {
                        jobId: job?.id,
                        meetingId: job?.data?.meetingId,
                        queue: queue.name,
                        attemptsMade,
                        maxAttempts,
                        error: err.message,
                        workerId: worker_identity_1.WORKER_ID,
                    });
                    // Move to DLQ after max attempts exhausted
                    if (job && attemptsMade >= maxAttempts) {
                        try {
                            await (0, queue_manager_1.moveToDeadLetter)(queue_manager_1.SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS, job, err.message);
                        }
                        catch (dlqErr) {
                            logger_1.logger.error('[TRANSCRIPT_WORKER] Failed to move job to DLQ', {
                                jobId: job.id,
                                error: dlqErr,
                            });
                        }
                    }
                });
                worker.on('completed', (job) => {
                    this.processedCount++;
                    logger_1.logger.debug('[TRANSCRIPT_WORKER] Job completed', {
                        jobId: job.id,
                        meetingId: job.data.meetingId,
                        queue: queue.name,
                    });
                });
                this.workers.push(worker);
            }
            this.isRunning = true;
            logger_1.logger.info('[TRANSCRIPT_WORKER] All shard workers initialized', {
                workerId: worker_identity_1.WORKER_ID,
                workerCount: this.workers.length,
                concurrency,
            });
        }
        catch (err) {
            logger_1.logger.error('[TRANSCRIPT_WORKER] Failed to initialize', err);
            throw err;
        }
    }
    /**
     * Process a transcript event
     */
    async processTranscriptEvent(job) {
        const { meetingId, speaker, speakerId, text, timestamp, isFinal, confidence, language } = job.data;
        try {
            // 0. Idempotency check — skip duplicates
            const idempotencyKey = (0, idempotency_1.getTranscriptIdempotencyKey)(meetingId, speakerId, timestamp, text);
            const isDuplicate = await (0, idempotency_1.checkAndMarkProcessed)(idempotencyKey, 'TRANSCRIPT_WORKER');
            if (isDuplicate) {
                logger_1.logger.debug('[TRANSCRIPT_WORKER] Duplicate event skipped', {
                    jobId: job.id,
                    meetingId,
                    timestamp,
                });
                return { success: true, skipped: true };
            }
            // 1. Store transcript in Redis with sliding window (max 300 entries)
            await this.storeTranscript(job.data);
            // 2. Broadcast to connected clients via sharded queue
            await (0, queue_manager_1.submitBroadcast)({
                meetingId,
                eventType: 'transcript',
                data: {
                    speaker,
                    speakerId,
                    text,
                    timestamp,
                    isFinal,
                    confidence,
                    language,
                },
            });
            // 3. Queue translation job if configured (via sharded queue)
            const targetLanguages = config_1.config.translation?.targetLanguages || [];
            if (targetLanguages.length > 0 && isFinal) {
                await (0, queue_manager_1.submitTranslation)({
                    meetingId,
                    speaker: speaker || '',
                    speakerId,
                    text,
                    timestamp: timestamp,
                    sourceLanguage: language || 'en',
                    targetLanguages,
                });
            }
            // 4. Increment meeting pipeline metrics (non-blocking)
            (0, meeting_metrics_1.incrementTranscriptsGenerated)(meetingId).catch(() => { });
            return { success: true };
        }
        catch (err) {
            logger_1.logger.error('[TRANSCRIPT_WORKER] Processing failed', {
                meetingId,
                error: err.message,
                workerId: worker_identity_1.WORKER_ID,
            });
            throw err;
        }
    }
    /**
     * Store transcript in Redis with sliding window.
     * Uses LPUSH + LTRIM to maintain only the last N entries.
     * This prevents Redis memory explosion at scale.
     */
    async storeTranscript(data) {
        if (!this.redis)
            return;
        const key = transcriptKey(data.meetingId);
        const entry = JSON.stringify({
            speaker: data.speaker,
            speakerId: data.speakerId,
            text: data.text,
            timestamp: data.timestamp,
            confidence: data.confidence,
            language: data.language,
        });
        try {
            // Use pipeline for atomic sliding window operation
            const pipeline = this.redis.pipeline();
            // LPUSH: Add new entry at the head (newest first)
            pipeline.lpush(key, entry);
            // LTRIM: Keep only the last N entries (sliding window)
            pipeline.ltrim(key, 0, TRANSCRIPT_CONFIG.maxTranscripts - 1);
            // EXPIRE: Set TTL to prevent orphaned keys
            pipeline.expire(key, TRANSCRIPT_CONFIG.transcriptTtlSeconds);
            await pipeline.exec();
        }
        catch (err) {
            logger_1.logger.warn('[TRANSCRIPT_WORKER] Failed to store transcript', {
                meetingId: data.meetingId,
                error: err.message,
            });
        }
    }
    /**
     * Get worker stats
     */
    getStats() {
        return {
            running: this.isRunning,
            processed: this.processedCount,
            failed: this.failedCount,
            workerId: worker_identity_1.WORKER_ID,
            workerCount: this.workers.length,
        };
    }
    /**
     * Gracefully stop all shard workers
     */
    async stop() {
        logger_1.logger.info('[TRANSCRIPT_WORKER] Stopping all workers...', {
            workerId: worker_identity_1.WORKER_ID,
            workerCount: this.workers.length,
        });
        // Close all workers in parallel
        await Promise.all(this.workers.map(worker => worker.close()));
        this.workers = [];
        this.isRunning = false;
        logger_1.logger.info('[TRANSCRIPT_WORKER] Stopped', { workerId: worker_identity_1.WORKER_ID });
    }
}
// ── Singleton Instance ──────────────────────────────────────
let transcriptWorker = null;
async function startTranscriptWorker() {
    if (!transcriptWorker) {
        transcriptWorker = new TranscriptWorker();
    }
    await transcriptWorker.initialize();
}
async function stopTranscriptWorker() {
    if (transcriptWorker) {
        await transcriptWorker.stop();
        transcriptWorker = null;
    }
}
function getTranscriptWorker() {
    return transcriptWorker;
}
// ── Utility Functions ───────────────────────────────────────
/**
 * Get all transcripts for a meeting from Redis.
 * Returns in chronological order (oldest first).
 *
 * Note: Transcripts are stored with LPUSH (newest first),
 * so we reverse the order for chronological retrieval.
 */
async function getMeetingTranscripts(meetingId) {
    const redis = (0, redisClient_1.createBullMQConnection)();
    const key = transcriptKey(meetingId);
    try {
        const entries = await redis.lrange(key, 0, -1);
        // Reverse to get chronological order (oldest first)
        return entries
            .map((entry) => JSON.parse(entry))
            .reverse();
    }
    catch (err) {
        logger_1.logger.error('[TRANSCRIPT_WORKER] Failed to get transcripts', {
            meetingId,
            error: err.message,
        });
        return [];
    }
}
//# sourceMappingURL=transcript.worker.js.map