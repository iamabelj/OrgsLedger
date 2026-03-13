"use strict";
// ============================================================
// OrgsLedger API — Shard Router
// Deterministic meeting-to-shard routing for BullMQ queues
// ============================================================
//
// Architecture:
//   - Configurable shard count via QUEUE_NUM_SHARDS env var
//   - Deterministic routing: murmurhash3(meetingId) % NUM_SHARDS
//   - Ensures same meetingId always maps to the same shard
//   - Compatible with BullMQ queue creation and Redis Cluster
//
// Queue naming convention:
//   transcript-jobs-shard-{id}
//   translation-jobs-shard-{id}
//   broadcast-jobs-shard-{id}
//
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUEUE_TYPES = exports.NUM_SHARDS = void 0;
exports.murmurhash3 = murmurhash3;
exports.getShardForMeeting = getShardForMeeting;
exports.getQueueForMeeting = getQueueForMeeting;
exports.buildQueueName = buildQueueName;
exports.getAllQueueNames = getAllQueueNames;
exports.getAllShardedQueueNames = getAllShardedQueueNames;
exports.parseQueueName = parseQueueName;
const logger_1 = require("../logger");
// ── Configuration ───────────────────────────────────────────
/**
 * Number of shards for queue distribution.
 * Configurable via QUEUE_NUM_SHARDS environment variable.
 * Default: 16 shards (~3,125 meetings per shard at 50k total).
 * Must be a power of 2 for optimal distribution.
 */
exports.NUM_SHARDS = (() => {
    const envVal = process.env.QUEUE_NUM_SHARDS;
    if (!envVal)
        return 16;
    const parsed = parseInt(envVal, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1024) {
        throw new Error(`Invalid QUEUE_NUM_SHARDS value "${envVal}". Must be an integer between 1 and 1024.`);
    }
    return parsed;
})();
// ── Queue Types ─────────────────────────────────────────────
exports.QUEUE_TYPES = ['transcript', 'translation', 'broadcast'];
/**
 * Queue name prefixes mapped to each queue type.
 * Follows the naming convention: {prefix}-shard-{id}
 */
const QUEUE_PREFIX = {
    transcript: 'transcript-jobs',
    translation: 'translation-jobs',
    broadcast: 'broadcast-jobs',
};
// ── MurmurHash3 Implementation ──────────────────────────────
/**
 * MurmurHash3 (32-bit) — fast, non-cryptographic hash with excellent
 * distribution properties. Produces uniform shard assignments even for
 * sequential or similar meeting IDs (e.g., UUID v4).
 *
 * Reference: https://en.wikipedia.org/wiki/MurmurHash
 *
 * @param key - String to hash
 * @param seed - Hash seed (default 0)
 * @returns 32-bit unsigned integer hash
 */
function murmurhash3(key, seed = 0) {
    let h = seed >>> 0;
    const len = key.length;
    const c1 = 0xcc9e2d51;
    const c2 = 0x1b873593;
    // Process 4-byte chunks
    const nBlocks = len >>> 2; // len / 4
    for (let i = 0; i < nBlocks; i++) {
        const offset = i << 2;
        let k = (key.charCodeAt(offset) & 0xff) |
            ((key.charCodeAt(offset + 1) & 0xff) << 8) |
            ((key.charCodeAt(offset + 2) & 0xff) << 16) |
            ((key.charCodeAt(offset + 3) & 0xff) << 24);
        k = Math.imul(k, c1);
        k = (k << 15) | (k >>> 17);
        k = Math.imul(k, c2);
        h ^= k;
        h = (h << 13) | (h >>> 19);
        h = Math.imul(h, 5) + 0xe6546b64;
    }
    // Process remaining bytes
    const tailOffset = nBlocks << 2;
    let k1 = 0;
    switch (len & 3) {
        case 3:
            k1 ^= (key.charCodeAt(tailOffset + 2) & 0xff) << 16;
        // falls through
        case 2:
            k1 ^= (key.charCodeAt(tailOffset + 1) & 0xff) << 8;
        // falls through
        case 1:
            k1 ^= key.charCodeAt(tailOffset) & 0xff;
            k1 = Math.imul(k1, c1);
            k1 = (k1 << 15) | (k1 >>> 17);
            k1 = Math.imul(k1, c2);
            h ^= k1;
    }
    // Finalization mix
    h ^= len;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0; // Ensure unsigned 32-bit
}
// ── Shard Routing Functions ─────────────────────────────────
/**
 * Get the shard assignment for a meeting ID.
 * Uses murmurhash3 for deterministic, uniformly distributed mapping.
 *
 * @param meetingId - Unique meeting identifier
 * @returns ShardInfo with the shard index
 */
