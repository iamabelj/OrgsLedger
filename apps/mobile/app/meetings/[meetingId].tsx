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
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Switch,
  TextInput,
  Modal,
  Animated,
  Dimensions,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { socketClient } from '../../src/api/socket';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Card, Badge, Button, Avatar, SectionHeader, LoadingScreen, CrossPlatformDateTimePicker, ResponsiveScrollView } from '../../src/components/ui';
import LiveTranslation from '../../src/components/ui/LiveTranslation';
import { showAlert } from '../../src/utils/alert';

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

  // ── Jitsi Join State (JWT-based) ────────────────────────
  const [showVideo, setShowVideo] = useState(false);
  const [joinConfig, setJoinConfig] = useState<any>(null);
  const [joinLoading, setJoinLoading] = useState(false);

  // ── Zoom-like Features State ────────────────────────────
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [countdownMs, setCountdownMs] = useState(0);
  const [liveParticipants, setLiveParticipants] = useState<any[]>([]);
  const [showParticipants, setShowParticipants] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [bandwidth, setBandwidth] = useState<'high' | 'medium' | 'low'>('high');
  const [bandwidthChecked, setBandwidthChecked] = useState(false);
  const [showBandwidthHint, setShowBandwidthHint] = useState(false);

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

  // ── Socket: Real-time participant tracking ──────────────
  useEffect(() => {
    if (!meetingId) return;
    socketClient.joinMeeting(meetingId);

    const handleParticipantJoined = (data: any) => {
      setLiveParticipants((prev) => {
        if (prev.find((p) => p.userId === data.userId)) return prev;
        return [...prev, { ...data, handRaised: false }];
      });
    };
    const handleParticipantLeft = (data: any) => {
      setLiveParticipants((prev) => prev.filter((p) => p.userId !== data.userId));
    };
    const handleHandRaised = (data: any) => {
      setLiveParticipants((prev) =>
        prev.map((p) => p.userId === data.userId ? { ...p, handRaised: data.raised } : p)
      );
    };

    const unsub1 = socketClient.on('meeting:participant-joined', handleParticipantJoined);
    const unsub2 = socketClient.on('meeting:participant-left', handleParticipantLeft);
    const unsub3 = socketClient.on('meeting:hand-raised', handleHandRaised);

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [meetingId]);

  // ── Meeting Actions ─────────────────────────────────────
  const handleStart = async () => {
    if (!currentOrgId || !meetingId) return;
    setActionLoading(true);
    try {
      await api.meetings.start(currentOrgId, meetingId);
      await loadMeeting();
      socketClient.joinMeeting(meetingId);
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
          setActionLoading(true);
          try {
            await api.meetings.end(currentOrgId, meetingId);
            await loadMeeting();
          } catch (err: any) {
            showAlert('Error', err.response?.data?.error || 'Failed to end meeting');
          } finally {
            setActionLoading(false);
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

  // ── AI Toggle ───────────────────────────────────────────
  const handleToggleAi = async () => {
    if (!currentOrgId || !meetingId) return;
    setActionLoading(true);
    try {
      const res = await api.meetings.toggleAi(currentOrgId, meetingId);
      showAlert('Done', res.data?.message || 'AI setting updated');
      await loadMeeting();
    } catch (err: any) {
      const errMsg = err.response?.data?.error || 'Failed to toggle AI';
      if (errMsg.includes('Insufficient')) {
        showAlert('Insufficient Credits', 'You need AI credits to enable this feature. Go to AI Plans to purchase credits.', [
          { text: 'Later', style: 'cancel' },
          { text: 'Go to AI Plans', onPress: () => router.push('/admin/plans' as any) },
        ]);
      } else {
        showAlert('Error', errMsg);
      }
    } finally {
      setActionLoading(false);
    }
  };

  // ── Join Meeting (JWT) ──────────────────────────────────
  const handleJoinMeeting = async (joinType: 'video' | 'audio') => {
    if (!currentOrgId || !meetingId) return;
    setJoinLoading(true);
    try {
      const res = await api.meetings.join(currentOrgId, meetingId, joinType);
      const config = res.data?.data;
      if (!config) throw new Error('No join config returned');
      setJoinConfig(config);

      if (Platform.OS === 'web') {
        setShowVideo(true);
      } else {
        // On native, build the Jitsi URL with JWT
        const configParams = Object.entries(config.configOverwrite || {})
          .filter(([_, v]) => typeof v !== 'object')
          .map(([k, v]) => `config.${k}=${encodeURIComponent(String(v))}`)
          .join('&');
        const ifaceParams = Object.entries(config.interfaceConfigOverwrite || {})
          .filter(([_, v]) => typeof v !== 'object')
          .map(([k, v]) => `interfaceConfig.${k}=${encodeURIComponent(String(v))}`)
          .join('&');
        const userParams = `userInfo.displayName=${encodeURIComponent(config.userInfo?.displayName || userName)}`;
        const hash = [configParams, ifaceParams, userParams].filter(Boolean).join('&');
        const jwtParam = config.jwt ? `?jwt=${config.jwt}` : '';
        const jitsiUrl = `https://${config.domain}/${config.roomName}${jwtParam}#${hash}`;
        await WebBrowser.openBrowserAsync(jitsiUrl, {
          toolbarColor: Colors.surface,
          controlsColor: Colors.highlight,
          dismissButtonStyle: 'close',
          presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
        });
        handleLeaveMeeting();
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Failed to join meeting';
      showAlert('Cannot Join', msg);
    } finally {
      setJoinLoading(false);
    }
  };

  const handleLeaveMeeting = async () => {
    if (!currentOrgId || !meetingId) return;
    try {
      await api.meetings.leave(currentOrgId, meetingId);
    } catch {
      // Non-critical — best effort
    }
    setShowVideo(false);
    setJoinConfig(null);
    setHandRaised(false);
  };

  // ── Toggle Translation ──────────────────────────────────
  const handleToggleTranslation = async () => {
    if (!currentOrgId || !meetingId) return;
    setActionLoading(true);
    try {
      await api.meetings.update(currentOrgId, meetingId, {
        translationEnabled: !meeting.translation_enabled,
      });
      await loadMeeting();
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to toggle translation');
    } finally {
      setActionLoading(false);
    }
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

  // ── Build Jitsi iframe URL ──────────────────────────────
  const jitsiIframeSrc = useMemo(() => {
    if (!joinConfig) return '';
    const configParams = Object.entries(joinConfig.configOverwrite || {})
      .filter(([_, v]) => typeof v !== 'object')
      .map(([k, v]) => `config.${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    const ifaceParams = Object.entries(joinConfig.interfaceConfigOverwrite || {})
      .filter(([_, v]) => typeof v !== 'object')
      .map(([k, v]) => `interfaceConfig.${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    const userParams = `userInfo.displayName=${encodeURIComponent(joinConfig.userInfo?.displayName || userName)}`;
    const hash = [configParams, ifaceParams, userParams].filter(Boolean).join('&');
    const jwtParam = joinConfig.jwt ? `?jwt=${joinConfig.jwt}` : '';
    return `https://${joinConfig.domain}/${joinConfig.roomName}${jwtParam}#${hash}`;
  }, [joinConfig, userName]);

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
  // RENDER
  // ════════════════════════════════════════════════════════
  return (
    <ResponsiveScrollView style={z.container}>
      <Stack.Screen options={{ title: meeting.title || 'Meeting', headerShown: true }} />

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

      {/* ═══ INLINE VIDEO (Jitsi Embed — Web Only) ═══════════ */}
      {showVideo && joinConfig && Platform.OS === 'web' && (
        <View style={z.videoWrapper}>
          {/* Video toolbar */}
          <View style={z.videoToolbar}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
              <PulseDot color="#34D399" size={8} />
              <Text style={z.videoToolbarText}>In Meeting</Text>
              <Text style={z.videoTimerText}>{formatDuration(elapsedSeconds)}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
              {/* Raise Hand */}
              <TouchableOpacity
                style={[z.toolbarBtn, handRaised && z.toolbarBtnActive]}
                onPress={handleRaiseHand}
              >
                <Text style={{ fontSize: 16 }}>✋</Text>
              </TouchableOpacity>
              {/* Participants */}
              <TouchableOpacity
                style={z.toolbarBtn}
                onPress={() => setShowParticipants(true)}
              >
                <Ionicons name="people" size={16} color={Colors.textWhite} />
                {participantCount > 0 && (
                  <View style={z.toolbarBadge}>
                    <Text style={z.toolbarBadgeText}>{participantCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
              {/* Leave button */}
              <TouchableOpacity
                style={[z.toolbarBtn, { backgroundColor: Colors.error }]}
                onPress={handleLeaveMeeting}
              >
                <Ionicons name="call" size={16} color="#FFF" style={{ transform: [{ rotate: '135deg' }] }} />
              </TouchableOpacity>
            </View>
          </View>
          {/* iframe */}
          <View style={z.videoContainer}>
            <iframe
              src={jitsiIframeSrc}
              style={{ width: '100%', height: '100%', border: 'none', borderRadius: 0 } as any}
              allow="camera; microphone; fullscreen; display-capture; autoplay"
              allowFullScreen
            />
          </View>
        </View>
      )}

      {/* ═══ JOIN CONTROLS (LIVE) ════════════════════════════ */}
      {meeting.status === 'live' && !showVideo && (
        <Card style={z.joinCard} variant="elevated">
          <Text style={z.joinCardTitle}>Join Meeting</Text>
          <Text style={z.joinCardHint}>
            {meeting.lobby_enabled
              ? 'A moderator will admit you from the waiting room.'
              : 'You will join the meeting immediately.'}
          </Text>

          <View style={z.joinBtnRow}>
            <TouchableOpacity
              style={[z.joinBtn, z.joinBtnVideo]}
              onPress={() => handleJoinMeeting(meeting.meeting_type === 'audio' ? 'audio' : 'video')}
              disabled={joinLoading}
              activeOpacity={0.7}
            >
              {joinLoading ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Ionicons name={meeting.meeting_type === 'audio' ? 'call' : 'videocam'} size={22} color="#FFF" />
              )}
              <Text style={z.joinBtnText}>
                {joinLoading ? 'Connecting...' : meeting.meeting_type === 'audio' ? 'Join Audio Call' : 'Join Video Call'}
              </Text>
            </TouchableOpacity>

            {meeting.meeting_type !== 'audio' && (
              <TouchableOpacity
                style={[z.joinBtn, z.joinBtnAudio]}
                onPress={() => handleJoinMeeting('audio')}
                disabled={joinLoading}
                activeOpacity={0.7}
              >
                <Ionicons name="call" size={18} color="#FFF" />
                <Text style={z.joinBtnText}>Audio Only{bandwidth === 'low' ? ' (Recommended)' : ''}</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={z.liveActionsRow}>
            <TouchableOpacity style={z.liveActionBtn} onPress={handleMarkAttendance} disabled={actionLoading}>
              <Ionicons name="hand-left" size={16} color={Colors.highlight} />
              <Text style={z.liveActionText}>Attendance</Text>
            </TouchableOpacity>
            <TouchableOpacity style={z.liveActionBtn} onPress={() => setShowParticipants(true)}>
              <Ionicons name="people" size={16} color={Colors.highlight} />
              <Text style={z.liveActionText}>Participants ({participantCount})</Text>
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
      {meeting.status === 'live' && meeting.translation_enabled && userId && (
        <LiveTranslation meetingId={meetingId!} userId={userId} />
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
                {meeting.ai_enabled
                  ? 'Enabled — Record audio and AI will generate minutes when meeting ends.'
                  : 'Disabled — Enable to allow AI-generated meeting minutes.'}
              </Text>
            </View>
            <Switch
              value={!!meeting.ai_enabled}
              onValueChange={handleToggleAi}
              trackColor={{ false: Colors.accent, true: Colors.highlight }}
              thumbColor={Colors.textWhite}
              disabled={actionLoading}
            />
          </View>

          <View style={z.serviceRow}>
            <View style={z.serviceInfo}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
                <Ionicons name="language" size={16} color="#7C3AED" />
                <Text style={z.serviceTitle}>Live Translation</Text>
              </View>
              <Text style={z.serviceHint}>
                {meeting.translation_enabled
                  ? 'Enabled — Real-time multilingual translation (26 languages).'
                  : 'Disabled — Enable to allow real-time multilingual translation.'}
              </Text>
            </View>
            <Switch
              value={!!meeting.translation_enabled}
              onValueChange={handleToggleTranslation}
              trackColor={{ false: Colors.accent, true: '#7C3AED' }}
              thumbColor={Colors.textWhite}
              disabled={actionLoading}
            />
          </View>
        </Card>
      )}

      {/* ═══ AUDIO RECORDING (Live + AI + Admin) ═════════════ */}
      {meeting.status === 'live' && isAdmin && meeting.ai_enabled && (
        <Card style={z.section}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.sm }}>
            <Ionicons name="mic" size={18} color={Colors.highlight} />
            <Text style={{ fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.highlight }}>Audio Recording</Text>
          </View>
          {!isRecording && !recordingUri && (
            <>
              <Text style={{ color: Colors.textLight, fontSize: FontSize.sm, marginBottom: Spacing.sm }}>
                Record the meeting audio for AI transcription and minutes generation.
              </Text>
              <TouchableOpacity style={z.recordBtn} onPress={startRecording} activeOpacity={0.7}>
                <Ionicons name="mic" size={24} color="#FFF" />
                <Text style={z.recordBtnText}>Start Recording</Text>
              </TouchableOpacity>
            </>
          )}
          {isRecording && (
            <View style={z.recordingActive}>
              <PulseDot color={Colors.error} size={16} />
              <Text style={z.recordingTime}>{formatDuration(recordingDuration)}</Text>
              <Text style={{ color: Colors.textLight, fontSize: FontSize.sm }}>Recording in progress...</Text>
              <TouchableOpacity style={z.stopBtn} onPress={stopRecording} activeOpacity={0.7}>
                <Ionicons name="stop" size={24} color="#FFF" />
                <Text style={z.recordBtnText}>Stop Recording</Text>
              </TouchableOpacity>
            </View>
          )}
          {recordingUri && !isRecording && (
            <View style={z.recordingDone}>
              <Ionicons name="checkmark-circle" size={24} color={Colors.success} />
              <Text style={{ color: Colors.textWhite, fontSize: FontSize.md, marginVertical: Spacing.xs }}>
                Recording ready ({formatDuration(recordingDuration)})
              </Text>
              <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                <TouchableOpacity style={z.uploadBtn} onPress={uploadRecording} disabled={uploading}>
                  {uploading ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="cloud-upload" size={20} color="#FFF" />}
                  <Text style={z.recordBtnText}>{uploading ? 'Uploading...' : 'Upload'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={z.discardBtn} onPress={() => { setRecordingUri(null); setRecordingDuration(0); }}>
                  <Ionicons name="trash" size={20} color={Colors.error} />
                  <Text style={[z.recordBtnText, { color: Colors.error }]}>Discard</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {meeting.audio_storage_url && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.sm }}>
              <Ionicons name="checkmark-done-circle" size={16} color={Colors.success} />
              <Text style={{ color: Colors.success, fontSize: FontSize.sm }}>Audio already uploaded</Text>
            </View>
          )}
        </Card>
      )}

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
  headerCard: { margin: Spacing.md, padding: Spacing.lg, overflow: 'hidden' },
  headerLive: { borderWidth: 1, borderColor: 'rgba(52, 211, 153, 0.25)' },
  liveStripe: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: '#34D399' },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  orgLabel: { fontSize: FontSize.xs, color: Colors.textLight, fontWeight: FontWeight.medium, letterSpacing: 0.5, textTransform: 'uppercase' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: BorderRadius.full },
  statusText: { fontSize: FontSize.xs, fontWeight: FontWeight.bold, textTransform: 'uppercase', letterSpacing: 0.5 },
  editIconBtn: { padding: 6, borderRadius: BorderRadius.sm, backgroundColor: Colors.primaryLight },
  title: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.textWhite, marginBottom: 2 },
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
  timerCard: { marginHorizontal: Spacing.md, marginBottom: Spacing.sm, padding: Spacing.md },
  timerInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  timerLabel: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium },
  timerValue: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.textWhite, fontVariant: ['tabular-nums'] as any, letterSpacing: 2 },
  durationLimitRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.xs },
  durationLimitText: { color: Colors.warning, fontSize: FontSize.xs },

  // ── Countdown ───────────────────────────────────────────
  countdownCard: { marginHorizontal: Spacing.md, marginBottom: Spacing.sm, padding: Spacing.lg, alignItems: 'center' },
  countdownLabel: { color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: FontWeight.medium, marginBottom: Spacing.md, textTransform: 'uppercase', letterSpacing: 1 },
  countdownBoxes: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  countdownUnit: { alignItems: 'center', backgroundColor: Colors.primaryLight, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderRadius: BorderRadius.md, minWidth: 68 },
  countdownNum: { fontSize: 32, fontWeight: FontWeight.bold, color: Colors.textWhite, fontVariant: ['tabular-nums'] as any },
  countdownSuffix: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 2, textTransform: 'uppercase' },
  countdownSep: { fontSize: 28, fontWeight: FontWeight.bold, color: Colors.textLight },

  // ── Video Embed ─────────────────────────────────────────
  videoWrapper: { marginHorizontal: Spacing.md, marginBottom: Spacing.md, borderRadius: BorderRadius.lg, overflow: 'hidden', backgroundColor: '#000', ...Shadow.lg },
  videoToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(15, 26, 46, 0.95)', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  videoToolbarText: { color: '#34D399', fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  videoTimerText: { color: Colors.textLight, fontSize: FontSize.xs, fontVariant: ['tabular-nums'] as any, marginLeft: Spacing.xs },
  toolbarBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  toolbarBtnActive: { backgroundColor: Colors.highlight },
  toolbarBadge: { position: 'absolute', top: -4, right: -4, backgroundColor: Colors.error, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  toolbarBadgeText: { color: '#FFF', fontSize: 10, fontWeight: FontWeight.bold },
  videoContainer: { height: 420, backgroundColor: '#000' },

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

  // ── Action Area ─────────────────────────────────────────
  actionArea: { marginHorizontal: Spacing.md, marginBottom: Spacing.sm, gap: Spacing.sm },
  cancelMeetingBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Spacing.sm, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.error },
  cancelMeetingText: { color: Colors.error, fontSize: FontSize.sm, fontWeight: FontWeight.medium },

  // ── Section ─────────────────────────────────────────────
  section: { marginHorizontal: Spacing.md, marginBottom: Spacing.md, padding: Spacing.md },

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
});
