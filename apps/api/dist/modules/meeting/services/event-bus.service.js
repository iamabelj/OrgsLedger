"use strict";
// ============================================================
// OrgsLedger API — Event Bus Service
// Redis PubSub-backed event bus for decoupled communication
// Uses shared ioredis client from infrastructure/redisClient.ts
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVENT_CHANNELS = void 0;
exports.getOrgChannel = getOrgChannel;
exports.getMeetingChannel = getMeetingChannel;
exports.publishEvent = publishEvent;
exports.subscribe = subscribe;
exports.isRedisAvailable = isRedisAvailable;
exports.publishToOrg = publishToOrg;
exports.publishToMeeting = publishToMeeting;
exports.publishToOrgAndMeeting = publishToOrgAndMeeting;
exports.subscribeToOrg = subscribeToOrg;
exports.subscribeToMeeting = subscribeToMeeting;
exports.subscribeToAllOrgs = subscribeToAllOrgs;
exports.shutdownEventBus = shutdownEventBus;
const logger_1 = require("../../../logger");
const redisClient_1 = require("../../../infrastructure/redisClient");
// ── Channel Constants ───────────────────────────────────────
exports.EVENT_CHANNELS = {
    /** @deprecated Use organization-scoped channels instead */
    MEETING_EVENTS: 'meeting.events',
};
/**
 * Get organization-scoped channel name.
 * Isolates traffic to prevent large orgs from flooding the system.
 */
function getOrgChannel(organizationId) {
    return `org:${organizationId}:events`;
}
/**
 * Get meeting-specific channel name.
 */
function getMeetingChannel(meetingId) {
    return `meeting:${meetingId}:events`;
}
// ── In-Memory Fallback (for development without Redis) ──────
const localSubscribers = new Map();
// ── Redis Clients (shared ioredis instances) ────────────────
let publisherClient = null;
let subscriberClient = null;
let redisAvailable = false;
let initializationPromise = null;
// Track registered message handlers by channel for cleanup
const channelHandlers = new Map();
/**
 * Initialize Redis pub/sub clients using shared ioredis manager
 */
async function initializeRedis() {
    if (initializationPromise)
        return initializationPromise;
    initializationPromise = (async () => {
        try {
            // Get dedicated pub/sub clients from the shared manager
            publisherClient = await redisClient_1.redisClientManager.getPublisher();
            subscriberClient = await redisClient_1.redisClientManager.getSubscriber();
            // Set up message handler for the subscriber
            subscriberClient.on('message', (channel, message) => {
                const handlers = channelHandlers.get(channel);
                if (!handlers)
                    return;
                try {
                    const payload = JSON.parse(message);
                    for (const handler of handlers) {
                        try {
                            const result = handler(payload);
                            if (result && typeof result.catch === 'function') {
                                result.catch((err) => {
                                    logger_1.logger.error('[EVENT_BUS] Handler error', {
                                        channel,
                                        error: err.message,
                                    });
                                });
                            }
                        }
                        catch (err) {
                            logger_1.logger.error('[EVENT_BUS] Sync handler error', {
                                channel,
                                error: err.message,
                            });
                        }
                    }
                }
                catch (err) {
                    logger_1.logger.warn('[EVENT_BUS] Failed to parse message', {
                        channel,
                        error: err.message,
                    });
                }
            });
            redisAvailable = true;
            logger_1.logger.info('[EVENT_BUS] Using shared ioredis pub/sub clients');
        }
        catch (err) {
            logger_1.logger.info('[EVENT_BUS] Redis not available, using in-memory event bus', {
                error: err.message,
            });
            redisAvailable = false;
        }
    })();
    return initializationPromise;
}
// Initialize on module load (non-blocking)
initializeRedis().catch(() => { });
// ── Event Bus Interface ─────────────────────────────────────
/**
 * Publish an event to a channel
 * Uses Redis pub/sub if available, falls back to in-memory
 */
async function publishEvent(channel, payload) {
    const message = JSON.stringify(payload);
    if (redisAvailable && publisherClient) {
        try {
            await publisherClient.publish(channel, message);
            logger_1.logger.debug('[EVENT_BUS] Published event', {
                channel,
                type: payload.type,
            });
            return;
        }
        catch (err) {
            logger_1.logger.warn('[EVENT_BUS] Redis publish failed, using local fallback', {
                error: err.message,
            });
        }
    }
    // Local fallback - emit to in-memory subscribers
    const handlers = localSubscribers.get(channel);
    if (handlers) {
        for (const handler of handlers) {
            try {
                await handler(payload);
            }
            catch (err) {
                logger_1.logger.error('[EVENT_BUS] Handler error', {
                    channel,
                    error: err.message,
                });
            }
        }
    }
}
/**
 * Subscribe to a channel
 * Returns unsubscribe function
 */
