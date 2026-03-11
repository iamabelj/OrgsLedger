// ============================================================
// OrgsLedger API — Socket.io Real-Time Layer (Scaled)
// Chat, Notifications, Financial Updates, Meeting Events
//
// HORIZONTAL SCALING: Uses Redis Pub/Sub adapter for multi-instance
// deployments. All broadcasts propagate across all API servers.
// ============================================================

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import os from 'os';
import { config } from './config';
import db from './db';
import { logger } from './logger';
import {
  initializeSocketRedis,
  getSocketRedisHealth,
  shutdownSocketRedis,
  isSocketRedisInitialized,
} from './infrastructure/socket/socket-redis';
import {
  subscribe,
  EVENT_CHANNELS,
  EventPayload,
  getMeetingChannel,
} from './modules/meeting/services/event-bus.service';
import { recordBroadcast, recordEvent } from './monitoring/socket-metrics';

// ── Worker Identity ─────────────────────────────────────────

const WORKER_ID = `${os.hostname()}-${process.pid}`;
const SERVER_START_TIME = new Date();

// ── Types ───────────────────────────────────────────────────

interface AuthenticatedSocket extends Socket {
  userId?: string;
  email?: string;
  globalRole?: string;
  meetingId?: string;
}

interface SocketStats {
  totalConnections: number;
  activeRooms: number;
  meetingRooms: number;
  userRooms: number;
  channelRooms: number;
}

// ── Module State ────────────────────────────────────────────

let ioInstance: Server | null = null;
let connectionCount = 0;
let totalConnectionsServed = 0;
let eventBridgeUnsubscribers: Array<() => void> = [];

// ── Setup Function ──────────────────────────────────────────

export function setupSocketIO(httpServer: HttpServer): Server {
  const allowedOrigins = config.env === 'production'
    ? ['https://app.orgsledger.com', 'https://orgsledger.com']
    : '*';

  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 10e6, // 10MB for file sharing
    // Transports: prefer WebSocket, fallback to polling
    transports: ['websocket', 'polling'],
  });

  ioInstance = io;

  // Attach Redis adapter asynchronously
  attachRedisAdapter(io).catch((err) => {
    logger.error('[SOCKET] Failed to attach Redis adapter, running in single-instance mode', {
      error: err.message,
      workerId: WORKER_ID,
    });
  });

  // ── Authentication Middleware ────────────────────────────
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token =
        socket.handshake.auth.token ||
        socket.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication required'));
      }

      const payload = jwt.verify(token, config.jwt.secret) as {
        userId: string;
        email: string;
      };

      const user = await db('users')
        .where({ id: payload.userId, is_active: true })
        .first();
      if (!user) {
        return next(new Error('User not found'));
      }

      socket.userId = payload.userId;
      socket.email = payload.email;
      socket.globalRole = user.global_role || 'member';
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  // ── Connection Handler ──────────────────────────────────
  io.on('connection', async (socket: AuthenticatedSocket) => {
    const userId = socket.userId!;
    connectionCount++;
    totalConnectionsServed++;

    // Detailed connection logging for distributed debugging
    logger.info('[SOCKET] Client connected', {
      socketId: socket.id,
      userId,
      workerId: WORKER_ID,
      transport: socket.conn.transport.name,
      remoteAddress: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent']?.substring(0, 100),
      totalConnections: connectionCount,
    });

    // Join user's personal room
    socket.join(`user:${userId}`);

    // Join all organization rooms the user belongs to
    try {
      const memberships = await db('memberships')
        .where({ user_id: userId, is_active: true })
        .select('organization_id');

      for (const m of memberships) {
        socket.join(`org:${m.organization_id}`);
      }

      // Join all channels the user is a member of
      const channelMemberships = await db('channel_members')
        .join('channels', 'channel_members.channel_id', 'channels.id')
        .where({ 'channel_members.user_id': userId })
        .select('channels.id');

      for (const cm of channelMemberships) {
        socket.join(`channel:${cm.id}`);
      }
    } catch (err) {
      logger.error('Error joining rooms', err);
    }

    // ── Channel Events ──────────────────────────────────
    socket.on('channel:join', async (channelId: string) => {
      try {
        // Verify user is a member of this channel (or it's a general/announcement channel in an org they belong to)
        const channel = await db('channels').where({ id: channelId }).first();
        if (!channel) return;

        const membership = await db('memberships')
          .where({ user_id: userId, organization_id: channel.organization_id, is_active: true })
          .first();
        if (!membership) {
          socket.emit('error', { message: 'Not a member of this organization' });
          return;
        }

        // For non-general/announcement channels, verify channel membership
        if (!['general', 'announcement'].includes(channel.type)) {
          const channelMember = await db('channel_members')
            .where({ channel_id: channelId, user_id: userId })
            .first();
          if (!channelMember) {
            socket.emit('error', { message: 'Not a member of this channel' });
            return;
          }
        }

        socket.join(`channel:${channelId}`);
      } catch (err) {
        logger.error('channel:join authorization error', err);
      }
    });

    socket.on('channel:leave', (channelId: string) => {
      socket.leave(`channel:${channelId}`);
    });

    socket.on('channel:typing', (data: { channelId: string }) => {
      socket.to(`channel:${data.channelId}`).emit('channel:typing', {
        userId,
        channelId: data.channelId,
      });
    });

    socket.on('channel:stop-typing', (data: { channelId: string }) => {
      socket.to(`channel:${data.channelId}`).emit('channel:stop-typing', {
        userId,
        channelId: data.channelId,
      });
    });

    socket.on('channel:read', (data: { channelId: string }) => {
      // Update last_read_at in DB and broadcast to channel
      db('channel_members')
        .where({ channel_id: data.channelId, user_id: userId })
        .update({ last_read_at: db.fn.now() })
        .catch((err) => logger.error('Failed to update read timestamp', err));

      socket.to(`channel:${data.channelId}`).emit('channel:read', {
        userId,
        channelId: data.channelId,
        readAt: new Date().toISOString(),
      });
    });

    // ── Financial Updates ───────────────────────────────
    socket.on('ledger:subscribe', async (orgId: string) => {
      try {
        // Verify user is a member of this organization
        const membership = await db('memberships')
          .where({ user_id: userId, organization_id: orgId, is_active: true })
          .first();
        if (!membership) {
          socket.emit('error', { message: 'Not a member of this organization' });
          return;
        }
        socket.join(`ledger:${orgId}`);
      } catch (err) {
        logger.error('ledger:subscribe authorization error', err);
      }
    });

    // ── Meeting Events ──────────────────────────────────
    // Join a meeting room for real-time transcripts, captions, minutes
    socket.on('meeting:join', (meetingId: string) => {
      socket.meetingId = meetingId;
      socket.join(`meeting:${meetingId}`);
      logger.debug('[SOCKET] User joined meeting room', {
        userId,
        meetingId,
        socketId: socket.id,
        workerId: WORKER_ID,
      });
    });

    socket.on('meeting:leave', (meetingId: string) => {
      socket.leave(`meeting:${meetingId}`);
      socket.meetingId = undefined;
      logger.debug('[SOCKET] User left meeting room', {
        userId,
        meetingId,
        socketId: socket.id,
        workerId: WORKER_ID,
      });
    });

    // ── Presence ────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      connectionCount--;
      logger.info('[SOCKET] Client disconnected', {
        socketId: socket.id,
        userId,
        reason,
        workerId: WORKER_ID,
        meetingId: socket.meetingId,
        remainingConnections: connectionCount,
      });
    });
  });

  return io;
}

