// ============================================================
// OrgsLedger API — LiveKit Meeting Service
// Token generation, room naming, and configuration for
// LiveKit-based video/audio conferencing.
// ============================================================

import jwt from 'jsonwebtoken';
import { config } from '../config';
import { logger } from '../logger';

// ── Types ───────────────────────────────────────────────────

export interface LiveKitUserContext {
  id: string;
  name: string;
  email: string;
  avatar?: string;
}

export interface LiveKitTokenPayload {
  room: string;
  moderator: boolean;
  user: LiveKitUserContext;
  meetingType: 'video' | 'audio';
  features?: {
    recording?: boolean;
    transcription?: boolean;
  };
}

export interface LiveKitJoinConfig {
  url: string;
  token: string;
  roomName: string;
  meetingType: 'video' | 'audio';
  isModerator: boolean;
  userInfo: {
    displayName: string;
    email: string;
  };
}

// ── Room Naming ─────────────────────────────────────────────
// Pattern: org_<orgId>_meeting_<meetingId>
// Enforces tenant isolation — room names are deterministic and
// cannot be guessed without knowing both IDs.

export function generateRoomName(orgId: string, meetingId: string): string {
  const orgSlug = orgId.replace(/-/g, '').slice(0, 12);
  const meetingSlug = meetingId.replace(/-/g, '').slice(0, 12);
  return `org_${orgSlug}_meeting_${meetingSlug}`;
}

// ── LiveKit Token Generation ────────────────────────────────
// Generates a short-lived JWT (access token) for LiveKit.
// LiveKit uses a standard JWT with specific claims for
// room access and permissions.

export function generateLiveKitToken(payload: LiveKitTokenPayload): string {
  const { apiKey, apiSecret, tokenExpirySeconds } = config.livekit;

  if (!apiSecret || !apiKey) {
    throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET are not configured. Cannot generate meeting tokens.');
  }

  const now = Math.floor(Date.now() / 1000);

  // LiveKit access token claims
  // See: https://docs.livekit.io/realtime/concepts/authentication/
  const grants: Record<string, any> = {
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
  } else {
    grants.canPublishSources = payload.meetingType === 'audio'
      ? ['microphone']
      : ['camera', 'microphone'];
  }

  // Audio-only mode: restrict to microphone only
  if (payload.meetingType === 'audio' && !payload.moderator) {
    grants.canPublishSources = ['microphone'];
  }

  const jwtPayload: Record<string, any> = {
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

  const token = jwt.sign(jwtPayload, apiSecret, { algorithm: 'HS256' });
  logger.info(`LiveKit token generated for user ${payload.user.id}, room ${payload.room}, moderator=${payload.moderator}`);
  return token;
}

// ── Build Full Join Configuration ───────────────────────────
// Returns everything the client needs to connect to LiveKit.

export function buildJoinConfig(params: {
  meetingType: 'video' | 'audio';
  roomName: string;
  token: string;
  userName: string;
  userEmail: string;
  isModerator: boolean;
}): LiveKitJoinConfig {
  return {
    url: config.livekit.url,
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
