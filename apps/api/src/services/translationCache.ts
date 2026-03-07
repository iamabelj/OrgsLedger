// ============================================================
// OrgsLedger API — Translation Cache (Redis-backed)
// Two-tier cache: L1 in-memory + L2 Redis for sub-20ms lookups
// Key format: tl:{source}:{target}:{hash}
// TTL: 1 hour
// ============================================================

import { createHash } from 'crypto';
import { logger } from '../logger';
import { getRedisClient } from '../infrastructure/redisClient';

const REDIS_PREFIX = 'tl:';
const REDIS_TTL_SECONDS = 3600; // 1 hour

// ── L1: In-process cache (< 1ms) ───────────────────────────
const l1Cache = new Map<string, { text: string; ts: number }>();
const L1_MAX = 2000;
const L1_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── Metrics ─────────────────────────────────────────────────
let cacheHits = 0;
let cacheMisses = 0;
let redisHits = 0;

// ── Helpers ─────────────────────────────────────────────────

function hashText(text: string): string {
  return createHash('md5').update(text).digest('hex').slice(0, 12);
}

function buildKey(sourceLang: string, targetLang: string, text: string): string {
  return `${REDIS_PREFIX}${sourceLang}:${targetLang}:${hashText(text)}`;
}

// ── Public API ──────────────────────────────────────────────

/**
 * Look up a cached translation. Checks L1 first, then Redis.
 * Returns null on miss.
 */
export async function getCachedTranslation(
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<string | null> {
  const key = buildKey(sourceLang, targetLang, text);

  // L1 check
  const l1 = l1Cache.get(key);
  if (l1 && Date.now() - l1.ts < L1_TTL_MS) {
    cacheHits++;
    return l1.text;
  }
  if (l1) l1Cache.delete(key); // stale

  // L2 (Redis) check
  try {
    const redis = await getRedisClient();
    const val = await redis.get(key);
    if (val !== null) {
      redisHits++;
      cacheHits++;
      // Promote to L1
      setL1(key, val);
      return val;
    }
  } catch (err) {
    // Redis down — proceed without cache
    logger.debug('[TRANSLATION_CACHE] Redis read failed', err);
  }

  cacheMisses++;
  return null;
}

/**
 * Store a translation in both L1 and Redis.
 */
export async function setCachedTranslation(
  text: string,
  sourceLang: string,
  targetLang: string,
  translation: string,
): Promise<void> {
  const key = buildKey(sourceLang, targetLang, text);

  // L1
  setL1(key, translation);

  // L2 (Redis) — fire-and-forget, don't block hot path
  try {
    const redis = await getRedisClient();
    redis.set(key, translation, 'EX', REDIS_TTL_SECONDS).catch(() => {});
  } catch {
    // Non-fatal
  }
}

/**
 * Batch-set multiple translations (used by prewarm).
 */
export async function batchSetTranslations(
  entries: Array<{ text: string; sourceLang: string; targetLang: string; translation: string }>,
): Promise<void> {
  try {
    const redis = await getRedisClient();
    const pipeline = redis.pipeline();

    for (const e of entries) {
      const key = buildKey(e.sourceLang, e.targetLang, e.text);
      pipeline.set(key, e.translation, 'EX', REDIS_TTL_SECONDS);
      setL1(key, e.translation);
    }

    await pipeline.exec();
    logger.info(`[TRANSLATION_CACHE] Prewarmed ${entries.length} entries`);
  } catch (err) {
    logger.warn('[TRANSLATION_CACHE] Batch set failed (non-fatal)', err);
  }
}

/**
 * Cache metrics for monitoring.
 */
export function getCacheMetrics() {
  const total = cacheHits + cacheMisses;
  return {
    hits: cacheHits,
    misses: cacheMisses,
    redisHits,
    hitRate: total > 0 ? ((cacheHits / total) * 100).toFixed(1) + '%' : '0%',
    l1Size: l1Cache.size,
  };
}

/**
 * Reset metrics (for testing).
 */
export function resetCacheMetrics(): void {
  cacheHits = 0;
  cacheMisses = 0;
  redisHits = 0;
}

// ── L1 internals ────────────────────────────────────────────
function setL1(key: string, text: string): void {
  if (l1Cache.size >= L1_MAX) {
    // Evict oldest 25%
    const entries = [...l1Cache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    const evictCount = Math.ceil(L1_MAX * 0.25);
    for (let i = 0; i < evictCount; i++) {
      l1Cache.delete(entries[i][0]);
    }
  }
  l1Cache.set(key, { text, ts: Date.now() });
}
