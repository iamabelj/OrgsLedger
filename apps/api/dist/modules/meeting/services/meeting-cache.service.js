"use strict";
// ============================================================
// OrgsLedger API — Meeting Cache Service
// Redis-backed active meeting state management
// Uses shared ioredis client from infrastructure/redisClient.ts
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.setActiveMeetingState = setActiveMeetingState;
exports.getActiveMeetingState = getActiveMeetingState;
exports.removeActiveMeetingState = removeActiveMeetingState;
exports.updateMeetingParticipants = updateMeetingParticipants;
exports.getOrgActiveMeetings = getOrgActiveMeetings;
exports.getActiveMeetingsCount = getActiveMeetingsCount;
exports.isMeetingActive = isMeetingActive;
exports.touchMeeting = touchMeeting;
const logger_1 = require("../../../logger");
const redisClient_1 = require("../../../infrastructure/redisClient");
// ── Cache Keys ──────────────────────────────────────────────
const CACHE_PREFIX = 'meeting:';
const ACTIVE_MEETINGS_SET = 'meetings:active';
const ORG_MEETINGS_PREFIX = 'meetings:org:';
function meetingKey(meetingId) {
    return `${CACHE_PREFIX}${meetingId}`;
}
function orgMeetingsKey(orgId) {
    return `${ORG_MEETINGS_PREFIX}${orgId}`;
}
const memoryStore = new Map();
const memorySets = new Map();
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
            logger_1.logger.info('[MEETING_CACHE] Using shared ioredis client');
            return cachedClient;
        }
        catch (err) {
            logger_1.logger.info('[MEETING_CACHE] Redis not available, using in-memory cache', {
                error: err.message,
            });
            redisAvailable = false;
            return null;
        }
    })();
    return initializationPromise;
}
// Initialize on module load (non-blocking)
getIoredisClient().catch(() => { });
// ── Cache TTL Configuration ─────────────────────────────────
// Active meeting state expires after 12 hours (prevents memory leaks from abandoned meetings)
const MEETING_STATE_TTL = 12 * 60 * 60; // 12 hours in seconds (43200)
// ── Active Meeting State Operations ─────────────────────────
/**
 * Store active meeting state in Redis
 */
async function setActiveMeetingState(state) {
    const key = meetingKey(state.meetingId);
    const value = JSON.stringify(state);
    const client = await getIoredisClient();
    if (redisAvailable && client) {
        try {
            // ioredis uses set with EX option
            await client.set(key, value, 'EX', MEETING_STATE_TTL);
            // Add to active meetings set
            await client.sadd(ACTIVE_MEETINGS_SET, state.meetingId);
            // Add to organization's active meetings set
            await client.sadd(orgMeetingsKey(state.organizationId), state.meetingId);
            return;
        }
        catch (err) {
            logger_1.logger.warn('[MEETING_CACHE] Redis write failed, using memory', { error: err.message });
        }
    }
    // Fallback to memory
    memoryStore.set(key, {
        value: state,
        expiresAt: Date.now() + MEETING_STATE_TTL * 1000,
    });
    // Track in sets
    if (!memorySets.has(ACTIVE_MEETINGS_SET)) {
        memorySets.set(ACTIVE_MEETINGS_SET, new Set());
    }
    memorySets.get(ACTIVE_MEETINGS_SET).add(state.meetingId);
    const orgKey = orgMeetingsKey(state.organizationId);
    if (!memorySets.has(orgKey)) {
        memorySets.set(orgKey, new Set());
    }
    memorySets.get(orgKey).add(state.meetingId);
}
/**
 * Get active meeting state from Redis
 */
async function getActiveMeetingState(meetingId) {
    const key = meetingKey(meetingId);
    const client = await getIoredisClient();
    if (redisAvailable && client) {
        try {
            const value = await client.get(key);
            return value ? JSON.parse(value) : null;
        }
        catch {
            // Fall through to memory
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
 * Remove active meeting state from Redis
 */
async function removeActiveMeetingState(meetingId, organizationId) {
    const key = meetingKey(meetingId);
    const client = await getIoredisClient();
    if (redisAvailable && client) {
        try {
            await client.del(key);
            await client.srem(ACTIVE_MEETINGS_SET, meetingId);
            await client.srem(orgMeetingsKey(organizationId), meetingId);
            return;
        }
        catch (err) {
            logger_1.logger.warn('[MEETING_CACHE] Redis delete failed', { error: err.message });
        }
    }
    // Fallback
    memoryStore.delete(key);
    memorySets.get(ACTIVE_MEETINGS_SET)?.delete(meetingId);
    memorySets.get(orgMeetingsKey(organizationId))?.delete(meetingId);
}
/**
 * Update participant list in active meeting state
 */
async function updateMeetingParticipants(meetingId, participants) {
    const state = await getActiveMeetingState(meetingId);
    if (!state)
        return;
    state.participants = participants;
    state.lastActivityAt = new Date().toISOString();
    await setActiveMeetingState(state);
}
/**
 * Get all active meeting IDs for an organization
 */
async function getOrgActiveMeetings(organizationId) {
    const key = orgMeetingsKey(organizationId);
    const client = await getIoredisClient();
    if (redisAvailable && client) {
        try {
            return await client.smembers(key);
        }
        catch {
            // Fall through
        }
    }
    const set = memorySets.get(key);
    return set ? Array.from(set) : [];
}
/**
 * Get count of active meetings globally
 */
async function getActiveMeetingsCount() {
    const client = await getIoredisClient();
    if (redisAvailable && client) {
        try {
            return await client.scard(ACTIVE_MEETINGS_SET);
        }
        catch {
            // Fall through
        }
    }
    return memorySets.get(ACTIVE_MEETINGS_SET)?.size ?? 0;
}
/**
 * Check if a meeting is currently active in cache
 */
async function isMeetingActive(meetingId) {
    const client = await getIoredisClient();
    if (redisAvailable && client) {
        try {
            const result = await client.sismember(ACTIVE_MEETINGS_SET, meetingId);
            return result === 1;
        }
        catch {
            // Fall through
        }
    }
    return memorySets.get(ACTIVE_MEETINGS_SET)?.has(meetingId) ?? false;
}
/**
 * Touch meeting to update last activity timestamp
 */
async function touchMeeting(meetingId) {
    const state = await getActiveMeetingState(meetingId);
    if (!state)
        return;
    state.lastActivityAt = new Date().toISOString();
    await setActiveMeetingState(state);
}
//# sourceMappingURL=meeting-cache.service.js.map