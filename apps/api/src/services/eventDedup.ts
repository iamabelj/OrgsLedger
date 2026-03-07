// ============================================================
// OrgsLedger — Event Deduplication
// Prevents duplicate processing in at-least-once delivery
// systems (NATS, BullMQ retries, etc.)
// Uses Redis SET NX with TTL for distributed lock semantics.
// ============================================================

import { logger } from '../logger';
import { getRedisClient } from '../infrastructure/redisClient';

const DEDUP_PREFIX = 'dedup:';
const DEFAULT_TTL = 300; // 5 minutes

/**
 * Check if an event has already been processed.
 * Returns true if this is the FIRST time seeing this eventId (should process).
 * Returns false if already processed (should skip).
 *
 * Uses Redis SET NX (set-if-not-exists) for atomic check-and-set.
 */
export async function tryClaimEvent(
  eventType: string,
  eventId: string,
  ttlSeconds: number = DEFAULT_TTL,
): Promise<boolean> {
  try {
    const redis = await getRedisClient();
    const key = `${DEDUP_PREFIX}${eventType}:${eventId}`;

    // SET NX returns 'OK' if key was set (first claim), null if already exists
    const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  } catch (err) {
    // If Redis is down, allow processing (better duplicate than dropped)
    logger.warn('[DEDUP] Redis unavailable, allowing event', err);
    return true;
  }
}

/**
 * Generate a deterministic event ID from payload fields.
 * Use for events that don't have a natural unique ID.
 */
export function buildEventId(...parts: string[]): string {
  return parts.join(':');
}
