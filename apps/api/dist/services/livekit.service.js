"use strict";
// ============================================================
// OrgsLedger API — LiveKit Meeting Service
// Token generation, room naming, and configuration for
// LiveKit-based video/audio conferencing.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRoomName = generateRoomName;
exports.generateLiveKitToken = generateLiveKitToken;
exports.buildJoinConfig = buildJoinConfig;
const livekit_server_sdk_1 = require("livekit-server-sdk");
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
// Generates a short-lived access token for LiveKit using the
// official livekit-server-sdk AccessToken class.
// This ensures the JWT format is exactly what LiveKit Cloud expects.
async function generateLiveKitToken(payload) {
    const { apiKey, apiSecret, tokenExpirySeconds } = config_1.config.livekit;
    if (!apiSecret || !apiKey) {
        throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET are not configured. Cannot generate meeting tokens.');
    }
    const token = new livekit_server_sdk_1.AccessToken(apiKey, apiSecret, {
        identity: payload.user.id,
        name: payload.user.name,
        ttl: `${tokenExpirySeconds}s`,
        metadata: JSON.stringify({
            userId: payload.user.id,
            email: payload.user.email,
            avatar: payload.user.avatar || '',
            isModerator: payload.moderator,
        }),
    });
    // Build the video grant
    const grant = {
        roomJoin: true,
        room: payload.room,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
    };
    // Moderator gets additional admin permissions
    if (payload.moderator) {
        grant.roomAdmin = true;
        grant.roomRecord = payload.features?.recording ?? true;
        grant.canPublishSources = [
            livekit_server_sdk_1.TrackSource.CAMERA,
            livekit_server_sdk_1.TrackSource.MICROPHONE,
            livekit_server_sdk_1.TrackSource.SCREEN_SHARE,
            livekit_server_sdk_1.TrackSource.SCREEN_SHARE_AUDIO,
        ];
    }
    else {
        grant.canPublishSources = payload.meetingType === 'audio'
            ? [livekit_server_sdk_1.TrackSource.MICROPHONE]
            : [livekit_server_sdk_1.TrackSource.CAMERA, livekit_server_sdk_1.TrackSource.MICROPHONE];
    }
    // Audio-only mode: restrict to microphone only
    if (payload.meetingType === 'audio' && !payload.moderator) {
        grant.canPublishSources = [livekit_server_sdk_1.TrackSource.MICROPHONE];
    }
    token.addGrant(grant);
    const jwt = await token.toJwt();
    logger_1.logger.info(`LiveKit token generated for user ${payload.user.id}, room ${payload.room}, moderator=${payload.moderator}, sources=${JSON.stringify(grant.canPublishSources)}`);
    return jwt;
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