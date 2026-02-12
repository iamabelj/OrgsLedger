// ============================================================
// OrgsLedger API — Socket.io Real-Time Layer
// Chat, Meetings, Notifications, Financial Updates
// ============================================================

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from './config';
import db from './db';
import { logger } from './logger';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  email?: string;
}

export function setupSocketIO(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 10e6, // 10MB for file sharing
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
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  // ── Connection Handler ──────────────────────────────────
  io.on('connection', async (socket: AuthenticatedSocket) => {
    const userId = socket.userId!;
    logger.debug(`Socket connected: ${userId}`);

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
    socket.on('channel:join', (channelId: string) => {
      socket.join(`channel:${channelId}`);
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

    // ── Meeting Events ──────────────────────────────────
    socket.on('meeting:join', (meetingId: string) => {
      socket.join(`meeting:${meetingId}`);
      socket.to(`meeting:${meetingId}`).emit('meeting:participant-joined', {
        userId,
      });
      logger.debug(`User ${userId} joined meeting ${meetingId}`);
    });

    socket.on('meeting:leave', (meetingId: string) => {
      socket.leave(`meeting:${meetingId}`);
      socket.to(`meeting:${meetingId}`).emit('meeting:participant-left', {
        userId,
      });
    });

    // ── Audio Streaming for AI ──────────────────────────
    socket.on('meeting:audio-chunk', (data: { meetingId: string; chunk: Buffer }) => {
      // Forward audio chunks for real-time processing
      socket.to(`meeting:${data.meetingId}`).emit('meeting:audio-chunk', {
        userId,
        chunk: data.chunk,
      });
    });

    // ── Financial Updates ───────────────────────────────
    socket.on('ledger:subscribe', (orgId: string) => {
      socket.join(`ledger:${orgId}`);
    });

    // ── Presence ────────────────────────────────────────
    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: ${userId}`);
    });
  });

  return io;
}

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
