"use strict";
// ============================================================
// OrgsLedger API — Global Rate Governor
// System-wide rate limiting using Redis sliding window
// ============================================================
//
// Limits:
//   MEETING_CREATION_LIMIT = 1000 per minute
//   TRANSCRIPT_EVENTS_LIMIT = 50000 per minute
//   AI_REQUEST_LIMIT = 2000 per minute
//
// Implementation:
//   Redis sliding window counters with INCR + EXPIRE
//
// Returns:
//   HTTP 429 when limit exceeded
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
exports.globalRateGovernor = exports.globalRateLimitAllowedCounter = exports.globalRateLimitCurrentGauge = exports.globalRateLimitHitsCounter = void 0;
exports.createMeetingCreationRateLimitMiddleware = createMeetingCreationRateLimitMiddleware;
exports.createAIRateLimitMiddleware = createAIRateLimitMiddleware;
exports.startRateGovernor = startRateGovernor;
exports.stopRateGovernor = stopRateGovernor;
exports.checkMeetingCreationLimit = checkMeetingCreationLimit;
exports.checkTranscriptRate = checkTranscriptRate;
exports.checkAIRate = checkAIRate;
exports.getRateGovernorStats = getRateGovernorStats;
const client = __importStar(require("prom-client"));
const redisClient_1 = require("../infrastructure/redisClient");
const logger_1 = require("../logger");
const DEFAULT_CONFIG = {
    meetingCreationLimit: parseInt(process.env.RATE_GOVERNOR_MEETING_LIMIT || '1000', 10),
    transcriptEventsLimit: parseInt(process.env.RATE_GOVERNOR_TRANSCRIPT_LIMIT || '50000', 10),
    aiRequestLimit: parseInt(process.env.RATE_GOVERNOR_AI_LIMIT || '2000', 10),
    windowSizeSeconds: parseInt(process.env.RATE_GOVERNOR_WINDOW_SEC || '60', 10),
    enabled: process.env.RATE_GOVERNOR_ENABLED !== 'false',
};
// ── Prometheus Metrics ──────────────────────────────────────
const PREFIX = 'orgsledger_global_rate_limit_';
exports.globalRateLimitHitsCounter = new client.Counter({
    name: `${PREFIX}hits_total`,
    help: 'Total requests blocked by global rate limiter',
    labelNames: ['type'],
});
exports.globalRateLimitCurrentGauge = new client.Gauge({
    name: `${PREFIX}current`,
    help: 'Current rate for each limit type',
    labelNames: ['type'],
});
exports.globalRateLimitAllowedCounter = new client.Counter({
    name: `${PREFIX}allowed_total`,
    help: 'Total requests allowed through rate limiter',
    labelNames: ['type'],
});
// ── Redis Keys ──────────────────────────────────────────────
const REDIS_KEY_PREFIX = 'rate_governor';
function getRedisKey(type, windowId) {
    return `${REDIS_KEY_PREFIX}:${type}:${windowId}`;
}
// ── Lua Script for Atomic Increment with Limit Check ────────
const CHECK_AND_INCREMENT_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local increment = tonumber(ARGV[3]) or 1

local current = redis.call('INCR', key)

-- Set TTL on first increment
if current == increment then
  redis.call('EXPIRE', key, ttl)
end

if current > limit then
  -- Exceeded limit, decrement back
  redis.call('DECR', key)
  return {0, current - 1, limit}
end

