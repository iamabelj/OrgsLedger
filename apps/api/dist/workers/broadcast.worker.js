"use strict";
// ============================================================
// OrgsLedger API — Broadcast Worker (Stage 4 - Scaled)
// Production-grade real-time caption broadcast worker
// Subscribes to SHARDED broadcast-events queues
// Supports 50k+ concurrent meetings via horizontal scaling
//
// Scaling features:
//   - Subscribes to ALL 16 broadcast shards
//   - CPU-based dynamic concurrency (CPU_CORES * 6)
//   - Worker identity for distributed tracing
//
// Socket.IO Events Emitted:
//   - meeting:caption (translated captions)
//   - meeting:transcript (original transcripts)
//   - meeting:minutes (meeting minutes)
//
// Environment Variables:
//   REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
//
// ============================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.startBroadcastWorker = startBroadcastWorker;
exports.stopBroadcastWorker = stopBroadcastWorker;
exports.getBroadcastWorker = getBroadcastWorker;
exports.submitTestCaption = submitTestCaption;
const bullmq_1 = require("bullmq");
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
const queue_manager_1 = require("../queues/queue-manager");
const event_bus_service_1 = require("../modules/meeting/services/event-bus.service");
const meeting_metrics_1 = require("../monitoring/meeting-metrics");
const worker_identity_1 = require("../scaling/worker-identity");
const idempotency_1 = require("./idempotency");
// ── Retry Configuration ─────────────────────────────────────
const RETRY_CONFIG = {
    maxRetries: 3,
    initialDelayMs: 100,
    maxDelayMs: 1000,
    backoffMultiplier: 2,
};
// ── Payload Validation ──────────────────────────────────────
/**
 * Validate broadcast event payload.
 */
