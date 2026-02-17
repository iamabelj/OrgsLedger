// ============================================================
// OrgsLedger API — Jitsi Meeting Service
// JWT token generation, room naming, config presets for
// enterprise-grade Jitsi integration (JaaS or self-hosted).
// ============================================================

import jwt from 'jsonwebtoken';
import { config } from '../config';
import { logger } from '../logger';

// ── Types ───────────────────────────────────────────────────

export interface JitsiUserContext {
  id: string;
  name: string;
  email: string;
  avatar?: string;
}

export interface JitsiTokenPayload {
  room: string;
  moderator: boolean;
  user: JitsiUserContext;
  meetingType: 'video' | 'audio';
  features?: {
    recording?: boolean;
    livestreaming?: boolean;
    transcription?: boolean;
  };
}

export interface JitsiJoinConfig {
  domain: string;
  roomName: string;
  jwt: string;
  configOverwrite: Record<string, any>;
  interfaceConfigOverwrite: Record<string, any>;
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
  // Use first 12 chars of each UUID to keep room name reasonable length
  // while maintaining uniqueness and tenant isolation
  const orgSlug = orgId.replace(/-/g, '').slice(0, 12);
  const meetingSlug = meetingId.replace(/-/g, '').slice(0, 12);
  return `org_${orgSlug}_meeting_${meetingSlug}`;
}

// ── JWT Token Generation ────────────────────────────────────
// Generates a short-lived JWT for Jitsi authentication.
// Works with both JaaS (8x8.vc) and self-hosted Jitsi with
// token authentication enabled.

export function generateJitsiToken(payload: JitsiTokenPayload): string {
  const {
    appId,
    appSecret,
    tokenExpirySeconds,
    domain,
  } = config.jitsi;

  if (!appSecret) {
    throw new Error('JITSI_APP_SECRET is not configured. Cannot generate meeting tokens.');
  }

  const now = Math.floor(Date.now() / 1000);

  const jwtPayload: Record<string, any> = {
    aud: 'jitsi',
    iss: appId,
    sub: domain,
    room: payload.room,
    exp: now + tokenExpirySeconds,
    iat: now,
    nbf: now - 10, // 10s clock skew tolerance
    context: {
      user: {
        id: payload.user.id,
        name: payload.user.name,
        email: payload.user.email,
        avatar: payload.user.avatar || '',
      },
      features: {
        recording: payload.features?.recording ?? false,
        livestreaming: payload.features?.livestreaming ?? false,
        transcription: payload.features?.transcription ?? false,
      },
    },
    moderator: payload.moderator,
  };

  const token = jwt.sign(jwtPayload, appSecret, { algorithm: 'HS256' });
  logger.info(`Jitsi JWT generated for user ${payload.user.id}, room ${payload.room}, moderator=${payload.moderator}`);
  return token;
}

// ── Config Presets ───────────────────────────────────────────
// Returns the full JitsiMeetExternalAPI configuration for the
// given meeting type (video vs audio).

export function getVideoConfig(): Record<string, any> {
  return {
    startWithVideoMuted: false,
    startWithAudioMuted: false,
    resolution: 720,
    disableSimulcast: false,
    prejoinPageEnabled: false,
    disableDeepLinking: true,
    enableNoisyMicDetection: false,
    enableNoAudioDetection: false,
    enableInsecureRoomNameWarning: false,
    requireDisplayName: false,
    hideRecordingLabel: true,
    disableInviteFunctions: true,
    enableLobbyChat: true,
    toolbarButtons: [
      'camera', 'chat', 'closedcaptions', 'desktop', 'download',
      'filmstrip', 'fullscreen', 'hangup', 'microphone', 'noisesuppression',
      'participants-pane', 'profile', 'raisehand', 'recording',
      'select-background', 'settings', 'tileview', 'toggle-camera',
      'videoquality',
    ],
    // Bandwidth optimization
    maxBitratesVideo: {
      low: 200000,
      standard: 500000,
      high: 1500000,
    },
  };
}

