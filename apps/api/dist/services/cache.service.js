"use strict";
// ============================================================
// OrgsLedger API — Cache Service
// Redis-backed with in-memory fallback for development.
// Provides get/set/del with TTL for route-level caching.
// Uses shared ioredis client from infrastructure/redisClient.ts
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.cacheGet = cacheGet;
exports.cacheSet = cacheSet;
exports.cacheDel = cacheDel;
exports.cacheAside = cacheAside;
exports.isRedisAvailable = isRedisAvailable;
exports.cacheClear = cacheClear;
const logger_1 = require("../logger");
const redisClient_1 = require("../infrastructure/redisClient");
const memoryStore = new Map();
// Periodic cleanup (every 2 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of memoryStore.entries()) {
        if (entry.expiresAt < now)
            memoryStore.delete(key);
    }
}, 2 * 60 * 1000).unref();
// ── Redis Client (shared ioredis instance) ──────────────────
let cachedClient = null;
let redisAvailable = false;
let initializationPromise = null;
async function getIoredisClient() {
    if (cachedClient)
        return cachedClient;
    if (initializationPromise)
        return initializationPromise;
    initializationPromise = (async () => {
        try {
            cachedClient = await (0, redisClient_1.getRedisClient)();
            redisAvailable = true;
            logger_1.logger.info('[CACHE] Using shared ioredis client');
            return cachedClient;
        }
        catch (err) {
            logger_1.logger.info('[CACHE] Redis not available, using in-memory cache', {
                error: err.message,
            });
            redisAvailable = false;
            return null;
        }
    })();
    return initializationPromise;
}
// Try to connect on module load (non-blocking)
getIoredisClient().catch(() => { });
// ── Cache Interface ─────────────────────────────────────────
/**
 * Get a cached value by key.
 * Returns null if not found or expired.
 */
async function cacheGet(key) {
    const client = await getIoredisClient();
    if (redisAvailable && client) {
        try {
            return await client.get(key);
        }
        catch {
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
async function cacheSet(key, value, ttlSeconds = 60) {
    const client = await getIoredisClient();
    if (redisAvailable && client) {
        try {
            // ioredis uses set with EX option instead of setEx
            await client.set(key, value, 'EX', ttlSeconds);
            return;
        }
        catch {
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
async function cacheDel(key) {
    const client = await getIoredisClient();
    if (redisAvailable && client) {
        try {
            if (key.includes('*')) {
                const keys = await client.keys(key);
                if (keys.length)
                    await client.del(...keys);
            }
            else {
                await client.del(key);
            }
            return;
        }
        catch {
            // Fallback
        }
    }
    if (key.includes('*')) {
        const pattern = new RegExp('^' + key.replace(/\*/g, '.*') + '$');
        for (const k of memoryStore.keys()) {
            if (pattern.test(k))
                memoryStore.delete(k);
        }
    }
    else {
        memoryStore.delete(key);
    }
}
/**
 * Cache-aside helper for route handlers.
 * If the key exists in cache, returns the parsed JSON.
 * Otherwise, calls the fetch function, caches the result, and returns it.
 */
async function cacheAside(key, ttlSeconds, fetchFn) {
    const cached = await cacheGet(key);
    if (cached) {
        try {
            return JSON.parse(cached);
        }
        catch {
            // Corrupted cache — refetch
        }
    }
    const result = await fetchFn();
    await cacheSet(key, JSON.stringify(result), ttlSeconds);
    return result;
}
/** Check if Redis is connected */
function isRedisAvailable() {
    return redisAvailable;
}
/** Clear entire cache (used in tests) */
async function cacheClear() {
    memoryStore.clear();
    const client = await getIoredisClient();
    if (redisAvailable && client) {
        try {
            await client.flushdb();
        }
        catch { }
    }
}
//# sourceMappingURL=cache.service.js.map