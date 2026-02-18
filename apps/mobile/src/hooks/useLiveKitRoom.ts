// ============================================================
// OrgsLedger — LiveKit Room Hook
// Manages room connection, tracks, participants, active speakers.
// Web-only: uses livekit-client SDK. Native: returns no-op state.
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react';
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
  const [error, setError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<LKParticipant[]>([]);
  const [activeSpeakerIds, setActiveSpeakerIds] = useState<string[]>([]);
  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [dominantSpeaker, setDominantSpeaker] = useState<LKParticipant | null>(null);

  const roomRef = useRef<any>(null);
  const audioElementsRef = useRef<Map<string, HTMLElement>>(new Map());

  // ── Rebuild all participants from room state ────────────
  const rebuildParticipants = useCallback(() => {
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

  // ── Attach audio track for playback ─────────────────────
  const attachAudio = useCallback((track: any, participantSid: string) => {
    if (!track || track.kind !== 'audio') return;
    const key = `${participantSid}-${track.sid}`;

    // Don't double-attach
    if (audioElementsRef.current.has(key)) return;

    try {
      const el = track.attach();
      el.id = `lk-audio-${key}`;
      el.style.display = 'none';
      document.body.appendChild(el);
      audioElementsRef.current.set(key, el);
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

    setIsConnecting(true);
    setError(null);

    try {
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
      });

      roomRef.current = room;

      // ── Room events ──────────────────────────────────
      const RE = LK.RoomEvent;

      room.on(RE.Connected, () => {
        console.debug('[LiveKit] Connected');
        setIsConnected(true);
        setIsConnecting(false);
        rebuildParticipants();
      });

      room.on(RE.Disconnected, (reason?: string) => {
        console.debug('[LiveKit] Disconnected:', reason);
        setIsConnected(false);
        setIsConnecting(false);
        setParticipants([]);
        setActiveSpeakerIds([]);
        // Clean up audio elements
        for (const [key, el] of audioElementsRef.current) {
          el.remove();
          audioElementsRef.current.delete(key);
        }
      });

      room.on(RE.Reconnecting, () => {
        console.debug('[LiveKit] Reconnecting...');
      });

      room.on(RE.Reconnected, () => {
        console.debug('[LiveKit] Reconnected');
        rebuildParticipants();
      });

      room.on(RE.ParticipantConnected, () => {
        rebuildParticipants();
      });

      room.on(RE.ParticipantDisconnected, () => {
        rebuildParticipants();
      });

      room.on(RE.TrackSubscribed, (track: any, publication: any, participant: any) => {
        console.debug(`[LiveKit] Track subscribed: ${track.kind} from ${participant.identity}`);
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

      room.on(RE.TrackMuted, () => rebuildParticipants());
      room.on(RE.TrackUnmuted, () => rebuildParticipants());

      room.on(RE.LocalTrackPublished, () => rebuildParticipants());
      room.on(RE.LocalTrackUnpublished, () => rebuildParticipants());

      room.on(RE.ActiveSpeakersChanged, (speakers: any[]) => {
        const ids = speakers.map((s: any) => s.sid);
        setActiveSpeakerIds(ids);
        if (speakers.length > 0) {
          setDominantSpeaker(buildParticipant(speakers[0], speakers[0] === room.localParticipant));
        } else {
          setDominantSpeaker(null);
        }
        rebuildParticipants();
      });

      room.on(RE.ConnectionQualityChanged, () => {
        rebuildParticipants();
      });

      room.on(RE.MediaDevicesError, (e: any) => {
        console.error('[LiveKit] Media devices error:', e);
        setError(`Device error: ${e.message || 'Unknown'}`);
      });

      // ── Connect ──────────────────────────────────────
      await room.connect(url, token);

      // Enable mic/camera based on options
      const enableAudio = options?.audio !== false;
      const enableVideo = options?.video !== false;

      if (enableAudio || enableVideo) {
        await room.localParticipant.enableCameraAndMicrophone();
      }

      if (!enableVideo && room.localParticipant.isCameraEnabled) {
        await room.localParticipant.setCameraEnabled(false);
      }

      if (!enableAudio && room.localParticipant.isMicrophoneEnabled) {
        await room.localParticipant.setMicrophoneEnabled(false);
      }

      rebuildParticipants();

    } catch (e: any) {
      console.error('[LiveKit] Connection failed:', e);
      setError(e.message || 'Failed to connect');
      setIsConnecting(false);
      roomRef.current = null;
    }
  }, [isWeb, rebuildParticipants, attachAudio, detachAudio]);

  // ── Disconnect ──────────────────────────────────────────
  const disconnect = useCallback(() => {
    const room = roomRef.current;
    if (room) {
      room.disconnect(true);
      roomRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
    setParticipants([]);
    setActiveSpeakerIds([]);
    setIsMicEnabled(false);
    setIsCameraEnabled(false);
    setIsScreenSharing(false);
    setDominantSpeaker(null);

    // Clean up audio elements
    for (const [, el] of audioElementsRef.current) {
      el.remove();
    }
    audioElementsRef.current.clear();
  }, []);

  // ── Toggle Microphone ───────────────────────────────────
  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room?.localParticipant) return;
    const next = !room.localParticipant.isMicrophoneEnabled;
    await room.localParticipant.setMicrophoneEnabled(next);
    setIsMicEnabled(next);
    rebuildParticipants();
  }, [rebuildParticipants]);

  // ── Toggle Camera ───────────────────────────────────────
  const toggleCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room?.localParticipant) return;
    const next = !room.localParticipant.isCameraEnabled;
    await room.localParticipant.setCameraEnabled(next);
    setIsCameraEnabled(next);
    rebuildParticipants();
  }, [rebuildParticipants]);

  // ── Toggle Screen Share ─────────────────────────────────
  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room?.localParticipant) return;
    const next = !room.localParticipant.isScreenShareEnabled;
    await room.localParticipant.setScreenShareEnabled(next);
    setIsScreenSharing(next);
    rebuildParticipants();
  }, [rebuildParticipants]);

  // ── Cleanup on unmount ──────────────────────────────────
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const localParticipant = participants.find((p) => p.isLocal) || null;

  return {
    isConnected,
    isConnecting,
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
  };
}
