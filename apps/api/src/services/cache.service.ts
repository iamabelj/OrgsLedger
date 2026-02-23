// ============================================================
// OrgsLedger API — Cache Service
// Redis-backed with in-memory fallback for development.
// Provides get/set/del with TTL for route-level caching.
// ============================================================

import { config } from '../config';
import { logger } from '../logger';

// ── In-Memory Fallback Store ────────────────────────────────
interface MemoryCacheEntry {
  value: string;
  expiresAt: number;
}
const memoryStore = new Map<string, MemoryCacheEntry>();

// Periodic cleanup (every 2 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (entry.expiresAt < now) memoryStore.delete(key);
  }
}, 2 * 60 * 1000).unref();

// ── Redis Client (lazy init) ────────────────────────────────
let redisClient: any = null;
let redisAvailable = false;

async function getRedisClient(): Promise<any> {
  if (redisClient) return redisClient;

  try {
    // Dynamic import — only loads if redis is installed
    // @ts-ignore — redis is an optional peer dependency
    const { createClient } = await import('redis');
    redisClient = createClient({ url: config.redis.url });
    redisClient.on('error', (err: any) => {
      logger.warn('[CACHE] Redis error, falling back to in-memory', { error: err.message });
      redisAvailable = false;
    });
    redisClient.on('connect', () => {
      redisAvailable = true;
      logger.info('[CACHE] Connected to Redis');
    });
    await redisClient.connect();
    redisAvailable = true;
    return redisClient;
  } catch {
    logger.info('[CACHE] Redis not available, using in-memory cache');
    redisAvailable = false;
    return null;
  }
}

// Try to connect on module load (non-blocking)
getRedisClient().catch(() => {});

// ── Cache Interface ─────────────────────────────────────────

/**
 * Get a cached value by key.
 * Returns null if not found or expired.
 */
export async function cacheGet(key: string): Promise<string | null> {
  if (redisAvailable && redisClient) {
    try {
      return await redisClient.get(key);
    } catch {
      // Fallback to memory
    }
  }
  const entry = memoryStore.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
}

/**
 * Set a cached value with TTL in seconds.
 */
export async function cacheSet(key: string, value: string, ttlSeconds: number = 60): Promise<void> {
  if (redisAvailable && redisClient) {
    try {
      await redisClient.setEx(key, ttlSeconds, value);
      return;
    } catch {
      // Fallback to memory
    }
  }
  memoryStore.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Delete a cached key (or pattern with wildcard *).
 */
export async function cacheDel(key: string): Promise<void> {
  if (redisAvailable && redisClient) {
    try {
      if (key.includes('*')) {
        const keys = await redisClient.keys(key);
        if (keys.length) await redisClient.del(keys);
      } else {
        await redisClient.del(key);
      }
      return;
    } catch {
      // Fallback
    }
  }

  if (key.includes('*')) {
    const pattern = new RegExp('^' + key.replace(/\*/g, '.*') + '$');
    for (const k of memoryStore.keys()) {
      if (pattern.test(k)) memoryStore.delete(k);
    }
  } else {
    memoryStore.delete(key);
  }
}

/**
 * Cache-aside helper for route handlers.
 * If the key exists in cache, returns the parsed JSON.
 * Otherwise, calls the fetch function, caches the result, and returns it.
 */
export async function cacheAside<T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>
): Promise<T> {
  const cached = await cacheGet(key);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      // Corrupted cache — refetch
    }
  }
  const result = await fetchFn();
  await cacheSet(key, JSON.stringify(result), ttlSeconds);
  return result;
}

/** Check if Redis is connected */
export function isRedisAvailable(): boolean {
  return redisAvailable;
}

/** Clear entire cache (used in tests) */
export async function cacheClear(): Promise<void> {
  memoryStore.clear();
  if (redisAvailable && redisClient) {
    try { await redisClient.flushDb(); } catch {}
  }
}
