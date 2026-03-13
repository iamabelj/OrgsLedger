"use strict";
// ============================================================
// OrgsLedger API — Transcript Queue
// Redis queue for realtime transcription events
// 
// IMPORTANT: This module now delegates to the sharded queue-manager
// for horizontal scaling support (50k+ concurrent meetings).
// The legacy API is preserved for backward compatibility.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUEUE_NAMES = void 0;
exports.initializeTranscriptQueues = initializeTranscriptQueues;
exports.submitTranscriptEvent = submitTranscriptEvent;
exports.submitTranslationJob = submitTranslationJob;
exports.submitBroadcastEvent = submitBroadcastEvent;
exports.submitMinutesJob = submitMinutesJob;
exports.getTranscriptQueues = getTranscriptQueues;
const logger_1 = require("../logger");
const queue_manager_1 = require("./queue-manager");
// ── Legacy Queue Names (for reference only) ─────────────────
// Note: Actual queues now use sharded names like "transcript-jobs-shard-0"
exports.QUEUE_NAMES = {
    TRANSCRIPT_EVENTS: 'transcript-events',
    TRANSLATION_JOBS: 'translation-jobs',
    BROADCAST_EVENTS: 'broadcast-events',
    MINUTES_GENERATION: 'minutes-generation',
};
// ── Initialization ──────────────────────────────────────────
let initialized = false;
/**
 * Initialize transcript queues (delegates to sharded queue-manager)
 */
async function initializeTranscriptQueues() {
    if (initialized)
        return;
    await (0, queue_manager_1.initializeQueueManager)();
    initialized = true;
    logger_1.logger.info('[TRANSCRIPT_QUEUE] Delegating to sharded queue-manager', {
        shardCounts: queue_manager_1.QUEUE_SHARD_COUNTS,
        queueTypes: Object.values(queue_manager_1.SHARDED_QUEUE_TYPES),
    });
}
// ── Job Submission Functions ────────────────────────────────
// These functions maintain the legacy API but route to sharded queues
/**
 * Submit a transcript event to the sharded queue
 * Deterministically routes to a shard based on meetingId
 */
async function submitTranscriptEvent(data) {
    // Ensure queue manager is initialized
    if (!queue_manager_1.queueManager.isInitialized()) {
        await (0, queue_manager_1.initializeQueueManager)();
        initialized = true;
    }
    const job = await queue_manager_1.queueManager.submitTranscript(data, { priority: 1 });
    const shardIndex = (0, queue_manager_1.getShardIndex)(data.meetingId, queue_manager_1.SHARDED_QUEUE_TYPES.TRANSCRIPT_EVENTS);
    logger_1.logger.debug('[TRANSCRIPT_QUEUE] Transcript event submitted to shard', {
        meetingId: data.meetingId,
        shard: shardIndex,
        jobId: job.id,
    });
    return job.id;
}
/**
 * Submit a translation job to the sharded queue
 * Deterministically routes to a shard based on meetingId
 */
async function submitTranslationJob(data) {
    if (!queue_manager_1.queueManager.isInitialized()) {
        await (0, queue_manager_1.initializeQueueManager)();
        initialized = true;
    }
    const job = await queue_manager_1.queueManager.submitTranslation(data);
    const shardIndex = (0, queue_manager_1.getShardIndex)(data.meetingId, queue_manager_1.SHARDED_QUEUE_TYPES.TRANSLATION_JOBS);
    logger_1.logger.debug('[TRANSCRIPT_QUEUE] Translation job submitted to shard', {
        meetingId: data.meetingId,
        shard: shardIndex,
        jobId: job.id,
    });
    return job.id;
}
/**
 * Submit a broadcast event to the sharded queue
 * Deterministically routes to a shard based on meetingId
 */
async function submitBroadcastEvent(data) {
    if (!queue_manager_1.queueManager.isInitialized()) {
        await (0, queue_manager_1.initializeQueueManager)();
        initialized = true;
    }
    const job = await queue_manager_1.queueManager.submitBroadcast(data);
    const shardIndex = (0, queue_manager_1.getShardIndex)(data.meetingId, queue_manager_1.SHARDED_QUEUE_TYPES.BROADCAST_EVENTS);
    logger_1.logger.debug('[TRANSCRIPT_QUEUE] Broadcast event submitted to shard', {
        meetingId: data.meetingId,
        shard: shardIndex,
        jobId: job.id,
    });
    return job.id;
}
/**
 * Submit a minutes generation job to the sharded queue
 * Deterministically routes to a shard based on meetingId
 */
async function submitMinutesJob(data, options) {
    if (!queue_manager_1.queueManager.isInitialized()) {
        await (0, queue_manager_1.initializeQueueManager)();
        initialized = true;
    }
    const job = await queue_manager_1.queueManager.submitMinutes(data, options);
    const shardIndex = (0, queue_manager_1.getShardIndex)(data.meetingId, queue_manager_1.SHARDED_QUEUE_TYPES.MINUTES_GENERATION);
    logger_1.logger.debug('[TRANSCRIPT_QUEUE] Minutes job submitted to shard', {
        meetingId: data.meetingId,
        shard: shardIndex,
        jobId: job.id,
    });
    return job.id;
}
/**
 * Get queue accessors for external use
 * Each accessor requires meetingId for deterministic shard routing
 */
function getTranscriptQueues() {
    return {
        getTranscriptQueue: (meetingId) => queue_manager_1.queueManager.getTranscriptQueue(meetingId),
        getTranslationQueue: (meetingId) => queue_manager_1.queueManager.getTranslationQueue(meetingId),
        getBroadcastQueue: (meetingId) => queue_manager_1.queueManager.getBroadcastQueue(meetingId),
        getMinutesQueue: (meetingId) => queue_manager_1.queueManager.getMinutesQueue(meetingId),
    };
}
//# sourceMappingURL=transcript.queue.js.map