async function subscribe(channel, handler) {
    // Ensure Redis is initialized
    await initializeRedis();
    if (redisAvailable && subscriberClient) {
        try {
            // Track the handler for this channel
            if (!channelHandlers.has(channel)) {
                channelHandlers.set(channel, new Set());
                // Subscribe to the channel (ioredis style)
                await subscriberClient.subscribe(channel);
                logger_1.logger.info('[EVENT_BUS] Subscribed to channel', { channel });
            }
            channelHandlers.get(channel).add(handler);
            return () => {
                const handlers = channelHandlers.get(channel);
                if (handlers) {
                    handlers.delete(handler);
                    // If no more handlers, unsubscribe from the channel
                    if (handlers.size === 0 && subscriberClient) {
                        channelHandlers.delete(channel);
                        subscriberClient.unsubscribe(channel).catch(() => { });
                    }
                }
            };
        }
        catch (err) {
            logger_1.logger.warn('[EVENT_BUS] Redis subscribe failed, using local fallback', {
                error: err.message,
            });
        }
    }
    // Local fallback
    if (!localSubscribers.has(channel)) {
        localSubscribers.set(channel, new Set());
    }
    localSubscribers.get(channel).add(handler);
    logger_1.logger.info('[EVENT_BUS] Subscribed to channel (local)', { channel });
    return () => {
        localSubscribers.get(channel)?.delete(handler);
    };
}
/**
 * Check if event bus is using Redis
 */
function isRedisAvailable() {
    return redisAvailable;
}
/**
 * Publish to organization-scoped channel.
 * Isolates traffic to prevent cross-org flooding.
 */
async function publishToOrg(organizationId, payload) {
    const channel = getOrgChannel(organizationId);
    return publishEvent(channel, payload);
}
/**
 * Publish to meeting-specific channel.
 */
async function publishToMeeting(meetingId, payload) {
    const channel = getMeetingChannel(meetingId);
    return publishEvent(channel, payload);
}
/**
 * Publish to both organization and meeting channels.
 * Use this for events that need to reach both scopes.
 */
async function publishToOrgAndMeeting(organizationId, meetingId, payload) {
    await Promise.all([
        publishToOrg(organizationId, payload),
        publishToMeeting(meetingId, payload),
    ]);
}
/**
 * Subscribe to organization-scoped channel.
 */
async function subscribeToOrg(organizationId, handler) {
    const channel = getOrgChannel(organizationId);
    return subscribe(channel, handler);
}
/**
 * Subscribe to meeting-specific channel.
 */
async function subscribeToMeeting(meetingId, handler) {
    const channel = getMeetingChannel(meetingId);
    return subscribe(channel, handler);
}
/**
 * Subscribe to multiple organization channels using pattern.
 * Note: Requires Redis pattern subscription.
 */
async function subscribeToAllOrgs(handler) {
    // Ensure Redis is initialized
    await initializeRedis();
    if (redisAvailable && subscriberClient) {
        try {
            // Pattern subscription for all org channels
            const pattern = 'org:*:events';
            // ioredis uses 'pmessage' event for pattern subscriptions
            const pmessageHandler = (_pattern, channel, message) => {
                try {
                    const payload = JSON.parse(message);
                    const result = handler(payload);
                    if (result && typeof result.catch === 'function') {
                        result.catch((err) => {
                            logger_1.logger.error('[EVENT_BUS] Handler error', {
                                channel,
                                error: err.message,
                            });
                        });
                    }
                }
                catch (err) {
                    logger_1.logger.warn('[EVENT_BUS] Failed to parse message', {
                        channel,
                        error: err.message,
                    });
                }
            };
            subscriberClient.on('pmessage', pmessageHandler);
            await subscriberClient.psubscribe(pattern);
            logger_1.logger.info('[EVENT_BUS] Subscribed to pattern', { pattern });
            return () => {
                subscriberClient.punsubscribe(pattern).catch(() => { });
                subscriberClient.off('pmessage', pmessageHandler);
            };
        }
        catch (err) {
            logger_1.logger.warn('[EVENT_BUS] Redis pattern subscribe failed', {
                error: err.message,
            });
            throw err;
        }
    }
    throw new Error('Redis not available for pattern subscription');
}
/**
 * Gracefully shutdown event bus connections
 */
async function shutdownEventBus() {
    try {
        if (subscriberClient) {
            await subscriberClient.quit();
        }
        if (publisherClient) {
            await publisherClient.quit();
        }
        logger_1.logger.info('[EVENT_BUS] Shutdown complete');
    }
    catch (err) {
        logger_1.logger.warn('[EVENT_BUS] Shutdown error', { error: err.message });
    }
}
//# sourceMappingURL=event-bus.service.js.map