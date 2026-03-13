"use strict";
// ============================================================
// OrgsLedger API — Minutes Worker (Stage 5 - Scaled)
// Production-grade meeting minutes generation with BullMQ
// Subscribes to SHARDED minutes-generation queues
// Supports 50k+ concurrent meetings via horizontal scaling
//
// Scaling features:
//   - Subscribes to ALL 8 minutes shards
//   - CPU-based dynamic concurrency (CPU_CORES * 1)
//   - Worker identity for distributed tracing
//
// This worker:
// 1. Checks for existing minutes (idempotency)
// 2. Retrieves transcripts from Redis
// 3. Uses minutes-ai.service.ts for LLM summarization
// 4. Stores structured minutes in PostgreSQL
// 5. Broadcasts completion events
//
// Environment Variables:
//   MINUTES_AI_MODEL=gpt-4o-mini
//   MINUTES_MAX_TOKENS=10000
//   REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
//
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startMinutesWorker = startMinutesWorker;
exports.stopMinutesWorker = stopMinutesWorker;
exports.getMinutesWorker = getMinutesWorker;
const bullmq_1 = require("bullmq");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
const queue_manager_1 = require("../queues/queue-manager");
const transcript_worker_1 = require("./transcript.worker");
const db_1 = __importDefault(require("../db"));
const minutes_ai_service_1 = require("../services/minutes-ai.service");
const meeting_metrics_1 = require("../monitoring/meeting-metrics");
const ai_rate_limit_guard_1 = require("../monitoring/ai-rate-limit.guard");
const worker_identity_1 = require("../scaling/worker-identity");
const idempotency_1 = require("./idempotency");
// ── Worker Configuration ────────────────────────────────────
const WORKER_CONFIG = {
    maxAttempts: 3,
    backoffType: 'exponential',
    backoffDelay: 5000, // 5 seconds base delay
    lockDuration: 600000, // 10 minutes for long AI processing
    stalledInterval: 60000, // 1 minute stall check
    maxStalledCount: 2,
};
// ── Worker Class ────────────────────────────────────────────
class MinutesWorker {
    workers = [];
    isRunning = false;
    processedCount = 0;
    skippedCount = 0;
    failedCount = 0;
    async initialize() {
        try {
            // Initialize queue manager first
            await (0, queue_manager_1.initializeQueueManager)();
            const connection = (0, redisClient_1.createBullMQConnection)();
            const concurrency = worker_identity_1.WORKER_CONCURRENCY.minutes();
            // Get all sharded queues for minutes processing
            const queues = queue_manager_1.queueManager.getAllMinutesQueues();
            (0, worker_identity_1.logWorkerIdentity)('MINUTES_WORKER');
            logger_1.logger.info('[MINUTES_WORKER] Starting workers for all shards', {
                workerId: worker_identity_1.WORKER_ID,
                shardCount: queues.length,
                concurrencyPerShard: concurrency,
                totalConcurrency: concurrency * queues.length,
            });
            // Create a worker for EACH shard queue
            for (const queue of queues) {
                const worker = new bullmq_1.Worker(queue.name, async (job) => {
                    return this.processMinutesJob(job);
                }, {
                    connection: connection,
                    concurrency,
                    maxStalledCount: WORKER_CONFIG.maxStalledCount,
                    stalledInterval: WORKER_CONFIG.stalledInterval,
                    lockDuration: WORKER_CONFIG.lockDuration,
                });
                this.setupWorkerEventHandlers(worker, queue.name);
                this.workers.push(worker);
            }
            this.isRunning = true;
            logger_1.logger.info('[MINUTES_WORKER] All shard workers initialized', {
                workerId: worker_identity_1.WORKER_ID,
                workerCount: this.workers.length,
                concurrency,
            });
        }
        catch (err) {
            logger_1.logger.error('[MINUTES_WORKER] Failed to initialize', err);
            throw err;
        }
    }
    /**
     * Set up worker event handlers for a shard.
     */
    setupWorkerEventHandlers(worker, queueName) {
        worker.on('ready', () => {
            logger_1.logger.debug('[MINUTES_WORKER] Shard ready', {
                queue: queueName,
                workerId: worker_identity_1.WORKER_ID,
            });
        });
        worker.on('error', (err) => {
            logger_1.logger.error('[MINUTES_WORKER] Worker error', {
                queue: queueName,
                error: err.message,
                workerId: worker_identity_1.WORKER_ID,
            });
        });
        worker.on('failed', async (job, err) => {
            this.failedCount++;
            const maxAttempts = job?.opts?.attempts || 3;
            const attemptsMade = job?.attemptsMade || 0;
            logger_1.logger.warn('[MINUTES_WORKER] Job failed', {
                jobId: job?.id,
                meetingId: job?.data?.meetingId,
                queue: queueName,
                attemptsMade,
                maxAttempts,
                error: err.message,
                workerId: worker_identity_1.WORKER_ID,
            });
            // Move to DLQ after max attempts exhausted
            if (job && attemptsMade >= maxAttempts) {
                try {
                    await (0, queue_manager_1.moveToDeadLetter)(queue_manager_1.SHARDED_QUEUE_TYPES.MINUTES_GENERATION, job, err.message);
                }
                catch (dlqErr) {
                    logger_1.logger.error('[MINUTES_WORKER] Failed to move job to DLQ', {
                        jobId: job.id,
                        error: dlqErr,
                    });
                }
            }
        });
        worker.on('completed', (job, result) => {
            if (result.skipped) {
                this.skippedCount++;
                logger_1.logger.info('[MINUTES_WORKER] Job skipped (idempotency)', {
                    jobId: job.id,
                    meetingId: job.data.meetingId,
                    queue: queueName,
                    reason: result.reason,
                });
            }
            else {
                this.processedCount++;
                logger_1.logger.info('[MINUTES_WORKER] Minutes generated', {
                    jobId: job.id,
                    meetingId: job.data.meetingId,
                    queue: queueName,
                    wordCount: result.minutes?.wordCount,
                    chunksProcessed: result.minutes?.chunksProcessed,
                });
            }
        });
        worker.on('stalled', (jobId) => {
            logger_1.logger.warn('[MINUTES_WORKER] Job stalled', {
                jobId,
                queue: queueName,
                workerId: worker_identity_1.WORKER_ID,
            });
        });
    }
    /**
     * Process a minutes generation job with idempotency check
     */
    async processMinutesJob(job) {
        const { meetingId, organizationId } = job.data;
        const startTime = Date.now();
        logger_1.logger.info('[MINUTES_WORKER] Processing job', {
            jobId: job.id,
            meetingId,
            organizationId,
            attempt: job.attemptsMade + 1,
        });
        try {
            // ── Step 0: Redis Idempotency Check (fast path) ───────
            const idempotencyKey = (0, idempotency_1.getMinutesIdempotencyKey)(meetingId);
            const isDuplicate = await (0, idempotency_1.checkAndMarkProcessed)(idempotencyKey, 'MINUTES_WORKER');
            if (isDuplicate) {
                logger_1.logger.debug('[MINUTES_WORKER] Duplicate event skipped (Redis)', {
                    jobId: job.id,
                    meetingId,
                });
                return {
                    success: true,
                    skipped: true,
                    reason: 'Duplicate event (Redis)',
                };
            }
            // ── Step 1: Database Idempotency Check ────────────────
            const existingMinutes = await this.checkExistingMinutes(meetingId);
            if (existingMinutes) {
                logger_1.logger.info('[MINUTES_WORKER] Minutes already exist, skipping', {
                    meetingId,
                    existingId: existingMinutes.id,
                    generatedAt: existingMinutes.generated_at,
                });
                return {
                    success: true,
                    skipped: true,
                    reason: 'Minutes already generated',
                };
            }
            // ── Step 2: Get Transcripts ───────────────────────────
            const transcripts = await (0, transcript_worker_1.getMeetingTranscripts)(meetingId);
            if (transcripts.length === 0) {
                logger_1.logger.warn('[MINUTES_WORKER] No transcripts found', { meetingId });
                throw new Error('No transcripts available for minutes generation');
            }
            logger_1.logger.info('[MINUTES_WORKER] Transcripts retrieved', {
                meetingId,
                count: transcripts.length,
            });
            // ── Step 2.5: Check AI Rate Limit ─────────────────────
            // Estimate tokens: ~4 chars per token, transcripts + output
            const totalChars = transcripts.reduce((sum, t) => sum + (t.text?.length || 0), 0);
            const estimatedTokens = Math.ceil(totalChars / 4) + 2000; // Add 2000 for output
            const rateLimitGuard = await (0, ai_rate_limit_guard_1.guardOpenAIRequest)(estimatedTokens);
            if (!rateLimitGuard.proceed) {
                // If rate limited, delay the job for reprocessing
                logger_1.logger.warn('[MINUTES_WORKER] OpenAI rate limited, delaying job', {
                    meetingId,
                    delayMs: rateLimitGuard.delayMs,
                    reason: rateLimitGuard.skipReason,
                });
                // Throw a special error that will trigger job retry with delay
                const error = new Error(`Rate limited: ${rateLimitGuard.skipReason}`);
                error.delayMs = rateLimitGuard.delayMs;
                error.rateLimited = true;
                throw error;
            }
            // ── Step 3: Generate Minutes with AI Service ──────────
            const result = await (0, minutes_ai_service_1.generateMeetingMinutes)({
                meetingId,
                transcripts: transcripts,
            });
            // ── Step 4: Build Minutes Object ──────────────────────
            const minutes = {
                meetingId,
                organizationId,
                generatedAt: result.generatedAt,
                summary: result.minutes.summary,
                keyTopics: result.minutes.keyTopics,
                decisions: result.minutes.decisions,
                actionItems: result.minutes.actionItems,
                participants: result.minutes.participants,
                wordCount: result.wordCount,
                chunksProcessed: result.chunksProcessed,
            };
            // ── Step 5: Store in Database ─────────────────────────
            await this.storeMinutes(minutes);
            // ── Step 6: Broadcast Completion ──────────────────────
            await this.broadcastCompletion(minutes);
            const duration = Date.now() - startTime;
            // ── Step 7: Record pipeline metrics (non-blocking) ────
            (0, meeting_metrics_1.storeMinutesGenerationMs)(meetingId, duration).catch(() => { });
            logger_1.logger.info('[MINUTES_WORKER] Job completed', {
                meetingId,
                duration,
                wordCount: minutes.wordCount,
                chunksProcessed: minutes.chunksProcessed,
                topicsCount: minutes.keyTopics.length,
                decisionsCount: minutes.decisions.length,
                actionItemsCount: minutes.actionItems.length,
            });
            return { success: true, minutes };
        }
        catch (err) {
            logger_1.logger.error('[MINUTES_WORKER] Processing failed', {
                meetingId,
                error: err.message,
                stack: err.stack,
            });
            throw err;
        }
    }
    /**
     * Check if minutes already exist for this meeting (idempotency)
     */
    async checkExistingMinutes(meetingId) {
        try {
            const existing = await (0, db_1.default)('meeting_minutes')
                .where('meeting_id', meetingId)
                .select('id', 'generated_at')
                .first();
            return existing || null;
        }
        catch (err) {
            // Table might not exist yet
            if (err.message?.includes('does not exist') || err.message?.includes('no such table')) {
                logger_1.logger.warn('[MINUTES_WORKER] meeting_minutes table not found');
                return null;
            }
            throw err;
        }
    }
    /**
     * Store minutes in database with conflict handling
     */
    async storeMinutes(minutes) {
        try {
            // Use upsert pattern for additional safety
            // Note: Using actual DB schema columns:
            // summary, decisions, action_items, transcript, motions, contributions,
            // ai_credits_used, status, generated_at
            await (0, db_1.default)('meeting_minutes')
                .insert({
                meeting_id: minutes.meetingId,
                organization_id: minutes.organizationId,
                summary: minutes.summary,
                decisions: JSON.stringify(minutes.decisions),
                action_items: JSON.stringify(minutes.actionItems),
                transcript: JSON.stringify([]), // Raw transcripts stored separately in Redis
                motions: JSON.stringify([]), // No motions in Stage 5
                contributions: JSON.stringify(minutes.participants.map(p => ({ speaker: p }))),
                ai_credits_used: 1,
                status: 'completed',
                generated_at: minutes.generatedAt,
            })
                .onConflict('meeting_id')
                .ignore(); // Ignore if already exists (idempotency)
            logger_1.logger.info('[MINUTES_WORKER] Minutes stored', {
                meetingId: minutes.meetingId,
            });
        }
        catch (err) {
            // Handle unique constraint violation (race condition)
            if (err.code === '23505' || err.message?.includes('UNIQUE constraint')) {
                logger_1.logger.info('[MINUTES_WORKER] Minutes already exist (concurrent write)', {
                    meetingId: minutes.meetingId,
                });
                return; // Not an error, just idempotency at work
            }
            // If table doesn't exist, log but don't fail
            if (err.message?.includes('does not exist') || err.message?.includes('no such table')) {
                logger_1.logger.warn('[MINUTES_WORKER] meeting_minutes table not found', {
                    meetingId: minutes.meetingId,
                });
                return;
            }
            throw err;
        }
    }
    /**
     * Broadcast minutes completion event
     */
    async broadcastCompletion(minutes) {
        try {
            await (0, queue_manager_1.submitBroadcast)({
                meetingId: minutes.meetingId,
                eventType: 'minutes',
                data: {
                    status: 'completed',
                    summary: minutes.summary,
                    topicsCount: minutes.keyTopics.length,
                    decisionsCount: minutes.decisions.length,
                    actionItemsCount: minutes.actionItems.length,
                    wordCount: minutes.wordCount,
                    generatedAt: minutes.generatedAt,
                },
            });
        }
        catch (err) {
            // Non-fatal error - minutes are still stored
            logger_1.logger.warn('[MINUTES_WORKER] Failed to broadcast completion', {
                meetingId: minutes.meetingId,
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
            skipped: this.skippedCount,
            failed: this.failedCount,
            workerId: worker_identity_1.WORKER_ID,
            workerCount: this.workers.length,
        };
    }
    /**
     * Gracefully stop all shard workers
     */
    async stop() {
        logger_1.logger.info('[MINUTES_WORKER] Stopping all shard workers...', {
            workerId: worker_identity_1.WORKER_ID,
            workerCount: this.workers.length,
        });
        // Close all shard workers in parallel
        await Promise.all(this.workers.map(worker => worker.close()));
        this.workers = [];
        this.isRunning = false;
        logger_1.logger.info('[MINUTES_WORKER] All workers stopped', {
            workerId: worker_identity_1.WORKER_ID,
            processedTotal: this.processedCount,
            skippedTotal: this.skippedCount,
            failedTotal: this.failedCount,
        });
    }
}
// ── Singleton Instance ──────────────────────────────────────
let minutesWorker = null;
async function startMinutesWorker() {
    if (!minutesWorker) {
        minutesWorker = new MinutesWorker();
    }
    await minutesWorker.initialize();
}
async function stopMinutesWorker() {
    if (minutesWorker) {
        await minutesWorker.stop();
        minutesWorker = null;
    }
}
function getMinutesWorker() {
    return minutesWorker;
}
//# sourceMappingURL=minutes.worker.js.map