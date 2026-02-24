"use strict";
// ============================================================
// OrgsLedger API — Cache Service
// Redis-backed with in-memory fallback for development.
// Provides get/set/del with TTL for route-level caching.
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
exports.cacheGet = cacheGet;
exports.cacheSet = cacheSet;
exports.cacheDel = cacheDel;
exports.cacheAside = cacheAside;
exports.isRedisAvailable = isRedisAvailable;
exports.cacheClear = cacheClear;
const config_1 = require("../config");
const logger_1 = require("../logger");
const memoryStore = new Map();
// Periodic cleanup (every 2 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of memoryStore.entries()) {
        if (entry.expiresAt < now)
            memoryStore.delete(key);
    }
}, 2 * 60 * 1000).unref();
// ── Redis Client (lazy init) ────────────────────────────────
let redisClient = null;
let redisAvailable = false;
async function getRedisClient() {
    if (redisClient)
        return redisClient;
    try {
        // Dynamic import — only loads if redis is installed
        // @ts-ignore — redis is an optional peer dependency
        const { createClient } = await Promise.resolve().then(() => __importStar(require('redis')));
        redisClient = createClient({ url: config_1.config.redis.url });
        redisClient.on('error', (err) => {
            logger_1.logger.warn('[CACHE] Redis error, falling back to in-memory', { error: err.message });
            redisAvailable = false;
        });
        redisClient.on('connect', () => {
            redisAvailable = true;
            logger_1.logger.info('[CACHE] Connected to Redis');
        });
        await redisClient.connect();
        redisAvailable = true;
        return redisClient;
    }
    catch {
        logger_1.logger.info('[CACHE] Redis not available, using in-memory cache');
        redisAvailable = false;
        return null;
    }
}
// Try to connect on module load (non-blocking)
getRedisClient().catch(() => { });
// ── Cache Interface ─────────────────────────────────────────
/**
 * Get a cached value by key.
 * Returns null if not found or expired.
 */
async function cacheGet(key) {
    if (redisAvailable && redisClient) {
        try {
            return await redisClient.get(key);
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
    if (redisAvailable && redisClient) {
        try {
            await redisClient.setEx(key, ttlSeconds, value);
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
    if (redisAvailable && redisClient) {
        try {
            if (key.includes('*')) {
                const keys = await redisClient.keys(key);
                if (keys.length)
                    await redisClient.del(keys);
            }
            else {
                await redisClient.del(key);
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
    if (redisAvailable && redisClient) {
        try {
            await redisClient.flushDb();
        }
        catch { }
    }
}
//# sourceMappingURL=cache.service.js.map