// ── Redis Adapter Attachment ────────────────────────────────

/**
 * Attach Redis pub/sub adapter for horizontal scaling.
 * This allows all Socket.IO servers to share events via Redis.
 */
async function attachRedisAdapter(io: Server): Promise<void> {
  try {
    logger.info('[SOCKET] Initializing Redis adapter for horizontal scaling...', {
      workerId: WORKER_ID,
    });

    const { pubClient, subClient } = await initializeSocketRedis();

    // Create and attach the adapter
    io.adapter(createAdapter(pubClient, subClient));

    logger.info('[SOCKET] Redis adapter attached successfully', {
      workerId: WORKER_ID,
      mode: 'scaled',
    });

    // Set up event bridge from event-bus to Socket.IO
    await setupEventBridge(io);

    // Start health monitoring
    startHealthMonitoring();
  } catch (err) {
    logger.error('[SOCKET] Failed to initialize Redis adapter', {
      error: err instanceof Error ? err.message : String(err),
      workerId: WORKER_ID,
    });
    throw err;
  }
}

// ── Event Bridge ────────────────────────────────────────────

/**
 * Bridge events from the event-bus (used by workers) to Socket.IO rooms.
 * This allows workers to publish events that reach connected clients.
 */
async function setupEventBridge(io: Server): Promise<void> {
  try {
    logger.info('[SOCKET] Setting up event bridge from event-bus to Socket.IO...', {
      workerId: WORKER_ID,
    });

    // Subscribe to legacy meeting events channel
    const unsubMeetingEvents = await subscribe(
      EVENT_CHANNELS.MEETING_EVENTS,
      (payload: EventPayload) => {
        handleMeetingEvent(io, payload);
      }
    );
    eventBridgeUnsubscribers.push(unsubMeetingEvents);

    logger.info('[SOCKET] Event bridge configured successfully', {
      workerId: WORKER_ID,
      channels: [EVENT_CHANNELS.MEETING_EVENTS],
    });
  } catch (err) {
    logger.error('[SOCKET] Failed to setup event bridge', {
      error: err instanceof Error ? err.message : String(err),
      workerId: WORKER_ID,
    });
  }
}

/**
 * Handle a meeting event from the event-bus and emit to Socket.IO room.
 */
