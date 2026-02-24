// ============================================================
// OrgsLedger — LiveKit Room Hook
// Manages room connection, tracks, participants, active speakers.
// Web-only: uses livekit-client SDK. Native: returns no-op state.
//
// Handles: AudioContext resume for autoplay policy, graceful
// permission denial, per-track audio attach/detach, reconnection.
// ============================================================

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Platform } from 'react-native';

// ── Types ─────────────────────────────────────────────────

export interface LKParticipant {
  sid: string;
  identity: string;
  name: string;
  isSpeaking: boolean;
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isScreenSharing: boolean;
  isLocal: boolean;
  videoTrack: any | null;   // Track from livekit-client
  audioTrack: any | null;
  screenTrack: any | null;
  connectionQuality: string;
  metadata?: string;
}

export interface UseLiveKitRoomReturn {
  isConnected: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
  error: string | null;
  participants: LKParticipant[];
  activeSpeakerIds: string[];
  localParticipant: LKParticipant | null;
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isScreenSharing: boolean;
  dominantSpeaker: LKParticipant | null;
  connect: (url: string, token: string, options?: { audio?: boolean; video?: boolean }) => Promise<void>;
  disconnect: () => void;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  room: any | null;
}

// ── LiveKit SDK (web-only dynamic import) ─────────────────

let LK: any = null;
if (Platform.OS === 'web') {
  try {
    LK = require('livekit-client');
  } catch (e) {
    console.warn('[LiveKit] Failed to load livekit-client:', e);
  }
}

// ── Helper: Resume AudioContext for browser autoplay policy ──

function ensureAudioContextResumed(): void {
  if (Platform.OS !== 'web') return;
  try {
    // Access the global AudioContext (most browsers)
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    // livekit-client creates an internal AudioContext — also try to resume it
    // by creating a short-lived one if none exists
    const ctx = new AC();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    ctx.close().catch(() => {});
  } catch (_) { /* ignore */ }
}

// ── Helper: Build participant object from LiveKit participant ──

function buildParticipant(p: any, isLocal: boolean): LKParticipant {
  let videoTrack: any = null;
  let audioTrack: any = null;
  let screenTrack: any = null;

  if (p.trackPublications) {
    for (const [, pub] of p.trackPublications) {
      if (!pub.track) continue;
      const src = pub.source;
      if (src === LK?.Track?.Source?.Camera) videoTrack = pub.track;
      else if (src === LK?.Track?.Source?.Microphone) audioTrack = pub.track;
      else if (src === LK?.Track?.Source?.ScreenShare) screenTrack = pub.track;
    }
  }

  return {
    sid: p.sid || '',
    identity: p.identity || '',
    name: p.name || p.identity || 'Unknown',
    isSpeaking: p.isSpeaking ?? false,
    isMicEnabled: p.isMicrophoneEnabled ?? false,
    isCameraEnabled: p.isCameraEnabled ?? false,
    isScreenSharing: p.isScreenShareEnabled ?? false,
    isLocal,
    videoTrack,
    audioTrack,
    screenTrack,
    connectionQuality: p.connectionQuality ?? 'unknown',
    metadata: p.metadata,
  };
}

// ── Hook ──────────────────────────────────────────────────

