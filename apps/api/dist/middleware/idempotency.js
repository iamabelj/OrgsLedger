"use strict";
// ============================================================
// OrgsLedger API — Idempotency Key Middleware
// Prevents duplicate side-effects from retried POST/PUT/DELETE
// requests. Clients send `Idempotency-Key: <unique-key>` header.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.idempotencyMiddleware = idempotencyMiddleware;
exports.clearIdempotencyStore = clearIdempotencyStore;
const logger_1 = require("../logger");
const cache_service_1 = require("../services/cache.service");
const IDEMPOTENCY_STORE = new Map();
const IDEMPOTENCY_TTL = 24 * 60 * 60 * 1000; // 24 hours
const IDEMPOTENCY_MAX = 10_000; // Max entries before eviction
const IN_PROGRESS = new Set(); // Track in-flight requests
// Periodic cleanup (every 5 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of IDEMPOTENCY_STORE.entries()) {
        if (now - entry.createdAt > IDEMPOTENCY_TTL) {
            IDEMPOTENCY_STORE.delete(key);
        }
    }
}, 5 * 60 * 1000).unref();
/**
 * Idempotency middleware for mutating endpoints.
 * Usage: app.use('/api/payments', idempotencyMiddleware);
 *
 * Behaviour:
 * - Only applies to POST, PUT, PATCH, DELETE methods
 * - If no Idempotency-Key header is present, request passes through
 * - If key was seen before and completed, replays the stored response
 * - If key is currently in-flight, returns 409 Conflict
 */
async function idempotencyMiddleware(req, res, next) {
    // Only apply to mutating methods
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        return next();
    }
    const idempotencyKey = req.headers['idempotency-key'];
    if (!idempotencyKey) {
        return next(); // No key provided — proceed normally
    }
    // Validate key format (UUID or reasonable string)
    if (idempotencyKey.length > 128) {
        res.status(400).json({ success: false, error: 'Idempotency-Key must be 128 characters or less' });
        return;
    }
    // Namespace by user to prevent cross-user collisions
    const userId = req.user?.userId || 'anonymous';
    const storeKey = `${userId}:${idempotencyKey}`;
    // Check if we have a stored response (Redis first, then in-memory)
    if ((0, cache_service_1.isRedisAvailable)()) {
        try {
            const redisEntry = await (0, cache_service_1.cacheGet)(`idempotency:${storeKey}`);
            if (redisEntry) {
                const parsed = JSON.parse(redisEntry);
                logger_1.logger.debug('[IDEMPOTENCY] Replaying from Redis', { key: idempotencyKey });
                res.setHeader('X-Idempotency-Replayed', 'true');
                res.status(parsed.status).json(parsed.body);
                return;
            }
        }
        catch { /* fall through to in-memory */ }
    }
    const existing = IDEMPOTENCY_STORE.get(storeKey);
    if (existing) {
        logger_1.logger.debug('[IDEMPOTENCY] Replaying stored response', { key: idempotencyKey, method: req.method, path: req.path });
        res.setHeader('X-Idempotency-Replayed', 'true');
        res.status(existing.status).json(existing.body);
        return;
    }
    // Check for in-flight request with same key
    if (IN_PROGRESS.has(storeKey)) {
        res.status(409).json({ success: false, error: 'A request with this idempotency key is already in progress' });
        return;
    }
    // Mark as in-flight
    IN_PROGRESS.add(storeKey);
    // Intercept res.json to capture the response
    const originalJson = res.json.bind(res);
    res.json = function (body) {
        IN_PROGRESS.delete(storeKey);
        // Only store successful or client-error responses (not 5xx)
        if (res.statusCode < 500) {
            // Evict oldest if at capacity
            if (IDEMPOTENCY_STORE.size >= IDEMPOTENCY_MAX) {
                const firstKey = IDEMPOTENCY_STORE.keys().next().value;
                if (firstKey)
                    IDEMPOTENCY_STORE.delete(firstKey);
            }
            IDEMPOTENCY_STORE.set(storeKey, {
                status: res.statusCode,
                body,
                createdAt: Date.now(),
            });
            // Also persist to Redis for multi-instance support
            if ((0, cache_service_1.isRedisAvailable)()) {
                (0, cache_service_1.cacheSet)(`idempotency:${storeKey}`, JSON.stringify({ status: res.statusCode, body }), 86400).catch(() => { });
            }
        }
        return originalJson(body);
    };
    // Clean up in-progress on response finish (safety net)
    res.on('finish', () => {
        IN_PROGRESS.delete(storeKey);
    });
    next();
}
/** Clear the idempotency store (used in tests) */
function clearIdempotencyStore() {
    IDEMPOTENCY_STORE.clear();
    IN_PROGRESS.clear();
}
//# sourceMappingURL=idempotency.js.map