function handleMeetingEvent(io: Server, payload: EventPayload): void {
  try {
    const { type, data } = payload;
    const meetingId = data?.meetingId || data?.data?.meetingId;

    if (!meetingId) {
      logger.warn('[SOCKET] Meeting event missing meetingId', {
        type,
        workerId: WORKER_ID,
      });
      return;
    }

    // Emit to the meeting room
    // The event type from the bus (e.g., "meeting:transcript") is used as-is
    const eventName = type;
    const roomName = `meeting:${meetingId}`;

    io.to(roomName).emit(eventName, data);

    // Record metrics
    recordBroadcast('meeting');
    recordEvent(eventName);

    logger.debug('[SOCKET] Bridged event to Socket.IO room', {
      eventName,
      roomName,
      meetingId,
      workerId: WORKER_ID,
    });
  } catch (err) {
    logger.error('[SOCKET] Failed to handle meeting event', {
      error: err instanceof Error ? err.message : String(err),
      type: payload?.type,
      workerId: WORKER_ID,
    });
  }
}

// ── Health Monitoring ───────────────────────────────────────

let healthInterval: NodeJS.Timeout | null = null;

function startHealthMonitoring(): void {
  // Log health every 60 seconds
  healthInterval = setInterval(async () => {
    try {
      const health = await getSocketRedisHealth();
      const stats = getSocketStats();

      logger.debug('[SOCKET] Health check', {
        workerId: WORKER_ID,
        redis: {
          connected: health.connected,
          latencyMs: health.latencyMs,
          reconnectAttempts: health.reconnectAttempts,
        },
        sockets: {
          active: stats.totalConnections,
          rooms: stats.activeRooms,
          meetingRooms: stats.meetingRooms,
        },
        uptime: Math.floor((Date.now() - SERVER_START_TIME.getTime()) / 1000),
      });
    } catch (err) {
      logger.error('[SOCKET] Health check failed', {
        error: err instanceof Error ? err.message : String(err),
        workerId: WORKER_ID,
      });
    }
  }, 60000);
}

// ── Public Functions ────────────────────────────────────────

/**
 * Emit a financial update to all connected org members.
 * Called when transactions are created/updated.
 */
export function emitFinancialUpdate(
  io: Server,
  organizationId: string,
  data: any
): void {
  io.to(`org:${organizationId}`).emit('financial:update', data);
  io.to(`ledger:${organizationId}`).emit('ledger:update', data);
}

/**
 * Emit an event to a specific meeting room.
 * Used by broadcast worker for transcripts, captions, minutes.
 */
export function emitMeetingEvent(
  io: Server,
  meetingId: string,
  eventType: string,
  data: any
): void {
  io.to(`meeting:${meetingId}`).emit(eventType, data);
}

/**
 * Get the Socket.IO server instance (if initialized).
 */
export function getIO(): Server | null {
  return ioInstance;
}

/**
 * Get current socket statistics.
 */
export function getSocketStats(): SocketStats {
  if (!ioInstance) {
    return {
      totalConnections: 0,
      activeRooms: 0,
      meetingRooms: 0,
      userRooms: 0,
      channelRooms: 0,
    };
  }

  const rooms = ioInstance.sockets.adapter.rooms;
  let meetingRooms = 0;
  let userRooms = 0;
  let channelRooms = 0;

  for (const [roomName] of rooms) {
    if (roomName.startsWith('meeting:')) meetingRooms++;
    else if (roomName.startsWith('user:')) userRooms++;
    else if (roomName.startsWith('channel:')) channelRooms++;
  }

  return {
    totalConnections: connectionCount,
    activeRooms: rooms.size,
    meetingRooms,
    userRooms,
    channelRooms,
  };
}

/**
 * Get detailed health information for the Socket.IO layer.
 */
export async function getSocketHealth(): Promise<{
  workerId: string;
  connections: number;
  totalServed: number;
  uptime: number;
  redis: Awaited<ReturnType<typeof getSocketRedisHealth>>;
  stats: SocketStats;
}> {
  const redisHealth = isSocketRedisInitialized()
    ? await getSocketRedisHealth()
    : {
        connected: false,
        pubConnected: false,
        subConnected: false,
        latencyMs: null,
        lastReconnectAttempt: null,
        reconnectAttempts: 0,
      };

  return {
    workerId: WORKER_ID,
    connections: connectionCount,
    totalServed: totalConnectionsServed,
    uptime: Math.floor((Date.now() - SERVER_START_TIME.getTime()) / 1000),
    redis: redisHealth,
    stats: getSocketStats(),
  };
}

/**
 * Gracefully shut down Socket.IO and Redis connections.
 */
export async function shutdownSocket(): Promise<void> {
  logger.info('[SOCKET] Shutting down...', { workerId: WORKER_ID });

  // Unsubscribe from event bridge channels
  for (const unsubscribe of eventBridgeUnsubscribers) {
    try {
      unsubscribe();
    } catch (err) {
      // Ignore errors during shutdown
    }
  }
  eventBridgeUnsubscribers = [];

  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }

  if (ioInstance) {
    // Disconnect all clients
    ioInstance.disconnectSockets(true);
    ioInstance = null;
  }

  await shutdownSocketRedis();

  logger.info('[SOCKET] Shutdown complete', { workerId: WORKER_ID });
}

// ── Exports ─────────────────────────────────────────────────

export { WORKER_ID };
