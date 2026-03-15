"use strict";
// ============================================================
// OrgsLedger API — WebSocket Gateway Service
// Bridges Redis event bus to Socket.IO for real-time delivery
// Decouples business logic from WebSocket transport
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeWebSocketGateway = initializeWebSocketGateway;
exports.shutdownWebSocketGateway = shutdownWebSocketGateway;
exports.isGatewayInitialized = isGatewayInitialized;
exports.setupMeetingRooms = setupMeetingRooms;
exports.emitToUser = emitToUser;
exports.emitToMeeting = emitToMeeting;
const logger_1 = require("../../../logger");
const registry_1 = require("../../../services/registry");
const event_bus_service_1 = require("./event-bus.service");
let unsubscribeFn = null;
let isInitialized = false;
/**
 * Handle meeting events from the event bus
 * Routes events to appropriate Socket.IO rooms
 */
async function handleMeetingEvent(payload) {
    const io = registry_1.services.get('io');
    if (!io) {
        logger_1.logger.warn('[WS_GATEWAY] Socket.IO not available, skipping broadcast');
        return;
    }
    const event = payload;
    // Broadcast to organization room
    if (event.organizationId) {
        io.to(`org:${event.organizationId}`).emit('meeting:event', event);
    }
    // Broadcast to meeting-specific room
    if (event.meetingId) {
        io.to(`meeting:${event.meetingId}`).emit('meeting:event', event);
    }
    logger_1.logger.debug('[WS_GATEWAY] Broadcasted event', {
        type: event.type,
        meetingId: event.meetingId,
        organizationId: event.organizationId,
    });
}
/**
 * Initialize the WebSocket gateway
 * Subscribes to Redis event bus channels and routes to Socket.IO
 */
async function initializeWebSocketGateway() {
    if (isInitialized) {
        logger_1.logger.warn('[WS_GATEWAY] Already initialized, skipping');
        return;
    }
    try {
        // Subscribe to meeting events channel
        unsubscribeFn = await (0, event_bus_service_1.subscribe)(event_bus_service_1.EVENT_CHANNELS.MEETING_EVENTS, handleMeetingEvent);
        isInitialized = true;
        logger_1.logger.info('[WS_GATEWAY] Initialized and subscribed to meeting events');
    }
    catch (err) {
        logger_1.logger.error('[WS_GATEWAY] Failed to initialize', { error: err.message });
        throw err;
    }
}
/**
 * Shutdown the WebSocket gateway
 * Unsubscribes from all channels
 */
async function shutdownWebSocketGateway() {
    if (unsubscribeFn) {
        unsubscribeFn();
        unsubscribeFn = null;
    }
    isInitialized = false;
    logger_1.logger.info('[WS_GATEWAY] Shutdown complete');
}
/**
 * Check if gateway is initialized
 */
function isGatewayInitialized() {
    return isInitialized;
}
/**
 * Setup Socket.IO room management for meetings
 * Call this after Socket.IO is initialized
 */
function setupMeetingRooms(io) {
    io.on('connection', (socket) => {
        // Join meeting room
        socket.on('meeting:join-room', (meetingId) => {
            if (meetingId && typeof meetingId === 'string') {
                socket.join(`meeting:${meetingId}`);
                logger_1.logger.debug('[WS_GATEWAY] Socket joined meeting room', {
                    socketId: socket.id,
                    meetingId,
                });
            }
        });
        // Leave meeting room
        socket.on('meeting:leave-room', (meetingId) => {
            if (meetingId && typeof meetingId === 'string') {
                socket.leave(`meeting:${meetingId}`);
                logger_1.logger.debug('[WS_GATEWAY] Socket left meeting room', {
                    socketId: socket.id,
                    meetingId,
                });
            }
        });
        // Subscribe to user-specific events (invites, notifications)
        socket.on('user:subscribe', (userId) => {
            if (userId && typeof userId === 'string') {
                socket.join(`user:${userId}`);
                logger_1.logger.debug('[WS_GATEWAY] Socket subscribed to user events', {
                    socketId: socket.id,
                    userId,
                });
            }
        });
        // Unsubscribe from user-specific events
        socket.on('user:unsubscribe', (userId) => {
            if (userId && typeof userId === 'string') {
                socket.leave(`user:${userId}`);
                logger_1.logger.debug('[WS_GATEWAY] Socket unsubscribed from user events', {
                    socketId: socket.id,
                    userId,
                });
            }
        });
        // Handle live captions from participants (browser speech recognition)
        socket.on('meeting:caption:send', (data) => {
            if (!data?.meetingId || !data?.text)
                return;
            // Broadcast caption to all participants in the meeting room (except sender)
            socket.to(`meeting:${data.meetingId}`).emit('meeting:caption', {
                meetingId: data.meetingId,
                speaker: data.speaker || 'Unknown',
                text: data.text,
                timestamp: Date.now(),
            });
            logger_1.logger.debug('[WS_GATEWAY] Caption broadcasted', {
                meetingId: data.meetingId,
                speaker: data.speaker,
                textLength: data.text.length,
            });
        });
        // Handle participant state updates (hand raise, reactions, etc.)
        socket.on('meeting:participant-state', (data) => {
            if (!data?.meetingId || !data?.userId)
                return;
            // Broadcast state to all participants (including sender)
            io.to(`meeting:${data.meetingId}`).emit('meeting:participant-state-changed', {
                meetingId: data.meetingId,
                userId: data.userId,
                state: data.state,
                timestamp: Date.now(),
            });
            logger_1.logger.debug('[WS_GATEWAY] Participant state broadcasted', {
                meetingId: data.meetingId,
                userId: data.userId,
                state: data.state,
            });
        });
        // Handle transcript visibility toggle (enable/disable live captions)
        socket.on('meeting:transcript-visibility', (data) => {
            if (!data?.meetingId)
                return;
            // Broadcast visibility preference to all participants
            socket.to(`meeting:${data.meetingId}`).emit('meeting:transcript-visibility-changed', {
                meetingId: data.meetingId,
                visible: data.visible,
                timestamp: Date.now(),
            });
        });
    });
    logger_1.logger.info('[WS_GATEWAY] Meeting room handlers registered');
}
/**
 * Send a targeted event to a specific user.
 * Used for meeting invites, notifications, etc.
 */
function emitToUser(io, userId, event, data) {
    io.to(`user:${userId}`).emit(event, data);
    logger_1.logger.debug('[WS_GATEWAY] Emitted to user', {
        userId,
        event,
    });
}
/**
 * Send a meeting event to all participants in a meeting room.
 */
function emitToMeeting(io, meetingId, event, data) {
    io.to(`meeting:${meetingId}`).emit(event, data);
    logger_1.logger.debug('[WS_GATEWAY] Emitted to meeting', {
        meetingId,
        event,
    });
}
//# sourceMappingURL=websocket-gateway.service.js.map