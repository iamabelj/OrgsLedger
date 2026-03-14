// ============================================================
// OrgsLedger — Meeting Room (Clean, Modern UX)
// Streamlined meeting experience with minimal UI, smooth
// animations, and mobile-first design.
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../src/api/client';
import { useAuthStore } from '../../src/stores/auth.store';
import { Colors, FontSize, FontWeight, BorderRadius, Spacing, Shadow } from '../../src/theme';
import { socketClient } from '../../src/api/socket';
import { format } from 'date-fns';

// ── Types ───────────────────────────────────────────────
type MeetingStatus = 'scheduled' | 'active' | 'ended' | 'cancelled';
type RoomPhase = 'lobby' | 'connecting' | 'active' | 'ended';
type PanelKind = 'participants' | 'captions' | 'language' | null;

interface Participant {
  userId: string;
  role: string;
  joinedAt: string;
  leftAt?: string;
  displayName?: string;
  // Local UI state
  isMuted?: boolean;
  isVideoOff?: boolean;
  isSpeaking?: boolean;
}

interface MeetingData {
  id: string;
  organizationId: string;
  hostId: string;
  title?: string;
  description?: string;
  status: MeetingStatus;
  participants: Participant[];
  settings: {
    maxParticipants?: number;
    muteOnEntry?: boolean;
    allowRecording?: boolean;
    allowScreenShare?: boolean;
    waitingRoom?: boolean;
    agenda?: string[];
    [key: string]: any;
  };
  scheduledAt?: string;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
}

interface CaptionEntry {
  id: string;
  speaker: string;
  text: string;
  translatedText?: string;
  timestamp: number;
}

// ── Popular Languages (subset for quick access) ─────────
const POPULAR_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'es', name: 'Spanish', flag: '🇪🇸' },
  { code: 'fr', name: 'French', flag: '🇫🇷' },
  { code: 'de', name: 'German', flag: '🇩🇪' },
  { code: 'pt', name: 'Portuguese', flag: '🇧🇷' },
  { code: 'ar', name: 'Arabic', flag: '🇸🇦' },
  { code: 'zh', name: 'Chinese', flag: '🇨🇳' },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', flag: '🇰🇷' },
  { code: 'hi', name: 'Hindi', flag: '🇮🇳' },
  { code: 'ru', name: 'Russian', flag: '🇷🇺' },
  { code: 'it', name: 'Italian', flag: '🇮🇹' },
  { code: 'nl', name: 'Dutch', flag: '🇳🇱' },
  { code: 'tr', name: 'Turkish', flag: '🇹🇷' },
  { code: 'sw', name: 'Swahili', flag: '🇰🇪' },
  { code: 'pl', name: 'Polish', flag: '🇵🇱' },
  { code: 'uk', name: 'Ukrainian', flag: '🇺🇦' },
  { code: 'th', name: 'Thai', flag: '🇹🇭' },
  { code: 'vi', name: 'Vietnamese', flag: '🇻🇳' },
  { code: 'id', name: 'Indonesian', flag: '🇮🇩' },
];

// ── Helpers ─────────────────────────────────────────────
const win = Dimensions.get('window');
const isSmallScreen = win.width < 768;
const isMobile = Platform.OS !== 'web' || win.width < 480;

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
}

