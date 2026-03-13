"use strict";
// ============================================================
// OrgsLedger API — Meeting Rate Limiter
// Prevents single meetings from flooding queues
// ============================================================
//
// Architecture:
//   - Redis-based sliding window rate limiting
//   - Per-meeting rate limits for different job types
//   - Configurable limits via environment variables
//   - Prometheus metrics for monitoring rate limit hits
//   - Support for both drop and delay strategies
//
// Rate Limits:
//   - Transcript events: 30/sec/meeting
//   - Translation jobs: 10/sec/meeting
//   - Minutes generation: 1/min/meeting
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
exports.meetingRateLimiter = exports.rateLimitExceededCounter = exports.rateLimitCurrentGauge = exports.rateLimitHitsCounter = void 0;
exports.initializeMeetingRateLimiter = initializeMeetingRateLimiter;
exports.checkMeetingRateLimit = checkMeetingRateLimit;
exports.consumeMeetingRateLimit = consumeMeetingRateLimit;
exports.getMeetingRateLimitStats = getMeetingRateLimitStats;
exports.resetMeetingRateLimits = resetMeetingRateLimits;
const client = __importStar(require("prom-client"));
const logger_1 = require("../logger");
const redisClient_1 = require("../infrastructure/redisClient");
const RATE_LIMITS = {
    transcript: {
        maxEvents: parseInt(process.env.RATE_LIMIT_TRANSCRIPT_MAX || '30', 10),
        windowSeconds: parseInt(process.env.RATE_LIMIT_TRANSCRIPT_WINDOW || '1', 10),
        action: 'drop',
    },
    translation: {
        maxEvents: parseInt(process.env.RATE_LIMIT_TRANSLATION_MAX || '10', 10),
        windowSeconds: parseInt(process.env.RATE_LIMIT_TRANSLATION_WINDOW || '1', 10),
        action: 'drop',
    },
    minutes: {
        maxEvents: parseInt(process.env.RATE_LIMIT_MINUTES_MAX || '1', 10),
        windowSeconds: parseInt(process.env.RATE_LIMIT_MINUTES_WINDOW || '60', 10),
        action: 'drop',
    },
    broadcast: {
        maxEvents: parseInt(process.env.RATE_LIMIT_BROADCAST_MAX || '50', 10),
        windowSeconds: parseInt(process.env.RATE_LIMIT_BROADCAST_WINDOW || '1', 10),
        action: 'delay',
        maxDelayMs: 5000,
    },
};
// ── Prometheus Metrics ──────────────────────────────────────
const PREFIX = 'orgsledger_';
exports.rateLimitHitsCounter = new client.Counter({
    name: `${PREFIX}meeting_rate_limit_hits_total`,
    help: 'Number of rate limit hits',
    labelNames: ['job_type', 'action'],
});
exports.rateLimitCurrentGauge = new client.Gauge({
    name: `${PREFIX}meeting_rate_limit_current`,
    help: 'Current rate for a job type',
    labelNames: ['job_type'],
});
exports.rateLimitExceededCounter = new client.Counter({
    name: `${PREFIX}meeting_rate_limit_exceeded_total`,
    help: 'Total number of rate limit exceeded events',
    labelNames: ['job_type'],
});
// ── Redis Keys ──────────────────────────────────────────────
function getRateLimitKey(meetingId, jobType) {
    return `meeting:${meetingId}:${jobType}_rate`;
}
// ── Meeting Rate Limiter Class ──────────────────────────────
class MeetingRateLimiter {
    redis = null;
    initialized = false;
    /**
     * Initialize Redis connection for rate limiting.
     */
    async initialize() {
        if (this.initialized)
            return;
        try {
            this.redis = (0, redisClient_1.createBullMQConnection)();
            this.initialized = true;
            logger_1.logger.info('[RATE_LIMITER] Initialized', {
                limits: Object.entries(RATE_LIMITS).map(([type, config]) => ({
                    type,
                    max: config.maxEvents,
                    window: config.windowSeconds,
                    action: config.action,
                })),
            });
        }
        catch (err) {
            logger_1.logger.error('[RATE_LIMITER] Failed to initialize', {
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    }
    /**
     * Check if a job can be processed for a meeting.
     * Uses sliding window rate limiting with Redis INCR + EXPIRE.
     */
    async checkRateLimit(meetingId, jobType) {
        const config = RATE_LIMITS[jobType];
        if (!config) {
            return {
                allowed: true,
                currentCount: 0,
                limit: Infinity,
                windowSeconds: 0,
                action: 'allow',
            };
        }
        const key = getRateLimitKey(meetingId, jobType);
        const { maxEvents, windowSeconds, action, maxDelayMs } = config;
        try {
            // Use Redis pipeline for atomic increment + expiry
            const redis = this.getRedis();
            const now = Date.now();
            const windowKey = `${key}:${Math.floor(now / (windowSeconds * 1000))}`;
            // Increment counter
            const count = await redis.incr(windowKey);
            // Set expiry on first increment
            if (count === 1) {
                await redis.expire(windowKey, windowSeconds + 1);
            }
            // Check if within limit
            if (count <= maxEvents) {
                return {
                    allowed: true,
                    currentCount: count,
                    limit: maxEvents,
                    windowSeconds,
                    action: 'allow',
                };
            }
            // Rate limit exceeded
            logger_1.logger.warn('[RATE_LIMITER] MEETING_RATE_LIMIT_EXCEEDED', {
                meetingId,
                jobType,
                currentCount: count,
                limit: maxEvents,
                windowSeconds,
                action,
            });
            exports.rateLimitHitsCounter.inc({ job_type: jobType, action });
            exports.rateLimitExceededCounter.inc({ job_type: jobType });
            if (action === 'delay' && maxDelayMs) {
                // Calculate delay based on how far over the limit we are
                const overage = count - maxEvents;
                const delayMs = Math.min(overage * 100, maxDelayMs);
                return {
                    allowed: true,
                    currentCount: count,
                    limit: maxEvents,
                    windowSeconds,
                    action: 'delay',
                    delayMs,
                    retryAfterMs: delayMs,
                };
            }
            // Drop action
            const retryAfterMs = Math.ceil((windowSeconds * 1000) - (now % (windowSeconds * 1000)));
            return {
                allowed: false,
                currentCount: count,
                limit: maxEvents,
                windowSeconds,
                action: 'drop',
                retryAfterMs,
            };
        }
        catch (err) {
            logger_1.logger.error('[RATE_LIMITER] Check failed, allowing by default', {
                meetingId,
                jobType,
                error: err instanceof Error ? err.message : String(err),
            });
            // Fail open - allow the request if Redis is down
            return {
                allowed: true,
                currentCount: 0,
                limit: maxEvents,
                windowSeconds,
                action: 'allow',
            };
        }
    }
    /**
     * Check and consume a rate limit token.
     * Returns true if allowed, false if rate limited.
     */
    async consume(meetingId, jobType) {
        const result = await this.checkRateLimit(meetingId, jobType);
        return result.allowed;
    }
    /**
     * Get current rate limit stats for a meeting.
     */
    async getStats(meetingId) {
        const stats = {
            meetingId,
            transcript: { current: 0, limit: RATE_LIMITS.transcript.maxEvents, windowSeconds: RATE_LIMITS.transcript.windowSeconds },
            translation: { current: 0, limit: RATE_LIMITS.translation.maxEvents, windowSeconds: RATE_LIMITS.translation.windowSeconds },
            minutes: { current: 0, limit: RATE_LIMITS.minutes.maxEvents, windowSeconds: RATE_LIMITS.minutes.windowSeconds },
            broadcast: { current: 0, limit: RATE_LIMITS.broadcast.maxEvents, windowSeconds: RATE_LIMITS.broadcast.windowSeconds },
        };
        try {
            const redis = this.getRedis();
            const now = Date.now();
            for (const jobType of ['transcript', 'translation', 'minutes', 'broadcast']) {
                const config = RATE_LIMITS[jobType];
                const windowKey = `${getRateLimitKey(meetingId, jobType)}:${Math.floor(now / (config.windowSeconds * 1000))}`;
                const count = await redis.get(windowKey);
                stats[jobType].current = count ? parseInt(count, 10) : 0;
            }
        }
        catch (err) {
            logger_1.logger.error('[RATE_LIMITER] Failed to get stats', {
                meetingId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
        return stats;
    }
    /**
     * Reset rate limit counters for a meeting.
     * Useful when a meeting ends.
     */
    async reset(meetingId) {
        try {
            const redis = this.getRedis();
            const pattern = `meeting:${meetingId}:*_rate:*`;
            // Use SCAN to find and delete all rate limit keys for this meeting
            let cursor = '0';
            do {
                const [newCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
                cursor = newCursor;
                if (keys.length > 0) {
                    await redis.del(...keys);
                }
            } while (cursor !== '0');
            logger_1.logger.debug('[RATE_LIMITER] Reset rate limits', { meetingId });
        }
        catch (err) {
            logger_1.logger.error('[RATE_LIMITER] Failed to reset', {
                meetingId,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    /**
     * Get Redis connection, initializing if needed.
     */
    getRedis() {
        if (!this.redis) {
            throw new Error('MeetingRateLimiter not initialized');
        }
        return this.redis;
    }
    /**
     * Get configuration for a job type.
     */
    getConfig(jobType) {
        return RATE_LIMITS[jobType];
    }
}
// ── Singleton ───────────────────────────────────────────────
exports.meetingRateLimiter = new MeetingRateLimiter();
// ── Exports ─────────────────────────────────────────────────
async function initializeMeetingRateLimiter() {
    await exports.meetingRateLimiter.initialize();
}
async function checkMeetingRateLimit(meetingId, jobType) {
    return exports.meetingRateLimiter.checkRateLimit(meetingId, jobType);
}
async function consumeMeetingRateLimit(meetingId, jobType) {
    return exports.meetingRateLimiter.consume(meetingId, jobType);
}
async function getMeetingRateLimitStats(meetingId) {
    return exports.meetingRateLimiter.getStats(meetingId);
}
async function resetMeetingRateLimits(meetingId) {
    return exports.meetingRateLimiter.reset(meetingId);
}
//# sourceMappingURL=meeting-rate-limiter.js.map