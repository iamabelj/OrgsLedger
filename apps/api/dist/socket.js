"use strict";
// ============================================================
// OrgsLedger API — Socket.io Real-Time Layer
// Chat, Meetings, Notifications, Financial Updates
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSocketIO = setupSocketIO;
exports.emitFinancialUpdate = emitFinancialUpdate;
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("./config");
const db_1 = __importDefault(require("./db"));
const logger_1 = require("./logger");
function setupSocketIO(httpServer) {
    const io = new socket_io_1.Server(httpServer, {
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
        },
        pingTimeout: 60000,
        pingInterval: 25000,
        maxHttpBufferSize: 10e6, // 10MB for file sharing
    });
    // ── Authentication Middleware ────────────────────────────
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token ||
                socket.handshake.headers.authorization?.split(' ')[1];
            if (!token) {
                return next(new Error('Authentication required'));
            }
            const payload = jsonwebtoken_1.default.verify(token, config_1.config.jwt.secret);
            const user = await (0, db_1.default)('users')
                .where({ id: payload.userId, is_active: true })
                .first();
            if (!user) {
                return next(new Error('User not found'));
            }
            socket.userId = payload.userId;
            socket.email = payload.email;
            next();
        }
        catch (err) {
            next(new Error('Invalid token'));
        }
    });
    // ── Connection Handler ──────────────────────────────────
    io.on('connection', async (socket) => {
        const userId = socket.userId;
        logger_1.logger.debug(`Socket connected: ${userId}`);
        // Join user's personal room
        socket.join(`user:${userId}`);
        // Join all organization rooms the user belongs to
        try {
            const memberships = await (0, db_1.default)('memberships')
                .where({ user_id: userId, is_active: true })
                .select('organization_id');
            for (const m of memberships) {
                socket.join(`org:${m.organization_id}`);
            }
            // Join all channels the user is a member of
            const channelMemberships = await (0, db_1.default)('channel_members')
                .join('channels', 'channel_members.channel_id', 'channels.id')
                .where({ 'channel_members.user_id': userId })
                .select('channels.id');
            for (const cm of channelMemberships) {
                socket.join(`channel:${cm.id}`);
            }
        }
        catch (err) {
            logger_1.logger.error('Error joining rooms', err);
        }
        // ── Channel Events ──────────────────────────────────
        socket.on('channel:join', (channelId) => {
            socket.join(`channel:${channelId}`);
        });
        socket.on('channel:leave', (channelId) => {
            socket.leave(`channel:${channelId}`);
        });
        socket.on('channel:typing', (data) => {
            socket.to(`channel:${data.channelId}`).emit('channel:typing', {
                userId,
                channelId: data.channelId,
            });
        });
        socket.on('channel:stop-typing', (data) => {
            socket.to(`channel:${data.channelId}`).emit('channel:stop-typing', {
                userId,
                channelId: data.channelId,
            });
        });
        socket.on('channel:read', (data) => {
            // Update last_read_at in DB and broadcast to channel
            (0, db_1.default)('channel_members')
                .where({ channel_id: data.channelId, user_id: userId })
                .update({ last_read_at: db_1.default.fn.now() })
                .catch((err) => logger_1.logger.error('Failed to update read timestamp', err));
            socket.to(`channel:${data.channelId}`).emit('channel:read', {
                userId,
                channelId: data.channelId,
                readAt: new Date().toISOString(),
            });
        });
        // ── Meeting Events ──────────────────────────────────
        socket.on('meeting:join', (meetingId) => {
            socket.join(`meeting:${meetingId}`);
            socket.to(`meeting:${meetingId}`).emit('meeting:participant-joined', {
                userId,
            });
            logger_1.logger.debug(`User ${userId} joined meeting ${meetingId}`);
        });
        socket.on('meeting:leave', (meetingId) => {
            socket.leave(`meeting:${meetingId}`);
            socket.to(`meeting:${meetingId}`).emit('meeting:participant-left', {
                userId,
            });
        });
        // ── Audio Streaming for AI ──────────────────────────
        socket.on('meeting:audio-chunk', (data) => {
            // Forward audio chunks for real-time processing
            socket.to(`meeting:${data.meetingId}`).emit('meeting:audio-chunk', {
                userId,
                chunk: data.chunk,
            });
        });
        // ── Financial Updates ───────────────────────────────
        socket.on('ledger:subscribe', (orgId) => {
            socket.join(`ledger:${orgId}`);
        });
        // ── Presence ────────────────────────────────────────
        socket.on('disconnect', () => {
            logger_1.logger.debug(`Socket disconnected: ${userId}`);
        });
    });
    return io;
}
/**
 * Emit a financial update to all connected org members.
 * Called when transactions are created/updated.
 */
function emitFinancialUpdate(io, organizationId, data) {
    io.to(`org:${organizationId}`).emit('financial:update', data);
    io.to(`ledger:${organizationId}`).emit('ledger:update', data);
}
//# sourceMappingURL=socket.js.map