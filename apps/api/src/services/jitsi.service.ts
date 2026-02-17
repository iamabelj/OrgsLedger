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

  // ── Prosody token auth expects these exact claims ──────
  //   aud   = "jitsi"  (hardcoded in mod_token_verification)
  //   iss   = app_id   (must match Prosody's app_id)
  //   sub   = domain   (must match Prosody's VirtualHost, i.e. XMPP domain)
  //   room  = "*" or exact room name ("*" allows any room)
  //   exp   = expiry timestamp
  //   context.user.affiliation = "owner" → moderator, "member" → participant
  //     This is read by mod_token_affiliation to assign XMPP role.
  //   context.user.moderator = boolean (used by lib-jitsi-meet / Jicofo)
  //
  // Both affiliation AND moderator are set for maximum compatibility
  // across Prosody plugins and Jicofo versions.

  const jwtPayload: Record<string, any> = {
    aud: 'jitsi',
    iss: appId,
    sub: domain,
    room: payload.room,  // exact room name for security (not "*")
    exp: now + tokenExpirySeconds,
    iat: now,
    nbf: now - 10, // 10s clock skew tolerance
    context: {
      user: {
        id: payload.user.id,
        name: payload.user.name,
        email: payload.user.email,
        avatar: payload.user.avatar || '',
        // ── Critical: Prosody mod_token_affiliation reads this ──
        affiliation: payload.moderator ? 'owner' : 'member',
        // ── Jicofo reads this for moderator grant ──
        moderator: payload.moderator,
      },
      features: {
        recording: payload.features?.recording ?? false,
        livestreaming: payload.features?.livestreaming ?? false,
        transcription: payload.features?.transcription ?? false,
      },
    },
    // Top-level moderator for backward compat with older Jitsi versions
    moderator: payload.moderator,
  };

  const token = jwt.sign(jwtPayload, appSecret, { algorithm: 'HS256' });
  logger.info(`Jitsi JWT generated for user ${payload.user.id}, room ${payload.room}, moderator=${payload.moderator}, affiliation=${payload.moderator ? 'owner' : 'member'}`);
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
    // Audio pipeline — CRITICAL: ensure audio flows correctly
    enableNoisyMicDetection: true,
    enableNoAudioDetection: true,
    stereo: false,
    disableAP: false,  // keep audio processing ON
    disableAEC: false,  // keep acoustic echo cancellation ON
    disableNS: false,   // keep noise suppression ON
    disableAGC: false,  // keep automatic gain control ON
    disableHPF: false,  // keep high-pass filter ON
    enableTalkWhileMuted: false,
    enableInsecureRoomNameWarning: false,
    requireDisplayName: false,
    hideRecordingLabel: true,
    disableInviteFunctions: true,
    enableLobbyChat: true,
    // Enforce JWT auth — prevent anonymous fallback
    tokenAuthUrl: true,
    // P2P mode for small meetings (2 participants) — lower latency audio
    p2p: {
      enabled: true,
      useStunTurn: true,
      stunServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    },
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
    // Audio pipeline — CRITICAL: ensure audio flows correctly
    enableNoisyMicDetection: true,
    enableNoAudioDetection: true,
    stereo: false,
    disableAP: false,
    disableAEC: false,
    disableNS: false,
    disableAGC: false,
    disableHPF: false,
    enableTalkWhileMuted: false,
    enableInsecureRoomNameWarning: false,
    requireDisplayName: false,
    hideRecordingLabel: true,
    disableInviteFunctions: true,
    // Enforce JWT auth — prevent anonymous fallback
    tokenAuthUrl: true,
    // Audio-only specific: disable camera entirely
    disableVideo: true,
    startVideoMuted: true,
    constraints: {
      video: false,
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
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
      useStunTurn: true,
      stunServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
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