export function getAudioConfig(): Record<string, any> {
  return {
    startWithVideoMuted: true,
    startWithAudioMuted: false,
    disableSimulcast: true,
    resolution: 180,
    prejoinPageEnabled: false,
    disableDeepLinking: true,
    enableNoisyMicDetection: false,
    enableNoAudioDetection: false,
    enableInsecureRoomNameWarning: false,
    requireDisplayName: false,
    hideRecordingLabel: true,
    disableInviteFunctions: true,
    // Audio-only specific: disable camera entirely
    disableVideo: true,
    startVideoMuted: true,
    constraints: {
      video: {
        height: { ideal: 180, max: 180 },
        width: { ideal: 320, max: 320 },
      },
    },
    // Hide video-related UI
    filmstripDisplayMode: 'hidden',
    toolbarButtons: [
      'chat', 'closedcaptions', 'fullscreen', 'hangup',
      'microphone', 'noisesuppression', 'participants-pane',
      'profile', 'raisehand', 'settings', 'tileview',
    ],
    // Bandwidth optimization for low-bandwidth regions
    maxBitratesVideo: {
      low: 0,
      standard: 0,
      high: 0,
    },
    p2p: {
      enabled: true,
      // Optimize for audio-only p2p
    },
  };
}

export function getInterfaceConfig(orgName?: string): Record<string, any> {
  return {
    SHOW_JITSI_WATERMARK: false,
    SHOW_WATERMARK_FOR_GUESTS: false,
    SHOW_BRAND_WATERMARK: false,
    SHOW_POWERED_BY: false,
    SHOW_PROMOTIONAL_CLOSE_PAGE: false,
    SHOW_CHROME_EXTENSION_BANNER: false,
    DISABLE_JOIN_LEAVE_NOTIFICATIONS: false,
    DISABLE_PRESENCE_STATUS: false,
    DEFAULT_BACKGROUND: '#1a1a2e',
    DEFAULT_REMOTE_DISPLAY_NAME: 'Member',
    DEFAULT_LOCAL_DISPLAY_NAME: 'You',
    APP_NAME: orgName || 'OrgsLedger Meeting',
    NATIVE_APP_NAME: orgName || 'OrgsLedger Meeting',
    PROVIDER_NAME: 'OrgsLedger',
    TOOLBAR_ALWAYS_VISIBLE: true,
    TOOLBAR_TIMEOUT: 10000,
    FILM_STRIP_MAX_HEIGHT: 120,
    ENABLE_FEEDBACK_ANIMATION: false,
    // Raise hand feature is enabled by default in Jitsi
    RAISE_HAND_ENABLED: true,
    // Meeting timer
    SHOW_MEETING_TIMER: true,
  };
}

// ── Build Full Join Configuration ───────────────────────────
// Returns everything the client needs to embed Jitsi.

export function buildJoinConfig(params: {
  meetingType: 'video' | 'audio';
  roomName: string;
  token: string;
  userName: string;
  userEmail: string;
  orgName?: string;
  lobbyEnabled?: boolean;
}): JitsiJoinConfig {
  const configOverwrite = params.meetingType === 'audio'
    ? getAudioConfig()
    : getVideoConfig();

  // Lobby / waiting room
  if (params.lobbyEnabled) {
    configOverwrite.enableLobby = true;
  } else {
    configOverwrite.enableLobby = false;
  }

  // Subject line
  configOverwrite.subject = params.orgName
    ? `${params.orgName} Meeting`
    : 'OrgsLedger Meeting';

  return {
    domain: config.jitsi.domain,
    roomName: params.roomName,
    jwt: params.token,
    configOverwrite,
    interfaceConfigOverwrite: getInterfaceConfig(params.orgName),
    userInfo: {
      displayName: params.userName,
      email: params.userEmail,
    },
  };
}
