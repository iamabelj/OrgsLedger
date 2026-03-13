"use strict";
// ============================================================
// OrgsLedger API — Socket.io Real-Time Layer (Scaled)
// Chat, Notifications, Financial Updates, Meeting Events
//
// HORIZONTAL SCALING: Uses Redis Pub/Sub adapter for multi-instance
// deployments. All broadcasts propagate across all API servers.
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKER_ID = void 0;
exports.setupSocketIO = setupSocketIO;
exports.emitFinancialUpdate = emitFinancialUpdate;
exports.emitMeetingEvent = emitMeetingEvent;
exports.getIO = getIO;
exports.getSocketStats = getSocketStats;
exports.getSocketHealth = getSocketHealth;
exports.shutdownSocket = shutdownSocket;
const socket_io_1 = require("socket.io");
const redis_adapter_1 = require("@socket.io/redis-adapter");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const os_1 = __importDefault(require("os"));
const config_1 = require("./config");
const db_1 = __importDefault(require("./db"));
const logger_1 = require("./logger");
const socket_redis_1 = require("./infrastructure/socket/socket-redis");
const event_bus_service_1 = require("./modules/meeting/services/event-bus.service");
const socket_metrics_1 = require("./monitoring/socket-metrics");
// ── Worker Identity ─────────────────────────────────────────
const WORKER_ID = `${os_1.default.hostname()}-${process.pid}`;
exports.WORKER_ID = WORKER_ID;
const SERVER_START_TIME = new Date();
// ── Module State ────────────────────────────────────────────
let ioInstance = null;
let connectionCount = 0;
let totalConnectionsServed = 0;
let eventBridgeUnsubscribers = [];
// ── Setup Function ──────────────────────────────────────────
function setupSocketIO(httpServer) {
    const allowedOrigins = config_1.config.env === 'production'
        ? ['https://app.orgsledger.com', 'https://orgsledger.com']
        : '*';
    const io = new socket_io_1.Server(httpServer, {
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
        logger_1.logger.error('[SOCKET] Failed to attach Redis adapter, running in single-instance mode', {
            error: err.message,
            workerId: WORKER_ID,
        });
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
            socket.globalRole = user.global_role || 'member';
            next();
        }
        catch (err) {
            next(new Error('Invalid token'));
        }
    });
    // ── Connection Handler ──────────────────────────────────
    io.on('connection', async (socket) => {
        const userId = socket.userId;
        connectionCount++;
        totalConnectionsServed++;
        // Detailed connection logging for distributed debugging
        logger_1.logger.info('[SOCKET] Client connected', {
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
        socket.on('channel:join', async (channelId) => {
            try {
                // Verify user is a member of this channel (or it's a general/announcement channel in an org they belong to)
                const channel = await (0, db_1.default)('channels').where({ id: channelId }).first();
                if (!channel)
                    return;
                const membership = await (0, db_1.default)('memberships')
                    .where({ user_id: userId, organization_id: channel.organization_id, is_active: true })
                    .first();
                if (!membership) {
                    socket.emit('error', { message: 'Not a member of this organization' });
                    return;
                }
                // For non-general/announcement channels, verify channel membership
                if (!['general', 'announcement'].includes(channel.type)) {
                    const channelMember = await (0, db_1.default)('channel_members')
                        .where({ channel_id: channelId, user_id: userId })
                        .first();
                    if (!channelMember) {
                        socket.emit('error', { message: 'Not a member of this channel' });
                        return;
                    }
                }
                socket.join(`channel:${channelId}`);
            }
            catch (err) {
                logger_1.logger.error('channel:join authorization error', err);
            }
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
        // ── Financial Updates ───────────────────────────────
        socket.on('ledger:subscribe', async (orgId) => {
            try {
                // Verify user is a member of this organization
                const membership = await (0, db_1.default)('memberships')
                    .where({ user_id: userId, organization_id: orgId, is_active: true })
                    .first();
                if (!membership) {
                    socket.emit('error', { message: 'Not a member of this organization' });
                    return;
                }
                socket.join(`ledger:${orgId}`);
            }
            catch (err) {
                logger_1.logger.error('ledger:subscribe authorization error', err);
            }
        });
        // ── Meeting Events ──────────────────────────────────
        // Join a meeting room for real-time transcripts, captions, minutes
        socket.on('meeting:join', (meetingId) => {
            socket.meetingId = meetingId;
            socket.join(`meeting:${meetingId}`);
            logger_1.logger.debug('[SOCKET] User joined meeting room', {
                userId,
                meetingId,
                socketId: socket.id,
                workerId: WORKER_ID,
            });
        });
        socket.on('meeting:leave', (meetingId) => {
            socket.leave(`meeting:${meetingId}`);
            socket.meetingId = undefined;
            logger_1.logger.debug('[SOCKET] User left meeting room', {
                userId,
                meetingId,
                socketId: socket.id,
                workerId: WORKER_ID,
            });
        });
        // ── Presence ────────────────────────────────────────
        socket.on('disconnect', (reason) => {
            connectionCount--;
            logger_1.logger.info('[SOCKET] Client disconnected', {
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
async function attachRedisAdapter(io) {
    try {
        logger_1.logger.info('[SOCKET] Initializing Redis adapter for horizontal scaling...', {
            workerId: WORKER_ID,
        });
        const { pubClient, subClient } = await (0, socket_redis_1.initializeSocketRedis)();
        // Create and attach the adapter
        io.adapter((0, redis_adapter_1.createAdapter)(pubClient, subClient));
        logger_1.logger.info('[SOCKET] Redis adapter attached successfully', {
            workerId: WORKER_ID,
            mode: 'scaled',
        });
        // Set up event bridge from event-bus to Socket.IO
        await setupEventBridge(io);
        // Start health monitoring
        startHealthMonitoring();
    }
    catch (err) {
        logger_1.logger.error('[SOCKET] Failed to initialize Redis adapter', {
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
async function setupEventBridge(io) {
    try {
        logger_1.logger.info('[SOCKET] Setting up event bridge from event-bus to Socket.IO...', {
            workerId: WORKER_ID,
        });
        // Subscribe to legacy meeting events channel
        const unsubMeetingEvents = await (0, event_bus_service_1.subscribe)(event_bus_service_1.EVENT_CHANNELS.MEETING_EVENTS, (payload) => {
            handleMeetingEvent(io, payload);
        });
        eventBridgeUnsubscribers.push(unsubMeetingEvents);
        logger_1.logger.info('[SOCKET] Event bridge configured successfully', {
            workerId: WORKER_ID,
            channels: [event_bus_service_1.EVENT_CHANNELS.MEETING_EVENTS],
        });
    }
    catch (err) {
        logger_1.logger.error('[SOCKET] Failed to setup event bridge', {
            error: err instanceof Error ? err.message : String(err),
            workerId: WORKER_ID,
        });
    }
}
/**
 * Handle a meeting event from the event-bus and emit to Socket.IO room.
 */
function handleMeetingEvent(io, payload) {
    try {
        const { type, data } = payload;
        const meetingId = data?.meetingId || data?.data?.meetingId;
        if (!meetingId) {
            logger_1.logger.warn('[SOCKET] Meeting event missing meetingId', {
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
        (0, socket_metrics_1.recordBroadcast)('meeting');
        (0, socket_metrics_1.recordEvent)(eventName);
        logger_1.logger.debug('[SOCKET] Bridged event to Socket.IO room', {
            eventName,
            roomName,
            meetingId,
            workerId: WORKER_ID,
        });
    }
    catch (err) {
        logger_1.logger.error('[SOCKET] Failed to handle meeting event', {
            error: err instanceof Error ? err.message : String(err),
            type: payload?.type,
            workerId: WORKER_ID,
        });
    }
}
// ── Health Monitoring ───────────────────────────────────────
let healthInterval = null;
function startHealthMonitoring() {
    // Log health every 60 seconds
    healthInterval = setInterval(async () => {
        try {
            const health = await (0, socket_redis_1.getSocketRedisHealth)();
            const stats = getSocketStats();
            logger_1.logger.debug('[SOCKET] Health check', {
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
        }
        catch (err) {
            logger_1.logger.error('[SOCKET] Health check failed', {
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
function emitFinancialUpdate(io, organizationId, data) {
    io.to(`org:${organizationId}`).emit('financial:update', data);
    io.to(`ledger:${organizationId}`).emit('ledger:update', data);
}
/**
 * Emit an event to a specific meeting room.
 * Used by broadcast worker for transcripts, captions, minutes.
 */
function emitMeetingEvent(io, meetingId, eventType, data) {
    io.to(`meeting:${meetingId}`).emit(eventType, data);
}
/**
 * Get the Socket.IO server instance (if initialized).
 */
function getIO() {
    return ioInstance;
}
/**
 * Get current socket statistics.
 */
function getSocketStats() {
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
        if (roomName.startsWith('meeting:'))
            meetingRooms++;
        else if (roomName.startsWith('user:'))
            userRooms++;
        else if (roomName.startsWith('channel:'))
            channelRooms++;
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
async function getSocketHealth() {
    const redisHealth = (0, socket_redis_1.isSocketRedisInitialized)()
        ? await (0, socket_redis_1.getSocketRedisHealth)()
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
async function shutdownSocket() {
    logger_1.logger.info('[SOCKET] Shutting down...', { workerId: WORKER_ID });
    // Unsubscribe from event bridge channels
    for (const unsubscribe of eventBridgeUnsubscribers) {
        try {
            unsubscribe();
        }
        catch (err) {
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
    await (0, socket_redis_1.shutdownSocketRedis)();
    logger_1.logger.info('[SOCKET] Shutdown complete', { workerId: WORKER_ID });
}
//# sourceMappingURL=socket.js.map