function formatElapsed(startedAt?: string): string {
  if (!startedAt) return '00:00';
  const ms = Date.now() - new Date(startedAt).getTime();
  const secs = Math.floor(ms / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Smart grid layout calculator
function calculateGridLayout(count: number, containerWidth: number, containerHeight: number) {
  if (count === 0) return { cols: 1, rows: 1, tileW: containerWidth, tileH: containerHeight };
  if (count === 1) return { cols: 1, rows: 1, tileW: Math.min(containerWidth, 640), tileH: Math.min(containerHeight, 480) };
  if (count === 2) {
    // Side by side on desktop, stacked on mobile
    if (isSmallScreen) return { cols: 1, rows: 2, tileW: containerWidth - 16, tileH: (containerHeight - 24) / 2 };
    return { cols: 2, rows: 1, tileW: (containerWidth - 16) / 2, tileH: containerHeight - 8 };
  }
  // For 3-4 participants: 2x2 grid
  if (count <= 4) {
    const cols = 2;
    const rows = Math.ceil(count / cols);
    return { cols, rows, tileW: (containerWidth - 16) / cols, tileH: (containerHeight - 16) / rows };
  }
  // For 5-9: 3 column grid
  if (count <= 9) {
    const cols = 3;
    const rows = Math.ceil(count / cols);
    return { cols, rows, tileW: (containerWidth - 24) / cols, tileH: (containerHeight - (rows * 8)) / rows };
  }
  // 10+: 4 column grid
  const cols = 4;
  const rows = Math.ceil(count / cols);
  return { cols, rows, tileW: (containerWidth - 32) / cols, tileH: (containerHeight - (rows * 8)) / rows };
}

// Avatar colors by index
const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
];

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function MeetingRoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  // ── State ─────────────────────────────────────────────
  const [phase, setPhase] = useState<RoomPhase>('lobby');
  const [meeting, setMeeting] = useState<MeetingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lobby state
  const [displayName, setDisplayName] = useState('');
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCameraOn, setIsCameraOn] = useState(true);

  // Active meeting state
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [activePanel, setActivePanel] = useState<PanelKind>(null);
  const [elapsed, setElapsed] = useState('00:00');
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // Captions & translation
  const [captions, setCaptions] = useState<CaptionEntry[]>([]);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [languageSearch, setLanguageSearch] = useState('');
  const [allLanguages, setAllLanguages] = useState(POPULAR_LANGUAGES);

  // End meeting confirmation
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  // ── Animations ────────────────────────────────────────
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const controlsAnim = useRef(new Animated.Value(1)).current;
  const panelAnim = useRef(new Animated.Value(0)).current;
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // WebRTC media
  const localStreamRef = useRef<MediaStream | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const selfVideoRef = useRef<HTMLVideoElement | null>(null);

  // Web Speech API for browser-native transcription
  const speechRecognitionRef = useRef<any>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const isHost = meeting?.hostId === user?.id;
  const activeParticipants = useMemo(
    () => participants.filter((p) => !p.leftAt),
    [participants]
  );

  // ── Load meeting data ─────────────────────────────────
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await api.meetings.get(id);
        const data = res.data?.data;
        if (!cancelled && data) {
          setMeeting(data);
          setParticipants(data.participants || []);
          // If meeting is already active and user already joined, skip lobby
          if (data.status === 'active') {
            const alreadyIn = data.participants?.some(
              (p: Participant) => p.userId === user?.id && !p.leftAt
            );
            if (alreadyIn) {
              setPhase('active');
            }
          }
          // If meeting ended, go to ended phase
          if (data.status === 'ended' || data.status === 'cancelled') {
            setPhase('ended');
          }
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.response?.data?.error || 'Unable to load meeting.');
      } finally {
        if (!cancelled) {
          setLoading(false);
          // Fade in content
          Animated.parallel([
            Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
            Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
          ]).start();
        }
      }
    })();

    return () => { cancelled = true; };
  }, [id, user?.id]);

  // Set default display name from user profile
  useEffect(() => {
    if (user) {
      const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      setDisplayName(name || user.email || '');
    }
  }, [user]);

  // Load all languages
  useEffect(() => {
    (async () => {
      try {
        const res = await api.translation.getLanguages();
        const langs = res.data?.data;
        if (Array.isArray(langs) && langs.length > 0) {
          setAllLanguages(langs.map((l: any) => ({
            code: l.code,
            name: l.name,
            flag: l.flag || '',
          })));
        }
      } catch {
        // Fall back to POPULAR_LANGUAGES
      }
    })();
  }, []);

  // ── Elapsed timer ─────────────────────────────────────
  useEffect(() => {
    if (phase !== 'active' || !meeting?.startedAt) return;
    const interval = setInterval(() => {
      setElapsed(formatElapsed(meeting.startedAt));
    }, 1000);
    return () => clearInterval(interval);
  }, [phase, meeting?.startedAt]);

  // ── WebRTC: Acquire local camera/mic stream ─────────
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (phase === 'ended') return;

    let cancelled = false;
    const stream = localStreamRef.current;

    // Acquire stream if we don't have one yet
    if (!stream) {
      (async () => {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
          localStreamRef.current = s;
          // Apply initial toggle state
          s.getAudioTracks().forEach((t) => { t.enabled = isMicOn; });
          s.getVideoTracks().forEach((t) => { t.enabled = isCameraOn; });
          // Attach to preview video element if it exists
          if (previewVideoRef.current) {
            previewVideoRef.current.srcObject = s;
          }
        } catch {
          // User denied or no device — fall back to avatar
        }
      })();
    }

    return () => {
      cancelled = true;
      // Stop all tracks when leaving the screen
      if (phase === 'ended' || phase === 'lobby') return; // keep stream alive in lobby/active
    };
  }, [phase]);

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
  }, []);

  // Toggle mic track when user taps mic button
  useEffect(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const enabled = phase === 'active' ? !isMuted : isMicOn;
    stream.getAudioTracks().forEach((t) => { t.enabled = enabled; });
  }, [isMicOn, isMuted, phase]);

  // Toggle video track when user taps camera button
  useEffect(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const enabled = phase === 'active' ? isVideoOn : isCameraOn;
    stream.getVideoTracks().forEach((t) => { t.enabled = enabled; });
  }, [isCameraOn, isVideoOn, phase]);

  // ── Socket events for real-time updates ───────────────
  useEffect(() => {
    if (phase !== 'active' || !id) return;

    // Join the socket room for this meeting
    socketClient.emit('meeting:join-room', id);

    const handleParticipantJoined = (data: any) => {
      if (data.meetingId !== id) return;
      setParticipants((prev) => {
        const exists = prev.find((p) => p.userId === data.userId);
        if (exists) {
          return prev.map((p) =>
            p.userId === data.userId ? { ...p, leftAt: undefined, joinedAt: data.joinedAt || new Date().toISOString() } : p
          );
        }
        return [...prev, {
          userId: data.userId,
          role: 'participant',
          joinedAt: data.joinedAt || new Date().toISOString(),
          displayName: data.displayName,
        }];
      });
    };

    const handleParticipantLeft = (data: any) => {
      if (data.meetingId !== id) return;
      setParticipants((prev) =>
        prev.map((p) =>
          p.userId === data.userId ? { ...p, leftAt: new Date().toISOString() } : p
        )
      );
    };

    const handleMeetingEnded = (data: any) => {
      if (data.meetingId !== id) return;
      setPhase('ended');
    };

    const handleCaption = (data: any) => {
      if (data.meetingId !== id || !captionsEnabled) return;
      const entry: CaptionEntry = {
        id: `${Date.now()}-${Math.random()}`,
        speaker: data.speaker || 'Unknown',
        text: data.text || '',
        timestamp: Date.now(),
      };
      // If translation needed, translate async
      if (selectedLanguage !== 'en' && entry.text) {
        api.translation.translate(entry.text, selectedLanguage).then((res) => {
          const translated = res.data?.data?.translatedText;
          if (translated) {
            setCaptions((prev) =>
              prev.map((c) => c.id === entry.id ? { ...c, translatedText: translated } : c)
            );
          }
        }).catch(() => {});
      }
      setCaptions((prev) => [...prev.slice(-49), entry]);
    };

    const unsubJoined = socketClient.on('meeting:participant:joined', handleParticipantJoined);
    const unsubLeft = socketClient.on('meeting:participant:left', handleParticipantLeft);
    const unsubEnded = socketClient.on('meeting:ended', handleMeetingEnded);
    const unsubCaption = socketClient.on('meeting:caption', handleCaption);

    return () => {
      // Leave the socket room
      socketClient.emit('meeting:leave-room', id);
      unsubJoined();
      unsubLeft();
      unsubEnded();
      unsubCaption();
    };
  }, [phase, id, captionsEnabled, selectedLanguage]);

  // ── Web Speech API for browser-native transcription ───
  useEffect(() => {
    // Only run on web + active meeting + captions enabled
    if (Platform.OS !== 'web' || phase !== 'active' || !captionsEnabled || !id) {
      // Stop recognition if running
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch {}
        speechRecognitionRef.current = null;
        setIsTranscribing(false);
      }
      return;
    }

    // Check browser support
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[Captions] Web Speech API not supported in this browser');
      return;
    }

    // Create recognition instance
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US'; // Source language (speaker's language)
    recognition.maxAlternatives = 1;

    let finalTranscript = '';
    let restartTimeout: ReturnType<typeof setTimeout> | null = null;

    recognition.onstart = () => {
      setIsTranscribing(true);
      console.log('[Captions] Speech recognition started');
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript = result[0].transcript.trim();
          if (finalTranscript) {
            // Add to local captions immediately
            const entry: CaptionEntry = {
              id: `${Date.now()}-${Math.random()}`,
              speaker: displayName || user?.displayName || 'You',
              text: finalTranscript,
              timestamp: Date.now(),
            };
            setCaptions((prev) => [...prev.slice(-49), entry]);

            // Send to server for broadcast to others
            socketClient.emit('meeting:caption:send', {
              meetingId: id,
              text: finalTranscript,
              speaker: displayName || user?.displayName || 'Unknown',
            });
            finalTranscript = '';
          }
        } else {
          interim += result[0].transcript;
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.warn('[Captions] Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        setIsTranscribing(false);
      }
      // For other errors, try to restart
      if (['network', 'aborted', 'no-speech'].includes(event.error)) {
        restartTimeout = setTimeout(() => {
          try { recognition.start(); } catch {}
        }, 1000);
      }
    };

    recognition.onend = () => {
      setIsTranscribing(false);
      // Auto-restart if still in active meeting with captions
      if (captionsEnabled && phase === 'active') {
        restartTimeout = setTimeout(() => {
          try { recognition.start(); } catch {}
        }, 500);
      }
    };

    speechRecognitionRef.current = recognition;

    // Start recognition
    try {
      recognition.start();
    } catch (err) {
      console.warn('[Captions] Failed to start speech recognition:', err);
    }

    return () => {
      if (restartTimeout) clearTimeout(restartTimeout);
      try { recognition.stop(); } catch {}
      speechRecognitionRef.current = null;
      setIsTranscribing(false);
    };
  }, [phase, captionsEnabled, id, displayName, user?.displayName]);

  // ── Keep controls always visible for seamless UX ────
  const resetControlsTimer = useCallback(() => {
    // Controls are always visible — no auto-hide
  }, []);

  useEffect(() => {
    if (phase === 'active') resetControlsTimer();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [phase]);

  // ── Actions ───────────────────────────────────────────

  const handleJoinMeeting = async () => {
    if (!id || !meeting) return;
    setPhase('connecting');
    try {
      // If scheduled and user is host, start it first
      if (meeting.status === 'scheduled' && isHost) {
        await api.meetings.start(id);
      }
      // Join the meeting
      await api.meetings.join(id, displayName);
      // Re-fetch meeting data
      const res = await api.meetings.get(id);
      const data = res.data?.data;
      if (data) {
        setMeeting(data);
        setParticipants(data.participants || []);
      }
      setIsMuted(!isMicOn);
      setIsVideoOn(isCameraOn);
      setPhase('active');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to join meeting.');
      setPhase('lobby');
    }
  };

  const handleLeaveMeeting = async () => {
    if (!id) return;
    // Stop camera/mic
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    try {
      await api.meetings.leave(id);
    } catch {
      // best-effort
    }
    router.back();
  };

  const handleEndMeeting = async () => {
    if (!id) return;
    setShowEndConfirm(false);
    // Stop camera/mic
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    try {
      await api.meetings.end(id);
      setPhase('ended');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to end meeting.');
    }
  };

  const togglePanel = (panel: PanelKind) => {
    const newPanel = activePanel === panel ? null : panel;
    // Animate panel
    Animated.timing(panelAnim, {
      toValue: newPanel ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
    setActivePanel(newPanel);
    setShowMoreMenu(false);
  };

  // ── Render: Loading / Error ───────────────────────────
  if (loading) {
    return (
      <View style={s.fullCenter}>
        <View style={s.loadingContainer}>
          <View style={s.loadingPulse}>
            <Ionicons name="videocam" size={36} color={Colors.highlight} />
          </View>
          <Text style={s.loadingText}>Preparing meeting room...</Text>
          <View style={s.loadingBar}>
            <Animated.View style={s.loadingBarFill} />
          </View>
        </View>
      </View>
    );
  }

  if (error && !meeting) {
    return (
      <View style={s.fullCenter}>
        <View style={s.errorContainer}>
          <View style={s.errorIcon}>
            <Ionicons name="alert-circle" size={48} color={Colors.error} />
          </View>
          <Text style={s.errorTitle}>Unable to Load Meeting</Text>
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity style={s.errorBtn} onPress={() => router.back()} activeOpacity={0.8}>
            <Ionicons name="arrow-back" size={18} color={Colors.textWhite} />
            <Text style={s.errorBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Render: LOBBY ─────────────────────────────────────
  if (phase === 'lobby' || phase === 'connecting') {
    return (
      <Animated.View style={[s.lobbyContainer, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        {/* Minimal header */}
        <View style={s.lobbyHeader}>
          <TouchableOpacity onPress={() => router.back()} style={s.lobbyBackBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={26} color={Colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
        </View>

        <ScrollView 
          contentContainerStyle={s.lobbyContent} 
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Camera preview - centered and prominent */}
          <View style={s.previewWrapper}>
            <View style={[s.previewBox, !isCameraOn && s.previewBoxOff]}>
              {Platform.OS === 'web' && isCameraOn ? (
                <View style={{ width: '100%', height: '100%', position: 'relative' }}>
                  <video
                    ref={(el: HTMLVideoElement | null) => {
                      previewVideoRef.current = el;
                      if (el && localStreamRef.current) el.srcObject = localStreamRef.current;
                    }}
                    autoPlay
                    playsInline
                    muted
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      borderRadius: 20,
                      transform: 'scaleX(-1)',
                    } as any}
                  />
                </View>
              ) : !isCameraOn ? (
                <View style={s.previewOffState}>
                  <View style={s.previewOffIcon}>
                    <Ionicons name="videocam-off" size={32} color={Colors.textLight} />
                  </View>
                  <Text style={s.previewOffText}>Camera off</Text>
                </View>
              ) : (
                <View style={s.previewOffState}>
                  <View style={[s.previewAvatar, { backgroundColor: AVATAR_COLORS[0] }]}>
                    <Text style={s.previewAvatarText}>{getInitials(displayName || '?')}</Text>
                  </View>
                </View>
              )}

              {/* Floating device controls over preview */}
              <View style={s.previewControlsFloat}>
                <TouchableOpacity
                  style={[s.deviceBtn, !isMicOn && s.deviceBtnOff]}
                  onPress={() => setIsMicOn(!isMicOn)}
                  activeOpacity={0.8}
                >
                  <Ionicons name={isMicOn ? 'mic' : 'mic-off'} size={24} color={isMicOn ? '#fff' : Colors.error} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.deviceBtn, !isCameraOn && s.deviceBtnOff]}
                  onPress={() => setIsCameraOn(!isCameraOn)}
                  activeOpacity={0.8}
                >
                  <Ionicons name={isCameraOn ? 'videocam' : 'videocam-off'} size={24} color={isCameraOn ? '#fff' : Colors.error} />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Meeting title and info */}
          <View style={s.lobbyInfo}>
            <Text style={s.lobbyTitle}>{meeting?.title || 'Meeting'}</Text>
            {meeting?.scheduledAt ? (
              <Text style={s.lobbyTime}>
                {format(new Date(meeting.scheduledAt), 'EEEE, MMM d · h:mm a')}
              </Text>
            ) : null}
            {isHost ? (
              <View style={s.hostBadge}>
                <Ionicons name="shield-checkmark" size={14} color={Colors.highlight} />
                <Text style={s.hostBadgeText}>Host</Text>
              </View>
            ) : null}
          </View>

          {/* Display name input */}
          <View style={s.nameInputWrapper}>
            <Text style={s.nameLabel}>Your name</Text>
            <TextInput
                style={s.lobbyNameField}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="How you'll appear to others"
                placeholderTextColor={Colors.textLight}
                maxLength={50}
              style={s.nameInput}
            />
          </View>

          {/* Join button - prominent */}
          <TouchableOpacity
            style={[s.joinBtn, phase === 'connecting' && s.joinBtnDisabled]}
            onPress={handleJoinMeeting}
            disabled={phase === 'connecting'}
            activeOpacity={0.85}
          >
            {phase === 'connecting' ? (
              <Text style={s.joinBtnText}>Joining...</Text>
            ) : (
              <Text style={s.joinBtnText}>
                {meeting?.status === 'scheduled' && isHost ? 'Start Meeting' : 'Join Meeting'}
              </Text>
            )}
          </TouchableOpacity>

          {/* Participants waiting */}
          {activeParticipants.length > 0 && meeting?.status === 'active' ? (
            <View style={s.waitingInfo}>
              <View style={s.waitingAvatars}>
                {activeParticipants.slice(0, 3).map((p, i) => (
                  <View key={p.userId} style={[s.waitingAvatar, { marginLeft: i > 0 ? -8 : 0, backgroundColor: AVATAR_COLORS[i] }]}>
                    <Text style={s.waitingAvatarText}>{getInitials(p.displayName || 'U')}</Text>
                  </View>
                ))}
              </View>
              <Text style={s.waitingText}>
                {activeParticipants.length} {activeParticipants.length === 1 ? 'person' : 'people'} in meeting
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </Animated.View>
    );
  }

  // ── Render: ENDED ─────────────────────────────────────
  if (phase === 'ended') {
    return (
      <View style={s.endedContainer}>
        <View style={s.endedCard}>
          <View style={s.endedIconWrap}>
            <Ionicons name="checkmark-circle" size={64} color={Colors.success} />
          </View>
          <Text style={s.endedTitle}>Meeting Ended</Text>
          <Text style={s.endedSub}>{meeting?.title || 'Meeting'}</Text>
          {meeting?.startedAt ? (
            <Text style={s.endedDuration}>
              Duration: {formatElapsed(meeting.startedAt)}
            </Text>
          ) : null}
          <View style={s.endedActions}>
            <TouchableOpacity style={s.endedBtnPrimary} onPress={() => router.back()} activeOpacity={0.85}>
              <Text style={s.endedBtnPrimaryText}>Back to Meetings</Text>
            </TouchableOpacity>
            {meeting?.status === 'ended' ? (
              <TouchableOpacity
                style={s.endedBtnSecondary}
                activeOpacity={0.85}
                onPress={async () => {
                  try {
                    const res = await api.meetings.getMinutes(id!);
                    const data = res.data?.data;
                    if (data?.summary) {
                      alert(data.summary);
                    } else {
                      alert(data?.message || 'Minutes are still being generated.');
                    }
                  } catch {
                    alert('Minutes not available yet.');
                  }
                }}
              >
                <Ionicons name="document-text-outline" size={18} color={Colors.highlight} />
                <Text style={s.endedBtnSecondaryText}>View Minutes</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  // ── Render: ACTIVE MEETING ROOM ───────────────────────
  // Memoize grid participants to prevent unnecessary re-renders
  const gridParticipants = useMemo(() => {
    return activeParticipants.length > 0 ? activeParticipants : [
      { userId: user?.id || '', role: 'host', joinedAt: new Date().toISOString(), displayName: displayName || 'You' },
    ];
  }, [activeParticipants, user?.id, displayName]);

  // Memoize grid layout calculations to prevent tile size changes on every render
  const gridLayout = useMemo(() => {
    const panelW = activePanel && !isMobile ? Math.min(320, win.width * 0.28) : 0;
    const gWidth = win.width - panelW;
    const gHeight = win.height - (isMobile ? 160 : 120);
    const layout = calculateGridLayout(gridParticipants.length, gWidth, gHeight);
    return { panelWidth: panelW, gridWidth: gWidth, gridHeight: gHeight, ...layout };
  }, [activeParticipants.length, activePanel, isMobile, win.width, win.height, gridParticipants.length]);

  const { panelWidth, gridWidth, gridHeight, cols, rows, tileW, tileH } = gridLayout;

  // Memoize the stable tile dimensions
  const stableTileW = useMemo(() => Math.min(tileW, 480), [tileW]);
  const stableTileH = useMemo(() => Math.min(tileH, 360), [tileH]);

  // Memoize localStream to prevent it from being recreated
  const currentLocalStream = localStreamRef.current;

  return (
    <Pressable style={s.roomContainer} onPress={resetControlsTimer}>
      {/* ── Minimal Top Bar ────────────────────────────── */}
      <View style={s.topBar}>
        <View style={s.topBarLive}>
          <View style={s.liveDot} />
          <Text style={s.liveText}>{elapsed}</Text>
        </View>
        <Text style={s.topBarTitle} numberOfLines={1}>{meeting?.title || 'Meeting'}</Text>
        <View style={s.topBarRight}>
          {isRecording && <View style={s.recDot} />}
          <Text style={s.participantCount}>{activeParticipants.length}</Text>
          <Ionicons name="people" size={16} color={Colors.textSecondary} />
        </View>
      </View>

      {/* ── Main Content ────────────────────────────────── */}
      <View style={s.mainArea}>
        {/* Participant Grid */}
        <View style={[s.gridContainer, { width: gridWidth }]}>
          <View style={[s.grid, { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }]}>
            {gridParticipants.map((p, index) => (
              <ParticipantTile
                key={p.userId}
                participant={p}
                width={stableTileW}
                height={stableTileH}
                colorIndex={index}
                isCurrentUser={p.userId === user?.id}
                isMuted={p.userId === user?.id ? isMuted : p.isMuted}
                isVideoOff={p.userId === user?.id ? !isVideoOn : p.isVideoOff}
                localStream={p.userId === user?.id ? currentLocalStream : null}
              />
            ))}
          </View>
        </View>

        {/* Side Panel - slides in on desktop */}
        {activePanel && activePanel !== 'language' && !isMobile ? (
          <Animated.View style={[s.sidePanel, { width: panelWidth, opacity: panelAnim }]}>
            <View style={s.sidePanelHeader}>
              <Text style={s.sidePanelTitle}>
                {activePanel === 'participants' ? 'Participants' : 'Captions'}
              </Text>
              <TouchableOpacity onPress={() => togglePanel(null)} style={s.sidePanelClose}>
                <Ionicons name="close" size={20} color={Colors.textLight} />
              </TouchableOpacity>
            </View>
            {activePanel === 'participants' ? (
              <ParticipantsPanel
                participants={activeParticipants}
                currentUserId={user?.id}
                hostId={meeting?.hostId}
              />
            ) : null}
            {activePanel === 'captions' ? (
              <CaptionsPanel
                captions={captions}
                selectedLanguage={selectedLanguage}
                onChangeLanguage={() => setActivePanel('language')}
                languageName={allLanguages.find((l) => l.code === selectedLanguage)?.name || 'English'}
                isTranscribing={isTranscribing}
              />
            ) : null}
          </Animated.View>
        ) : null}
      </View>

      {/* ── Captions Overlay (floating) ──────────────── */}
      {captionsEnabled && captions.length > 0 && activePanel !== 'captions' ? (
        <CaptionOverlay captions={captions} />
      ) : null}

      {/* ── Simplified Bottom Controls ───────────────── */}
      <View style={[s.controlsBar, isMobile && s.controlsBarMobile]}>
        {/* Core controls */}
        <View style={s.controlsMain}>
          <TouchableOpacity
            style={[s.controlBtn, isMuted && s.controlBtnDanger]}
            onPress={() => setIsMuted(!isMuted)}
            activeOpacity={0.8}
          >
            <Ionicons name={isMuted ? 'mic-off' : 'mic'} size={isMobile ? 28 : 24} color={isMuted ? Colors.error : '#fff'} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.controlBtn, !isVideoOn && s.controlBtnDanger]}
            onPress={() => setIsVideoOn(!isVideoOn)}
            activeOpacity={0.8}
          >
            <Ionicons name={isVideoOn ? 'videocam' : 'videocam-off'} size={isMobile ? 28 : 24} color={!isVideoOn ? Colors.error : '#fff'} />
          </TouchableOpacity>
          {!isMobile && meeting?.settings?.allowScreenShare !== false ? (
            <TouchableOpacity
              style={[s.controlBtn, isScreenSharing && s.controlBtnActive]}
              onPress={() => setIsScreenSharing(!isScreenSharing)}
              activeOpacity={0.8}
            >
              <Ionicons name="share-outline" size={24} color={isScreenSharing ? Colors.highlight : '#fff'} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Secondary controls */}
        <View style={s.controlsSecondary}>
          <TouchableOpacity
            style={[s.controlBtnSmall, activePanel === 'participants' && s.controlBtnSmallActive]}
            onPress={() => togglePanel('participants')}
            activeOpacity={0.8}
          >
            <View style={s.badgeWrap}>
              <Ionicons name="people-outline" size={20} color={activePanel === 'participants' ? Colors.highlight : Colors.textSecondary} />
              {activeParticipants.length > 1 && (
                <View style={s.badge}><Text style={s.badgeText}>{activeParticipants.length}</Text></View>
              )}
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.controlBtnSmall, captionsEnabled && s.controlBtnSmallActive]}
            onPress={() => {
              if (!captionsEnabled) {
                setCaptionsEnabled(true);
                if (!isMobile) togglePanel('captions');
              } else {
                setCaptionsEnabled(false);
                if (activePanel === 'captions') setActivePanel(null);
              }
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={20} color={captionsEnabled ? Colors.highlight : Colors.textSecondary} />
          </TouchableOpacity>
          {!isMobile && (
            <TouchableOpacity
              style={s.controlBtnSmall}
              onPress={() => setShowMoreMenu(!showMoreMenu)}
              activeOpacity={0.8}
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        {/* Leave/End button */}
        <TouchableOpacity
          style={s.leaveBtn}
          onPress={() => isHost ? setShowEndConfirm(true) : handleLeaveMeeting()}
          activeOpacity={0.85}
        >
          <Ionicons name="call" size={20} color="#fff" style={{ transform: [{ rotate: '135deg' }] }} />
          {!isMobile && <Text style={s.leaveBtnText}>{isHost ? 'End' : 'Leave'}</Text>}
        </TouchableOpacity>
      </View>

      {/* ── More menu ────────────────────────────────── */}
      {showMoreMenu && (
        <Pressable style={s.moreMenuOverlay} onPress={() => setShowMoreMenu(false)}>
          <View style={s.moreMenu}>
            <TouchableOpacity style={s.moreMenuItem} onPress={() => { togglePanel('participants'); setShowMoreMenu(false); }}>
              <Ionicons name="people-outline" size={20} color={Colors.textPrimary} />
              <Text style={s.moreMenuText}>Participants</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.moreMenuItem} onPress={() => { setCaptionsEnabled(!captionsEnabled); if (!captionsEnabled) togglePanel('captions'); setShowMoreMenu(false); }}>
              <Ionicons name="chatbubble-ellipses-outline" size={20} color={Colors.textPrimary} />
              <Text style={s.moreMenuText}>Live Captions</Text>
              {captionsEnabled && <Ionicons name="checkmark" size={18} color={Colors.success} />}
            </TouchableOpacity>
            <TouchableOpacity style={s.moreMenuItem} onPress={() => { setActivePanel('language'); setShowMoreMenu(false); }}>
              <Ionicons name="language-outline" size={20} color={Colors.textPrimary} />
              <Text style={s.moreMenuText}>Translation</Text>
              <Text style={s.moreMenuValue}>{allLanguages.find((l) => l.code === selectedLanguage)?.flag}</Text>
            </TouchableOpacity>
            {meeting?.settings?.allowRecording && (
              <TouchableOpacity style={s.moreMenuItem} onPress={() => { setIsRecording(!isRecording); setShowMoreMenu(false); }}>
                <Ionicons name={isRecording ? 'stop-circle' : 'radio-button-on'} size={20} color={isRecording ? Colors.error : Colors.textPrimary} />
                <Text style={s.moreMenuText}>{isRecording ? 'Stop Recording' : 'Record'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </Pressable>
      )}

      {/* ── End Meeting Confirmation ─────────────────── */}
      <Modal visible={showEndConfirm} transparent animationType="fade" onRequestClose={() => setShowEndConfirm(false)}>
        <Pressable style={s.confirmOverlay} onPress={() => setShowEndConfirm(false)}>
          <View style={s.confirmCard}>
            <Text style={s.confirmTitle}>End meeting for everyone?</Text>
            <Text style={s.confirmText}>
              {activeParticipants.length > 1 
                ? `This will end the meeting for all ${activeParticipants.length} participants.`
                : 'The meeting will be ended.'}
            </Text>
            <View style={s.confirmActions}>
              <TouchableOpacity style={s.confirmCancelBtn} onPress={() => setShowEndConfirm(false)} activeOpacity={0.8}>
                <Text style={s.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirmLeaveBtn} onPress={handleLeaveMeeting} activeOpacity={0.8}>
                <Text style={s.confirmLeaveText}>Leave</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirmEndBtn} onPress={handleEndMeeting} activeOpacity={0.8}>
                <Text style={s.confirmEndText}>End for all</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* ── Language Picker Modal ────────────────────── */}
      <LanguagePickerModal
        visible={activePanel === 'language'}
        languages={allLanguages}
        selected={selectedLanguage}
        search={languageSearch}
        onSearch={setLanguageSearch}
        onSelect={(code) => {
          setSelectedLanguage(code);
          setActivePanel(null);
          setLanguageSearch('');
        }}
        onClose={() => { setActivePanel(null); setLanguageSearch(''); }}
      />

      {/* Mobile panels as bottom sheet */}
      {isMobile && activePanel && activePanel !== 'language' && (
        <Modal visible transparent animationType="slide" onRequestClose={() => setActivePanel(null)}>
          <Pressable style={s.mobileSheetOverlay} onPress={() => setActivePanel(null)}>
            <View style={s.mobileSheet}>
              <View style={s.mobileSheetHandle} />
              <View style={s.sidePanelHeader}>
                <Text style={s.sidePanelTitle}>
                  {activePanel === 'participants' ? 'Participants' : 'Captions'}
                </Text>
                <TouchableOpacity onPress={() => setActivePanel(null)} style={s.sidePanelClose}>
                  <Ionicons name="close" size={22} color={Colors.textLight} />
                </TouchableOpacity>
              </View>
              {activePanel === 'participants' && (
                <ParticipantsPanel participants={activeParticipants} currentUserId={user?.id} hostId={meeting?.hostId} />
              )}
              {activePanel === 'captions' && (
                <CaptionsPanel
                  captions={captions}
                  selectedLanguage={selectedLanguage}
                  onChangeLanguage={() => setActivePanel('language')}
                  languageName={allLanguages.find((l) => l.code === selectedLanguage)?.name || 'English'}
                  isTranscribing={isTranscribing}
                />
              )}
            </View>
          </Pressable>
        </Modal>
      )}
    </Pressable>
  );
}

// ── Sub-components ──────────────────────────────────────

// ── Caption Bubble (memoized for overlay) ───────────────
const CaptionBubble = React.memo(function CaptionBubble({
  caption,
}: {
  caption: CaptionEntry;
}) {
  return (
    <View style={s.captionBubble}>
      <Text style={s.captionSpeaker}>{caption.speaker}</Text>
      <Text style={s.captionText}>{caption.translatedText || caption.text}</Text>
    </View>
  );
});

// ── Caption Overlay (memoized floating captions) ────────
const CaptionOverlay = React.memo(function CaptionOverlay({
  captions,
}: {
  captions: CaptionEntry[];
}) {
  // Only show last 2 captions
  const recentCaptions = useMemo(() => captions.slice(-2), [captions]);
  
  return (
    <View style={s.captionOverlay}>
      {recentCaptions.map((c) => (
        <CaptionBubble key={c.id} caption={c} />
      ))}
    </View>
  );
});

// ── Video Element Component ─────────────────────────────
// Memoized component to prevent video blinking from re-renders
const VideoElement = React.memo(function VideoElement({ 
  stream 
}: { 
  stream: MediaStream | null 
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamIdRef = useRef<string | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    // Only update srcObject if the stream actually changed
    const newStreamId = stream?.id || null;
    if (streamIdRef.current !== newStreamId) {
      streamIdRef.current = newStreamId;
      el.srcObject = stream;
    }
  }, [stream]);

  if (Platform.OS !== 'web') return null;

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: 'scaleX(-1)',
      } as any}
    />
  );
});

// ── Participant Tile ────────────────────────────────────
const ParticipantTile = React.memo(function ParticipantTile({
  participant,
  width,
  height,
  colorIndex,
  isCurrentUser,
  isMuted,
  isVideoOff,
  localStream,
}: {
  participant: Participant;
  width: number;
  height: number;
  colorIndex: number;
  isCurrentUser: boolean;
  isMuted?: boolean;
  isVideoOff?: boolean;
  localStream?: MediaStream | null;
}) {
  const name = participant.displayName || `User ${participant.userId.slice(0, 6)}`;
  const color = AVATAR_COLORS[colorIndex % AVATAR_COLORS.length];
  const isSpeaking = participant.isSpeaking;
  const showVideo = isCurrentUser && !isVideoOff && localStream && Platform.OS === 'web';

  return (
    <View
      style={[
        s.tile,
        { width, height },
        isSpeaking && { borderColor: Colors.success, borderWidth: 3 },
      ]}
    >
      {showVideo ? (
        <View style={{ flex: 1, overflow: 'hidden' }}>
          <VideoElement stream={localStream} />
        </View>
      ) : (
        <View style={[s.tileAvatarContainer, { backgroundColor: isVideoOff !== false ? color + '22' : '#111' }]}>
          <View style={[s.tileAvatar, { backgroundColor: color }]}>
            <Text style={s.tileAvatarText}>{getInitials(name)}</Text>
          </View>
        </View>
      )}

      {/* Name bar */}
      <View style={s.tileNameBar}>
        {isMuted ? (
          <Ionicons name="mic-off" size={13} color={Colors.error} style={{ marginRight: 4 }} />
        ) : null}
        <Text style={s.tileName} numberOfLines={1}>
          {name}{isCurrentUser ? ' (You)' : ''}
        </Text>
        {participant.role === 'host' ? (
          <View style={s.tileHostBadge}>
            <Text style={s.tileHostText}>Host</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
});

// ── Control Button ──────────────────────────────────────
function ControlButton({
  icon,
  label,
  isActive,
  isDanger,
  badge,
  onPress,
}: {
  icon: string;
  label: string;
  isActive?: boolean;
  isDanger?: boolean;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        s.controlBtn,
        isDanger && s.controlBtnDanger,
        isActive && !isDanger && s.controlBtnActive,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={s.controlBtnInner}>
        <Ionicons
          name={icon as any}
          size={22}
          color={isDanger ? Colors.error : isActive ? Colors.highlight : Colors.textPrimary}
        />
        {badge !== undefined && badge > 0 ? (
          <View style={s.controlBadge}>
            <Text style={s.controlBadgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text
        style={[
          s.controlLabel,
          isDanger && { color: Colors.error },
          isActive && !isDanger && { color: Colors.highlight },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Participants Panel ──────────────────────────────────
function ParticipantsPanel({
  participants,
  currentUserId,
  hostId,
}: {
  participants: Participant[];
  currentUserId?: string;
  hostId?: string;
}) {
  return (
    <ScrollView style={s.panelScroll} showsVerticalScrollIndicator={false}>
      {participants.map((p, i) => {
        const name = p.displayName || `User ${p.userId.slice(0, 6)}`;
        const isMe = p.userId === currentUserId;
        const isParticipantHost = p.userId === hostId;
        const color = AVATAR_COLORS[i % AVATAR_COLORS.length];

        return (
          <View key={p.userId} style={s.participantRow}>
            <View style={[s.participantAvatar, { backgroundColor: color }]}>
              <Text style={s.participantAvatarText}>{getInitials(name)}</Text>
            </View>
            <View style={s.participantInfo}>
              <Text style={s.participantName} numberOfLines={1}>
                {name}{isMe ? ' (You)' : ''}
              </Text>
              <Text style={s.participantRole}>
                {isParticipantHost ? 'Host' : p.role || 'Participant'}
              </Text>
            </View>
            <View style={s.participantIcons}>
              <Ionicons
                name={p.isMuted ? 'mic-off' : 'mic'}
                size={16}
                color={p.isMuted ? Colors.error : Colors.success}
              />
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

// ── Caption Entry Item (memoized to prevent blinking) ───
const CaptionEntryItem = React.memo(function CaptionEntryItem({
  caption,
  showOriginal,
}: {
  caption: CaptionEntry;
  showOriginal: boolean;
}) {
  return (
    <View style={s.captionEntry}>
      <Text style={s.captionEntrySpeaker}>{caption.speaker}</Text>
      <Text style={s.captionEntryText}>
        {caption.translatedText || caption.text}
      </Text>
      {caption.translatedText && showOriginal ? (
        <Text style={s.captionEntryOriginal}>{caption.text}</Text>
      ) : null}
    </View>
  );
});

// ── Captions Panel (memoized) ───────────────────────────
const CaptionsPanel = React.memo(function CaptionsPanel({
  captions,
  selectedLanguage,
  onChangeLanguage,
  languageName,
  isTranscribing,
}: {
  captions: CaptionEntry[];
  selectedLanguage: string;
  onChangeLanguage: () => void;
  languageName: string;
  isTranscribing?: boolean;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const showOriginal = selectedLanguage !== 'en';

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [captions.length]);

  return (
    <View style={s.captionsPanel}>
      {/* Transcribing indicator */}
      {isTranscribing ? (
        <View style={s.transcribingBar}>
          <View style={s.transcribingDot} />
          <Text style={s.transcribingText}>Transcribing your speech...</Text>
        </View>
      ) : null}
      <TouchableOpacity style={s.captionsLangBtn} onPress={onChangeLanguage}>
        <Ionicons name="language-outline" size={16} color={Colors.highlight} />
        <Text style={s.captionsLangText}>Translating to: {languageName}</Text>
        <Ionicons name="chevron-forward" size={14} color={Colors.textLight} />
      </TouchableOpacity>
      <ScrollView ref={scrollRef} style={s.captionsScroll} showsVerticalScrollIndicator={false}>
        {captions.length === 0 ? (
          <View style={s.captionsEmpty}>
            <Ionicons name="chatbubble-ellipses-outline" size={32} color={Colors.textLight} />
            <Text style={s.captionsEmptyText}>
              Captions will appear here as participants speak
            </Text>
          </View>
        ) : (
          captions.map((c) => (
            <CaptionEntryItem key={c.id} caption={c} showOriginal={showOriginal} />
          ))
        )}
      </ScrollView>
    </View>
  );
});

// ── Language Picker Modal ───────────────────────────────
function LanguagePickerModal({
  visible,
  languages,
  selected,
  search,
  onSearch,
  onSelect,
  onClose,
}: {
  visible: boolean;
  languages: { code: string; name: string; flag: string }[];
  selected: string;
  search: string;
  onSearch: (v: string) => void;
  onSelect: (code: string) => void;
  onClose: () => void;
}) {
  const filtered = useMemo(() => {
    if (!search.trim()) return languages;
    const q = search.toLowerCase();
    return languages.filter(
      (l) => l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q)
    );
  }, [languages, search]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.langModalOverlay}>
        <View style={s.langModalCard}>
          <View style={s.langModalHeader}>
            <Text style={s.langModalTitle}>Select Language</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={Colors.textLight} />
            </TouchableOpacity>
          </View>
          <Text style={s.langModalSub}>
            Live captions will be translated to your selected language in real-time
          </Text>
          <View style={s.langSearchBox}>
            <Ionicons name="search" size={18} color={Colors.textLight} />
            <TextInput
              style={s.langSearchInput}
              value={search}
              onChangeText={onSearch}
              placeholder="Search languages..."
              placeholderTextColor={Colors.textLight}
              autoFocus
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.code}
            style={s.langList}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[s.langItem, item.code === selected && s.langItemActive]}
                onPress={() => onSelect(item.code)}
              >
                <Text style={s.langItemFlag}>{item.flag}</Text>
                <Text style={[s.langItemName, item.code === selected && s.langItemNameActive]}>
                  {item.name}
                </Text>
                {item.code === selected ? (
                  <Ionicons name="checkmark-circle" size={20} color={Colors.highlight} />
                ) : null}
              </TouchableOpacity>
            )}
            ListEmptyComponent={
              <View style={s.langEmpty}>
                <Text style={s.langEmptyText}>No languages found</Text>
              </View>
            }
          />
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────
const s = StyleSheet.create({
  // ── Full-screen states ────────────────────────────
  fullCenter: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  loadingContainer: {
    alignItems: 'center',
    gap: Spacing.lg,
  },
  loadingPulse: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.highlightSubtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: { fontSize: FontSize.md, color: Colors.textSecondary },
  loadingBar: {
    width: 120,
    height: 3,
    backgroundColor: Colors.primaryMid,
    borderRadius: 2,
    overflow: 'hidden',
  },
  loadingBarFill: {
    width: '40%',
    height: '100%',
    backgroundColor: Colors.highlight,
    borderRadius: 2,
  },
  errorContainer: {
    alignItems: 'center',
    maxWidth: 320,
    gap: Spacing.md,
  },
  errorIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.error + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  errorText: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center' },
  errorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm + 4,
    backgroundColor: Colors.highlight,
    borderRadius: BorderRadius.full,
    marginTop: Spacing.md,
  },
  errorBtnText: { color: '#fff', fontWeight: FontWeight.semibold, fontSize: FontSize.md },

  // ── Lobby (Clean, minimal) ────────────────────────
  lobbyContainer: { flex: 1, backgroundColor: Colors.background },
  lobbyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: Platform.OS === 'web' ? Spacing.md : Spacing.xl + 10,
    paddingBottom: Spacing.sm,
  },
  lobbyBackBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lobbyContent: {
    flexGrow: 1,
    padding: Spacing.lg,
    paddingTop: 0,
    alignItems: 'center',
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },

  // Preview - larger, centered
  previewWrapper: { width: '100%', marginBottom: Spacing.xl },
  previewBox: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: '#1a1a1a',
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  previewBoxOff: { backgroundColor: '#111' },
  previewOffState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewOffIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewOffText: { fontSize: FontSize.sm, color: Colors.textLight, marginTop: Spacing.sm },
  previewAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewAvatarText: { fontSize: 26, fontWeight: FontWeight.bold, color: '#fff' },
  previewControlsFloat: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  deviceBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deviceBtnOff: {
    backgroundColor: 'rgba(192,57,43,0.3)',
  },

  // Lobby info
  lobbyInfo: { width: '100%', alignItems: 'center', marginBottom: Spacing.lg },
  lobbyTitle: {
    fontSize: 22,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  lobbyTime: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  hostBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    backgroundColor: Colors.highlightSubtle,
    borderRadius: BorderRadius.full,
  },
  hostBadgeText: { fontSize: FontSize.xs, color: Colors.highlight, fontWeight: FontWeight.semibold },

  // Name input
  nameInputWrapper: { width: '100%', marginBottom: Spacing.lg },
  nameLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: 6 },
  nameInput: {
    width: '100%',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    fontSize: FontSize.md,
    color: Colors.textPrimary,
    textAlign: 'center',
  },

  // Join button
  joinBtn: {
    width: '100%',
    paddingVertical: Spacing.md + 2,
    backgroundColor: Colors.highlight,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
  },
  joinBtnDisabled: { opacity: 0.6 },
  joinBtnText: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: '#fff' },

  // Waiting participants
  waitingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  waitingAvatars: { flexDirection: 'row' },
  waitingAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.background,
  },
  waitingAvatarText: { fontSize: 10, fontWeight: FontWeight.bold, color: '#fff' },
  waitingText: { fontSize: FontSize.sm, color: Colors.textSecondary },

  // ── Ended state ───────────────────────────────────
  endedContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  endedCard: {
    alignItems: 'center',
    maxWidth: 360,
    gap: Spacing.sm,
  },
  endedIconWrap: { marginBottom: Spacing.md },
  endedTitle: { fontSize: FontSize.title, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  endedSub: { fontSize: FontSize.lg, color: Colors.textSecondary },
  endedDuration: { fontSize: FontSize.md, color: Colors.textLight },
  endedActions: {
    flexDirection: 'column',
    gap: Spacing.sm,
    marginTop: Spacing.xl,
    width: '100%',
    maxWidth: 280,
  },
  endedBtnPrimary: {
    paddingVertical: Spacing.sm + 4,
    backgroundColor: Colors.highlight,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
  },
  endedBtnPrimaryText: { fontSize: FontSize.md, color: '#fff', fontWeight: FontWeight.semibold },
  endedBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.sm + 4,
    backgroundColor: Colors.primaryMid,
    borderRadius: BorderRadius.full,
  },
  endedBtnSecondaryText: { fontSize: FontSize.md, color: Colors.highlight, fontWeight: FontWeight.semibold },

  // ── Active Room ───────────────────────────────────
  roomContainer: { flex: 1, backgroundColor: '#0a0a0a' },

  // Top bar (minimal)
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingTop: Platform.OS === 'web' ? Spacing.sm : Spacing.lg + 10,
    paddingBottom: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.4)',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  topBarLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  topBarLive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(46, 204, 113, 0.2)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success },
  liveText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.success },
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(192, 57, 43, 0.25)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.error },
  recText: { fontSize: 10, fontWeight: FontWeight.bold, color: Colors.error },
  topBarTitle: { flex: 1, textAlign: 'center', fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textPrimary, marginHorizontal: Spacing.sm },
  topBarRight: { flexDirection: 'row', alignItems: 'center' },
  participantCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  participantCountText: { fontSize: FontSize.sm, color: Colors.textSecondary },

  // Main area
  mainArea: { flex: 1, flexDirection: 'row', paddingTop: Platform.OS === 'web' ? 56 : 72, paddingBottom: 88 },

  // Grid
  gridContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', padding: 4 },

  // Participant tile
  tile: {
    margin: 4,
    borderRadius: BorderRadius.lg,
    backgroundColor: '#1a1a2e',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tileAvatarContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tileAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tileAvatarText: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.textWhite },
  tileNameBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  tileName: { flex: 1, fontSize: FontSize.xs, color: Colors.textPrimary, fontWeight: FontWeight.medium },
  tileHostBadge: {
    backgroundColor: Colors.highlightSubtle,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.sm,
    marginLeft: 4,
  },
  tileHostText: { fontSize: 9, color: Colors.highlight, fontWeight: FontWeight.bold },

  // Side panel
  sidePanel: {
    backgroundColor: Colors.surface,
    borderLeftWidth: 1,
    borderLeftColor: Colors.border,
  },
  sidePanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  sidePanelTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  sidePanelClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.primaryMid,
    justifyContent: 'center',
    alignItems: 'center',
  },
  panelScroll: { flex: 1, padding: Spacing.md },

  // Participant row (in panel)
  participantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm + 2,
    gap: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  participantAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  participantAvatarText: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.textWhite },
  participantInfo: { flex: 1 },
  participantName: { fontSize: FontSize.md, fontWeight: FontWeight.medium, color: Colors.textPrimary },
  participantRole: { fontSize: FontSize.xs, color: Colors.textLight, textTransform: 'capitalize' },
  participantIcons: { flexDirection: 'row', gap: Spacing.xs },

  // Controls bar (simplified)
  controlsBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    paddingBottom: Platform.OS === 'web' ? Spacing.md : Spacing.lg + 8,
    backgroundColor: 'rgba(0,0,0,0.8)',
    gap: Spacing.xs,
    zIndex: 10,
  },
  controlsBarMobile: {
    paddingVertical: Spacing.sm,
    paddingBottom: Spacing.xl,
    gap: Spacing.sm,
    flexWrap: 'wrap',
    justifyContent: 'space-evenly',
  },
  controlsMain: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  controlsSecondary: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginLeft: Spacing.sm },
  
  // Control buttons
  controlBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  controlBtnDanger: { backgroundColor: 'rgba(192, 57, 43, 0.3)' },
  controlBtnActive: { backgroundColor: 'rgba(201, 168, 76, 0.2)' },
  controlBtnSmall: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  controlBtnSmallActive: { backgroundColor: 'rgba(201, 168, 76, 0.15)' },
  
  // Badge
  badgeWrap: { position: 'relative' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.highlight,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { fontSize: 10, fontWeight: FontWeight.bold, color: Colors.primary },

  controlBtnInner: { position: 'relative' },
  controlBadge: {
    position: 'absolute',
    top: -6,
    right: -10,
    backgroundColor: Colors.highlight,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  controlBadgeText: { fontSize: 9, fontWeight: FontWeight.bold, color: Colors.primary },
  controlLabel: { fontSize: 10, color: Colors.textSecondary, marginTop: 3 },

  // Leave button
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.error,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    borderRadius: BorderRadius.full,
    marginLeft: Spacing.sm,
  },
  leaveBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.textWhite },

  // Caption overlay
  captionOverlay: {
    position: 'absolute',
    bottom: 90,
    left: Spacing.xl,
    right: Spacing.xl,
    alignItems: 'center',
    zIndex: 5,
  },
  captionBubble: {
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    marginBottom: 4,
    maxWidth: '100%',
  },
  captionSpeaker: { fontSize: FontSize.xs, color: Colors.highlight, fontWeight: FontWeight.semibold, marginBottom: 2 },
  captionText: { fontSize: FontSize.md, color: Colors.textPrimary, lineHeight: 22 },

  // Captions panel
  captionsPanel: { flex: 1 },
  transcribingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.success + '15',
    borderBottomWidth: 1,
    borderBottomColor: Colors.success + '33',
  },
  transcribingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
  transcribingText: {
    fontSize: FontSize.xs,
    color: Colors.success,
    fontWeight: FontWeight.medium,
  },
  captionsLangBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  captionsLangText: { flex: 1, fontSize: FontSize.sm, color: Colors.highlight },
  captionsScroll: { flex: 1, padding: Spacing.md },
  captionsEmpty: { alignItems: 'center', paddingTop: Spacing.xxl },
  captionsEmptyText: { fontSize: FontSize.sm, color: Colors.textLight, textAlign: 'center', marginTop: Spacing.sm },
  captionEntry: { marginBottom: Spacing.md },
  captionEntrySpeaker: { fontSize: FontSize.xs, color: Colors.highlight, fontWeight: FontWeight.semibold, marginBottom: 2 },
  captionEntryText: { fontSize: FontSize.md, color: Colors.textPrimary, lineHeight: 22 },
  captionEntryOriginal: { fontSize: FontSize.xs, color: Colors.textLight, fontStyle: 'italic', marginTop: 2 },

  // More menu
  moreMenuOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 19,
  },
  moreMenu: {
    position: 'absolute',
    bottom: 100,
    right: Spacing.md,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.lg,
    padding: Spacing.sm,
    minWidth: 240,
    ...Shadow.lg,
    zIndex: 20,
  },
  moreMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  moreMenuText: { flex: 1, fontSize: FontSize.md, color: Colors.textPrimary },
  moreMenuValue: { fontSize: FontSize.sm, color: Colors.textLight },
  moreMenuToggle: {
    width: 32,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.primaryMid,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  moreMenuToggleOn: { backgroundColor: Colors.success },
  moreMenuAgenda: {
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    marginTop: Spacing.xs,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  moreMenuAgendaHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.xs },
  moreMenuAgendaTitle: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.highlight, textTransform: 'uppercase' },
  moreMenuAgendaItem: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: 3, paddingLeft: Spacing.xs },

  // Mobile bottom sheet
  mobileSheetOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 50,
    justifyContent: 'flex-end',
  },
  mobileSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    minHeight: 300,
    paddingBottom: Spacing.xl,
  },
  mobileSheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: Colors.borderLight,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },

  // End confirm modal
  confirmOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', alignItems: 'center' },
  confirmCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.xxl,
    padding: Spacing.xl,
    alignItems: 'center',
    maxWidth: 380,
    width: '90%',
    ...Shadow.lg,
  },
  confirmTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary, marginTop: Spacing.md },
  confirmText: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.sm, lineHeight: 22 },
  confirmActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg, flexWrap: 'wrap', justifyContent: 'center' },
  confirmCancelBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryMid,
  },
  confirmCancelText: { fontSize: FontSize.md, color: Colors.textPrimary, fontWeight: FontWeight.semibold },
  confirmEndBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.error,
  },
  confirmEndText: { fontSize: FontSize.md, color: Colors.textWhite, fontWeight: FontWeight.semibold },
  confirmLeaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.warning,
  },
  confirmLeaveText: { fontSize: FontSize.md, color: Colors.textWhite, fontWeight: FontWeight.semibold },

  // ── Language Picker Modal ─────────────────────────
  langModalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  langModalCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xxl,
    borderTopRightRadius: BorderRadius.xxl,
    maxHeight: '80%',
    padding: Spacing.lg,
  },
  langModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  langModalTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  langModalSub: { fontSize: FontSize.sm, color: Colors.textLight, marginBottom: Spacing.md },
  langSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.md,
  },
  langSearchInput: { flex: 1, paddingVertical: Spacing.sm + 2, fontSize: FontSize.md, color: Colors.textPrimary },
  langList: { maxHeight: 400 },
  langItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  langItemActive: { backgroundColor: Colors.highlightSubtle },
  langItemFlag: { fontSize: 22 },
  langItemName: { flex: 1, fontSize: FontSize.md, color: Colors.textPrimary },
  langItemNameActive: { color: Colors.highlight, fontWeight: FontWeight.semibold },
  langEmpty: { alignItems: 'center', padding: Spacing.xl },
  langEmptyText: { color: Colors.textLight },
});
