// ============================================================
// OrgsLedger API — LiveKit Meeting Service
// Token generation, room naming, and configuration for
// LiveKit-based video/audio conferencing.
// ============================================================

import { AccessToken, TrackSource } from 'livekit-server-sdk';
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
// Generates a short-lived access token for LiveKit using the
// official livekit-server-sdk AccessToken class.
// This ensures the JWT format is exactly what LiveKit Cloud expects.

export async function generateLiveKitToken(payload: LiveKitTokenPayload): Promise<string> {
  const { apiKey, apiSecret, tokenExpirySeconds } = config.livekit;

  if (!apiSecret || !apiKey) {
    throw new Error('LIVEKIT_API_KEY and LIVEKIT_API_SECRET are not configured. Cannot generate meeting tokens.');
  }

  const token = new AccessToken(apiKey, apiSecret, {
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
  const grant: Record<string, any> = {
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
      TrackSource.CAMERA,
      TrackSource.MICROPHONE,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    ];
  } else {
    grant.canPublishSources = payload.meetingType === 'audio'
      ? [TrackSource.MICROPHONE]
      : [TrackSource.CAMERA, TrackSource.MICROPHONE];
  }

  // Audio-only mode: restrict to microphone only
  if (payload.meetingType === 'audio' && !payload.moderator) {
    grant.canPublishSources = [TrackSource.MICROPHONE];
  }

  token.addGrant(grant);

  const jwt = await token.toJwt();
  logger.info(`LiveKit token generated for user ${payload.user.id}, room ${payload.room}, moderator=${payload.moderator}, sources=${JSON.stringify(grant.canPublishSources)}`);
  return jwt;
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