return {1, current, limit}
`;
// ── Global Rate Governor Class ──────────────────────────────
class GlobalRateGovernor {
    config;
    redis = null;
    scriptSha = null;
    isRunning = false;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Initialize the rate governor.
     */
    async start() {
        if (this.isRunning) {
            logger_1.logger.warn('[RATE_GOVERNOR] Already running');
            return;
        }
        if (!this.config.enabled) {
            logger_1.logger.info('[RATE_GOVERNOR] Disabled via configuration');
            return;
        }
        try {
            this.redis = (0, redisClient_1.createBullMQConnection)();
            // Load Lua script
            this.scriptSha = await this.redis.script('LOAD', CHECK_AND_INCREMENT_SCRIPT);
            this.isRunning = true;
            logger_1.logger.info('[RATE_GOVERNOR] Started', {
                meetingCreationLimit: this.config.meetingCreationLimit,
                transcriptEventsLimit: this.config.transcriptEventsLimit,
                aiRequestLimit: this.config.aiRequestLimit,
                windowSizeSeconds: this.config.windowSizeSeconds,
            });
        }
        catch (err) {
            logger_1.logger.error('[RATE_GOVERNOR] Failed to start', {
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    }
    /**
     * Stop the rate governor.
     */
    stop() {
        this.isRunning = false;
        logger_1.logger.info('[RATE_GOVERNOR] Stopped');
    }
    /**
     * Get current window ID based on time.
     */
    getCurrentWindowId() {
        return Math.floor(Date.now() / (this.config.windowSizeSeconds * 1000));
    }
    /**
     * Get seconds until window reset.
     */
    getResetInSeconds() {
        const windowMs = this.config.windowSizeSeconds * 1000;
        const currentMs = Date.now();
        const windowStart = Math.floor(currentMs / windowMs) * windowMs;
        const windowEnd = windowStart + windowMs;
        return Math.ceil((windowEnd - currentMs) / 1000);
    }
    /**
     * Check rate limit using Lua script.
     */
    async checkLimit(type, limit, increment = 1) {
        if (!this.redis || !this.scriptSha || !this.isRunning) {
            // Not running, allow everything
            return {
                allowed: true,
                current: 0,
                limit,
                remaining: limit,
                resetInSeconds: this.config.windowSizeSeconds,
            };
        }
        const windowId = this.getCurrentWindowId();
        const key = getRedisKey(type, windowId);
        const ttl = this.config.windowSizeSeconds + 1; // Extra second for safety
        try {
            const result = await this.redis.evalsha(this.scriptSha, 1, key, limit.toString(), ttl.toString(), increment.toString());
            const [allowed, current, limitVal] = result;
            const remaining = Math.max(0, limitVal - current);
            const resetInSeconds = this.getResetInSeconds();
            // Update metrics
            exports.globalRateLimitCurrentGauge.set({ type }, current);
            if (allowed) {
                exports.globalRateLimitAllowedCounter.inc({ type });
            }
            else {
                exports.globalRateLimitHitsCounter.inc({ type });
                logger_1.logger.warn(`[RATE_GOVERNOR] Rate limit exceeded for ${type}`, {
                    current,
                    limit: limitVal,
                });
            }
            return {
                allowed: allowed === 1,
                current,
                limit: limitVal,
                remaining,
                resetInSeconds,
            };
        }
        catch (err) {
            logger_1.logger.error('[RATE_GOVERNOR] Check failed, allowing request', {
                type,
                error: err instanceof Error ? err.message : String(err),
            });
            // Fail open - allow the request
            return {
                allowed: true,
                current: 0,
                limit,
                remaining: limit,
                resetInSeconds: this.config.windowSizeSeconds,
            };
        }
    }
    /**
     * Check meeting creation rate limit.
     */
    async checkMeetingCreationLimit() {
        return this.checkLimit('meeting_creation', this.config.meetingCreationLimit);
    }
    /**
     * Check transcript events rate limit.
     */
    async checkTranscriptRate(count = 1) {
        return this.checkLimit('transcript_events', this.config.transcriptEventsLimit, count);
    }
    /**
     * Check AI requests rate limit.
     */
    async checkAIRate() {
        return this.checkLimit('ai_requests', this.config.aiRequestLimit);
    }
    /**
     * Get current stats for all limit types.
     */
    async getStats() {
        if (!this.redis || !this.isRunning) {
            return {
                meetingCreation: { allowed: true, current: 0, limit: this.config.meetingCreationLimit, remaining: this.config.meetingCreationLimit, resetInSeconds: this.config.windowSizeSeconds },
                transcriptEvents: { allowed: true, current: 0, limit: this.config.transcriptEventsLimit, remaining: this.config.transcriptEventsLimit, resetInSeconds: this.config.windowSizeSeconds },
                aiRequests: { allowed: true, current: 0, limit: this.config.aiRequestLimit, remaining: this.config.aiRequestLimit, resetInSeconds: this.config.windowSizeSeconds },
            };
        }
        const windowId = this.getCurrentWindowId();
        const resetInSeconds = this.getResetInSeconds();
        // Get current counts
        const [meetingCount, transcriptCount, aiCount] = await Promise.all([
            this.redis.get(getRedisKey('meeting_creation', windowId)),
            this.redis.get(getRedisKey('transcript_events', windowId)),
            this.redis.get(getRedisKey('ai_requests', windowId)),
        ]);
        const meetingCurrent = parseInt(meetingCount || '0', 10);
        const transcriptCurrent = parseInt(transcriptCount || '0', 10);
        const aiCurrent = parseInt(aiCount || '0', 10);
        return {
            meetingCreation: {
                allowed: meetingCurrent < this.config.meetingCreationLimit,
                current: meetingCurrent,
                limit: this.config.meetingCreationLimit,
                remaining: Math.max(0, this.config.meetingCreationLimit - meetingCurrent),
                resetInSeconds,
            },
            transcriptEvents: {
                allowed: transcriptCurrent < this.config.transcriptEventsLimit,
                current: transcriptCurrent,
                limit: this.config.transcriptEventsLimit,
                remaining: Math.max(0, this.config.transcriptEventsLimit - transcriptCurrent),
                resetInSeconds,
            },
            aiRequests: {
                allowed: aiCurrent < this.config.aiRequestLimit,
                current: aiCurrent,
                limit: this.config.aiRequestLimit,
                remaining: Math.max(0, this.config.aiRequestLimit - aiCurrent),
                resetInSeconds,
            },
        };
    }
    /**
     * Check if governor is running.
     */
    isGovernorRunning() {
        return this.isRunning;
    }
}
// ── Singleton ───────────────────────────────────────────────
exports.globalRateGovernor = new GlobalRateGovernor();
// ── Express Middleware ──────────────────────────────────────
/**
 * Create middleware for meeting creation rate limiting.
 */
function createMeetingCreationRateLimitMiddleware() {
    return async (req, res, next) => {
        try {
            const result = await exports.globalRateGovernor.checkMeetingCreationLimit();
            // Add rate limit headers
            res.setHeader('X-RateLimit-Limit', result.limit);
            res.setHeader('X-RateLimit-Remaining', result.remaining);
            res.setHeader('X-RateLimit-Reset', result.resetInSeconds);
            if (!result.allowed) {
                res.status(429).json({
                    error: 'RATE_LIMIT_EXCEEDED',
                    message: 'Meeting creation rate limit exceeded. Please try again later.',
                    limit: result.limit,
                    current: result.current,
                    retryAfter: result.resetInSeconds,
                });
                return;
            }
            next();
        }
        catch (err) {
            // Fail open
            logger_1.logger.error('[RATE_GOVERNOR] Middleware error', {
                error: err instanceof Error ? err.message : String(err),
            });
            next();
        }
    };
}
/**
 * Create middleware for AI request rate limiting.
 */
function createAIRateLimitMiddleware() {
    return async (req, res, next) => {
        try {
            const result = await exports.globalRateGovernor.checkAIRate();
            res.setHeader('X-RateLimit-Limit', result.limit);
            res.setHeader('X-RateLimit-Remaining', result.remaining);
            res.setHeader('X-RateLimit-Reset', result.resetInSeconds);
            if (!result.allowed) {
                res.status(429).json({
                    error: 'RATE_LIMIT_EXCEEDED',
                    message: 'AI request rate limit exceeded. Please try again later.',
                    limit: result.limit,
                    current: result.current,
                    retryAfter: result.resetInSeconds,
                });
                return;
            }
            next();
        }
        catch (err) {
            logger_1.logger.error('[RATE_GOVERNOR] AI middleware error', {
                error: err instanceof Error ? err.message : String(err),
            });
            next();
        }
    };
}
// ── Exports ─────────────────────────────────────────────────
async function startRateGovernor() {
    await exports.globalRateGovernor.start();
}
function stopRateGovernor() {
    exports.globalRateGovernor.stop();
}
async function checkMeetingCreationLimit() {
    return exports.globalRateGovernor.checkMeetingCreationLimit();
}
async function checkTranscriptRate(count) {
    return exports.globalRateGovernor.checkTranscriptRate(count);
}
async function checkAIRate() {
    return exports.globalRateGovernor.checkAIRate();
}
async function getRateGovernorStats() {
    return exports.globalRateGovernor.getStats();
}
//# sourceMappingURL=global-rate-governor.js.map