"use strict";
// ============================================================
// OrgsLedger API — Worker Idempotency Helper
// Ensures workers don't process duplicate events
// ============================================================
//
// Architecture:
//   - Redis-based deduplication using SET with TTL
//   - PostgreSQL event store backup for durability
//   - Fast O(1) lookup via Redis
//   - Automatic TTL-based cleanup
//
// Usage in workers:
//   const key = getIdempotencyKey('transcript', meetingId, timestamp, text);
//   if (await checkAndMarkProcessed(key)) {
//     return { skipped: true, reason: 'Duplicate event' };
//   }
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
exports.getTranscriptIdempotencyKey = getTranscriptIdempotencyKey;
exports.getTranslationIdempotencyKey = getTranslationIdempotencyKey;
exports.getBroadcastIdempotencyKey = getBroadcastIdempotencyKey;
exports.getMinutesIdempotencyKey = getMinutesIdempotencyKey;
exports.getEventIdempotencyKey = getEventIdempotencyKey;
exports.hashObject = hashObject;
exports.checkAndMarkProcessed = checkAndMarkProcessed;
exports.isProcessed = isProcessed;
exports.markProcessed = markProcessed;
exports.clearIdempotencyKey = clearIdempotencyKey;
exports.batchCheckDuplicates = batchCheckDuplicates;
exports.isJobProcessed = isJobProcessed;
exports.markJobProcessed = markJobProcessed;
exports.checkAndMarkJobProcessed = checkAndMarkJobProcessed;
const client = __importStar(require("prom-client"));
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
// ── Configuration ───────────────────────────────────────────
const IDEMPOTENCY_CONFIG = {
    /** TTL for idempotency keys (24 hours) */
    ttlSeconds: 86400,
    /** Redis key prefix */
    keyPrefix: 'idem:',
    /** Batch check size for Redis */
    batchSize: 100,
};
// ── Prometheus Metrics ──────────────────────────────────────
const idempotencyChecksTotal = new client.Counter({
    name: 'orgsledger_idempotency_checks_total',
    help: 'Total idempotency checks performed',
    labelNames: ['worker', 'result'],
});
const idempotencyDuplicatesTotal = new client.Counter({
    name: 'orgsledger_idempotency_duplicates_total',
    help: 'Total duplicate events detected',
    labelNames: ['worker'],
});
// ── Idempotency Key Generation ──────────────────────────────
/**
 * Generate a unique idempotency key for transcript events.
 * Combines meeting ID, speaker ID, timestamp, and a hash of the text.
 */
function getTranscriptIdempotencyKey(meetingId, speakerId, timestamp, text) {
    // Use first 50 chars of text for uniqueness (enough to differentiate)
    const textSnippet = text.substring(0, 50).replace(/\s+/g, '_');
    const hash = simpleHash(textSnippet);
    return `${IDEMPOTENCY_CONFIG.keyPrefix}transcript:${meetingId}:${speakerId || 'unknown'}:${timestamp}:${hash}`;
}
/**
 * Generate idempotency key for translation events.
 */
function getTranslationIdempotencyKey(meetingId, speakerId, timestamp, targetLanguage) {
    return `${IDEMPOTENCY_CONFIG.keyPrefix}translation:${meetingId}:${speakerId}:${timestamp}:${targetLanguage}`;
}
/**
 * Generate idempotency key for broadcast events.
 */
function getBroadcastIdempotencyKey(meetingId, eventType, dataHash) {
    return `${IDEMPOTENCY_CONFIG.keyPrefix}broadcast:${meetingId}:${eventType}:${dataHash}`;
}
/**
 * Generate idempotency key for minutes events.
 */
function getMinutesIdempotencyKey(meetingId) {
    return `${IDEMPOTENCY_CONFIG.keyPrefix}minutes:${meetingId}`;
}
/**
 * Generate idempotency key from event ID.
 * Use this when you have a pre-assigned event ID.
 */
function getEventIdempotencyKey(eventId) {
    return `${IDEMPOTENCY_CONFIG.keyPrefix}event:${eventId}`;
}
// ── Simple Hash Function ────────────────────────────────────
/**
 * Fast djb2 hash for generating content hashes.
 */
function simpleHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
}
/**
 * Generate a hash from an object (for data payloads).
 */
function hashObject(obj) {
    const str = JSON.stringify(obj, Object.keys(obj).sort());
    return simpleHash(str);
}
// ── Redis-based Idempotency Checks ──────────────────────────
let redisClient = null;
/**
 * Get or create Redis client for idempotency checks.
 */
function getRedisClient() {
    if (!redisClient) {
        redisClient = (0, redisClient_1.createBullMQConnection)();
    }
    return redisClient;
}
/**
 * Check if an event has already been processed.
 * If not, marks it as processed atomically (using SETNX).
 *
 * @param key - Unique idempotency key
 * @param workerName - Worker name for metrics
 * @returns true if this is a duplicate (already processed)
 */
