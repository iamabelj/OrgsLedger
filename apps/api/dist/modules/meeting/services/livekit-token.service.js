"use strict";
// ============================================================
// OrgsLedger API — LiveKit Token Service
// Generates LiveKit tokens for meeting participants
// Manages room creation and access control
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRoomIfNotExists = createRoomIfNotExists;
exports.generateParticipantToken = generateParticipantToken;
exports.deleteRoom = deleteRoom;
exports.getRoomParticipants = getRoomParticipants;
exports.removeParticipant = removeParticipant;
const livekit_server_sdk_1 = require("livekit-server-sdk");
const config_1 = require("../../../config");
const logger_1 = require("../../../logger");
// ── Configuration ───────────────────────────────────────────
const LIVEKIT_URL = config_1.config.livekit?.url || '';
const LIVEKIT_API_KEY = config_1.config.livekit?.apiKey || '';
const LIVEKIT_API_SECRET = config_1.config.livekit?.apiSecret || '';
// Token validity (6 hours for meetings)
const TOKEN_TTL_SECONDS = 6 * 60 * 60;
// ── Room Service Client (lazy init) ─────────────────────────
let roomServiceClient = null;
function getRoomServiceClient() {
    if (!roomServiceClient) {
        if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
            throw new Error('LiveKit API credentials not configured');
        }
        // Extract HTTP URL from WebSocket URL
        const httpUrl = LIVEKIT_URL.replace('wss://', 'https://').replace('ws://', 'http://');
        roomServiceClient = new livekit_server_sdk_1.RoomServiceClient(httpUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    }
    return roomServiceClient;
}
// ── Service Functions ───────────────────────────────────────
/**
 * Create a LiveKit room if it doesn't exist
 * Room name = meetingId for simplicity
 */
async function createRoomIfNotExists(meetingId) {
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
        logger_1.logger.warn('[LIVEKIT] Credentials not configured, skipping room creation');
        return;
    }
    const client = getRoomServiceClient();
    const roomName = meetingId;
    try {
        // List rooms to check if exists
        const rooms = await client.listRooms([roomName]);
        if (rooms.length === 0) {
            // Create the room
            await client.createRoom({
                name: roomName,
                // Empty room cleanup after 5 minutes
                emptyTimeout: 300,
                // Max duration 12 hours
                maxParticipants: 100,
            });
            logger_1.logger.info('[LIVEKIT] Room created', { roomName });
        }
        else {
            logger_1.logger.debug('[LIVEKIT] Room already exists', { roomName });
        }
    }
    catch (err) {
        logger_1.logger.error('[LIVEKIT] Failed to create room', {
            roomName,
            error: err.message,
        });
        throw err;
    }
}
/**
 * Generate a LiveKit access token for a participant
 */
async function generateParticipantToken(request) {
    const { meetingId, userId, name, role } = request;
    const roomName = meetingId;
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
        throw new Error('LiveKit API credentials not configured');
    }
    // Create access token
    const token = new livekit_server_sdk_1.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: userId,
        name: name,
        ttl: TOKEN_TTL_SECONDS,
    });
    // Configure video grant based on role
    const videoGrant = {
        roomJoin: true,
        room: roomName,
        canSubscribe: true,
        canPublish: role !== 'bot', // Bots don't publish, only subscribe
        canPublishData: true,
    };
    // Host gets additional permissions
    if (role === 'host') {
        videoGrant.roomAdmin = true;
        videoGrant.roomRecord = true;
    }
    // Bot is hidden
    if (role === 'bot') {
        videoGrant.hidden = true;
    }
    token.addGrant(videoGrant);
    const jwt = await token.toJwt();
    logger_1.logger.info('[LIVEKIT] Token generated', {
        meetingId,
        userId,
        role,
        roomName,
    });
    return {
        token: jwt,
        url: LIVEKIT_URL,
        roomName,
    };
}
/**
 * Delete a LiveKit room when meeting ends
 */
async function deleteRoom(meetingId) {
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
        return;
    }
    const client = getRoomServiceClient();
    const roomName = meetingId;
    try {
        await client.deleteRoom(roomName);
        logger_1.logger.info('[LIVEKIT] Room deleted', { roomName });
    }
    catch (err) {
        // Room might not exist, that's OK
        logger_1.logger.warn('[LIVEKIT] Failed to delete room', {
            roomName,
            error: err.message,
        });
    }
}
/**
 * Get list of participants in a room
 */
async function getRoomParticipants(meetingId) {
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
        return [];
    }
    const client = getRoomServiceClient();
    const roomName = meetingId;
    try {
        const participants = await client.listParticipants(roomName);
        return participants;
    }
    catch (err) {
        logger_1.logger.warn('[LIVEKIT] Failed to list participants', {
            roomName,
            error: err.message,
        });
        return [];
    }
}
/**
 * Remove a participant from a room
 */
async function removeParticipant(meetingId, userId) {
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
        return;
    }
    const client = getRoomServiceClient();
    try {
        await client.removeParticipant(meetingId, userId);
        logger_1.logger.info('[LIVEKIT] Participant removed', { meetingId, userId });
    }
    catch (err) {
        logger_1.logger.warn('[LIVEKIT] Failed to remove participant', {
            meetingId,
            userId,
            error: err.message,
        });
    }
}
//# sourceMappingURL=livekit-token.service.js.map