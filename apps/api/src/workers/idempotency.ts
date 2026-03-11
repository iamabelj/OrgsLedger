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

import * as client from 'prom-client';
import { createBullMQConnection } from '../infrastructure/redisClient';
import { logger } from '../logger';

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
  labelNames: ['worker', 'result'] as const,
});

const idempotencyDuplicatesTotal = new client.Counter({
  name: 'orgsledger_idempotency_duplicates_total',
  help: 'Total duplicate events detected',
  labelNames: ['worker'] as const,
});

// ── Types ───────────────────────────────────────────────────

export interface IdempotencyCheckResult {
  isDuplicate: boolean;
  previouslyProcessedAt?: Date;
}

// ── Idempotency Key Generation ──────────────────────────────

/**
 * Generate a unique idempotency key for transcript events.
 * Combines meeting ID, speaker ID, timestamp, and a hash of the text.
 */
export function getTranscriptIdempotencyKey(
  meetingId: string,
  speakerId: string | undefined,
  timestamp: string | number,
  text: string
): string {
  // Use first 50 chars of text for uniqueness (enough to differentiate)
  const textSnippet = text.substring(0, 50).replace(/\s+/g, '_');
  const hash = simpleHash(textSnippet);
  return `${IDEMPOTENCY_CONFIG.keyPrefix}transcript:${meetingId}:${speakerId || 'unknown'}:${timestamp}:${hash}`;
}

/**
 * Generate idempotency key for translation events.
 */
export function getTranslationIdempotencyKey(
  meetingId: string,
  speakerId: string,
  timestamp: string | number,
  targetLanguage: string
): string {
  return `${IDEMPOTENCY_CONFIG.keyPrefix}translation:${meetingId}:${speakerId}:${timestamp}:${targetLanguage}`;
}

/**
 * Generate idempotency key for broadcast events.
 */
export function getBroadcastIdempotencyKey(
  meetingId: string,
  eventType: string,
  dataHash: string
): string {
  return `${IDEMPOTENCY_CONFIG.keyPrefix}broadcast:${meetingId}:${eventType}:${dataHash}`;
}

/**
 * Generate idempotency key for minutes events.
 */
export function getMinutesIdempotencyKey(meetingId: string): string {
  return `${IDEMPOTENCY_CONFIG.keyPrefix}minutes:${meetingId}`;
}

/**
 * Generate idempotency key from event ID.
 * Use this when you have a pre-assigned event ID.
 */
export function getEventIdempotencyKey(eventId: string): string {
  return `${IDEMPOTENCY_CONFIG.keyPrefix}event:${eventId}`;
}

// ── Simple Hash Function ────────────────────────────────────

/**
 * Fast djb2 hash for generating content hashes.
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Generate a hash from an object (for data payloads).
 */
export function hashObject(obj: Record<string, any>): string {
  const str = JSON.stringify(obj, Object.keys(obj).sort());
  return simpleHash(str);
}

// ── Redis-based Idempotency Checks ──────────────────────────

let redisClient: any = null;

/**
 * Get or create Redis client for idempotency checks.
 */
function getRedisClient(): any {
  if (!redisClient) {
    redisClient = createBullMQConnection();
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
export async function checkAndMarkProcessed(
  key: string,
  workerName: string = 'unknown'
): Promise<boolean> {
  try {
    const redis = getRedisClient();
    
    // Use SET with NX (only set if not exists) and EX (TTL)
    const result = await redis.set(
      key,
      Date.now().toString(),
      'NX', // Only set if not exists
      'EX', // Expiry in seconds
      IDEMPOTENCY_CONFIG.ttlSeconds
    );
    
    if (result === null) {
      // Key already exists — this is a duplicate
      idempotencyChecksTotal.inc({ worker: workerName, result: 'duplicate' });
      idempotencyDuplicatesTotal.inc({ worker: workerName });
      
      logger.debug('[IDEMPOTENCY] Duplicate event detected', {
        key,
        worker: workerName,
      });
      
      return true; // Is duplicate
    }
    
    // Key was set — this is a new event
    idempotencyChecksTotal.inc({ worker: workerName, result: 'new' });
    return false; // Not duplicate
  } catch (err) {
    logger.error('[IDEMPOTENCY] Redis check failed, allowing processing', {
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
export async function isProcessed(key: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const exists = await redis.exists(key);
    return exists === 1;
  } catch (err) {
    logger.error('[IDEMPOTENCY] Redis check failed', { key, error: err });
    return false;
  }
}

/**
 * Manually mark an event as processed.
 * Use this when processing happens outside the normal flow.
 */
export async function markProcessed(key: string): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.set(
      key,
      Date.now().toString(),
      'EX',
      IDEMPOTENCY_CONFIG.ttlSeconds
    );
  } catch (err) {
    logger.error('[IDEMPOTENCY] Failed to mark as processed', { key, error: err });
  }
}

/**
 * Remove idempotency record (for testing or manual retry).
 */
export async function clearIdempotencyKey(key: string): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(key);
  } catch (err) {
    logger.error('[IDEMPOTENCY] Failed to clear key', { key, error: err });
  }
}

/**
 * Batch check multiple keys for duplicates.
 * Returns a map of key -> isDuplicate.
 */
export async function batchCheckDuplicates(
  keys: string[]
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();
  
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
  } catch (err) {
    logger.error('[IDEMPOTENCY] Batch check failed', { error: err });
    
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
export async function isJobProcessed(
  jobId: string,
  queueName: string
): Promise<boolean> {
  const key = `${IDEMPOTENCY_CONFIG.keyPrefix}job:${queueName}:${jobId}`;
  return isProcessed(key);
}

/**
 * Mark a BullMQ job as processed.
 */
export async function markJobProcessed(
  jobId: string,
  queueName: string
): Promise<void> {
  const key = `${IDEMPOTENCY_CONFIG.keyPrefix}job:${queueName}:${jobId}`;
  await markProcessed(key);
}

/**
 * Check and mark a job as processed atomically.
 * Returns true if already processed (duplicate).
 */
export async function checkAndMarkJobProcessed(
  jobId: string,
  queueName: string,
  workerName: string
): Promise<boolean> {
  const key = `${IDEMPOTENCY_CONFIG.keyPrefix}job:${queueName}:${jobId}`;
  return checkAndMarkProcessed(key, workerName);
}

// ── Exports ─────────────────────────────────────────────────

export default {
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