async function checkAndMarkProcessed(key, workerName = 'unknown') {
    try {
        const redis = getRedisClient();
        // Use SET with NX (only set if not exists) and EX (TTL)
        const result = await redis.set(key, Date.now().toString(), 'NX', // Only set if not exists
        'EX', // Expiry in seconds
        IDEMPOTENCY_CONFIG.ttlSeconds);
        if (result === null) {
            // Key already exists — this is a duplicate
            idempotencyChecksTotal.inc({ worker: workerName, result: 'duplicate' });
            idempotencyDuplicatesTotal.inc({ worker: workerName });
            logger_1.logger.debug('[IDEMPOTENCY] Duplicate event detected', {
                key,
                worker: workerName,
            });
            return true; // Is duplicate
        }
        // Key was set — this is a new event
        idempotencyChecksTotal.inc({ worker: workerName, result: 'new' });
        return false; // Not duplicate
    }
    catch (err) {
        logger_1.logger.error('[IDEMPOTENCY] Redis check failed, allowing processing', {
            key,
            worker: workerName,
            error: err,
        });
        // On Redis errors, allow processing (better to have duplicates than lost events)
        idempotencyChecksTotal.inc({ worker: workerName, result: 'error' });
        return false;
    }
}
/**
 * Check if an event was already processed (read-only check).
 * Does NOT mark as processed.
 */
async function isProcessed(key) {
    try {
        const redis = getRedisClient();
        const exists = await redis.exists(key);
        return exists === 1;
    }
    catch (err) {
        logger_1.logger.error('[IDEMPOTENCY] Redis check failed', { key, error: err });
        return false;
    }
}
/**
 * Manually mark an event as processed.
 * Use this when processing happens outside the normal flow.
 */
async function markProcessed(key) {
    try {
        const redis = getRedisClient();
        await redis.set(key, Date.now().toString(), 'EX', IDEMPOTENCY_CONFIG.ttlSeconds);
    }
    catch (err) {
        logger_1.logger.error('[IDEMPOTENCY] Failed to mark as processed', { key, error: err });
    }
}
/**
 * Remove idempotency record (for testing or manual retry).
 */
async function clearIdempotencyKey(key) {
    try {
        const redis = getRedisClient();
        await redis.del(key);
    }
    catch (err) {
        logger_1.logger.error('[IDEMPOTENCY] Failed to clear key', { key, error: err });
    }
}
/**
 * Batch check multiple keys for duplicates.
 * Returns a map of key -> isDuplicate.
 */
async function batchCheckDuplicates(keys) {
    const results = new Map();
    if (keys.length === 0) {
        return results;
    }
    try {
        const redis = getRedisClient();
        // Use MGET for efficient batch lookup
        const values = await redis.mget(...keys);
        for (let i = 0; i < keys.length; i++) {
            results.set(keys[i], values[i] !== null);
        }
        return results;
    }
    catch (err) {
        logger_1.logger.error('[IDEMPOTENCY] Batch check failed', { error: err });
        // Return all as non-duplicate on error
        for (const key of keys) {
            results.set(key, false);
        }
        return results;
    }
}
// ── Job ID Based Idempotency ────────────────────────────────
/**
 * Check if a BullMQ job has already been processed.
 * Uses the job ID as the idempotency key.
 */
async function isJobProcessed(jobId, queueName) {
    const key = `${IDEMPOTENCY_CONFIG.keyPrefix}job:${queueName}:${jobId}`;
    return isProcessed(key);
}
/**
 * Mark a BullMQ job as processed.
 */
async function markJobProcessed(jobId, queueName) {
    const key = `${IDEMPOTENCY_CONFIG.keyPrefix}job:${queueName}:${jobId}`;
    await markProcessed(key);
}
/**
 * Check and mark a job as processed atomically.
 * Returns true if already processed (duplicate).
 */
async function checkAndMarkJobProcessed(jobId, queueName, workerName) {
    const key = `${IDEMPOTENCY_CONFIG.keyPrefix}job:${queueName}:${jobId}`;
    return checkAndMarkProcessed(key, workerName);
}
// ── Exports ─────────────────────────────────────────────────
exports.default = {
    checkAndMarkProcessed,
    isProcessed,
    markProcessed,
    clearIdempotencyKey,
    batchCheckDuplicates,
    getTranscriptIdempotencyKey,
    getTranslationIdempotencyKey,
    getBroadcastIdempotencyKey,
    getMinutesIdempotencyKey,
    getEventIdempotencyKey,
    hashObject,
    isJobProcessed,
    markJobProcessed,
    checkAndMarkJobProcessed,
};
//# sourceMappingURL=idempotency.js.map