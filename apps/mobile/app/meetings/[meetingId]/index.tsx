// ============================================================
// OrgsLedger Mobile — Meeting Detail Screen (Zoom-like UX)
// Full-featured: Waiting room, raise hand, participant list,
// recording toggle, meeting timer, join countdown,
// custom org branding, bandwidth auto-detection.
// ============================================================

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  TextInput,
  Modal,
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { useMeetingStore } from '../../src/stores/meeting.store';
import { api } from '../../src/api/client';
import { socketClient } from '../../src/api/socket';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Card, Badge, Button, Avatar, SectionHeader, LoadingScreen, CrossPlatformDateTimePicker, ResponsiveScrollView } from '../../src/components/ui';
import LiveTranslation, { LANGUAGES, LANG_FLAGS, LiveTranslationRef } from '../../src/components/ui/LiveTranslation';
import { ALL_LANGUAGES, getLanguageFlag, getLanguageName, isTtsSupported } from '../../src/utils/languages';
import { showAlert } from '../../src/utils/alert';
import { MeetingRoom } from '../../src/components/meeting';
import { useGlobalMeeting } from '../../src/contexts/MeetingContext';

// ── Constants ──────────────────────────────────────────────
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: string; label: string }> = {
  scheduled: { color: '#818CF8', bg: 'rgba(129, 140, 248, 0.12)', icon: 'calendar', label: 'Scheduled' },
  live:      { color: '#34D399', bg: 'rgba(52, 211, 153, 0.12)', icon: 'radio', label: 'Live Now' },
  ended:     { color: Colors.textLight, bg: Colors.accent, icon: 'checkmark-circle', label: 'Completed' },
  completed: { color: Colors.textLight, bg: Colors.accent, icon: 'checkmark-circle', label: 'Completed' },
  cancelled: { color: Colors.error, bg: Colors.errorSubtle, icon: 'close-circle', label: 'Cancelled' },
};

// ── Helpers ────────────────────────────────────────────────
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatCountdown(ms: number): { hours: string; minutes: string; seconds: string } {
  if (ms <= 0) return { hours: '00', minutes: '00', seconds: '00' };
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return {
    hours: h.toString().padStart(2, '0'),
    minutes: m.toString().padStart(2, '0'),
    seconds: s.toString().padStart(2, '0'),
  };
}

function estimateBandwidth(): Promise<'high' | 'medium' | 'low'> {
  return new Promise((resolve) => {
    if (Platform.OS !== 'web') { resolve('high'); return; }
    const nav = (navigator as any);
    if (nav.connection) {
      const dl = nav.connection.downlink || 10;
      const type = nav.connection.effectiveType || '4g';
      if (type === 'slow-2g' || type === '2g' || dl < 0.5) { resolve('low'); return; }
      if (type === '3g' || dl < 2) { resolve('medium'); return; }
      resolve('high'); return;
    }
    resolve('high');
  });
}

// ── Pulse Dot Component ────────────────────────────────────
function PulseDot({ color, size = 10 }: { color: string; size?: number }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return (
    <Animated.View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: color, opacity: pulse,
    }} />
  );
}

