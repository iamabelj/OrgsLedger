// ============================================================
// OrgsLedger API — Event Bus Service
// Redis PubSub-backed event bus for decoupled communication
// Uses shared ioredis client from infrastructure/redisClient.ts
// ============================================================

import { logger } from '../../../logger';
import {
  redisClientManager,
} from '../../../infrastructure/redisClient';
import type { Redis, Cluster } from 'ioredis';

// ── Types ───────────────────────────────────────────────────
export interface EventPayload {
  type: string;
  timestamp: string;
  data: Record<string, any>;
}

export type EventHandler = (payload: EventPayload) => void | Promise<void>;

// ── Channel Constants ───────────────────────────────────────
export const EVENT_CHANNELS = {
  /** @deprecated Use organization-scoped channels instead */
  MEETING_EVENTS: 'meeting.events',
} as const;

export type EventChannel = typeof EVENT_CHANNELS[keyof typeof EVENT_CHANNELS] | string;

/**
 * Get organization-scoped channel name.
 * Isolates traffic to prevent large orgs from flooding the system.
 */
export function getOrgChannel(organizationId: string): string {
  return `org:${organizationId}:events`;
}

/**
 * Get meeting-specific channel name.
 */
export function getMeetingChannel(meetingId: string): string {
  return `meeting:${meetingId}:events`;
}

// ── In-Memory Fallback (for development without Redis) ──────
const localSubscribers = new Map<string, Set<EventHandler>>();

// ── Redis Clients (shared ioredis instances) ────────────────
let publisherClient: Redis | Cluster | null = null;
let subscriberClient: Redis | Cluster | null = null;
let redisAvailable = false;
let initializationPromise: Promise<void> | null = null;

// Track registered message handlers by channel for cleanup
const channelHandlers = new Map<string, Set<EventHandler>>();

/**
 * Initialize Redis pub/sub clients using shared ioredis manager
 */
async function initializeRedis(): Promise<void> {
  if (initializationPromise) return initializationPromise;
  
  initializationPromise = (async () => {
    try {
      // Get dedicated pub/sub clients from the shared manager
      publisherClient = await redisClientManager.getPublisher();
      subscriberClient = await redisClientManager.getSubscriber();
      
      // Set up message handler for the subscriber
      subscriberClient.on('message', (channel: string, message: string) => {
        const handlers = channelHandlers.get(channel);
        if (!handlers) return;
        
        try {
          const payload = JSON.parse(message) as EventPayload;
          for (const handler of handlers) {
            try {
              const result = handler(payload);
              if (result && typeof result.catch === 'function') {
                result.catch((err: any) => {
                  logger.error('[EVENT_BUS] Handler error', { 
                    channel, 
                    error: err.message,
                  });
                });
              }
            } catch (err: any) {
              logger.error('[EVENT_BUS] Sync handler error', { 
                channel, 
                error: err.message,
              });
            }
          }
        } catch (err: any) {
          logger.warn('[EVENT_BUS] Failed to parse message', { 
            channel, 
            error: err.message,
          });
        }
      });
      
      redisAvailable = true;
      logger.info('[EVENT_BUS] Using shared ioredis pub/sub clients');
    } catch (err: any) {
      logger.info('[EVENT_BUS] Redis not available, using in-memory event bus', {
        error: err.message,
      });
      redisAvailable = false;
    }
  })();
  
  return initializationPromise;
}

// Initialize on module load (non-blocking)
initializeRedis().catch(() => {});

// ── Event Bus Interface ─────────────────────────────────────

/**
 * Publish an event to a channel
 * Uses Redis pub/sub if available, falls back to in-memory
 */
