/**
 * Number of shards for queue distribution.
 * Configurable via QUEUE_NUM_SHARDS environment variable.
 * Default: 16 shards (~3,125 meetings per shard at 50k total).
 * Must be a power of 2 for optimal distribution.
 */
export declare const NUM_SHARDS: number;
export declare const QUEUE_TYPES: readonly ["transcript", "translation", "broadcast"];
export type QueueType = typeof QUEUE_TYPES[number];
export interface ShardRouting {
    shardId: number;
    queueName: string;
}
export interface ShardInfo {
    shardId: number;
}
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
export declare function murmurhash3(key: string, seed?: number): number;
/**
 * Get the shard assignment for a meeting ID.
 * Uses murmurhash3 for deterministic, uniformly distributed mapping.
 *
 * @param meetingId - Unique meeting identifier
 * @returns ShardInfo with the shard index
 */
export declare function getShardForMeeting(meetingId: string): ShardInfo;
/**
 * Get the full queue routing for a meeting ID and queue type.
 * Returns both the shard ID and the resolved BullMQ queue name.
 *
 * @param meetingId - Unique meeting identifier
 * @param queueType - Queue type: 'transcript' | 'translation' | 'broadcast'
 * @returns ShardRouting with shardId and queueName
 */
export declare function getQueueForMeeting(meetingId: string, queueType: QueueType): ShardRouting;
/**
 * Build a BullMQ-compatible queue name from type and shard index.
 *
 * @param queueType - Queue type
 * @param shardId - Shard index (0 to NUM_SHARDS - 1)
 * @returns Queue name string
 */
export declare function buildQueueName(queueType: QueueType, shardId: number): string;
/**
 * Get all queue names for a given queue type across all shards.
 * Useful for worker registration where a worker must consume from every shard.
 *
 * @param queueType - Queue type
 * @returns Array of all shard queue names
 */
export declare function getAllQueueNames(queueType: QueueType): string[];
/**
 * Get all queue names across all types and all shards.
 * Useful for system-level operations like health checks or draining.
 *
 * @returns Array of every queue name in the sharded topology
 */
export declare function getAllShardedQueueNames(): string[];
/**
 * Parse a shard queue name back into its components.
 *
 * @param queueName - Full queue name (e.g., "transcript-jobs-shard-5")
 * @returns Parsed components or null if the name doesn't match
 */
export declare function parseQueueName(queueName: string): {
    queueType: QueueType;
    shardId: number;
} | null;
//# sourceMappingURL=shard-router.d.ts.map