// ── Participant Modal ──────────────────────────────────────
function ParticipantModal({
  visible, onClose, participants, attendance,
}: {
  visible: boolean; onClose: () => void;
  participants: any[]; attendance: any[];
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={z.modalOverlay}>
        <View style={z.modalContent}>
          <View style={z.modalHeader}>
            <Text style={z.modalTitle}>Participants ({participants.length + attendance.length})</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="close" size={24} color={Colors.textWhite} />
            </TouchableOpacity>
          </View>
          {/* Live participants from socket */}
          {participants.length > 0 && (
            <>
              <Text style={z.modalSectionLabel}>In Meeting</Text>
              {participants.map((p, i) => (
                <View key={p.userId || i} style={z.participantRow}>
                  <View style={[z.participantDot, { backgroundColor: '#34D399' }]} />
                  <Avatar name={p.name?.[0]?.toUpperCase() || '?'} size={32} />
                  <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                    <Text style={z.participantName}>{p.name}</Text>
                    {p.isModerator && <Text style={z.moderatorBadge}>Moderator</Text>}
                  </View>
                  {p.handRaised && (
                    <View style={z.handRaisedIcon}>
                      <Text style={{ fontSize: 16 }}>✋</Text>
                    </View>
                  )}
                </View>
              ))}
            </>
          )}
          {/* Attendance from DB */}
          {attendance.length > 0 && (
            <>
              <Text style={[z.modalSectionLabel, { marginTop: Spacing.md }]}>Attendance</Text>
              {attendance.map((a: any) => {
                const initials = `${(a.first_name?.[0] || '?').toUpperCase()}${(a.last_name?.[0] || '').toUpperCase()}`;
                return (
                  <View key={a.id || a.user_id} style={z.participantRow}>
                    <View style={[z.participantDot, { backgroundColor: a.status === 'present' ? '#34D399' : Colors.warning }]} />
                    <Avatar name={initials} size={32} />
                    <Text style={[z.participantName, { flex: 1, marginLeft: Spacing.sm }]}>
                      {a.first_name || a.user_id} {a.last_name || ''}
                    </Text>
                    <Badge variant={a.status === 'present' ? 'success' : 'warning'} label={a.status === 'present' ? 'Present' : 'Late'} />
                  </View>
                );
              })}
            </>
          )}
          {participants.length === 0 && attendance.length === 0 && (
            <Text style={{ color: Colors.textLight, textAlign: 'center', marginTop: Spacing.xl }}>No participants yet</Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function MeetingDetailScreen() {
  const { meetingId } = useLocalSearchParams<{ meetingId: string }>();
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const userId = useAuthStore((s) => s.user?.id);
  const globalRole = useAuthStore((s) => s.user?.globalRole);
  const userName = useAuthStore((s) => s.user ? `${s.user.firstName} ${s.user.lastName}`.trim() : 'Guest');
  const membership = useAuthStore((s) =>
    s.memberships.find((m) => m.organization_id === s.currentOrgId)
  );

  // ── Core State ──────────────────────────────────────────
  const [meeting, setMeeting] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // ── Zustand Meeting Store (centralized state) ───────────
  const meetingStore = useMeetingStore();
  const meetingEndedByModerator = useMeetingStore((s) => s.meetingEndedByModerator);

  // ── Global Meeting Context (persistent overlay) ─────────
  const gm = useGlobalMeeting();

  // ── Edit State ──────────────────────────────────────────
  const [editMode, setEditMode] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editDate, setEditDate] = useState<Date>(new Date());
  const [editTime, setEditTime] = useState<Date>(new Date());
  const [saving, setSaving] = useState(false);

  // ── Audio Recording State ───────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const recordingRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── LiveKit Join State (token-based) ─────────────────────
  const [showVideo, setShowVideo] = useState(false);
  const [joinConfig, setJoinConfig] = useState<any>(null);
  const [joinLoading, setJoinLoading] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);

  // ── Zoom-like Features State ────────────────────────────
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [countdownMs, setCountdownMs] = useState(0);
  const [liveParticipants, setLiveParticipants] = useState<any[]>([]);
  const [showParticipants, setShowParticipants] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [bandwidth, setBandwidth] = useState<'high' | 'medium' | 'low'>('high');
  const [bandwidthChecked, setBandwidthChecked] = useState(false);
  const [showBandwidthHint, setShowBandwidthHint] = useState(false);

  // ── Unified Control Bar State ───────────────────────────
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [translationLang, setTranslationLang] = useState('en');
  const [langPickerSearch, setLangPickerSearch] = useState('');
  const [translationListening, setTranslationListening] = useState(false);
  const [voiceToVoice, setVoiceToVoice] = useState(true); // Auto TTS for translations
  const translationRef = useRef<LiveTranslationRef>(null);

  // Filtered language list for control bar picker
  const filteredPickerLangs = useMemo(() => {
    if (!langPickerSearch.trim()) return ALL_LANGUAGES;
    const q = langPickerSearch.toLowerCase().trim();
    return ALL_LANGUAGES.filter(
      (l) => l.name.toLowerCase().includes(q) || l.nativeName.toLowerCase().includes(q) || l.code.includes(q)
    );
  }, [langPickerSearch]);

  // ── Tab State ───────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'meeting' | 'transcript' | 'minutes'>('meeting');
  const [transcripts, setTranscripts] = useState<any[]>([]);
  const [minutes, setMinutes] = useState<any>(null);
  const [minutesLoading, setMinutesLoading] = useState(false);
  const [transcriptsLoading, setTranscriptsLoading] = useState(false);
  const [generateLoading, setGenerateLoading] = useState(false);

  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isAdmin = globalRole === 'super_admin' || globalRole === 'developer' || (membership &&
    ['org_admin', 'executive'].includes(membership.role));

  const orgName = meeting?.org_name || '';

  // ── Load Meeting ────────────────────────────────────────
  const loadMeeting = useCallback(async () => {
    if (!currentOrgId || !meetingId) return;
    try {
      const res = await api.meetings.get(currentOrgId, meetingId);
      const m = res.data.data;
      setMeeting(m);
      if (m) {
        setEditTitle(m.title || '');
        setEditDescription(m.description || '');
        setEditLocation(m.location || '');
        const start = new Date(m.scheduled_start);
        setEditDate(start);
        setEditTime(start);
      }
    } catch {
      showAlert('Error', 'Failed to load meeting');
    } finally {
      setLoading(false);
    }
  }, [currentOrgId, meetingId]);

  useEffect(() => { loadMeeting(); }, [loadMeeting]);

  // ── Load Transcripts ────────────────────────────────────
  const loadTranscripts = useCallback(async () => {
    if (!currentOrgId || !meetingId) return;
    setTranscriptsLoading(true);
    try {
      const res = await api.meetings.getTranscripts(currentOrgId, meetingId);
      setTranscripts(res.data.data || []);
    } catch {
      // Table may not exist yet — not an error
      setTranscripts([]);
    } finally {
      setTranscriptsLoading(false);
    }
  }, [currentOrgId, meetingId]);

  // ── Load Minutes ────────────────────────────────────────
  const loadMinutes = useCallback(async () => {
    if (!currentOrgId || !meetingId) return;
    setMinutesLoading(true);
    try {
      const res = await api.meetings.getMinutes(currentOrgId, meetingId);
      setMinutes(res.data.data);
    } catch {
      setMinutes(null);
    } finally {
      setMinutesLoading(false);
    }
  }, [currentOrgId, meetingId]);

  // Load transcripts/minutes when switching tabs
  useEffect(() => {
    if (activeTab === 'transcript') loadTranscripts();
    if (activeTab === 'minutes') loadMinutes();
  }, [activeTab, loadTranscripts, loadMinutes]);

  // ── Generate Minutes from Live Transcripts ──────────────
  const handleGenerateMinutes = async () => {
    if (!currentOrgId || !meetingId) return;
    setGenerateLoading(true);
    try {
      await api.meetings.generateMinutes(currentOrgId, meetingId);
      showAlert('Processing', 'AI minutes generation started. You will be notified when complete.');
      await loadMinutes();
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to generate minutes');
    } finally {
      setGenerateLoading(false);
    }
  };

  // ── Download Minutes ────────────────────────────────────
  const handleDownloadMinutes = async (format: 'txt' | 'json' = 'txt') => {
    if (!currentOrgId || !meetingId) return;
    try {
      const res = await api.meetings.downloadMinutes(currentOrgId, meetingId, format);
      if (Platform.OS === 'web') {
        // Create download blob
        const blob = new Blob([res.data], { type: format === 'json' ? 'application/json' : 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${meeting?.title || 'meeting'}_minutes.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        showAlert('Downloaded', 'Minutes have been downloaded.');
      }
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to download minutes');
    }
  };

  // ── Initialize Zustand meeting store ────────────────────
  useEffect(() => {
    if (meetingId && currentOrgId) {
      meetingStore.enterMeeting(meetingId, currentOrgId);
    }
    return () => {
      meetingStore.reset();
    };
  }, [meetingId, currentOrgId]);

  // Sync loaded meeting into store
  useEffect(() => {
    if (meeting) {
      meetingStore.setMeeting(meeting);
    }
  }, [meeting]);

  // ── Meeting Timer (elapsed since actual_start) ──────────
  useEffect(() => {
    if (meeting?.status === 'live' && meeting.actual_start) {
      const start = new Date(meeting.actual_start).getTime();
      const updateElapsed = () => {
        const now = Date.now();
        setElapsedSeconds(Math.floor((now - start) / 1000));
      };
      updateElapsed();
      elapsedRef.current = setInterval(updateElapsed, 1000);
    }
    return () => { if (elapsedRef.current) clearInterval(elapsedRef.current); };
  }, [meeting?.status, meeting?.actual_start]);

  // ── Join Countdown (time until scheduled_start) ─────────
  useEffect(() => {
    if (meeting?.status === 'scheduled' && meeting.scheduled_start) {
      const target = new Date(meeting.scheduled_start).getTime();
      const updateCountdown = () => {
        const remaining = target - Date.now();
        setCountdownMs(remaining > 0 ? remaining : 0);
      };
      updateCountdown();
      countdownRef.current = setInterval(updateCountdown, 1000);
    }
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [meeting?.status, meeting?.scheduled_start]);

  // ── Sync from GlobalMeetingContext when it handles meeting:ended ──
  // When gm.isActive, the local socket listeners are skipped (GlobalMeetingProvider handles them).
  // But the context updates its own state, not our local `meeting`. Sync here.
  useEffect(() => {
    if (gm.isActive && gm.meeting && meeting) {
      if (gm.meeting.status === 'ended' && meeting.status !== 'ended') {
        setMeeting((prev: any) => prev ? { ...prev, status: 'ended', actual_end: gm.meeting?.actual_end || new Date().toISOString() } : prev);
        meetingStore.setStatus('ended');
        if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
        if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
        setShowVideo(false);
        setJoinConfig(null);
        setHandRaised(false);
      }
    }
  }, [gm.isActive, gm.meeting?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Bandwidth Detection ─────────────────────────────────
  useEffect(() => {
    if (!bandwidthChecked) {
      estimateBandwidth().then((bw) => {
        setBandwidth(bw);
        setBandwidthChecked(true);
        if (bw === 'low') setShowBandwidthHint(true);
      });
    }
  }, [bandwidthChecked]);

  // ── Socket: Real-time event-driven architecture ────────
  useEffect(() => {
    if (!meetingId) return;
    // When GlobalMeetingProvider is active, it handles all socket events.
    // Skip duplicate listeners here to avoid double-processing.
    if (gm.isActive) return;

    socketClient.joinMeeting(meetingId);

    // -- Participant events --
    const handleParticipantJoined = (data: any) => {
      setLiveParticipants((prev) => {
        if (prev.find((p) => p.userId === data.userId)) return prev;
        return [...prev, { ...data, handRaised: false }];
      });
      meetingStore.addParticipant({ userId: data.userId, name: data.name, isModerator: data.isModerator });
    };
    const handleParticipantLeft = (data: any) => {
      setLiveParticipants((prev) => prev.filter((p) => p.userId !== data.userId));
      meetingStore.removeParticipant(data.userId);
    };
    const handleHandRaised = (data: any) => {
      setLiveParticipants((prev) =>
        prev.map((p) => p.userId === data.userId ? { ...p, handRaised: data.raised } : p)
      );
      meetingStore.setHandRaised(data.userId, data.raised);
    };

    // -- Meeting lifecycle events (instant, no refresh) --
    const handleMeetingStarted = (data: any) => {
      if (data.meetingId === meetingId) {
        setMeeting((prev: any) => prev ? { ...prev, status: 'live', actual_start: new Date().toISOString() } : prev);
        meetingStore.onMeetingStarted(data);
      }
    };
    const handleMeetingEnded = (data: any) => {
      if (data.meetingId === meetingId) {
        setMeeting((prev: any) => prev ? { ...prev, status: 'ended', actual_end: new Date().toISOString() } : prev);
        meetingStore.onMeetingEnded(data);
        // Stop any active LiveKit video session
        setShowVideo(false);
        setJoinConfig(null);
        setHandRaised(false);
        // Always stop translation mic (avoid stale closure check)
        translationRef.current?.stopListening();
        setTranslationListening(false);
        // Stop recording if active
        try { stopRecording(); } catch (_) {}
        // Reload transcripts so transcript tab shows final data
        loadTranscripts();
      }
    };

    // -- Force disconnect: server kicked all sockets --
    const handleForceDisconnect = (data: any) => {
      if (data.meetingId === meetingId) {
        // Clean up all local meeting state
        setShowVideo(false);
        setJoinConfig(null);
        setHandRaised(false);
        setLiveParticipants([]);
        // Always stop translation mic (avoid stale closure check)
        translationRef.current?.stopListening();
        setTranslationListening(false);
        try { stopRecording(); } catch (_) {}
        meetingStore.setMeetingEndedByModerator(true);
        meetingStore.setStatus('ended');
        // Reload to get final meeting state (AI minutes etc.)
        loadMeeting();
        loadTranscripts();
      }
    };

    // -- Moderator control broadcasts --
    const handleRecordingStarted = (data: any) => {
      if (data.meetingId === meetingId) meetingStore.setRecording(true);
    };
    const handleRecordingStopped = (data: any) => {
      if (data.meetingId === meetingId) meetingStore.setRecording(false);
    };
    const handleLockChanged = (data: any) => {
      if (data.meetingId === meetingId) meetingStore.setLocked(data.locked);
    };

    // -- Join rejected (meeting already ended) --
    const handleJoinRejected = (data: any) => {
      if (data.meetingId === meetingId) {
        showAlert('Cannot Join', data.reason || 'Meeting has ended');
      }
    };

    const unsub1 = socketClient.on('meeting:participant-joined', handleParticipantJoined);
    const unsub2 = socketClient.on('meeting:participant-left', handleParticipantLeft);
    const unsub3 = socketClient.on('meeting:hand-raised', handleHandRaised);
    const unsub4 = socketClient.on('meeting:started', handleMeetingStarted);
    const unsub5 = socketClient.on('meeting:ended', handleMeetingEnded);
    const unsub6 = socketClient.on('meeting:force-disconnect', handleForceDisconnect);
    const unsub7 = socketClient.on('meeting:recording-started', handleRecordingStarted);
    const unsub8 = socketClient.on('meeting:recording-stopped', handleRecordingStopped);
    const unsub9 = socketClient.on('meeting:lock-changed', handleLockChanged);
    const unsub10 = socketClient.on('meeting:join-rejected', handleJoinRejected);

    // -- AI Minutes lifecycle --
    const handleMinutesReady = (data: any) => {
      if (data.meetingId === meetingId) {
        loadMinutes();
        showAlert('Minutes Ready', `AI-generated minutes for "${data.title || 'this meeting'}" are now available.`);
      }
    };
    const handleMinutesProcessing = (data: any) => {
      if (data.meetingId === meetingId) {
        setMinutes((prev: any) => prev ? { ...prev, status: 'processing' } : { status: 'processing' });
      }
    };
    const handleMinutesFailed = (data: any) => {
      if (data.meetingId === meetingId) {
        showAlert('Minutes Failed', data.error || 'AI minutes generation failed.');
        loadMinutes();
      }
    };
    const unsub11 = socketClient.on('meeting:minutes:ready', handleMinutesReady);
    const unsub12 = socketClient.on('meeting:minutes:processing', handleMinutesProcessing);
    const unsub13 = socketClient.on('meeting:minutes:failed', handleMinutesFailed);

    // -- Real-time transcript updates (server persists -> UI updates) --
    const handleTranscriptStored = (data: any) => {
      if (data.meetingId === meetingId) {
        setTranscripts((prev) => {
          // Deduplicate by speakerId+timestamp
          const key = `${data.speakerId}-${data.timestamp}`;
          if (prev.find((t: any) => t.id === key || (t.speaker_id === data.speakerId && t.spoken_at === String(data.timestamp)))) return prev;
          return [...prev, {
            id: key,
            meeting_id: data.meetingId,
            speaker_id: data.speakerId,
            speaker_name: data.speakerName,
            original_text: data.originalText,
            source_lang: data.sourceLang,
            translations: data.translations,
            spoken_at: String(data.timestamp),
          }];
        });
      }
    };
    const unsub14 = socketClient.on('transcript:stored', handleTranscriptStored);

    return () => {
      unsub1(); unsub2(); unsub3(); unsub4(); unsub5();
      unsub6(); unsub7(); unsub8(); unsub9(); unsub10();
      unsub11(); unsub12(); unsub13(); unsub14();
      socketClient.leaveMeeting(meetingId);
    };
  }, [meetingId, gm.isActive]);

  // ── Meeting Actions ─────────────────────────────────────
  const handleStart = async () => {
    if (!currentOrgId || !meetingId) return;
    setActionLoading(true);
    try {
      await api.meetings.start(currentOrgId, meetingId);
      // Instant local update — socket broadcasts to everyone else
      setMeeting((prev: any) => prev ? { ...prev, status: 'live', actual_start: new Date().toISOString() } : prev);
      meetingStore.setStatus('live');
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to start meeting');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEnd = async () => {
    if (!currentOrgId || !meetingId) return;
    showAlert('End Meeting', 'Are you sure? AI minutes will be generated if audio was uploaded.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End Meeting',
        style: 'destructive',
        onPress: async () => {
          // Optimistic: update UI immediately so timer stops and buttons hide
          setMeeting((prev: any) => prev ? { ...prev, status: 'ended', actual_end: new Date().toISOString() } : prev);
          meetingStore.setStatus('ended');
          if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null; }
          if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
          setShowVideo(false);
          setJoinConfig(null);
          setHandRaised(false);

          try {
            await api.meetings.end(currentOrgId, meetingId);
          } catch (err: any) {
            // Revert optimistic update on failure
            showAlert('Error', err.response?.data?.error || 'Failed to end meeting');
            loadMeeting();
          }
        },
      },
    ]);
  };

  const handleCancel = async () => {
    if (!currentOrgId || !meetingId) return;
    showAlert('Cancel Meeting', 'This will cancel the meeting for all attendees.', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Cancel Meeting',
        style: 'destructive',
        onPress: async () => {
          setActionLoading(true);
          try {
            await api.meetings.update(currentOrgId, meetingId, { status: 'cancelled' });
            await loadMeeting();
            showAlert('Done', 'Meeting cancelled');
          } catch (err: any) {
            showAlert('Error', err.response?.data?.error || 'Failed to cancel');
          } finally {
            setActionLoading(false);
          }
        },
      },
    ]);
  };

  const handleMarkAttendance = async () => {
    if (!currentOrgId || !meetingId) return;
    setActionLoading(true);
    try {
      await api.meetings.recordAttendance(currentOrgId, meetingId);
      showAlert('Success', 'Attendance marked');
      await loadMeeting();
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to mark attendance');
    } finally {
      setActionLoading(false);
    }
  };

  // ── Edit Handlers ───────────────────────────────────────
  const handleSaveEdit = async () => {
    if (!currentOrgId || !meetingId) return;
    if (!editTitle.trim()) { showAlert('Error', 'Title is required'); return; }
    setSaving(true);
    try {
      const combined = new Date(editDate);
      combined.setHours(editTime.getHours(), editTime.getMinutes(), 0, 0);
      await api.meetings.update(currentOrgId, meetingId, {
        title: editTitle.trim(),
        description: editDescription.trim() || null,
        location: editLocation.trim() || null,
        scheduledStart: combined.toISOString(),
      });
      showAlert('Saved', 'Meeting updated successfully');
      setEditMode(false);
      await loadMeeting();
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  // ── Join Meeting (LiveKit) ──────────────────────────────
  const handleJoinMeeting = async (joinType: 'video' | 'audio') => {
    if (!currentOrgId || !meetingId) return;
    setJoinLoading(true);
    try {
      const res = await api.meetings.join(currentOrgId, meetingId, joinType);
      const cfg = res.data?.data;
      if (!cfg) throw new Error('No join config returned');
      if (!cfg.token) throw new Error('Meeting token not received. Please contact your administrator.');

      // Activate the global meeting overlay (persistent across navigation)
      gm.joinMeeting({
        orgId: currentOrgId,
        meetingId: meetingId!,
        meeting,
        joinConfig: {
          url: cfg.url,
          token: cfg.token,
          roomName: cfg.roomName,
          meetingType: cfg.meetingType || (meeting.meeting_type === 'audio' ? 'audio' : 'video'),
        },
        joinType,
        userId: userId!,
        userName,
        isAdmin: !!isAdmin,
      });

      // Also set local state for backward compat
      setJoinConfig(cfg);
      setVideoEnabled(joinType === 'video');
      setAudioEnabled(true);
      setShowVideo(true);
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Failed to join meeting';
      showAlert('Cannot Join', msg);
    } finally {
      setJoinLoading(false);
    }
  };

  const handleLeaveMeeting = async () => {
    // Use global meeting context for leave — it handles LiveKit disconnect + socket leave
    gm.leaveMeeting();
    setShowVideo(false);
    setJoinConfig(null);
    setHandRaised(false);
  };

  // ── Vote ────────────────────────────────────────────────
  const handleVote = async (voteId: string, option: string) => {
    if (!currentOrgId || !meetingId) return;
    try {
      await api.meetings.castVote(currentOrgId, meetingId, voteId, { option });
      showAlert('Voted', `Your vote for "${option}" has been recorded.`);
      await loadMeeting();
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to submit vote');
    }
  };

  // ── Raise Hand Toggle ──────────────────────────────────
  const handleRaiseHand = () => {
    const newState = !handRaised;
    setHandRaised(newState);
    if (meetingId) {
      socketClient.emit('meeting:raise-hand', {
        meetingId,
        userId,
        name: userName,
        raised: newState,
      });
    }
  };

  // ── Audio Recording ─────────────────────────────────────
  const startRecording = async () => {
    if (Platform.OS === 'web') {
      showAlert('Info', 'Audio recording is only available on mobile devices.');
      return;
    }
    try {
      const { Audio } = require('expo-av');
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      recordingRef.current = recording;
      setIsRecording(true);
      setRecordingDuration(0);
      timerRef.current = setInterval(() => setRecordingDuration((d) => d + 1), 1000);
    } catch {
      showAlert('Error', 'Could not start recording. Please check microphone permissions.');
    }
  };

  const stopRecording = async () => {
    if (!recordingRef.current) return;
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      setRecordingUri(uri || null);
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    } catch {
      showAlert('Error', 'Failed to stop recording');
    }
  };

  const uploadRecording = async () => {
    if (!recordingUri || !currentOrgId || !meetingId) return;
    setUploading(true);
    try {
      await api.meetings.uploadAudio(currentOrgId, meetingId, recordingUri, 'meeting-recording.m4a');
      showAlert('Success', 'Audio uploaded. AI minutes will be generated when the meeting ends.');
      setRecordingUri(null);
      setRecordingDuration(0);
      await loadMeeting();
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to upload audio');
    } finally {
      setUploading(false);
    }
  };

  // ── Derived Values ──────────────────────────────────────
  const statusCfg = STATUS_CONFIG[meeting?.status] || STATUS_CONFIG.scheduled;
  const countdown = formatCountdown(countdownMs);
  const participantCount = liveParticipants.length + (meeting?.attendance?.length || 0);

  // ── Loading / Error ─────────────────────────────────────
  if (loading) return <LoadingScreen />;
  if (!meeting) {
    return (
      <View style={z.center}>
        <Ionicons name="alert-circle-outline" size={48} color={Colors.textLight} />
        <Text style={z.errorText}>Meeting not found</Text>
        <Button title="Go Back" onPress={() => router.back()} variant="outline" />
      </View>
    );
  }

  // ════════════════════════════════════════════════════════
  // MEETING ROOM — now handled by GlobalMeetingOverlay.
  // When the global overlay is active and NOT minimized,
  // it covers the entire screen. If minimized, this page
  // is visible behind the floating widget.
  // We hide header when full-screen overlay is active.
  // ════════════════════════════════════════════════════════
  const isInGlobalMeeting = gm.isActive && gm.meetingId === meetingId;

  // ════════════════════════════════════════════════════════
  // RENDER (pre-join / meeting detail view)
  // ════════════════════════════════════════════════════════
  return (
    <ResponsiveScrollView style={z.container}>
      <Stack.Screen options={{ title: meeting.title || 'Meeting', headerShown: !isInGlobalMeeting || gm.isMinimized }} />

      {/* ═══ IN-MEETING BANNER (when global overlay is active) ═══ */}
      {isInGlobalMeeting && gm.isMinimized && (
        <TouchableOpacity
          style={{
            backgroundColor: Colors.success,
            paddingVertical: Spacing.sm,
            paddingHorizontal: Spacing.md,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: Spacing.sm,
          }}
          onPress={gm.maximize}
          activeOpacity={0.8}
        >
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFF' }} />
          <Text style={{ color: '#FFF', fontWeight: FontWeight.semibold as any, fontSize: FontSize.sm }}>
            Tap to return to meeting
          </Text>
        </TouchableOpacity>
      )}

      {/* ═══ MEETING ENDED BY MODERATOR OVERLAY ══════════════ */}
      {meetingEndedByModerator && (
        <Card style={StyleSheet.flatten([z.section, { backgroundColor: Colors.errorSubtle, borderColor: Colors.error, borderWidth: 1 }])}>
          <View style={{ alignItems: 'center', paddingVertical: Spacing.lg }}>
            <Ionicons name="stop-circle" size={48} color={Colors.error} />
            <Text style={{ color: Colors.error, fontSize: FontSize.xl, fontWeight: FontWeight.bold as any, marginTop: Spacing.sm }}>
              Meeting Ended
            </Text>
            <Text style={{ color: Colors.textPrimary, fontSize: FontSize.md, textAlign: 'center', marginTop: Spacing.xs }}>
              The moderator has ended this meeting. All participants have been disconnected.
            </Text>
            <TouchableOpacity
              style={{ marginTop: Spacing.md, backgroundColor: Colors.highlight, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md }}
              onPress={() => router.back()}
              activeOpacity={0.7}
            >
              <Text style={{ color: '#FFF', fontWeight: FontWeight.semibold as any, fontSize: FontSize.md }}>Back to Meetings</Text>
            </TouchableOpacity>
          </View>
        </Card>
      )}

      {/* ═══ EDIT MODE ═══════════════════════════════════════ */}
      {editMode && isAdmin && (
        <Card style={z.section}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md }}>
            <Ionicons name="create-outline" size={18} color={Colors.highlight} />
            <Text style={{ color: Colors.highlight, fontSize: FontSize.lg, fontWeight: FontWeight.semibold }}>Edit Meeting</Text>
          </View>
          <View style={z.editField}>
            <Text style={z.editLabel}>Title</Text>
            <TextInput style={z.editInput} value={editTitle} onChangeText={setEditTitle} placeholder="Meeting title" placeholderTextColor={Colors.textLight} />
          </View>
          <View style={z.editField}>
            <Text style={z.editLabel}>Description</Text>
            <TextInput style={[z.editInput, { minHeight: 60 }]} value={editDescription} onChangeText={setEditDescription} placeholder="Optional description" placeholderTextColor={Colors.textLight} multiline />
          </View>
          <View style={z.editField}>
            <Text style={z.editLabel}>Location</Text>
            <TextInput style={z.editInput} value={editLocation} onChangeText={setEditLocation} placeholder="Optional location" placeholderTextColor={Colors.textLight} />
          </View>
          <View style={z.editField}>
            <Text style={z.editLabel}>Date & Time</Text>
            <View style={{ gap: Spacing.sm }}>
              <CrossPlatformDateTimePicker label="Date" value={editDate} mode="date" hasValue={true} onChange={setEditDate} />
              <CrossPlatformDateTimePicker label="Time" value={editTime} mode="time" hasValue={true} onChange={setEditTime} />
            </View>
          </View>
          <View style={z.editActions}>
            <TouchableOpacity style={z.cancelEditBtn} onPress={() => setEditMode(false)}>
              <Text style={{ color: Colors.textLight, fontSize: FontSize.md }}>Cancel</Text>
            </TouchableOpacity>
            <Button title={saving ? 'Saving...' : 'Save Changes'} onPress={handleSaveEdit} disabled={saving} variant="primary" size="sm" />
          </View>
        </Card>
      )}

      {/* ═══ ORG BRANDING HEADER ═════════════════════════════ */}
      <Card style={StyleSheet.flatten([z.headerCard, meeting.status === 'live' && z.headerLive])} variant="elevated">
        {meeting.status === 'live' && <View style={z.liveStripe} />}

        {/* Top row: org name + status + edit */}
        <View style={z.headerTopRow}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
            {orgName ? (
              <>
                <Ionicons name="business" size={14} color={Colors.textLight} />
                <Text style={z.orgLabel} numberOfLines={1}>{orgName}</Text>
              </>
            ) : null}
          </View>
          {/* Status badge */}
          <View style={[z.statusBadge, { backgroundColor: statusCfg.bg }]}>
            {meeting.status === 'live' && <PulseDot color={statusCfg.color} size={8} />}
            <Ionicons name={statusCfg.icon as any} size={12} color={statusCfg.color} />
            <Text style={[z.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
          </View>
          {/* Edit button */}
          {isAdmin && meeting.status === 'scheduled' && !editMode && (
            <TouchableOpacity onPress={() => setEditMode(true)} style={z.editIconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="create-outline" size={18} color={Colors.textLight} />
            </TouchableOpacity>
          )}
        </View>

        {/* Title */}
        <Text style={z.title}>{meeting.title}</Text>
        {meeting.description && <Text style={z.description}>{meeting.description}</Text>}

        {/* Meeting type badges */}
        <View style={z.typeBadgeRow}>
          {meeting.meeting_type && (
            <View style={z.typeBadge}>
              <Ionicons name={meeting.meeting_type === 'audio' ? 'mic' : 'videocam'} size={12} color="#818CF8" />
              <Text style={z.typeBadgeText}>{meeting.meeting_type === 'audio' ? 'Audio' : 'Video'}</Text>
            </View>
          )}
          {meeting.ai_enabled && (
            <View style={z.aiBadge}>
              <Ionicons name="flash" size={12} color={Colors.highlight} />
              <Text style={z.aiBadgeText}>AI</Text>
            </View>
          )}
          {meeting.lobby_enabled && (
            <View style={z.typeBadge}>
              <Ionicons name="shield-checkmark" size={12} color="#818CF8" />
              <Text style={z.typeBadgeText}>Waiting Room</Text>
            </View>
          )}
        </View>

        {/* Meta info */}
        <View style={z.metaGrid}>
          <View style={z.metaItem}>
            <Ionicons name="calendar-outline" size={14} color={Colors.textLight} />
            <Text style={z.metaText}>
              {new Date(meeting.scheduled_start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
            </Text>
          </View>
          <View style={z.metaItem}>
            <Ionicons name="time-outline" size={14} color={Colors.textLight} />
            <Text style={z.metaText}>
              {new Date(meeting.scheduled_start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
          {meeting.location && (
            <View style={z.metaItem}>
              <Ionicons name="location-outline" size={14} color={Colors.textLight} />
              <Text style={z.metaText}>{meeting.location}</Text>
            </View>
          )}
        </View>
      </Card>

      {/* ═══ TAB BAR ════════════════════════════════════════ */}
      <View style={z.tabBar}>
        <TouchableOpacity
          style={[z.tab, activeTab === 'meeting' && z.tabActive]}
          onPress={() => setActiveTab('meeting')}
          activeOpacity={0.7}
        >
          <Ionicons name="videocam" size={16} color={activeTab === 'meeting' ? Colors.highlight : Colors.textLight} />
          <Text style={[z.tabText, activeTab === 'meeting' && z.tabTextActive]} numberOfLines={1}>Meeting</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[z.tab, activeTab === 'transcript' && z.tabActive]}
          onPress={() => setActiveTab('transcript')}
          activeOpacity={0.7}
        >
          <Ionicons name="chatbubbles" size={16} color={activeTab === 'transcript' ? Colors.highlight : Colors.textLight} />
          <Text style={[z.tabText, activeTab === 'transcript' && z.tabTextActive]} numberOfLines={1}>Transcript</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[z.tab, activeTab === 'minutes' && z.tabActive]}
          onPress={() => setActiveTab('minutes')}
          activeOpacity={0.7}
        >
          <Ionicons name="document-text" size={16} color={activeTab === 'minutes' ? Colors.highlight : Colors.textLight} />
          <Text style={[z.tabText, activeTab === 'minutes' && z.tabTextActive]} numberOfLines={1}>Minutes</Text>
          {meeting.minutes && meeting.minutes.status === 'completed' && (
            <View style={z.tabDot} />
          )}
        </TouchableOpacity>
      </View>

      {/* ═══ TAB: TRANSCRIPT ═════════════════════════════════ */}
      {activeTab === 'transcript' && (
        <>
          <Card style={z.section}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
                <Ionicons name="chatbubbles" size={18} color={Colors.highlight} />
                <Text style={{ fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.highlight }}>
                  Live Transcript
                </Text>
              </View>
              <TouchableOpacity onPress={loadTranscripts} style={{ padding: Spacing.xs }}>
                <Ionicons name="refresh" size={18} color={Colors.textLight} />
              </TouchableOpacity>
            </View>

            {transcriptsLoading ? (
              <View style={{ paddingVertical: Spacing.xl, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={Colors.highlight} />
                <Text style={{ color: Colors.textLight, marginTop: Spacing.sm }}>Loading transcripts...</Text>
              </View>
            ) : transcripts.length === 0 ? (
              <View style={{ paddingVertical: Spacing.xl, alignItems: 'center' }}>
                <Ionicons name="chatbubbles-outline" size={40} color={Colors.textLight} />
                <Text style={{ color: Colors.textLight, fontSize: FontSize.md, marginTop: Spacing.sm, textAlign: 'center' }}>
                  No transcripts yet.{'\n'}Enable Live Translation and speak to generate a transcript.
                </Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 500 }} showsVerticalScrollIndicator={false}>
                {transcripts.map((t: any, idx: number) => {
                  const time = new Date(parseInt(t.spoken_at)).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  const isSelf = t.speaker_id === userId;
                  return (
                    <View key={t.id || idx} style={[z.transcriptRow, isSelf && z.transcriptRowSelf]}>
                      <View style={z.transcriptHeader}>
                        <Text style={z.transcriptSpeaker}>
                          {getLanguageFlag(t.source_lang)} {isSelf ? 'You' : t.speaker_name}
                        </Text>
                        <Text style={z.transcriptTime}>{time}</Text>
                      </View>
                      <Text style={z.transcriptText}>{t.original_text}</Text>
                      {t.translations && Object.keys(typeof t.translations === 'string' ? JSON.parse(t.translations) : t.translations).length > 0 && (
                        <View style={z.transcriptTranslations}>
                          {Object.entries(typeof t.translations === 'string' ? JSON.parse(t.translations) : t.translations).map(([lang, text]) => (
                            <Text key={lang} style={z.transcriptTranslation}>
                              {getLanguageFlag(lang)} {text as string}
                            </Text>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </Card>
          <View style={{ height: Spacing.xxl * 2 }} />
        </>
      )}

      {/* ═══ TAB: MINUTES ════════════════════════════════════ */}
      {activeTab === 'minutes' && (
        <>
          <Card style={z.section}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
                <Ionicons name="document-text" size={18} color={Colors.highlight} />
                <Text style={{ fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.highlight }}>
                  AI Meeting Minutes
                </Text>
              </View>
              <TouchableOpacity onPress={loadMinutes} style={{ padding: Spacing.xs }}>
                <Ionicons name="refresh" size={18} color={Colors.textLight} />
              </TouchableOpacity>
            </View>

            {minutesLoading ? (
              <View style={{ paddingVertical: Spacing.xl, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={Colors.highlight} />
                <Text style={{ color: Colors.textLight, marginTop: Spacing.sm }}>Loading minutes...</Text>
              </View>
            ) : minutes?.status === 'processing' ? (
              <View style={{ paddingVertical: Spacing.xl, alignItems: 'center' }}>
                <ActivityIndicator size="large" color={Colors.highlight} />
                <Text style={{ color: Colors.highlight, fontSize: FontSize.lg, fontWeight: FontWeight.semibold, marginTop: Spacing.md }}>
                  Generating Minutes...
                </Text>
                <Text style={{ color: Colors.textLight, fontSize: FontSize.sm, marginTop: Spacing.xs, textAlign: 'center' }}>
                  AI is analyzing the meeting transcript. This may take a few moments.
                </Text>
              </View>
            ) : minutes?.status === 'failed' ? (
              <View style={{ paddingVertical: Spacing.xl, alignItems: 'center' }}>
                <Ionicons name="alert-circle" size={40} color={Colors.error} />
                <Text style={{ color: Colors.error, fontSize: FontSize.md, fontWeight: FontWeight.semibold, marginTop: Spacing.sm }}>
                  Minutes Generation Failed
                </Text>
                <Text style={{ color: Colors.textLight, fontSize: FontSize.sm, marginTop: Spacing.xs, textAlign: 'center' }}>
                  {minutes.error_message || 'An error occurred during AI processing.'}
                </Text>
                {isAdmin && (
                  <TouchableOpacity
                    style={{ marginTop: Spacing.md, backgroundColor: Colors.highlight, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md }}
                    onPress={handleGenerateMinutes}
                    disabled={generateLoading}
                  >
                    <Text style={{ color: '#FFF', fontWeight: FontWeight.semibold }}>
                      {generateLoading ? 'Retrying...' : 'Retry Generation'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : minutes?.status === 'completed' ? (
              <>
                {/* Summary */}
                {minutes.summary && (
                  <View style={z.minutesSection}>
                    <Text style={z.minutesSectionTitle}>Executive Summary</Text>
                    <Text style={z.minutesSectionContent}>{minutes.summary}</Text>
                  </View>
                )}

                {/* Decisions */}
                {minutes.decisions?.length > 0 && (
                  <View style={z.minutesSection}>
                    <Text style={z.minutesSectionTitle}>Key Decisions</Text>
                    {minutes.decisions.map((d: string, i: number) => (
                      <View key={i} style={z.minutesBulletRow}>
                        <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
                        <Text style={z.minutesBulletText}>{d}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Motions */}
                {minutes.motions?.length > 0 && (
                  <View style={z.minutesSection}>
                    <Text style={z.minutesSectionTitle}>Motions</Text>
                    {minutes.motions.map((m: any, i: number) => (
                      <View key={i} style={z.minutesBulletRow}>
                        <Ionicons name="megaphone" size={14} color={Colors.warning} />
                        <Text style={z.minutesBulletText}>
                          {typeof m === 'string' ? m : `${m.text}${m.movedBy ? ` — Moved by ${m.movedBy}` : ''}${m.result ? ` (${m.result})` : ''}`}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Action Items */}
                {minutes.action_items?.length > 0 && (
                  <View style={z.minutesSection}>
                    <Text style={z.minutesSectionTitle}>Action Items</Text>
                    {minutes.action_items.map((a: any, i: number) => (
                      <View key={i} style={z.minutesBulletRow}>
                        <Ionicons name="arrow-forward-circle" size={14} color={Colors.highlight} />
                        <View style={{ flex: 1 }}>
                          <Text style={z.minutesBulletText}>
                            {typeof a === 'string' ? a : a.description || a.task}
                          </Text>
                          {typeof a !== 'string' && (a.assigneeName || a.assignee) && (
                            <Text style={{ color: Colors.textLight, fontSize: FontSize.xs, marginTop: 2 }}>
                              Assigned to: {a.assigneeName || a.assignee}
                              {a.dueDate ? ` — Due: ${a.dueDate}` : ''}
                            </Text>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {/* Contributions */}
                {minutes.contributions?.length > 0 && (
                  <View style={z.minutesSection}>
                    <Text style={z.minutesSectionTitle}>Participant Contributions</Text>
                    {minutes.contributions.map((c: any, i: number) => (
                      <View key={i} style={z.contributionCard}>
                        <Text style={z.contributionName}>{c.userName}</Text>
                        {c.speakingTimeSeconds > 0 && (
                          <Text style={z.contributionTime}>
                            Speaking time: {Math.floor(c.speakingTimeSeconds / 60)}m {c.speakingTimeSeconds % 60}s
                          </Text>
                        )}
                        {c.keyPoints?.map((kp: string, j: number) => (
                          <Text key={j} style={z.contributionPoint}>• {kp}</Text>
                        ))}
                      </View>
                    ))}
                  </View>
                )}

                {/* Download Buttons */}
                <View style={z.downloadRow}>
                  <TouchableOpacity style={z.downloadBtn} onPress={() => handleDownloadMinutes('txt')} activeOpacity={0.7}>
                    <Ionicons name="document-outline" size={18} color={Colors.highlight} />
                    <Text style={z.downloadBtnText}>Download TXT</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={z.downloadBtn} onPress={() => handleDownloadMinutes('json')} activeOpacity={0.7}>
                    <Ionicons name="code-slash" size={18} color={Colors.highlight} />
                    <Text style={z.downloadBtnText}>Download JSON</Text>
                  </TouchableOpacity>
                </View>

                {/* View Full Report */}
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, marginTop: Spacing.md, paddingVertical: Spacing.sm }}
                  onPress={() => router.push(`/meetings/${meetingId}/report`)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="reader-outline" size={18} color={Colors.highlight} />
                  <Text style={{ color: Colors.highlight, fontSize: FontSize.md, fontWeight: FontWeight.semibold }}>
                    View Full Report
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={Colors.highlight} />
                </TouchableOpacity>

                {/* Generated timestamp */}
                {minutes.generated_at && (
                  <Text style={{ color: Colors.textLight, fontSize: FontSize.xs, textAlign: 'center', marginTop: Spacing.sm }}>
                    Generated {new Date(minutes.generated_at).toLocaleString()}
                  </Text>
                )}
              </>
            ) : (
              // No minutes yet
              <View style={{ paddingVertical: Spacing.xl, alignItems: 'center' }}>
                <Ionicons name="document-text-outline" size={40} color={Colors.textLight} />
                <Text style={{ color: Colors.textLight, fontSize: FontSize.md, marginTop: Spacing.sm, textAlign: 'center' }}>
                  No minutes generated yet.
                </Text>
                <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm, marginTop: Spacing.xs, textAlign: 'center' }}>
                  Minutes will be auto-generated when the meeting ends.
                </Text>
                {isAdmin && meeting.status === 'ended' && transcripts.length > 0 && (
                  <TouchableOpacity
                    style={{ marginTop: Spacing.md, backgroundColor: Colors.highlight, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md }}
                    onPress={handleGenerateMinutes}
                    disabled={generateLoading}
                  >
                    <Text style={{ color: '#FFF', fontWeight: FontWeight.semibold }}>
                      {generateLoading ? 'Generating...' : 'Generate Minutes from Transcript'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </Card>
          <View style={{ height: Spacing.xxl * 2 }} />
        </>
      )}

      {/* ═══ TAB: MEETING (default) ══════════════════════════ */}
      {activeTab === 'meeting' && (<>

      {/* ═══ MEETING TIMER (LIVE) ════════════════════════════ */}
      {meeting.status === 'live' && (
        <Card style={z.timerCard} variant="elevated">
          <View style={z.timerInner}>
            <View style={z.timerLeft}>
              <PulseDot color="#34D399" size={12} />
              <Text style={z.timerLabel}>Meeting Duration</Text>
            </View>
            <Text style={z.timerValue}>{formatDuration(elapsedSeconds)}</Text>
          </View>
          {meeting.duration_limit_minutes > 0 && (
            <View style={z.durationLimitRow}>
              <Ionicons name="hourglass-outline" size={12} color={Colors.warning} />
              <Text style={z.durationLimitText}>
                Limit: {meeting.duration_limit_minutes} min
                {elapsedSeconds > 0 && ` (${Math.max(0, meeting.duration_limit_minutes - Math.floor(elapsedSeconds / 60))} min left)`}
              </Text>
            </View>
          )}
        </Card>
      )}

      {/* ═══ JOIN COUNTDOWN (SCHEDULED) ══════════════════════ */}
      {meeting.status === 'scheduled' && countdownMs > 0 && (
        <Card style={z.countdownCard} variant="elevated">
          <Text style={z.countdownLabel}>Meeting starts in</Text>
          <View style={z.countdownBoxes}>
            <View style={z.countdownUnit}><Text style={z.countdownNum}>{countdown.hours}</Text><Text style={z.countdownSuffix}>hrs</Text></View>
            <Text style={z.countdownSep}>:</Text>
            <View style={z.countdownUnit}><Text style={z.countdownNum}>{countdown.minutes}</Text><Text style={z.countdownSuffix}>min</Text></View>
            <Text style={z.countdownSep}>:</Text>
            <View style={z.countdownUnit}><Text style={z.countdownNum}>{countdown.seconds}</Text><Text style={z.countdownSuffix}>sec</Text></View>
          </View>
        </Card>
      )}

      {/* ═══ BANDWIDTH HINT ══════════════════════════════════ */}
      {showBandwidthHint && meeting.status === 'live' && (
        <Card style={StyleSheet.flatten([z.section, { borderLeftWidth: 3, borderLeftColor: Colors.warning }])}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
            <Ionicons name="cellular-outline" size={18} color={Colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: Colors.warning, fontSize: FontSize.md, fontWeight: FontWeight.semibold }}>Low Bandwidth Detected</Text>
              <Text style={{ color: Colors.textLight, fontSize: FontSize.sm, marginTop: 2 }}>
                We recommend joining as audio-only for a better experience.
              </Text>
            </View>
            <TouchableOpacity onPress={() => setShowBandwidthHint(false)}>
              <Ionicons name="close" size={18} color={Colors.textLight} />
            </TouchableOpacity>
          </View>
        </Card>
      )}

      {/* ═══ PRE-JOIN LOBBY (LIVE — not yet joined) ═════════ */}
      {meeting.status === 'live' && (
        <Card style={z.lobbyCard} variant="elevated">
          {/* Lobby Preview Area */}
          <View style={z.lobbyPreview}>
            <View style={z.lobbyAvatarCircle}>
              <Ionicons
                name={meeting.meeting_type === 'audio' ? 'mic' : 'videocam'}
                size={48}
                color="rgba(129, 140, 248, 0.6)"
              />
            </View>
            <Text style={z.lobbyTitle}>Ready to join?</Text>
            <Text style={z.lobbySubtitle}>
              {meeting.meeting_type === 'audio' ? 'Audio conference' : 'Video conference'} is in progress
            </Text>
          </View>

          {/* Participant Count */}
          <View style={z.lobbyParticipantRow}>
            <Ionicons name="people" size={16} color={Colors.textLight} />
            <Text style={z.lobbyParticipantText}>
              {participantCount} participant{participantCount !== 1 ? 's' : ''} in meeting
            </Text>
            <TouchableOpacity onPress={() => setShowParticipants(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ color: Colors.highlight, fontSize: FontSize.sm, fontWeight: FontWeight.medium as any }}>View</Text>
            </TouchableOpacity>
          </View>

          {/* Join Button */}
          <View style={z.lobbyJoinRow}>
            <TouchableOpacity
              style={z.lobbyJoinVideoBtn}
              onPress={() => handleJoinMeeting('video')}
              disabled={joinLoading}
              activeOpacity={0.7}
            >
              {joinLoading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name="videocam" size={22} color="#FFF" />
                  <Text style={z.lobbyJoinBtnText}>Join Meeting</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Quick Actions */}
          <View style={z.lobbyQuickActions}>
            <TouchableOpacity style={z.lobbyQuickBtn} onPress={handleMarkAttendance} disabled={actionLoading}>
              <Ionicons name="hand-left" size={16} color={Colors.highlight} />
              <Text style={z.lobbyQuickText}>Attendance</Text>
            </TouchableOpacity>
          </View>
        </Card>
      )}

      {/* ═══ START / CANCEL (SCHEDULED — ADMIN) ══════════════ */}
      {isAdmin && meeting.status === 'scheduled' && (
        <View style={z.actionArea}>
          <Button
            title={actionLoading ? 'Starting...' : 'Start Meeting'}
            onPress={handleStart}
            disabled={actionLoading}
            variant="primary"
            icon="play"
            fullWidth
          />
          <TouchableOpacity style={z.cancelMeetingBtn} onPress={handleCancel} disabled={actionLoading}>
            <Ionicons name="close-circle-outline" size={18} color={Colors.error} />
            <Text style={z.cancelMeetingText}>Cancel Meeting</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ═══ END MEETING (LIVE — ADMIN) ══════════════════════ */}
      {isAdmin && meeting.status === 'live' && (
        <View style={z.actionArea}>
          <Button title="End Meeting" onPress={handleEnd} disabled={actionLoading} variant="danger" icon="stop-circle" fullWidth />
        </View>
      )}

      {/* ═══ LIVE TRANSLATION ════════════════════════════════ */}
      {!gm.isActive && meeting.status === 'live' && userId && (
        <LiveTranslation ref={translationRef} meetingId={meetingId!} userId={userId} hideControls autoTTS={voiceToVoice} />
      )}

      {/* ═══ MEETING SERVICES ════════════════════════════════ */}
      {isAdmin && (
        <Card style={z.section}>
          <SectionHeader title="Meeting Services" />

          <View style={z.serviceRow}>
            <View style={z.serviceInfo}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
                <Ionicons name="flash" size={16} color={Colors.highlight} />
                <Text style={z.serviceTitle}>AI-Powered Minutes</Text>
              </View>
              <Text style={z.serviceHint}>
                Active — Minutes auto-generate when the meeting ends.
              </Text>
            </View>
            <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
          </View>

          <View style={z.serviceRow}>
            <View style={z.serviceInfo}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
                <Ionicons name="language" size={16} color="#7C3AED" />
                <Text style={z.serviceTitle}>Live Translation</Text>
              </View>
              <Text style={z.serviceHint}>
                Active — Real-time multilingual translation (100+ languages).
              </Text>
            </View>
            <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
          </View>
        </Card>
      )}

      {/* Audio recording controls moved to unified control bar */}

      {/* ═══ AGENDA ITEMS ════════════════════════════════════ */}
      {meeting.agendaItems && meeting.agendaItems.length > 0 && (
        <Card style={z.section}>
          <SectionHeader title={`Agenda (${meeting.agendaItems.length})`} />
          {meeting.agendaItems.map((item: any, idx: number) => (
            <View key={item.id || idx} style={z.agendaItem}>
              <View style={z.agendaNum}><Text style={z.agendaNumText}>{idx + 1}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={z.agendaTitle}>{item.title}</Text>
                {item.description && <Text style={z.agendaDesc}>{item.description}</Text>}
                {item.duration_minutes && (
                  <View style={z.agendaDurationRow}>
                    <Ionicons name="time-outline" size={12} color={Colors.textLight} />
                    <Text style={z.agendaDuration}>{item.duration_minutes} min</Text>
                  </View>
                )}
              </View>
            </View>
          ))}
        </Card>
      )}

      {/* ═══ ATTENDANCE ══════════════════════════════════════ */}
      {meeting.attendance && meeting.attendance.length > 0 && (
        <Card style={z.section}>
          <SectionHeader title={`Attendance (${meeting.attendance.length})`} />
          {meeting.attendance.map((a: any) => {
            const initials = `${(a.first_name?.[0] || '?').toUpperCase()}${(a.last_name?.[0] || '').toUpperCase()}`;
            return (
              <View key={a.id || a.user_id} style={z.attendeeRow}>
                <Avatar name={initials} size={32} />
                <Text style={z.attendeeName}>{a.first_name || a.user_id} {a.last_name || ''}</Text>
                <Badge variant={a.status === 'present' ? 'success' : 'warning'} label={a.status === 'present' ? 'Present' : 'Late'} />
              </View>
            );
          })}
        </Card>
      )}

      {/* ═══ VOTES ═══════════════════════════════════════════ */}
      {meeting.votes && meeting.votes.length > 0 && (
        <Card style={z.section}>
          <SectionHeader title="Votes" />
          {meeting.votes.map((v: any) => (
            <View key={v.id} style={z.voteCard}>
              <Text style={z.voteQuestion}>{v.title}</Text>
              {v.description && <Text style={z.voteType}>{v.description}</Text>}
              {v.status === 'open' ? (
                <View style={z.voteOptions}>
                  {(typeof v.options === 'string' ? JSON.parse(v.options) : v.options || []).map((opt: string) => (
                    <TouchableOpacity key={opt} style={z.voteOptionBtn} onPress={() => handleVote(v.id, opt)} activeOpacity={0.7}>
                      <Text style={z.voteOptionText}>{opt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <View style={z.voteResults}>
                  <Ionicons name="checkmark-done" size={14} color={Colors.textLight} />
                  <Text style={z.voteClosed}>Vote closed — {v.result || 'Results pending'}</Text>
                </View>
              )}
            </View>
          ))}
        </Card>
      )}

      {/* ═══ AI MINUTES ══════════════════════════════════════ */}
      {meeting.minutes && (
        <Card style={z.section}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.sm }}>
            <Ionicons name="flash" size={16} color={Colors.highlight} />
            <Text style={{ fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.highlight }}>AI Meeting Minutes</Text>
          </View>
          <View style={z.minutesCard}>
            <Text style={z.minutesLabel}>Summary</Text>
            <Text style={z.minutesText}>{meeting.minutes.summary}</Text>
            {meeting.minutes.decisions?.length > 0 && (
              <>
                <Text style={z.minutesLabel}>Key Decisions</Text>
                {meeting.minutes.decisions.map((d: string, i: number) => (
                  <View key={i} style={z.bulletRow}>
                    <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
                    <Text style={z.minutesBullet}>{d}</Text>
                  </View>
                ))}
              </>
            )}
            {meeting.minutes.action_items?.length > 0 && (
              <>
                <Text style={z.minutesLabel}>Action Items</Text>
                {meeting.minutes.action_items.map((a: any, i: number) => (
                  <View key={i} style={z.bulletRow}>
                    <Ionicons name="arrow-forward-circle" size={14} color={Colors.highlight} />
                    <Text style={z.minutesBullet}>
                      {typeof a === 'string' ? a : `${a.task} → ${a.assignee || 'TBD'}`}
                    </Text>
                  </View>
                ))}
              </>
            )}
            {meeting.minutes.motions?.length > 0 && (
              <>
                <Text style={z.minutesLabel}>Motions</Text>
                {meeting.minutes.motions.map((m: any, i: number) => (
                  <View key={i} style={z.bulletRow}>
                    <Ionicons name="megaphone" size={14} color={Colors.warning} />
                    <Text style={z.minutesBullet}>
                      {typeof m === 'string' ? m : `${m.text} — ${m.result || 'pending'}`}
                    </Text>
                  </View>
                ))}
              </>
            )}
          </View>
        </Card>
      )}

      <View style={{ height: Spacing.xxl * 2 }} />
      </>)}

      {/* ═══ PARTICIPANT MODAL ═══════════════════════════════ */}
      <ParticipantModal
        visible={showParticipants}
        onClose={() => setShowParticipants(false)}
        participants={liveParticipants}
        attendance={meeting.attendance || []}
      />
    </ResponsiveScrollView>
  );
}

// ════════════════════════════════════════════════════════════
// STYLES
// ════════════════════════════════════════════════════════════
const z = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background, gap: Spacing.md },
  errorText: { color: Colors.textLight, fontSize: FontSize.lg },

  // ── Header Card ─────────────────────────────────────────
  headerCard: { marginHorizontal: Spacing.sm, marginTop: Spacing.sm, padding: Spacing.md, overflow: 'hidden' },
  headerLive: { borderWidth: 1, borderColor: 'rgba(52, 211, 153, 0.25)' },
  liveStripe: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: '#34D399' },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  orgLabel: { fontSize: FontSize.xs, color: Colors.textLight, fontWeight: FontWeight.medium, letterSpacing: 0.5, textTransform: 'uppercase' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: BorderRadius.full },
  statusText: { fontSize: FontSize.xs, fontWeight: FontWeight.bold, textTransform: 'uppercase', letterSpacing: 0.5 },
  editIconBtn: { padding: 6, borderRadius: BorderRadius.sm, backgroundColor: Colors.primaryLight },
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textWhite, marginBottom: 2 },
  description: { fontSize: FontSize.md, color: Colors.textLight, marginTop: Spacing.xs, lineHeight: 22 },
  typeBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(129, 140, 248, 0.12)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: BorderRadius.full },
  typeBadgeText: { color: '#818CF8', fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  aiBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.highlightSubtle, paddingHorizontal: 8, paddingVertical: 3, borderRadius: BorderRadius.full },
  aiBadgeText: { color: Colors.highlight, fontSize: FontSize.xs, fontWeight: FontWeight.bold },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginTop: Spacing.md },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { color: Colors.textSecondary, fontSize: FontSize.sm },

  // ── Timer ───────────────────────────────────────────────
  timerCard: { marginHorizontal: Spacing.sm, marginBottom: Spacing.xs, padding: Spacing.sm },
  timerInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  timerLabel: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  timerValue: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textWhite, fontVariant: ['tabular-nums'] as any, letterSpacing: 2 },
  durationLimitRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.xs },
  durationLimitText: { color: Colors.warning, fontSize: FontSize.xs },

  // ── Countdown ───────────────────────────────────────────
  countdownCard: { marginHorizontal: Spacing.sm, marginBottom: Spacing.xs, padding: Spacing.md, alignItems: 'center' },
  countdownLabel: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium, marginBottom: Spacing.md, textTransform: 'uppercase', letterSpacing: 1 },
  countdownBoxes: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  countdownUnit: { alignItems: 'center', backgroundColor: Colors.primaryLight, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, minWidth: 56 },
  countdownNum: { fontSize: 24, fontWeight: FontWeight.bold, color: Colors.textWhite, fontVariant: ['tabular-nums'] as any },
  countdownSuffix: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 2, textTransform: 'uppercase' },
  countdownSep: { fontSize: 28, fontWeight: FontWeight.bold, color: Colors.textLight },

  // ── Video Embed ─────────────────────────────────────────
  videoWrapper: { marginHorizontal: Spacing.sm, marginBottom: Spacing.sm, borderRadius: BorderRadius.lg, overflow: 'hidden', backgroundColor: '#000', ...Shadow.lg },
  videoToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(15, 26, 46, 0.95)', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  videoToolbarText: { color: '#34D399', fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  videoTimerText: { color: Colors.textLight, fontSize: FontSize.xs, fontVariant: ['tabular-nums'] as any, marginLeft: Spacing.xs },
  toolbarBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  toolbarBtnActive: { backgroundColor: Colors.highlight },
  toolbarBadge: { position: 'absolute', top: -4, right: -4, backgroundColor: Colors.error, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  toolbarBadgeText: { color: '#FFF', fontSize: 10, fontWeight: FontWeight.bold },
  videoContainer: { aspectRatio: 16 / 9, maxHeight: 400, backgroundColor: '#000' },

  // ── Join Card ───────────────────────────────────────────
  joinCard: { marginHorizontal: Spacing.md, marginBottom: Spacing.sm, padding: Spacing.lg },
  joinCardTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textWhite, marginBottom: 4 },
  joinCardHint: { fontSize: FontSize.sm, color: Colors.textLight, marginBottom: Spacing.md },
  joinBtnRow: { gap: Spacing.sm },
  joinBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: 14, borderRadius: BorderRadius.lg, ...Shadow.md },
  joinBtnVideo: { backgroundColor: '#6366F1' },
  joinBtnAudio: { backgroundColor: '#10B981' },
  joinBtnText: { color: '#FFF', fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  liveActionsRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.accent },
  liveActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, backgroundColor: Colors.primaryLight },
  liveActionText: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },

  // ── Pre-Join Lobby ──────────────────────────────────────
  lobbyCard: { marginHorizontal: Spacing.sm, marginBottom: Spacing.sm, padding: 0, overflow: 'hidden' },
  lobbyPreview: {
    alignItems: 'center',
    paddingVertical: Spacing.xl * 2,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderBottomWidth: 1,
    borderBottomColor: Colors.accent,
  },
  lobbyAvatarCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(129, 140, 248, 0.1)',
    borderWidth: 2,
    borderColor: 'rgba(129, 140, 248, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  lobbyTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.textWhite,
    marginBottom: Spacing.xs,
  },
  lobbySubtitle: {
    fontSize: FontSize.md,
    color: Colors.textLight,
  },
  lobbyParticipantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.accent,
  },
  lobbyParticipantText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    flex: 1,
  },
  lobbyJoinRow: {
    gap: Spacing.sm,
    padding: Spacing.md,
  },
  lobbyJoinVideoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: 16,
    borderRadius: BorderRadius.lg,
    backgroundColor: '#6366F1',
    ...Shadow.md,
  },
  lobbyJoinAudioBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: 16,
    borderRadius: BorderRadius.lg,
    backgroundColor: '#10B981',
    ...Shadow.md,
  },
  lobbyJoinBtnText: {
    color: '#FFF',
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
  },
  lobbyQuickActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  lobbyQuickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.primaryLight,
    borderWidth: 0.5,
    borderColor: Colors.accent,
  },
  lobbyQuickText: {
    fontSize: FontSize.sm,
    color: Colors.textWhite,
    fontWeight: FontWeight.medium as any,
  },

  // ── Action Area ─────────────────────────────────────────
  actionArea: { marginHorizontal: Spacing.sm, marginBottom: Spacing.xs, gap: Spacing.sm },
  cancelMeetingBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Spacing.sm, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.error },
  cancelMeetingText: { color: Colors.error, fontSize: FontSize.sm, fontWeight: FontWeight.medium },

  // ── Section ─────────────────────────────────────────────
  section: { marginHorizontal: Spacing.sm, marginBottom: Spacing.sm, padding: Spacing.sm },

  // ── Services ────────────────────────────────────────────
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: 0.5, borderBottomColor: Colors.accent },
  serviceInfo: { flex: 1 },
  serviceTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textWhite },
  serviceHint: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 2 },

  // ── Audio Recording ─────────────────────────────────────
  recordBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.error, paddingVertical: Spacing.md, borderRadius: BorderRadius.lg, ...Shadow.md },
  recordBtnText: { color: '#FFF', fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  stopBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.error, paddingVertical: Spacing.md, borderRadius: BorderRadius.lg, marginTop: Spacing.sm, ...Shadow.md },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.success, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: BorderRadius.lg, flex: 1 },
  discardBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.surface, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.error },
  recordingActive: { alignItems: 'center', paddingVertical: Spacing.md, gap: Spacing.sm },
  recordingTime: { fontSize: 36, fontWeight: FontWeight.bold, color: Colors.textWhite, fontVariant: ['tabular-nums'] as any },
  recordingDone: { alignItems: 'center', paddingVertical: Spacing.sm },

  // ── Edit Mode ───────────────────────────────────────────
  editField: { marginBottom: Spacing.sm },
  editLabel: { color: Colors.textLight, fontSize: FontSize.sm, fontWeight: FontWeight.semibold, marginBottom: 4 },
  editInput: { backgroundColor: Colors.primaryLight, color: Colors.textWhite, fontSize: FontSize.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.accent },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.sm },
  cancelEditBtn: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },

  // ── Agenda ──────────────────────────────────────────────
  agendaItem: { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm, borderBottomWidth: 0.5, borderBottomColor: Colors.accent },
  agendaNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.highlightSubtle, alignItems: 'center', justifyContent: 'center' },
  agendaNumText: { color: Colors.highlight, fontWeight: FontWeight.bold, fontSize: FontSize.sm },
  agendaTitle: { color: Colors.textWhite, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  agendaDesc: { color: Colors.textLight, fontSize: FontSize.sm, marginTop: 2 },
  agendaDurationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  agendaDuration: { color: Colors.textLight, fontSize: FontSize.xs },

  // ── Attendance ──────────────────────────────────────────
  attendeeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs + 2, borderBottomWidth: 0.5, borderBottomColor: Colors.accent },
  attendeeName: { color: Colors.textWhite, fontSize: FontSize.md, flex: 1, fontWeight: FontWeight.medium },

  // ── Votes ───────────────────────────────────────────────
  voteCard: { backgroundColor: Colors.primaryLight, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, borderWidth: 0.5, borderColor: Colors.accent },
  voteQuestion: { color: Colors.textWhite, fontSize: FontSize.md, fontWeight: FontWeight.semibold },
  voteType: { color: Colors.textLight, fontSize: FontSize.xs, marginTop: 2, marginBottom: Spacing.sm },
  voteOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  voteOptionBtn: { backgroundColor: Colors.highlight, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full, ...Shadow.sm },
  voteOptionText: { color: Colors.textWhite, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  voteResults: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: Spacing.xs },
  voteClosed: { color: Colors.textLight, fontStyle: 'italic', fontSize: FontSize.sm },

  // ── AI Minutes ──────────────────────────────────────────
  minutesCard: { backgroundColor: Colors.primaryLight, borderRadius: BorderRadius.md, padding: Spacing.md, borderWidth: 0.5, borderColor: Colors.accent },
  minutesLabel: { color: Colors.highlight, fontSize: FontSize.sm, fontWeight: FontWeight.bold, marginTop: Spacing.md, marginBottom: 4 },
  minutesText: { color: Colors.textWhite, fontSize: FontSize.md, lineHeight: 22 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 4 },
  minutesBullet: { color: Colors.textWhite, fontSize: FontSize.sm, flex: 1, lineHeight: 20 },

  // ── Modal ───────────────────────────────────────────────
  modalOverlay: { flex: 1, backgroundColor: 'rgba(6, 13, 24, 0.8)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: Colors.surface, borderTopLeftRadius: BorderRadius.xl, borderTopRightRadius: BorderRadius.xl, padding: Spacing.lg, maxHeight: '75%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  modalTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textWhite },
  modalSectionLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.bold, color: Colors.textLight, textTransform: 'uppercase', letterSpacing: 1, marginBottom: Spacing.sm },
  participantRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs + 2, borderBottomWidth: 0.5, borderBottomColor: Colors.accent },
  participantDot: { width: 8, height: 8, borderRadius: 4 },
  participantName: { color: Colors.textWhite, fontSize: FontSize.md, fontWeight: FontWeight.medium },
  moderatorBadge: { fontSize: FontSize.xs, color: Colors.highlight, fontWeight: FontWeight.semibold },
  handRaisedIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.highlightSubtle, alignItems: 'center', justifyContent: 'center' },

  // ── Unified Control Bar ─────────────────────────────────
  controlBarCard: { marginHorizontal: Spacing.sm, marginBottom: Spacing.xs, paddingHorizontal: Spacing.xs, paddingVertical: Spacing.sm },
  controlBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', flexWrap: 'wrap' },
  controlItem: { alignItems: 'center', gap: 3, flex: 1 },
  controlIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', flexShrink: 1 },
  controlIconActive: { backgroundColor: '#6366F1' },
  controlIconOff: { backgroundColor: Colors.primaryLight, borderWidth: 1, borderColor: Colors.accent },
  controlIconMic: { backgroundColor: '#10B981' },
  controlIconRec: { backgroundColor: Colors.error },
  controlIconReady: { backgroundColor: Colors.success },
  controlIconLang: { backgroundColor: Colors.primaryLight, borderWidth: 1, borderColor: Colors.accent },
  controlText: { fontSize: FontSize.xs, color: Colors.textWhite, fontWeight: FontWeight.medium as any, marginTop: 2 },
  controlSecondary: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.sm, marginTop: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 0.5, borderTopColor: Colors.accent },
  controlSecBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, borderRadius: BorderRadius.full, backgroundColor: Colors.primaryLight, borderWidth: 0.5, borderColor: Colors.accent },
  controlSecText: { fontSize: FontSize.xs, color: Colors.textWhite, fontWeight: FontWeight.medium as any },

  // ── Language Picker ─────────────────────────────────────
  langPickerCard: { marginHorizontal: Spacing.sm, marginBottom: Spacing.xs, padding: Spacing.sm },
  langPickerHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  langPickerTitle: { flex: 1, fontSize: FontSize.md, fontWeight: FontWeight.semibold as any, color: Colors.textWhite },
  langPickerItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs + 2, paddingHorizontal: Spacing.xs, borderRadius: BorderRadius.sm },
  langPickerItemActive: { backgroundColor: Colors.highlightSubtle },
  langPickerName: { color: Colors.textWhite, fontSize: FontSize.sm },
  langSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    marginBottom: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  langSearchInput: { flex: 1, color: Colors.textWhite, fontSize: FontSize.sm, padding: 0 },

  // ── Recording Status ────────────────────────────────────
  recordStatusCard: { marginHorizontal: Spacing.sm, marginBottom: Spacing.xs, padding: Spacing.sm },
  uploadSmBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.success, alignItems: 'center', justifyContent: 'center' },

  // ── Video Status Bar ────────────────────────────────────
  videoStatusBar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: 'rgba(15, 26, 46, 0.95)', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },

  // ── Tab Bar ─────────────────────────────────────────────
  tabBar: { flexDirection: 'row', marginHorizontal: Spacing.sm, marginBottom: Spacing.xs, backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: 3, borderWidth: 0.5, borderColor: Colors.accent },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md },
  tabActive: { backgroundColor: Colors.primaryLight },
  tabText: { fontSize: FontSize.sm, color: Colors.textLight, fontWeight: FontWeight.medium as any, flexShrink: 1 },
  tabTextActive: { color: Colors.highlight, fontWeight: FontWeight.semibold as any },
  tabDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.success, marginLeft: 2 },

  // ── Transcript Tab ──────────────────────────────────────
  transcriptRow: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.sm, borderBottomWidth: 0.5, borderBottomColor: Colors.accent },
  transcriptRowSelf: { backgroundColor: 'rgba(129, 140, 248, 0.06)' },
  transcriptHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  transcriptSpeaker: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold as any, color: Colors.highlight },
  transcriptTime: { fontSize: FontSize.xs, color: Colors.textLight, fontVariant: ['tabular-nums'] as any },
  transcriptText: { fontSize: FontSize.md, color: Colors.textWhite, lineHeight: 22 },
  transcriptTranslations: { marginTop: Spacing.xs, paddingTop: Spacing.xs, borderTopWidth: 0.5, borderTopColor: Colors.accent },
  transcriptTranslation: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20, marginTop: 2 },

  // ── Minutes Tab ─────────────────────────────────────────
  minutesSection: { marginBottom: Spacing.md, paddingBottom: Spacing.md, borderBottomWidth: 0.5, borderBottomColor: Colors.accent },
  minutesSectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.bold as any, color: Colors.highlight, marginBottom: Spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  minutesSectionContent: { fontSize: FontSize.md, color: Colors.textWhite, lineHeight: 24 },
  minutesBulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: Spacing.xs },
  minutesBulletText: { fontSize: FontSize.sm, color: Colors.textWhite, flex: 1, lineHeight: 20 },
  contributionCard: { backgroundColor: Colors.primaryLight, borderRadius: BorderRadius.md, padding: Spacing.sm, marginBottom: Spacing.sm, borderWidth: 0.5, borderColor: Colors.accent },
  contributionName: { fontSize: FontSize.md, fontWeight: FontWeight.semibold as any, color: Colors.textWhite },
  contributionTime: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 2 },
  contributionPoint: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 3, lineHeight: 20 },
  downloadRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  downloadBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, backgroundColor: Colors.primaryLight, borderWidth: 1, borderColor: Colors.accent },
  downloadBtnText: { fontSize: FontSize.sm, color: Colors.highlight, fontWeight: FontWeight.medium as any },
});