export async function publishEvent(
  channel: EventChannel,
  payload: EventPayload
): Promise<void> {
  const message = JSON.stringify(payload);
  
  if (redisAvailable && publisherClient) {
    try {
      await publisherClient.publish(channel, message);
      logger.debug('[EVENT_BUS] Published event', { 
        channel, 
        type: payload.type,
      });
      return;
    } catch (err: any) {
      logger.warn('[EVENT_BUS] Redis publish failed, using local fallback', {
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
      } catch (err: any) {
        logger.error('[EVENT_BUS] Handler error', { 
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
export async function subscribe(
  channel: EventChannel,
  handler: EventHandler
): Promise<() => void> {
  // Ensure Redis is initialized
  await initializeRedis();
  
  if (redisAvailable && subscriberClient) {
    try {
      // Track the handler for this channel
      if (!channelHandlers.has(channel)) {
        channelHandlers.set(channel, new Set());
        // Subscribe to the channel (ioredis style)
        await subscriberClient.subscribe(channel);
        logger.info('[EVENT_BUS] Subscribed to channel', { channel });
      }
      channelHandlers.get(channel)!.add(handler);
      
      return () => {
        const handlers = channelHandlers.get(channel);
        if (handlers) {
          handlers.delete(handler);
          // If no more handlers, unsubscribe from the channel
          if (handlers.size === 0 && subscriberClient) {
            channelHandlers.delete(channel);
            subscriberClient.unsubscribe(channel).catch(() => {});
          }
        }
      };
    } catch (err: any) {
      logger.warn('[EVENT_BUS] Redis subscribe failed, using local fallback', {
        error: err.message,
      });
    }
  }
  
  // Local fallback
  if (!localSubscribers.has(channel)) {
    localSubscribers.set(channel, new Set());
  }
  localSubscribers.get(channel)!.add(handler);
  
  logger.info('[EVENT_BUS] Subscribed to channel (local)', { channel });
  
  return () => {
    localSubscribers.get(channel)?.delete(handler);
  };
}

/**
 * Check if event bus is using Redis
 */
export function isRedisAvailable(): boolean {
  return redisAvailable;
}

/**
 * Publish to organization-scoped channel.
 * Isolates traffic to prevent cross-org flooding.
 */
export async function publishToOrg(
  organizationId: string,
  payload: EventPayload
): Promise<void> {
  const channel = getOrgChannel(organizationId);
  return publishEvent(channel as EventChannel, payload);
}

/**
 * Publish to meeting-specific channel.
 */
export async function publishToMeeting(
  meetingId: string,
  payload: EventPayload
): Promise<void> {
  const channel = getMeetingChannel(meetingId);
  return publishEvent(channel as EventChannel, payload);
}

/**
 * Publish to both organization and meeting channels.
 * Use this for events that need to reach both scopes.
 */
export async function publishToOrgAndMeeting(
  organizationId: string,
  meetingId: string,
  payload: EventPayload
): Promise<void> {
  await Promise.all([
    publishToOrg(organizationId, payload),
    publishToMeeting(meetingId, payload),
  ]);
}

/**
 * Subscribe to organization-scoped channel.
 */
export async function subscribeToOrg(
  organizationId: string,
  handler: EventHandler
): Promise<() => void> {
  const channel = getOrgChannel(organizationId);
  return subscribe(channel as EventChannel, handler);
}

/**
 * Subscribe to meeting-specific channel.
 */
export async function subscribeToMeeting(
  meetingId: string,
  handler: EventHandler
): Promise<() => void> {
  const channel = getMeetingChannel(meetingId);
  return subscribe(channel as EventChannel, handler);
}

/**
 * Subscribe to multiple organization channels using pattern.
 * Note: Requires Redis pattern subscription.
 */
export async function subscribeToAllOrgs(
  handler: EventHandler
): Promise<() => void> {
  // Ensure Redis is initialized
  await initializeRedis();
  
  if (redisAvailable && subscriberClient) {
    try {
      // Pattern subscription for all org channels
      const pattern = 'org:*:events';
      
      // ioredis uses 'pmessage' event for pattern subscriptions
      const pmessageHandler = (_pattern: string, channel: string, message: string) => {
        try {
          const payload = JSON.parse(message) as EventPayload;
          const result = handler(payload);
          if (result && typeof result.catch === 'function') {
            result.catch((err: any) => {
              logger.error('[EVENT_BUS] Handler error', { 
                channel, 
                error: err.message,
              });
            });
          }
        } catch (err: any) {
          logger.warn('[EVENT_BUS] Failed to parse message', { 
            channel, 
            error: err.message,
          });
        }
      };
      
      subscriberClient.on('pmessage', pmessageHandler);
      await subscriberClient.psubscribe(pattern);
      
      logger.info('[EVENT_BUS] Subscribed to pattern', { pattern });
      
      return () => {
        subscriberClient!.punsubscribe(pattern).catch(() => {});
        subscriberClient!.off('pmessage', pmessageHandler);
      };
    } catch (err: any) {
      logger.warn('[EVENT_BUS] Redis pattern subscribe failed', {
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
export async function shutdownEventBus(): Promise<void> {
  try {
    if (subscriberClient) {
      await subscriberClient.quit();
    }
    if (publisherClient) {
      await publisherClient.quit();
    }
    logger.info('[EVENT_BUS] Shutdown complete');
  } catch (err: any) {
    logger.warn('[EVENT_BUS] Shutdown error', { error: err.message });
  }
}
