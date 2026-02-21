"use strict";
// ============================================================
// OrgsLedger API — LiveKit Meeting Service
// Token generation, room naming, and configuration for
// LiveKit-based video/audio conferencing.
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRoomName = generateRoomName;
exports.generateLiveKitToken = generateLiveKitToken;
exports.buildJoinConfig = buildJoinConfig;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
const logger_1 = require("../logger");
// ── Room Naming ─────────────────────────────────────────────
// Pattern: org_<orgId>_meeting_<meetingId>
// Enforces tenant isolation — room names are deterministic and
// cannot be guessed without knowing both IDs.
function generateRoomName(orgId, meetingId) {
    const orgSlug = orgId.replace(/-/g, '').slice(0, 12);
    const meetingSlug = meetingId.replace(/-/g, '').slice(0, 12);
    return `org_${orgSlug}_meeting_${meetingSlug}`;
}
// ── LiveKit Token Generation ────────────────────────────────
// Generates a short-lived JWT (access token) for LiveKit.
// LiveKit uses a standard JWT with specific claims for
// room access and permissions.
function generateLiveKitToken(payload) {
    const { apiKey, apiSecret, tokenExpirySeconds } = config_1.config.livekit;
    if (!apiSecret || !apiKey) {
        throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET are not configured. Cannot generate meeting tokens.');
    }
    const now = Math.floor(Date.now() / 1000);
    // LiveKit access token claims
    // See: https://docs.livekit.io/realtime/concepts/authentication/
    const grants = {
        roomJoin: true,
        room: payload.room,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
    };
    // Moderator gets additional admin permissions
    if (payload.moderator) {
        grants.roomAdmin = true;
        grants.roomRecord = payload.features?.recording ?? true;
        grants.canPublishSources = ['camera', 'microphone', 'screen_share', 'screen_share_audio'];
    }
    else {
        grants.canPublishSources = payload.meetingType === 'audio'
            ? ['microphone']
            : ['camera', 'microphone'];
    }
    // Audio-only mode: restrict to microphone only
    if (payload.meetingType === 'audio' && !payload.moderator) {
        grants.canPublishSources = ['microphone'];
    }
    const jwtPayload = {
        exp: now + tokenExpirySeconds,
        iat: now,
        nbf: now - 10,
        iss: apiKey,
        sub: payload.user.id,
        name: payload.user.name,
        video: grants,
        metadata: JSON.stringify({
            userId: payload.user.id,
            email: payload.user.email,
            avatar: payload.user.avatar || '',
            isModerator: payload.moderator,
        }),
    };
    const token = jsonwebtoken_1.default.sign(jwtPayload, apiSecret, { algorithm: 'HS256' });
    logger_1.logger.info(`LiveKit token generated for user ${payload.user.id}, room ${payload.room}, moderator=${payload.moderator}`);
    return token;
}
// ── Build Full Join Configuration ───────────────────────────
// Returns everything the client needs to connect to LiveKit.
function buildJoinConfig(params) {
    return {
        url: config_1.config.livekit.url,
        token: params.token,
        roomName: params.roomName,
        meetingType: params.meetingType,
        isModerator: params.isModerator,
        userInfo: {
            displayName: params.userName,
            email: params.userEmail,
        },
    };
}
//# sourceMappingURL=livekit.service.js.map