function getShardForMeeting(meetingId) {
    const hash = murmurhash3(meetingId);
    const shardId = hash % exports.NUM_SHARDS;
    logger_1.logger.debug('[SHARD_ROUTER] Routed meeting to shard', {
        meetingId,
        shardId,
        numShards: exports.NUM_SHARDS,
    });
    return { shardId };
}
/**
 * Get the full queue routing for a meeting ID and queue type.
 * Returns both the shard ID and the resolved BullMQ queue name.
 *
 * @param meetingId - Unique meeting identifier
 * @param queueType - Queue type: 'transcript' | 'translation' | 'broadcast'
 * @returns ShardRouting with shardId and queueName
 */
function getQueueForMeeting(meetingId, queueType) {
    const { shardId } = getShardForMeeting(meetingId);
    const queueName = buildQueueName(queueType, shardId);
    logger_1.logger.debug('[SHARD_ROUTER] Resolved queue for meeting', {
        meetingId,
        queueType,
        shardId,
        queueName,
    });
    return { shardId, queueName };
}
// ── Queue Name Helpers ──────────────────────────────────────
/**
 * Build a BullMQ-compatible queue name from type and shard index.
 *
 * @param queueType - Queue type
 * @param shardId - Shard index (0 to NUM_SHARDS - 1)
 * @returns Queue name string
 */
function buildQueueName(queueType, shardId) {
    return `${QUEUE_PREFIX[queueType]}-shard-${shardId}`;
}
/**
 * Get all queue names for a given queue type across all shards.
 * Useful for worker registration where a worker must consume from every shard.
 *
 * @param queueType - Queue type
 * @returns Array of all shard queue names
 */
function getAllQueueNames(queueType) {
    const names = new Array(exports.NUM_SHARDS);
    for (let i = 0; i < exports.NUM_SHARDS; i++) {
        names[i] = buildQueueName(queueType, i);
    }
    return names;
}
/**
 * Get all queue names across all types and all shards.
 * Useful for system-level operations like health checks or draining.
 *
 * @returns Array of every queue name in the sharded topology
 */
function getAllShardedQueueNames() {
    const names = [];
    for (const queueType of exports.QUEUE_TYPES) {
        for (let i = 0; i < exports.NUM_SHARDS; i++) {
            names.push(buildQueueName(queueType, i));
        }
    }
    return names;
}
/**
 * Parse a shard queue name back into its components.
 *
 * @param queueName - Full queue name (e.g., "transcript-jobs-shard-5")
 * @returns Parsed components or null if the name doesn't match
 */
function parseQueueName(queueName) {
    const match = queueName.match(/^(.+)-shard-(\d+)$/);
    if (!match)
        return null;
    const prefix = match[1];
    const shardId = parseInt(match[2], 10);
    if (shardId < 0 || shardId >= exports.NUM_SHARDS)
        return null;
    const queueType = Object.entries(QUEUE_PREFIX).find(([, p]) => p === prefix)?.[0];
    if (!queueType)
        return null;
    return { queueType, shardId };
}
//# sourceMappingURL=shard-router.js.map