function validatePayload(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Invalid payload: expected an object');
    }
    const payload = data;
    if (typeof payload.meetingId !== 'string' || !payload.meetingId) {
        throw new Error('Invalid payload: meetingId must be a non-empty string');
    }
    if (typeof payload.eventType !== 'string' || !payload.eventType) {
        throw new Error('Invalid payload: eventType must be a non-empty string');
    }
    if (!payload.data || typeof payload.data !== 'object') {
        throw new Error('Invalid payload: data must be an object');
    }
}
// ── Worker Class ────────────────────────────────────────────
class BroadcastWorker {
    workers = [];
    isRunning = false;
    processedCount = 0;
    failedCount = 0;
    broadcastCount = 0;
    disconnectCount = 0;
    /**
     * Initialize all broadcast shard workers.
     */
    async initialize() {
        try {
            // Initialize queue manager first
            await (0, queue_manager_1.initializeQueueManager)();
            const connection = (0, redisClient_1.createBullMQConnection)();
            const concurrency = worker_identity_1.WORKER_CONCURRENCY.broadcast();
            // Get all sharded queues for broadcast processing
            const queues = queue_manager_1.queueManager.getAllBroadcastQueues();
            (0, worker_identity_1.logWorkerIdentity)('BROADCAST_WORKER');
            logger_1.logger.info('[BROADCAST_WORKER] Starting workers for all shards', {
                workerId: worker_identity_1.WORKER_ID,
                shardCount: queues.length,
                concurrencyPerShard: concurrency,
                totalConcurrency: concurrency * queues.length,
            });
            // Create a worker for EACH shard queue
            for (const queue of queues) {
                const worker = new bullmq_1.Worker(queue.name, async (job) => {
                    return this.processBroadcastEvent(job);
                }, {
                    connection: connection,
                    concurrency,
                    maxStalledCount: 1,
                    stalledInterval: 5000,
                    lockDuration: 10000, // Broadcasting should be fast
                });
                this.setupWorkerEventHandlers(worker, queue.name);
                this.workers.push(worker);
            }
            this.isRunning = true;
            logger_1.logger.info('[BROADCAST_WORKER] All shard workers initialized', {
                workerId: worker_identity_1.WORKER_ID,
                workerCount: this.workers.length,
                concurrency,
            });
        }
        catch (err) {
            logger_1.logger.error('[BROADCAST_WORKER] Failed to initialize', { error: err });
            throw err;
        }
    }
    /**
     * Set up worker event handlers for a shard.
     */
    setupWorkerEventHandlers(worker, queueName) {
        worker.on('ready', () => {
            logger_1.logger.debug('[BROADCAST_WORKER] Shard ready', {
                queue: queueName,
                workerId: worker_identity_1.WORKER_ID,
            });
        });
        worker.on('error', (err) => {
            logger_1.logger.error('[BROADCAST_WORKER] Worker error', {
                queue: queueName,
                error: err.message,
                workerId: worker_identity_1.WORKER_ID,
            });
        });
        worker.on('failed', async (job, err) => {
            this.failedCount++;
            const maxAttempts = job?.opts?.attempts || 3;
            const attemptsMade = job?.attemptsMade || 0;
            logger_1.logger.warn('[BROADCAST_WORKER] Job failed', {
                jobId: job?.id,
                meetingId: job?.data?.meetingId,
                eventType: job?.data?.eventType,
                queue: queueName,
                attemptsMade,
                maxAttempts,
                error: err.message,
                workerId: worker_identity_1.WORKER_ID,
            });
            // Move to DLQ after max attempts exhausted
            if (job && attemptsMade >= maxAttempts) {
                try {
                    await (0, queue_manager_1.moveToDeadLetter)(queue_manager_1.SHARDED_QUEUE_TYPES.BROADCAST_EVENTS, job, err.message);
                }
                catch (dlqErr) {
                    logger_1.logger.error('[BROADCAST_WORKER] Failed to move job to DLQ', {
                        jobId: job.id,
                        error: dlqErr,
                    });
                }
            }
        });
        worker.on('completed', (job, result) => {
            this.processedCount++;
            const res = result;
            logger_1.logger.debug('[BROADCAST_WORKER] Job completed', {
                jobId: job.id,
                meetingId: job.data.meetingId,
                eventType: job.data.eventType,
                queue: queueName,
                durationMs: res?.durationMs,
            });
        });
        worker.on('stalled', (jobId) => {
            logger_1.logger.warn('[BROADCAST_WORKER] Job stalled', {
                jobId,
                queue: queueName,
                workerId: worker_identity_1.WORKER_ID,
            });
        });
    }
    /**
     * Process a broadcast event with retry logic.
     */
    async processBroadcastEvent(job) {
        const startTime = Date.now();
        let retryCount = 0;
        let lastError = null;
        try {
            // Step 1: Validate payload
            validatePayload(job.data);
            const { meetingId, eventType, data } = job.data;
            // Step 1.5: Idempotency check — skip duplicate broadcasts
            const dataHash = (0, idempotency_1.hashObject)(data);
            const idempotencyKey = (0, idempotency_1.getBroadcastIdempotencyKey)(meetingId, eventType, dataHash);
            const isDuplicate = await (0, idempotency_1.checkAndMarkProcessed)(idempotencyKey, 'BROADCAST_WORKER');
            if (isDuplicate) {
                logger_1.logger.debug('[BROADCAST_WORKER] Duplicate broadcast skipped', {
                    jobId: job.id,
                    meetingId,
                    eventType,
                });
                return {
                    success: true,
                    eventType,
                    meetingId,
                    retryCount: 0,
                    durationMs: Date.now() - startTime,
                };
            }
            logger_1.logger.debug('[BROADCAST_WORKER] Processing broadcast event', {
                jobId: job.id,
                meetingId,
                eventType,
                dataKeys: Object.keys(data),
            });
            // Step 2: Determine Socket.IO event name
            const eventName = this.mapEventType(eventType);
            // Step 3: Retry loop for broadcast
            while (retryCount < RETRY_CONFIG.maxRetries) {
                try {
                    await this.broadcastToClients(meetingId, eventName, data);
                    this.broadcastCount++;
                    // Increment meeting pipeline metrics (non-blocking)
                    (0, meeting_metrics_1.incrementBroadcastEvents)(meetingId).catch(() => { });
                    logger_1.logger.info('[BROADCAST_WORKER] Broadcast successful', {
                        jobId: job.id,
                        meetingId,
                        eventType,
                        eventName,
                        retryCount,
                        durationMs: Date.now() - startTime,
                    });
                    return {
                        success: true,
                        eventType,
                        meetingId,
                        retryCount,
                        durationMs: Date.now() - startTime,
                    };
                }
                catch (err) {
                    lastError = err;
                    retryCount++;
                    // Check if it's a disconnect error
                    if (this.isDisconnectError(err)) {
                        this.disconnectCount++;
                        logger_1.logger.warn('[BROADCAST_WORKER] WebSocket disconnect detected', {
                            jobId: job.id,
                            meetingId,
                            retryCount,
                            error: err.message,
                        });
                    }
                    // Calculate backoff delay
                    const delay = Math.min(RETRY_CONFIG.initialDelayMs * Math.pow(RETRY_CONFIG.backoffMultiplier, retryCount - 1), RETRY_CONFIG.maxDelayMs);
                    if (retryCount < RETRY_CONFIG.maxRetries) {
                        logger_1.logger.debug('[BROADCAST_WORKER] Retrying broadcast', {
                            jobId: job.id,
                            retryCount,
                            delayMs: delay,
                        });
                        await this.sleep(delay);
                    }
                }
            }
            // All retries exhausted
            throw lastError || new Error('Broadcast failed after max retries');
        }
        catch (err) {
            logger_1.logger.error('[BROADCAST_WORKER] Broadcast failed permanently', {
                jobId: job.id,
                meetingId: job.data?.meetingId,
                eventType: job.data?.eventType,
                retryCount,
                error: err.message,
            });
            throw err;
        }
    }
    /**
     * Map internal event type to Socket.IO event name.
     * For Stage 4, translations are broadcast as 'meeting:caption'.
     */
    mapEventType(eventType) {
        const eventMap = {
            'transcript': 'meeting:transcript',
            'translation': 'meeting:caption', // Stage 4: Caption event
            'minutes': 'meeting:minutes',
            'caption': 'meeting:caption',
        };
        return eventMap[eventType] || `meeting:${eventType}`;
    }
    /**
     * Broadcast event to Socket.IO clients via Redis PubSub.
     */
    async broadcastToClients(meetingId, eventName, data) {
        // Construct caption payload for 'meeting:caption' events
        const payload = {
            type: eventName,
            timestamp: new Date().toISOString(),
            data: {
                meetingId,
                ...data,
            },
        };
        // Detailed logging for caption events
        if (eventName === 'meeting:caption') {
            logger_1.logger.debug('[BROADCAST_WORKER] Broadcasting caption', {
                meetingId,
                speakerId: data.speakerId,
                language: data.language || data.targetLanguage,
                textPreview: (data.translatedText || data.originalText || '').substring(0, 50),
            });
        }
        // Publish to Redis PubSub channel
        // The WebSocket gateway (socket.ts) subscribes and broadcasts to room
        await (0, event_bus_service_1.publishEvent)(event_bus_service_1.EVENT_CHANNELS.MEETING_EVENTS, payload);
    }
    /**
     * Check if error is a WebSocket disconnect error.
     */
    isDisconnectError(err) {
        const disconnectPatterns = [
            'disconnected',
            'socket hang up',
            'connection reset',
            'ECONNRESET',
            'EPIPE',
            'client disconnected',
            'not connected',
        ];
        return disconnectPatterns.some(pattern => err.message.toLowerCase().includes(pattern.toLowerCase()));
    }
    /**
     * Sleep utility for retry backoff.
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    /**
     * Get worker statistics.
     */
    getStats() {
        return {
            running: this.isRunning,
            processed: this.processedCount,
            failed: this.failedCount,
            broadcasts: this.broadcastCount,
            disconnects: this.disconnectCount,
            workerId: worker_identity_1.WORKER_ID,
            workerCount: this.workers.length,
        };
    }
    /**
     * Gracefully stop all shard workers.
     */
    async stop() {
        logger_1.logger.info('[BROADCAST_WORKER] Stopping all shard workers...', {
            workerId: worker_identity_1.WORKER_ID,
            workerCount: this.workers.length,
            processedTotal: this.processedCount,
            failedTotal: this.failedCount,
            broadcastsTotal: this.broadcastCount,
        });
        // Close all shard workers in parallel
        await Promise.all(this.workers.map(worker => worker.close()));
        this.workers = [];
        this.isRunning = false;
        logger_1.logger.info('[BROADCAST_WORKER] All workers stopped', {
            workerId: worker_identity_1.WORKER_ID,
        });
    }
}
// ── Singleton Instance ──────────────────────────────────────
let broadcastWorker = null;
async function startBroadcastWorker() {
    if (!broadcastWorker) {
        broadcastWorker = new BroadcastWorker();
    }
    await broadcastWorker.initialize();
}
async function stopBroadcastWorker() {
    if (broadcastWorker) {
        await broadcastWorker.stop();
        broadcastWorker = null;
    }
}
function getBroadcastWorker() {
    return broadcastWorker;
}
// ── Test Helper (for development) ───────────────────────────
/**
 * Submit a test caption broadcast for development/debugging.
 */
async function submitTestCaption(meetingId, speakerId, text, language = 'es') {
    // Use queue-manager for sharded queue submission
    const { submitBroadcast, initializeQueueManager } = await Promise.resolve().then(() => __importStar(require('../queues/queue-manager')));
    await initializeQueueManager();
    return submitBroadcast({
        meetingId,
        eventType: 'translation',
        data: {
            meetingId,
            speakerId,
            originalText: text,
            translatedText: `[${language.toUpperCase()}] ${text}`,
            language,
            timestamp: Date.now(),
        },
    });
}
//# sourceMappingURL=broadcast.worker.js.map