export function useLiveKitRoom(): UseLiveKitRoomReturn {
  const isWeb = Platform.OS === 'web' && !!LK;

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<LKParticipant[]>([]);
  const [activeSpeakerIds, setActiveSpeakerIds] = useState<string[]>([]);
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [dominantSpeaker, setDominantSpeaker] = useState<LKParticipant | null>(null);

  const roomRef = useRef<any>(null);
  const audioElementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const connectingRef = useRef(false); // guard against double-connect
  const rebuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Rebuild all participants from room state ────────────
  // Actual rebuild logic (called by debounced wrapper)
  const doRebuild = useCallback(() => {
    const room = roomRef.current;
    if (!room) {
      setParticipants([]);
      return;
    }

    const result: LKParticipant[] = [];

    // Local participant
    if (room.localParticipant) {
      result.push(buildParticipant(room.localParticipant, true));
    }

    // Remote participants
    for (const [, rp] of room.remoteParticipants) {
      result.push(buildParticipant(rp, false));
    }

    setParticipants(result);

    // Update local state
    if (room.localParticipant) {
      setIsMicEnabled(room.localParticipant.isMicrophoneEnabled ?? false);
      setIsCameraEnabled(room.localParticipant.isCameraEnabled ?? false);
      setIsScreenSharing(room.localParticipant.isScreenShareEnabled ?? false);
    }
  }, []);

  // Debounced wrapper — coalesces rapid-fire events (e.g., ParticipantConnected +
  // TrackSubscribed × 2 → one rebuild instead of three)
  const rebuildParticipants = useCallback(() => {
    if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current);
    rebuildTimerRef.current = setTimeout(() => {
      rebuildTimerRef.current = null;
      doRebuild();
    }, 50); // 50ms debounce — fast enough to feel instant, prevents burst rebuilds
  }, [doRebuild]);

  // ── Attach audio track for playback ─────────────────────
  const attachAudio = useCallback((track: any, participantSid: string) => {
    if (!track || track.kind !== 'audio') return;
    const key = `${participantSid}-${track.sid}`;

    // Don't double-attach
    if (audioElementsRef.current.has(key)) return;

    try {
      // Resume AudioContext before attaching (browser autoplay policy)
      ensureAudioContextResumed();

      const el = track.attach();
      el.id = `lk-audio-${key}`;
      el.style.display = 'none';
      // Set attributes to help with autoplay
      el.setAttribute('autoplay', 'true');
      el.setAttribute('playsinline', 'true');
      document.body.appendChild(el);
      audioElementsRef.current.set(key, el);

      // Attempt play in case autoplay was blocked
      const playPromise = el.play?.();
      if (playPromise?.catch) {
        playPromise.catch((e: any) => {
          console.warn('[LiveKit] Audio autoplay blocked — will retry on user interaction:', e.message);
        });
      }
    } catch (e) {
      console.warn('[LiveKit] Failed to attach audio track:', e);
    }
  }, []);

  // ── Detach audio track ──────────────────────────────────
  const detachAudio = useCallback((track: any, participantSid: string) => {
    const key = `${participantSid}-${track.sid}`;
    const el = audioElementsRef.current.get(key);
    if (el) {
      try {
        track.detach(el);
        el.remove();
      } catch (e) { /* ignore */ }
      audioElementsRef.current.delete(key);
    }
  }, []);

  // ── Connect to room ────────────────────────────────────
  const connect = useCallback(async (
    url: string,
    token: string,
    options?: { audio?: boolean; video?: boolean },
  ) => {
    if (!isWeb) {
      setError('LiveKit SDK is only available on web');
      return;
    }

    // Prevent duplicate connect calls
    if (connectingRef.current) {
      console.warn('[LiveKit] Connect already in progress, skipping');
      return;
    }

    // Disconnect existing room first
    if (roomRef.current) {
      try { roomRef.current.disconnect(true); } catch (_) {}
      roomRef.current = null;
    }

    connectingRef.current = true;
    setIsConnecting(true);
    setError(null);

    try {
      // Resume AudioContext early (user gesture context)
      ensureAudioContextResumed();

      // Create room with adaptive streaming
      const room = new LK.Room({
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: {
          resolution: LK.VideoPresets.h720.resolution,
        },
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        // Reconnect settings
        reconnectPolicy: {
          maxRetries: 10,
          nextRetryDelayInMs: (context: any) => {
            // Exponential back-off: 300ms, 600ms, 1200ms ... capped at 10s
            return Math.min(300 * Math.pow(2, context?.retryCount ?? 0), 10000);
          },
        },
      });

      roomRef.current = room;

      // ── Room events ──────────────────────────────────
      const RE = LK.RoomEvent;

      room.on(RE.Connected, () => {
        console.debug('[LiveKit] Connected to room');
        setIsConnected(true);
        setIsConnecting(false);
        setIsReconnecting(false);
        rebuildParticipants();
      });

      room.on(RE.Disconnected, (reason?: string) => {
        console.debug('[LiveKit] Disconnected:', reason);
        setIsConnected(false);
        setIsConnecting(false);
        setIsReconnecting(false);
        setParticipants([]);
        setActiveSpeakerIds([]);
        // Clean up audio elements
        for (const [, el] of audioElementsRef.current) {
          try { el.remove(); } catch (_) {}
        }
        audioElementsRef.current.clear();
      });

      room.on(RE.Reconnecting, () => {
        console.debug('[LiveKit] Reconnecting...');
        setIsReconnecting(true);
      });

      room.on(RE.Reconnected, () => {
        console.debug('[LiveKit] Reconnected successfully');
        setIsReconnecting(false);
        setIsConnected(true);
        rebuildParticipants();
      });

      room.on(RE.SignalReconnecting, () => {
        console.debug('[LiveKit] Signal reconnecting...');
      });

      room.on(RE.ParticipantConnected, (participant: any) => {
        console.debug(`[LiveKit] Participant connected: ${participant.identity}`);
        rebuildParticipants();
      });

      room.on(RE.ParticipantDisconnected, (participant: any) => {
        console.debug(`[LiveKit] Participant disconnected: ${participant.identity}`);
        rebuildParticipants();
      });

      room.on(RE.TrackSubscribed, (track: any, publication: any, participant: any) => {
        console.debug(`[LiveKit] Track subscribed: ${track.kind} (${track.source}) from ${participant.identity}`);
        if (track.kind === 'audio') {
          attachAudio(track, participant.sid);
        }
        rebuildParticipants();
      });

      room.on(RE.TrackUnsubscribed, (track: any, publication: any, participant: any) => {
        console.debug(`[LiveKit] Track unsubscribed: ${track.kind} from ${participant.identity}`);
        if (track.kind === 'audio') {
          detachAudio(track, participant.sid);
        }
        rebuildParticipants();
      });

      room.on(RE.TrackMuted, (_pub: any, participant: any) => {
        console.debug(`[LiveKit] Track muted by ${participant?.identity}`);
        rebuildParticipants();
      });

      room.on(RE.TrackUnmuted, (_pub: any, participant: any) => {
        console.debug(`[LiveKit] Track unmuted by ${participant?.identity}`);
        rebuildParticipants();
      });

      room.on(RE.LocalTrackPublished, (pub: any) => {
        console.debug(`[LiveKit] Local track published: ${pub.source}`);
        rebuildParticipants();
      });

      room.on(RE.LocalTrackUnpublished, (pub: any) => {
        console.debug(`[LiveKit] Local track unpublished: ${pub.source}`);
        rebuildParticipants();
      });

      room.on(RE.ActiveSpeakersChanged, (speakers: any[]) => {
        const ids = speakers.map((s: any) => s.sid);
        setActiveSpeakerIds(ids);
        if (speakers.length > 0) {
          setDominantSpeaker(buildParticipant(speakers[0], speakers[0] === room.localParticipant));
        } else {
          setDominantSpeaker(null);
        }
        // No rebuildParticipants() — active speakers don't change track/mute state,
        // only the speaker highlight, which is handled via activeSpeakerIds
      });

      room.on(RE.ConnectionQualityChanged, () => {
        // Connection quality is cosmetic — don't rebuild particles for it
      });

      room.on(RE.MediaDevicesError, (e: any) => {
        console.error('[LiveKit] Media devices error:', e);
        // Show error but don't break the connection
        setError(`Device error: ${e.message || 'Unknown'}. You may need to grant permissions.`);
      });

      room.on(RE.MediaDevicesChanged, () => {
        console.debug('[LiveKit] Media devices changed (hot-plug)');
        rebuildParticipants();
      });

      // ── Connect ──────────────────────────────────────
      console.debug(`[LiveKit] Connecting to ${url}...`);
      await room.connect(url, token);
      console.debug('[LiveKit] Room connected, enabling media...');

      // Enable mic/camera SEPARATELY to avoid requesting unneeded permissions
      // and to handle denial gracefully (connection stays alive)
      const enableAudio = options?.audio !== false;
      const enableVideo = options?.video !== false;

      // Enable mic and camera with retry — first attempt sometimes fails
      // due to browser autoplay policy or transient permission gate.
      const enableWithRetry = async (label: string, fn: () => Promise<void>, retries = 2) => {
        for (let attempt = 1; attempt <= retries; attempt++) {
          try {
            await fn();
            console.debug(`[LiveKit] ${label} enabled (attempt ${attempt})`);
            return;
          } catch (err: any) {
            console.warn(`[LiveKit] ${label} enable failed (attempt ${attempt}/${retries}):`, err.message);
            if (attempt < retries) {
              // Brief pause then retry — gives browser time to settle permission prompt
              await new Promise((r) => setTimeout(r, 500));
            } else {
              // Final attempt failed — surface a visible but non-blocking error
              setError(`${label} access denied. Check your browser permissions and try the toggle button.`);
            }
          }
        }
      };

      if (enableAudio) {
        await enableWithRetry('Microphone', () => room.localParticipant.setMicrophoneEnabled(true));
      }

      if (enableVideo) {
        await enableWithRetry('Camera', () => room.localParticipant.setCameraEnabled(true));
      }

      rebuildParticipants();

    } catch (e: any) {
      console.error('[LiveKit] Connection failed:', e);
      setError(e.message || 'Failed to connect to meeting');
      setIsConnecting(false);
      // Clean up the room on connection failure
      if (roomRef.current) {
        try { roomRef.current.disconnect(true); } catch (_) {}
      }
      roomRef.current = null;
    } finally {
      connectingRef.current = false;
    }
  }, [isWeb, rebuildParticipants, attachAudio, detachAudio]);

  // ── Disconnect ──────────────────────────────────────────
  const disconnect = useCallback(() => {
    const room = roomRef.current;
    if (room) {
      try { room.disconnect(true); } catch (_) {}
      roomRef.current = null;
    }
    connectingRef.current = false;
    setIsConnected(false);
    setIsConnecting(false);
    setIsReconnecting(false);
    setParticipants([]);
    setActiveSpeakerIds([]);
    setIsMicEnabled(false);
    setIsCameraEnabled(false);
    setIsScreenSharing(false);
    setDominantSpeaker(null);

    // Clean up audio elements
    for (const [, el] of audioElementsRef.current) {
      try { el.remove(); } catch (_) {}
    }
    audioElementsRef.current.clear();
  }, []);

  // ── Toggle Microphone ───────────────────────────────────
  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room?.localParticipant) {
      console.warn('[LiveKit] toggleMic called but no room/localParticipant');
      setError('Not connected to meeting. Please rejoin.');
      return;
    }
    try {
      const next = !room.localParticipant.isMicrophoneEnabled;
      await room.localParticipant.setMicrophoneEnabled(next);
      setIsMicEnabled(next);
      // Clear any previous mic error on successful toggle
      setError(null);
      rebuildParticipants();
    } catch (e: any) {
      console.error('[LiveKit] Toggle mic failed:', e);
      setError(`Microphone error: ${e.message}. Check browser permissions.`);
    }
  }, [rebuildParticipants]);

  // ── Toggle Camera ───────────────────────────────────────
  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room?.localParticipant) {
      console.warn('[LiveKit] toggleCamera called but no room/localParticipant');
      setError('Not connected to meeting. Please rejoin.');
      return;
    }
    try {
      const next = !room.localParticipant.isCameraEnabled;
      await room.localParticipant.setCameraEnabled(next);
      setIsCameraEnabled(next);
      // Clear any previous camera error on successful toggle
      setError(null);
      rebuildParticipants();
    } catch (e: any) {
      console.error('[LiveKit] Toggle camera failed:', e);
      setError(`Camera error: ${e.message}. Check browser permissions.`);
    }
  }, [rebuildParticipants]);

  // ── Toggle Screen Share ─────────────────────────────────
  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room?.localParticipant) return;
    try {
      const next = !room.localParticipant.isScreenShareEnabled;
      await room.localParticipant.setScreenShareEnabled(next);
      setIsScreenSharing(next);
      rebuildParticipants();
    } catch (e: any) {
      console.error('[LiveKit] Toggle screen share failed:', e);
      // User cancellation of screen share picker is not an error
      if (!e.message?.includes('cancel') && !e.message?.includes('denied')) {
        setError(`Screen share error: ${e.message}`);
      }
    }
  }, [rebuildParticipants]);

  // ── Cleanup on unmount ──────────────────────────────────
  useEffect(() => {
    return () => {
      // Use ref to ensure we disconnect the correct room
      const room = roomRef.current;
      if (room) {
        try { room.disconnect(true); } catch (_) {}
        roomRef.current = null;
      }
      connectingRef.current = false;
      // Cancel pending rebuild timer
      if (rebuildTimerRef.current) {
        clearTimeout(rebuildTimerRef.current);
        rebuildTimerRef.current = null;
      }
      // Clean up audio elements
      for (const [, el] of audioElementsRef.current) {
        try { el.remove(); } catch (_) {}
      }
      audioElementsRef.current.clear();
    };
  }, []);

  const localParticipant = useMemo(
    () => participants.find((p) => p.isLocal) || null,
    [participants]
  );

  // Memoize return value so consumers don't see a new object every render
  return useMemo(() => ({
    isConnected,
    isConnecting,
    isReconnecting,
    error,
    participants,
    activeSpeakerIds,
    localParticipant,
    isMicEnabled,
    isCameraEnabled,
    isScreenSharing,
    dominantSpeaker,
    connect,
    disconnect,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    room: roomRef.current,
  }), [
    isConnected, isConnecting, isReconnecting, error,
    participants, activeSpeakerIds, localParticipant,
    isMicEnabled, isCameraEnabled, isScreenSharing,
    dominantSpeaker, connect, disconnect,
    toggleMic, toggleCamera, toggleScreenShare,
  ]);
}
