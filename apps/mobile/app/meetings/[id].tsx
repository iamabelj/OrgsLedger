// ============================================================
// OrgsLedger — Meeting Room (Zoom-like UX)
// Full-screen meeting experience with lobby, participant grid,
// controls toolbar, participants panel, live captions & language
// translation selector.
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

  // Animations
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        if (!cancelled) setLoading(false);
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

  // ── Socket events for real-time updates ───────────────
  useEffect(() => {
    if (phase !== 'active' || !id) return;

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

    socketClient.on('meeting:participant:joined', handleParticipantJoined);
    socketClient.on('meeting:participant:left', handleParticipantLeft);
    socketClient.on('meeting:ended', handleMeetingEnded);
    socketClient.on('meeting:caption', handleCaption);

    return () => {
      socketClient.off('meeting:participant:joined', handleParticipantJoined);
      socketClient.off('meeting:participant:left', handleParticipantLeft);
      socketClient.off('meeting:ended', handleMeetingEnded);
      socketClient.off('meeting:caption', handleCaption);
    };
  }, [phase, id, captionsEnabled, selectedLanguage]);

  // ── Auto-hide controls in active meeting ──────────────
  const resetControlsTimer = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!controlsVisible) {
      setControlsVisible(true);
      Animated.timing(controlsOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    }
    hideTimer.current = setTimeout(() => {
      Animated.timing(controlsOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => {
        setControlsVisible(false);
      });
    }, 5000);
  }, [controlsVisible, controlsOpacity]);

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
    try {
      await api.meetings.end(id);
      setPhase('ended');
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to end meeting.');
    }
  };

  const togglePanel = (panel: PanelKind) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
    setShowMoreMenu(false);
  };

  // ── Render: Loading / Error ───────────────────────────
  if (loading) {
    return (
      <View style={s.fullCenter}>
        <View style={s.loadingDot}>
          <Ionicons name="videocam" size={32} color={Colors.highlight} />
        </View>
        <Text style={s.loadingText}>Loading meeting...</Text>
      </View>
    );
  }

  if (error && !meeting) {
    return (
      <View style={s.fullCenter}>
        <Ionicons name="alert-circle-outline" size={48} color={Colors.error} />
        <Text style={s.errorText}>{error}</Text>
        <TouchableOpacity style={s.errorBtn} onPress={() => router.back()}>
          <Text style={s.errorBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Render: LOBBY ─────────────────────────────────────
  if (phase === 'lobby' || phase === 'connecting') {
    return (
      <View style={s.lobbyContainer}>
        {/* Top bar */}
        <View style={s.lobbyTopBar}>
          <TouchableOpacity onPress={() => router.back()} style={s.lobbyBackBtn}>
            <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.lobbyTopTitle} numberOfLines={1}>
            {meeting?.title || 'Meeting'}
          </Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={s.lobbyContent} showsVerticalScrollIndicator={false}>
          {/* Camera preview placeholder */}
          <View style={s.previewContainer}>
            <View style={[s.previewBox, !isCameraOn && s.previewBoxOff]}>
              {isCameraOn ? (
                <>
                  <View style={s.previewAvatar}>
                    <Text style={s.previewAvatarText}>{getInitials(displayName || '?')}</Text>
                  </View>
                  <Text style={s.previewHelp}>Camera preview will appear when connected</Text>
                </>
              ) : (
                <>
                  <View style={[s.previewAvatar, { backgroundColor: Colors.primaryMid }]}>
                    <Ionicons name="videocam-off" size={36} color={Colors.textLight} />
                  </View>
                  <Text style={s.previewHelp}>Camera is off</Text>
                </>
              )}
            </View>

            {/* Device toggles */}
            <View style={s.previewControls}>
              <TouchableOpacity
                style={[s.previewToggle, !isMicOn && s.previewToggleOff]}
                onPress={() => setIsMicOn(!isMicOn)}
              >
                <Ionicons
                  name={isMicOn ? 'mic' : 'mic-off'}
                  size={22}
                  color={isMicOn ? Colors.textWhite : Colors.error}
                />
                <Text style={[s.previewToggleLabel, !isMicOn && { color: Colors.error }]}>
                  {isMicOn ? 'Mic On' : 'Mic Off'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.previewToggle, !isCameraOn && s.previewToggleOff]}
                onPress={() => setIsCameraOn(!isCameraOn)}
              >
                <Ionicons
                  name={isCameraOn ? 'videocam' : 'videocam-off'}
                  size={22}
                  color={isCameraOn ? Colors.textWhite : Colors.error}
                />
                <Text style={[s.previewToggleLabel, !isCameraOn && { color: Colors.error }]}>
                  {isCameraOn ? 'Camera On' : 'Camera Off'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Meeting info */}
          <View style={s.lobbyInfo}>
            <Text style={s.lobbyTitle}>{meeting?.title || 'Untitled Meeting'}</Text>
            {meeting?.description ? (
              <Text style={s.lobbyDescription}>{meeting.description}</Text>
            ) : null}
            <View style={s.lobbyMeta}>
              {meeting?.scheduledAt ? (
                <View style={s.lobbyMetaRow}>
                  <Ionicons name="calendar-outline" size={15} color={Colors.textLight} />
                  <Text style={s.lobbyMetaText}>
                    {format(new Date(meeting.scheduledAt), 'MMM d, yyyy · h:mm a')}
                  </Text>
                </View>
              ) : null}
              <View style={s.lobbyMetaRow}>
                <Ionicons name="people-outline" size={15} color={Colors.textLight} />
                <Text style={s.lobbyMetaText}>
                  {activeParticipants.length} participant{activeParticipants.length !== 1 ? 's' : ''}
                  {meeting?.status === 'active' ? ' in meeting' : ''}
                </Text>
              </View>
              {isHost ? (
                <View style={s.lobbyMetaRow}>
                  <Ionicons name="shield-checkmark" size={15} color={Colors.highlight} />
                  <Text style={[s.lobbyMetaText, { color: Colors.highlight }]}>You are the host</Text>
                </View>
              ) : null}
            </View>

            {/* Agenda preview */}
            {meeting?.settings?.agenda && meeting.settings.agenda.length > 0 ? (
              <View style={s.lobbyAgenda}>
                <Text style={s.lobbyAgendaTitle}>Agenda</Text>
                {meeting.settings.agenda.map((item, i) => (
                  <View key={i} style={s.lobbyAgendaItem}>
                    <View style={s.lobbyAgendaDot}>
                      <Text style={s.lobbyAgendaNum}>{i + 1}</Text>
                    </View>
                    <Text style={s.lobbyAgendaText}>{item}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

          {/* Display name */}
          <View style={s.lobbyNameSection}>
            <Text style={s.lobbyFieldLabel}>YOUR DISPLAY NAME</Text>
            <View style={s.lobbyNameInput}>
              <Ionicons name="person-outline" size={18} color={Colors.textLight} />
              <TextInput
                style={s.lobbyNameField}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Enter your name"
                placeholderTextColor={Colors.textLight}
                maxLength={50}
              />
            </View>
          </View>

          {/* Language selection */}
          <View style={s.lobbyLangSection}>
            <Text style={s.lobbyFieldLabel}>CAPTION LANGUAGE</Text>
            <Text style={s.lobbyFieldHint}>
              Live captions will be translated to your selected language
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.langScroll}>
              <View style={s.langRow}>
                {POPULAR_LANGUAGES.slice(0, 10).map((lang) => (
                  <TouchableOpacity
                    key={lang.code}
                    style={[s.langChip, selectedLanguage === lang.code && s.langChipActive]}
                    onPress={() => setSelectedLanguage(lang.code)}
                  >
                    <Text style={s.langFlag}>{lang.flag}</Text>
                    <Text style={[s.langName, selectedLanguage === lang.code && s.langNameActive]}>
                      {lang.name}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={s.langChipMore}
                  onPress={() => setActivePanel('language')}
                >
                  <Ionicons name="ellipsis-horizontal" size={16} color={Colors.highlight} />
                  <Text style={s.langMoreText}>More</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>

          {/* Join button */}
          <TouchableOpacity
            style={[s.joinBtn, phase === 'connecting' && { opacity: 0.6 }]}
            onPress={handleJoinMeeting}
            disabled={phase === 'connecting'}
            activeOpacity={0.8}
          >
            {phase === 'connecting' ? (
              <>
                <Ionicons name="sync" size={20} color={Colors.textWhite} />
                <Text style={s.joinBtnText}>Connecting...</Text>
              </>
            ) : (
              <>
                <Ionicons name="videocam" size={20} color={Colors.textWhite} />
                <Text style={s.joinBtnText}>
                  {meeting?.status === 'scheduled' && isHost ? 'Start & Join' : 'Join Meeting'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>

        {/* Language picker modal (from lobby) */}
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
      </View>
    );
  }

  // ── Render: ENDED ─────────────────────────────────────
  if (phase === 'ended') {
    return (
      <View style={s.fullCenter}>
        <View style={s.endedIcon}>
          <Ionicons name="checkmark-circle" size={56} color={Colors.success} />
        </View>
        <Text style={s.endedTitle}>Meeting Ended</Text>
        <Text style={s.endedSub}>{meeting?.title || 'Meeting'}</Text>
        {meeting?.startedAt && meeting?.endedAt ? (
          <Text style={s.endedDuration}>
            Duration: {formatElapsed(meeting.startedAt).replace(/^0+:/, '')}
          </Text>
        ) : null}
        <View style={s.endedActions}>
          <TouchableOpacity style={s.endedBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={18} color={Colors.textWhite} />
            <Text style={s.endedBtnText}>Back to Meetings</Text>
          </TouchableOpacity>
          {meeting?.status === 'ended' ? (
            <TouchableOpacity
              style={[s.endedBtn, { backgroundColor: Colors.info }]}
              onPress={async () => {
                try {
                  const res = await api.meetings.getMinutes(id!);
                  const data = res.data?.data;
                  if (data?.summary) {
                    // Could navigate to a minutes detail screen
                    alert(data.summary);
                  } else {
                    alert(data?.message || 'Minutes are still being generated.');
                  }
                } catch {
                  alert('Minutes not available yet.');
                }
              }}
            >
              <Ionicons name="document-text-outline" size={18} color={Colors.textWhite} />
              <Text style={s.endedBtnText}>View Minutes</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }

  // ── Render: ACTIVE MEETING ROOM ───────────────────────
  const gridParticipants = activeParticipants.length > 0 ? activeParticipants : [
    { userId: user?.id || '', role: 'host', joinedAt: new Date().toISOString(), displayName: displayName || 'You' },
  ];

  // Calculate grid layout
  const panelWidth = activePanel ? Math.min(360, win.width * 0.3) : 0;
  const gridWidth = win.width - panelWidth;
  const count = gridParticipants.length;
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
  const rows = Math.ceil(count / cols);
  const tileW = Math.floor(gridWidth / cols) - 8;
  const tileH = Math.floor((win.height - 140) / rows) - 8;

  return (
    <Pressable style={s.roomContainer} onPress={resetControlsTimer}>
      {/* ── Top Bar ────────────────────────────────────── */}
      <Animated.View style={[s.topBar, { opacity: controlsOpacity }]}>
        <View style={s.topBarLeft}>
          <View style={s.topBarLive}>
            <View style={s.liveDot} />
            <Text style={s.liveText}>{elapsed}</Text>
          </View>
          {isRecording ? (
            <View style={s.recBadge}>
              <View style={s.recDot} />
              <Text style={s.recText}>REC</Text>
            </View>
          ) : null}
        </View>
        <Text style={s.topBarTitle} numberOfLines={1}>{meeting?.title || 'Meeting'}</Text>
        <View style={s.topBarRight}>
          <Text style={s.participantCountText}>
            <Ionicons name="people" size={14} color={Colors.textSecondary} />
            {' '}{activeParticipants.length}
          </Text>
        </View>
      </Animated.View>

      {/* ── Main Content (Grid + Side Panel) ──────────── */}
      <View style={s.mainArea}>
        {/* Participant Grid */}
        <View style={[s.gridContainer, { width: gridWidth }]}>
          <View style={s.grid}>
            {gridParticipants.map((p, index) => (
              <ParticipantTile
                key={p.userId}
                participant={p}
                width={tileW}
                height={tileH}
                colorIndex={index}
                isCurrentUser={p.userId === user?.id}
                isMuted={p.userId === user?.id ? isMuted : p.isMuted}
                isVideoOff={p.userId === user?.id ? !isVideoOn : p.isVideoOff}
              />
            ))}
          </View>
        </View>

        {/* Side Panel */}
        {activePanel && activePanel !== 'language' ? (
          <View style={[s.sidePanel, { width: panelWidth }]}>
            <View style={s.sidePanelHeader}>
              <Text style={s.sidePanelTitle}>
                {activePanel === 'participants' ? 'Participants' : 'Captions'}
              </Text>
              <TouchableOpacity onPress={() => setActivePanel(null)}>
                <Ionicons name="close" size={22} color={Colors.textLight} />
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
              />
            ) : null}
          </View>
        ) : null}
      </View>

      {/* ── Captions Overlay (bottom of grid) ────────── */}
      {captionsEnabled && captions.length > 0 && activePanel !== 'captions' ? (
        <View style={s.captionOverlay}>
          {captions.slice(-2).map((c) => (
            <View key={c.id} style={s.captionBubble}>
              <Text style={s.captionSpeaker}>{c.speaker}</Text>
              <Text style={s.captionText}>
                {c.translatedText || c.text}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* ── Bottom Controls Bar ──────────────────────── */}
      <Animated.View style={[s.controlsBar, { opacity: controlsOpacity }]}>
        {/* Mic */}
        <ControlButton
          icon={isMuted ? 'mic-off' : 'mic'}
          label={isMuted ? 'Unmute' : 'Mute'}
          isActive={!isMuted}
          isDanger={isMuted}
          onPress={() => setIsMuted(!isMuted)}
        />
        {/* Camera */}
        <ControlButton
          icon={isVideoOn ? 'videocam' : 'videocam-off'}
          label={isVideoOn ? 'Stop Video' : 'Start Video'}
          isActive={isVideoOn}
          isDanger={!isVideoOn}
          onPress={() => setIsVideoOn(!isVideoOn)}
        />
        {/* Screen Share */}
        {meeting?.settings?.allowScreenShare !== false ? (
          <ControlButton
            icon={isScreenSharing ? 'stop-circle' : 'share-outline'}
            label={isScreenSharing ? 'Stop Share' : 'Share Screen'}
            isActive={isScreenSharing}
            onPress={() => setIsScreenSharing(!isScreenSharing)}
          />
        ) : null}
        {/* Participants */}
        <ControlButton
          icon="people"
          label="Participants"
          isActive={activePanel === 'participants'}
          badge={activeParticipants.length}
          onPress={() => togglePanel('participants')}
        />
        {/* Captions */}
        <ControlButton
          icon="chatbubble-ellipses"
          label="Captions"
          isActive={captionsEnabled}
          onPress={() => {
            if (!captionsEnabled) {
              setCaptionsEnabled(true);
              togglePanel('captions');
            } else {
              setCaptionsEnabled(false);
              if (activePanel === 'captions') setActivePanel(null);
            }
          }}
        />
        {/* More */}
        <ControlButton
          icon="ellipsis-horizontal"
          label="More"
          onPress={() => setShowMoreMenu(!showMoreMenu)}
        />
        {/* Leave / End */}
        <TouchableOpacity
          style={s.leaveBtn}
          onPress={() => {
            if (isHost) {
              setShowEndConfirm(true);
            } else {
              handleLeaveMeeting();
            }
          }}
        >
          <Ionicons name="call" size={22} color={Colors.textWhite} style={{ transform: [{ rotate: '135deg' }] }} />
          <Text style={s.leaveBtnText}>{isHost ? 'End' : 'Leave'}</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* ── More menu popup ──────────────────────────── */}
      {showMoreMenu ? (
        <View style={s.moreMenu}>
          <TouchableOpacity style={s.moreMenuItem} onPress={() => { togglePanel('captions'); setCaptionsEnabled(true); }}>
            <Ionicons name="chatbubble-ellipses-outline" size={20} color={Colors.textPrimary} />
            <Text style={s.moreMenuText}>Live Captions</Text>
            <View style={[s.moreMenuToggle, captionsEnabled && s.moreMenuToggleOn]} />
          </TouchableOpacity>
          <TouchableOpacity style={s.moreMenuItem} onPress={() => { setActivePanel('language'); setShowMoreMenu(false); }}>
            <Ionicons name="language-outline" size={20} color={Colors.textPrimary} />
            <Text style={s.moreMenuText}>Translation Language</Text>
            <Text style={s.moreMenuValue}>
              {allLanguages.find((l) => l.code === selectedLanguage)?.flag}{' '}
              {allLanguages.find((l) => l.code === selectedLanguage)?.name || 'English'}
            </Text>
          </TouchableOpacity>
          {meeting?.settings?.allowRecording ? (
            <TouchableOpacity style={s.moreMenuItem} onPress={() => { setIsRecording(!isRecording); setShowMoreMenu(false); }}>
              <Ionicons name={isRecording ? 'stop-circle' : 'radio-button-on'} size={20} color={isRecording ? Colors.error : Colors.textPrimary} />
              <Text style={s.moreMenuText}>{isRecording ? 'Stop Recording' : 'Record Meeting'}</Text>
            </TouchableOpacity>
          ) : null}
          {meeting?.settings?.agenda && meeting.settings.agenda.length > 0 ? (
            <View style={s.moreMenuAgenda}>
              <View style={s.moreMenuAgendaHeader}>
                <Ionicons name="list-outline" size={18} color={Colors.highlight} />
                <Text style={s.moreMenuAgendaTitle}>Agenda</Text>
              </View>
              {meeting.settings.agenda.map((item, i) => (
                <Text key={i} style={s.moreMenuAgendaItem}>
                  {i + 1}. {item}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {/* ── End Meeting Confirmation ─────────────────── */}
      <Modal visible={showEndConfirm} transparent animationType="fade" onRequestClose={() => setShowEndConfirm(false)}>
        <View style={s.confirmOverlay}>
          <View style={s.confirmCard}>
            <Ionicons name="warning-outline" size={36} color={Colors.error} />
            <Text style={s.confirmTitle}>End Meeting?</Text>
            <Text style={s.confirmText}>
              This will end the meeting for all {activeParticipants.length} participant{activeParticipants.length !== 1 ? 's' : ''}.
              Meeting minutes will be generated automatically.
            </Text>
            <View style={s.confirmActions}>
              <TouchableOpacity
                style={s.confirmCancelBtn}
                onPress={() => setShowEndConfirm(false)}
              >
                <Text style={s.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirmEndBtn} onPress={handleEndMeeting}>
                <Ionicons name="call" size={18} color={Colors.textWhite} style={{ transform: [{ rotate: '135deg' }] }} />
                <Text style={s.confirmEndText}>End for All</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirmLeaveBtn} onPress={handleLeaveMeeting}>
                <Ionicons name="exit-outline" size={18} color={Colors.textWhite} />
                <Text style={s.confirmLeaveText}>Leave</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
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
    </Pressable>
  );
}

// ── Sub-components ──────────────────────────────────────

// ── Participant Tile ────────────────────────────────────
function ParticipantTile({
  participant,
  width,
  height,
  colorIndex,
  isCurrentUser,
  isMuted,
  isVideoOff,
}: {
  participant: Participant;
  width: number;
  height: number;
  colorIndex: number;
  isCurrentUser: boolean;
  isMuted?: boolean;
  isVideoOff?: boolean;
}) {
  const name = participant.displayName || `User ${participant.userId.slice(0, 6)}`;
  const color = AVATAR_COLORS[colorIndex % AVATAR_COLORS.length];
  const isSpeaking = participant.isSpeaking;

  return (
    <View
      style={[
        s.tile,
        { width, height },
        isSpeaking && { borderColor: Colors.success, borderWidth: 3 },
      ]}
    >
      {/* Avatar / Video placeholder */}
      {isVideoOff !== false ? (
        <View style={[s.tileAvatarContainer, { backgroundColor: color + '22' }]}>
          <View style={[s.tileAvatar, { backgroundColor: color }]}>
            <Text style={s.tileAvatarText}>{getInitials(name)}</Text>
          </View>
        </View>
      ) : (
        <View style={[s.tileAvatarContainer, { backgroundColor: '#111' }]}>
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
}

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

// ── Captions Panel ──────────────────────────────────────
function CaptionsPanel({
  captions,
  selectedLanguage,
  onChangeLanguage,
  languageName,
}: {
  captions: CaptionEntry[];
  selectedLanguage: string;
  onChangeLanguage: () => void;
  languageName: string;
}) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [captions.length]);

  return (
    <View style={s.captionsPanel}>
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
            <View key={c.id} style={s.captionEntry}>
              <Text style={s.captionEntrySpeaker}>{c.speaker}</Text>
              <Text style={s.captionEntryText}>
                {c.translatedText || c.text}
              </Text>
              {c.translatedText && selectedLanguage !== 'en' ? (
                <Text style={s.captionEntryOriginal}>{c.text}</Text>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

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
  // Full-screen center
  fullCenter: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  loadingDot: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.highlightSubtle,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  loadingText: { fontSize: FontSize.lg, color: Colors.textSecondary },
  errorText: { fontSize: FontSize.md, color: Colors.error, textAlign: 'center', marginTop: Spacing.md, marginBottom: Spacing.lg },
  errorBtn: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm + 2, backgroundColor: Colors.primaryMid, borderRadius: BorderRadius.md },
  errorBtnText: { color: Colors.textPrimary, fontWeight: FontWeight.semibold },

  // ── Lobby ─────────────────────────────────────────
  lobbyContainer: { flex: 1, backgroundColor: Colors.background },
  lobbyTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingTop: Platform.OS === 'web' ? Spacing.md : Spacing.xl,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  lobbyBackBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.primaryMid, justifyContent: 'center', alignItems: 'center' },
  lobbyTopTitle: { flex: 1, textAlign: 'center', fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.textPrimary, marginHorizontal: Spacing.sm },

  lobbyContent: { padding: Spacing.lg, alignItems: 'center', maxWidth: 540, alignSelf: 'center', width: '100%' },

  // Preview
  previewContainer: { width: '100%', marginBottom: Spacing.lg },
  previewBox: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: Colors.primaryMid,
    borderRadius: BorderRadius.xl,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  previewBoxOff: { backgroundColor: Colors.primary },
  previewAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.highlightSubtle,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  previewAvatarText: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.highlight },
  previewHelp: { fontSize: FontSize.sm, color: Colors.textLight },
  previewControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  previewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.primaryMid,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  previewToggleOff: { backgroundColor: 'rgba(192, 57, 43, 0.15)', borderColor: Colors.error + '44' },
  previewToggleLabel: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: FontWeight.medium },

  // Lobby info
  lobbyInfo: { width: '100%', marginBottom: Spacing.lg },
  lobbyTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary, textAlign: 'center' },
  lobbyDescription: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.xs, lineHeight: 22 },
  lobbyMeta: { marginTop: Spacing.md, alignItems: 'center', gap: Spacing.xs },
  lobbyMetaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  lobbyMetaText: { fontSize: FontSize.sm, color: Colors.textLight },

  // Lobby agenda
  lobbyAgenda: {
    width: '100%',
    marginTop: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  lobbyAgendaTitle: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.textLight, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.sm },
  lobbyAgendaItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.xs },
  lobbyAgendaDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.highlightSubtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lobbyAgendaNum: { fontSize: 10, color: Colors.highlight, fontWeight: FontWeight.bold },
  lobbyAgendaText: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary },

  // Lobby name
  lobbyNameSection: { width: '100%', marginBottom: Spacing.md },
  lobbyFieldLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold, color: Colors.textLight, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: Spacing.xs },
  lobbyFieldHint: { fontSize: FontSize.xs, color: Colors.textLight, marginBottom: Spacing.sm },
  lobbyNameInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
  },
  lobbyNameField: { flex: 1, paddingVertical: Spacing.sm + 4, fontSize: FontSize.md, color: Colors.textPrimary },

  // Lobby language
  lobbyLangSection: { width: '100%', marginBottom: Spacing.lg },
  langScroll: { marginTop: Spacing.xs },
  langRow: { flexDirection: 'row', gap: Spacing.xs, paddingBottom: Spacing.xs },
  langChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.primaryMid,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  langChipActive: { borderColor: Colors.highlight, backgroundColor: Colors.highlightSubtle },
  langFlag: { fontSize: 16 },
  langName: { fontSize: FontSize.sm, color: Colors.textSecondary },
  langNameActive: { color: Colors.highlight, fontWeight: FontWeight.semibold },
  langChipMore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.highlightSubtle,
  },
  langMoreText: { fontSize: FontSize.sm, color: Colors.highlight, fontWeight: FontWeight.medium },

  // Join button
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    width: '100%',
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.success,
    ...Shadow.md,
  },
  joinBtnText: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textWhite },

  // ── Active Room ───────────────────────────────────
  roomContainer: { flex: 1, backgroundColor: '#0a0a0a' },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingTop: Platform.OS === 'web' ? Spacing.sm : Spacing.lg,
    paddingBottom: Spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.6)',
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
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success },
  liveText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.success },
  recBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(192, 57, 43, 0.3)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.error },
  recText: { fontSize: 10, fontWeight: FontWeight.bold, color: Colors.error },
  topBarTitle: { flex: 1, textAlign: 'center', fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textPrimary, marginHorizontal: Spacing.sm },
  topBarRight: { flexDirection: 'row', alignItems: 'center' },
  participantCountText: { fontSize: FontSize.sm, color: Colors.textSecondary },

  // Main area
  mainArea: { flex: 1, flexDirection: 'row', marginTop: 52, marginBottom: 80 },

  // Grid
  gridContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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

  // Controls bar
  controlsBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingBottom: Platform.OS === 'web' ? Spacing.md : Spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.75)',
    gap: Spacing.xs,
    zIndex: 10,
  },
  controlBtn: {
    alignItems: 'center',
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.md,
    minWidth: 56,
  },
  controlBtnDanger: { backgroundColor: 'rgba(192, 57, 43, 0.15)' },
  controlBtnActive: { backgroundColor: 'rgba(201, 168, 76, 0.12)' },
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
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
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
  moreMenu: {
    position: 'absolute',
    bottom: 90,
    right: Spacing.md,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: BorderRadius.lg,
    padding: Spacing.sm,
    minWidth: 260,
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

  // ── Ended ─────────────────────────────────────────
  endedIcon: { marginBottom: Spacing.md },
  endedTitle: { fontSize: FontSize.title, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  endedSub: { fontSize: FontSize.lg, color: Colors.textSecondary, marginTop: Spacing.xs },
  endedDuration: { fontSize: FontSize.md, color: Colors.textLight, marginTop: Spacing.xs },
  endedActions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xl },
  endedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 4,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primaryMid,
  },
  endedBtnText: { fontSize: FontSize.md, color: Colors.textPrimary, fontWeight: FontWeight.semibold },

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
