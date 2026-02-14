// ============================================================
// OrgsLedger Mobile — Meeting Detail Screen (Royal Design)
// Full-featured: View, Edit, AI Toggle, Video, Audio, Votes
// ============================================================

import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Switch,
  TextInput,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { socketClient } from '../../src/api/socket';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Card, Badge, Button, Avatar, SectionHeader, LoadingScreen, CrossPlatformDateTimePicker } from '../../src/components/ui';
import LiveTranslation from '../../src/components/ui/LiveTranslation';
import { showAlert } from '../../src/utils/alert';

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: string; label: string }> = {
  scheduled: { color: Colors.highlight, bg: Colors.highlightSubtle, icon: 'calendar', label: 'Scheduled' },
  live: { color: Colors.success, bg: Colors.successSubtle, icon: 'radio', label: 'Live Now' },
  ended: { color: Colors.textLight, bg: Colors.accent, icon: 'checkmark-circle', label: 'Completed' },
  completed: { color: Colors.textLight, bg: Colors.accent, icon: 'checkmark-circle', label: 'Completed' },
  cancelled: { color: Colors.error, bg: Colors.errorSubtle, icon: 'close-circle', label: 'Cancelled' },
};

export default function MeetingDetailScreen() {
  const { meetingId } = useLocalSearchParams<{ meetingId: string }>();
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const userId = useAuthStore((s) => s.user?.id);
  const globalRole = useAuthStore((s) => s.user?.globalRole);
  const membership = useAuthStore((s) =>
    s.memberships.find((m) => m.organization_id === s.currentOrgId)
  );

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
  const [showVideo, setShowVideo] = useState(false);
  const recordingRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isAdmin = globalRole === 'super_admin' || globalRole === 'developer' || (membership &&
    ['org_admin', 'executive'].includes(membership.role));

  useEffect(() => {
    loadMeeting();
  }, [meetingId]);

  const loadMeeting = async () => {
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
  };

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

  // ── Translation Toggle ─────────────────────────────────
  const handleToggleTranslation = async () => {
    if (!currentOrgId || !meetingId) return;
    setActionLoading(true);
    try {
      const newVal = !meeting.translation_enabled;
      await api.meetings.update(currentOrgId, meetingId, { translationEnabled: newVal });
      showAlert('Done', newVal ? 'Live translation enabled' : 'Live translation disabled');
      await loadMeeting();
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to toggle translation');
    } finally {
      setActionLoading(false);
    }
  };

  const handleVote = async (voteId: string, option: string) => {
    if (!currentOrgId || !meetingId) return;
    try {
      await api.meetings.castVote(currentOrgId, meetingId, voteId, { option });
      showAlert('Voted', `You voted: ${option}`);
      await loadMeeting();
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Vote failed');
    }
  };

  // ── Audio Recording ─────────────────────────────────────
  const startRecording = async () => {
    if (Platform.OS === 'web') {
      showAlert('Not Supported', 'Audio recording is only available on mobile devices. Upload an audio file instead.');
      return;
    }
    try {
      const { Audio } = require('expo-av');
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) { showAlert('Permission Required', 'Microphone permission is needed.'); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      setIsRecording(true);
      setRecordingDuration(0);
      timerRef.current = setInterval(() => setRecordingDuration((d) => d + 1), 1000);
    } catch { showAlert('Error', 'Failed to start recording'); }
  };

  const stopRecording = async () => {
    try {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync();
        setRecordingUri(recordingRef.current.getURI());
        recordingRef.current = null;
      }
      const { Audio } = require('expo-av');
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch { showAlert('Error', 'Failed to stop recording'); }
    finally { setIsRecording(false); }
  };

  const uploadRecording = async () => {
    if (!recordingUri || !currentOrgId || !meetingId) return;
    setUploading(true);
    try {
      await api.meetings.uploadAudio(currentOrgId, meetingId, recordingUri, `meeting_${meetingId}_${Date.now()}.m4a`);
      showAlert('Success', 'Audio uploaded! AI minutes will be generated when the meeting ends.');
      setRecordingUri(null); setRecordingDuration(0);
      await loadMeeting();
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Upload failed');
    } finally { setUploading(false); }
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  if (loading) return <LoadingScreen />;

  if (!meeting) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={48} color={Colors.textLight} />
        <Text style={styles.errorText}>Meeting not found</Text>
      </View>
    );
  }

  const sc = STATUS_CONFIG[meeting.status] || STATUS_CONFIG.scheduled;
  const canEdit = isAdmin && ['scheduled'].includes(meeting.status);

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Meeting Details',
          headerStyle: { backgroundColor: Colors.surface },
          headerTintColor: Colors.highlight,
          headerTitleStyle: { fontWeight: FontWeight.semibold as any, color: Colors.textWhite },
          headerShadowVisible: false,
          headerRight: canEdit ? () => (
            <TouchableOpacity onPress={() => setEditMode(!editMode)} style={{ marginRight: Spacing.md }}>
              <Ionicons name={editMode ? 'close' : 'create-outline'} size={22} color={Colors.highlight} />
            </TouchableOpacity>
          ) : undefined,
        }}
      />

      {/* ── Edit Mode ──────────────────────────────────────── */}
      {editMode && canEdit && (
        <Card style={[styles.section, { borderColor: Colors.highlight, borderWidth: 1 }]}>
          <SectionHeader title="Edit Meeting" />
          <View style={styles.editField}>
            <Text style={styles.editLabel}>Title</Text>
            <TextInput style={styles.editInput} value={editTitle} onChangeText={setEditTitle} placeholderTextColor={Colors.textLight} placeholder="Meeting title" />
          </View>
          <View style={styles.editField}>
            <Text style={styles.editLabel}>Description</Text>
            <TextInput style={[styles.editInput, { minHeight: 60 }]} value={editDescription} onChangeText={setEditDescription} placeholderTextColor={Colors.textLight} placeholder="Optional description" multiline />
          </View>
          <View style={styles.editField}>
            <Text style={styles.editLabel}>Location</Text>
            <TextInput style={styles.editInput} value={editLocation} onChangeText={setEditLocation} placeholderTextColor={Colors.textLight} placeholder="Room, Zoom link, etc." />
          </View>
          <View style={styles.row}>
            <CrossPlatformDateTimePicker label="Date" value={editDate} mode="date" hasValue={true} onChange={setEditDate} style={{ flex: 1 }} />
            <CrossPlatformDateTimePicker label="Time" value={editTime} mode="time" hasValue={true} onChange={setEditTime} style={{ flex: 1 }} />
          </View>
          <View style={styles.editActions}>
            <TouchableOpacity style={styles.cancelEditBtn} onPress={() => setEditMode(false)}>
              <Text style={{ color: Colors.textLight }}>Cancel</Text>
            </TouchableOpacity>
            <Button title={saving ? 'Saving...' : 'Save Changes'} onPress={handleSaveEdit} disabled={saving} variant="primary" />
          </View>
        </Card>
      )}

      {/* ── Header Card ────────────────────────────────────── */}
      <Card style={styles.headerCard}>
        {meeting.status === 'live' && <View style={styles.liveAccent} />}
        <View style={styles.headerTop}>
          <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
            <Ionicons name={sc.icon as any} size={12} color={sc.color} />
            <Text style={[styles.statusText, { color: sc.color }]}>{sc.label}</Text>
          </View>
          {meeting.ai_enabled && (
            <View style={styles.aiBadgeMini}>
              <Ionicons name="sparkles" size={12} color={Colors.highlight} />
              <Text style={styles.aiBadgeText}>AI</Text>
            </View>
          )}
          {meeting.translation_enabled && (
            <View style={[styles.aiBadgeMini, { backgroundColor: '#7C3AED15' }]}>
              <Ionicons name="language" size={12} color="#7C3AED" />
              <Text style={[styles.aiBadgeText, { color: '#7C3AED' }]}>Translation</Text>
            </View>
          )}
        </View>
        <Text style={styles.title}>{meeting.title}</Text>
        {meeting.description && <Text style={styles.description}>{meeting.description}</Text>}
        <View style={styles.metaRow}>
          <View style={styles.metaIcon}><Ionicons name="calendar-outline" size={14} color={Colors.highlight} /></View>
          <Text style={styles.metaText}>
            {new Date(meeting.scheduled_start).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <View style={styles.metaIcon}><Ionicons name="time-outline" size={14} color={Colors.highlight} /></View>
          <Text style={styles.metaText}>
            {new Date(meeting.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
        {meeting.location && (
          <View style={styles.metaRow}>
            <View style={styles.metaIcon}><Ionicons name="location-outline" size={14} color={Colors.highlight} /></View>
            <Text style={styles.metaText}>{meeting.location}</Text>
          </View>
        )}
        {meeting.moderator && (
          <View style={styles.metaRow}>
            <View style={styles.metaIcon}><Ionicons name="person-circle-outline" size={14} color={Colors.highlight} /></View>
            <Text style={styles.metaText}>Moderator: {meeting.moderator.first_name} {meeting.moderator.last_name}</Text>
          </View>
        )}
      </Card>

      {/* ── Meeting Services Card ─────────────────────────── */}
      {isAdmin && !['ended', 'completed', 'cancelled'].includes(meeting.status) && (
        <Card style={styles.section}>
          <View style={styles.aiHeader}>
            <Ionicons name="settings" size={18} color={Colors.highlight} />
            <Text style={styles.aiTitle}>Meeting Services</Text>
          </View>
          <View style={styles.aiToggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.aiToggleLabel}>AI Meeting Minutes</Text>
              <Text style={styles.aiToggleHint}>
                {meeting.ai_enabled
                  ? 'Enabled — Record audio during the meeting for auto-generated minutes.'
                  : 'Disabled — Enable to get AI-powered transcription, summaries & action items.'}
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
          {!meeting.ai_enabled && (
            <Text style={styles.aiCreditNote}>Requires at least 1 AI credit. Purchase in AI Plans.</Text>
          )}
          <View style={{ height: 12 }} />
          <View style={styles.aiToggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.aiToggleLabel}>Live Translation</Text>
              <Text style={styles.aiToggleHint}>
                {meeting.translation_enabled
                  ? 'Enabled — Members can speak their own language and hear others in theirs.'
                  : 'Disabled — Enable to allow real-time multilingual translation (26 languages).'}
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

      {/* ── Action Buttons ─────────────────────────────────── */}
      {isAdmin && meeting.status === 'scheduled' && (
        <View style={styles.actionArea}>
          <Button title={actionLoading ? 'Starting...' : 'Start Meeting'} onPress={handleStart} disabled={actionLoading} variant="primary" />
          <TouchableOpacity style={styles.cancelMeetingBtn} onPress={handleCancel} disabled={actionLoading}>
            <Ionicons name="close-circle-outline" size={18} color={Colors.error} />
            <Text style={styles.cancelMeetingText}>Cancel Meeting</Text>
          </TouchableOpacity>
        </View>
      )}
      {isAdmin && meeting.status === 'live' && (
        <View style={styles.actionArea}>
          <Button title="End Meeting" onPress={handleEnd} disabled={actionLoading} variant="danger" />
        </View>
      )}
      {meeting.status === 'live' && (
        <View style={styles.actionArea}>
          {meeting.jitsi_room_id && !showVideo && (
            <TouchableOpacity
              style={styles.jitsiBtn}
              onPress={async () => {
                const jitsiUrl = `https://meet.jit.si/${meeting.jitsi_room_id}#config.prejoinPageEnabled=false&config.startWithAudioMuted=true`;
                if (Platform.OS === 'web') setShowVideo(true);
                else await WebBrowser.openBrowserAsync(jitsiUrl, { toolbarColor: Colors.surface, controlsColor: Colors.highlight, dismissButtonStyle: 'close', presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN });
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="videocam" size={22} color="#FFF" />
              <Text style={styles.jitsiBtnText}>Join Video Call</Text>
            </TouchableOpacity>
          )}
          {meeting.jitsi_room_id && showVideo && Platform.OS === 'web' && (
            <TouchableOpacity style={[styles.jitsiBtn, { backgroundColor: Colors.error }]} onPress={() => setShowVideo(false)} activeOpacity={0.7}>
              <Ionicons name="close-circle" size={22} color="#FFF" />
              <Text style={styles.jitsiBtnText}>Leave Video Call</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.attendanceBtn} onPress={handleMarkAttendance} disabled={actionLoading} activeOpacity={0.7}>
            <Ionicons name="hand-left" size={20} color={Colors.textWhite} />
            <Text style={styles.attendanceBtnText}>Mark My Attendance</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Live Translation ─────────────────────────────────── */}
      {meeting.status === 'live' && meeting.translation_enabled && userId && (
        <LiveTranslation meetingId={meetingId!} userId={userId} />
      )}

      {/* Embedded Jitsi Video */}
      {showVideo && meeting.jitsi_room_id && Platform.OS === 'web' && (
        <View style={styles.videoContainer}>
          <iframe
            src={`https://meet.jit.si/${meeting.jitsi_room_id}#config.prejoinPageEnabled=false&config.startWithAudioMuted=true`}
            style={{ width: '100%', height: '100%', border: 'none', borderRadius: 12 } as any}
            allow="camera; microphone; fullscreen; display-capture; autoplay"
            allowFullScreen
          />
        </View>
      )}

      {/* ── Audio Recording (live + AI enabled) ────────────── */}
      {meeting.status === 'live' && isAdmin && meeting.ai_enabled && (
        <Card style={styles.section}>
          <View style={styles.aiHeader}>
            <Ionicons name="mic" size={18} color={Colors.highlight} />
            <Text style={styles.aiTitle}>Audio Recording</Text>
          </View>
          {!isRecording && !recordingUri && (
            <>
              <Text style={{ color: Colors.textLight, fontSize: FontSize.sm, marginBottom: Spacing.sm }}>
                Record the meeting audio for AI transcription and minutes generation.
              </Text>
              <TouchableOpacity style={styles.recordBtn} onPress={startRecording} activeOpacity={0.7}>
                <Ionicons name="mic" size={24} color="#FFF" />
                <Text style={styles.recordBtnText}>Start Recording</Text>
              </TouchableOpacity>
            </>
          )}
          {isRecording && (
            <View style={styles.recordingActive}>
              <View style={styles.recordingPulse} />
              <Text style={styles.recordingTime}>{formatDuration(recordingDuration)}</Text>
              <Text style={{ color: Colors.textLight, fontSize: FontSize.sm }}>Recording in progress...</Text>
              <TouchableOpacity style={styles.stopBtn} onPress={stopRecording} activeOpacity={0.7}>
                <Ionicons name="stop" size={24} color="#FFF" />
                <Text style={styles.recordBtnText}>Stop Recording</Text>
              </TouchableOpacity>
            </View>
          )}
          {recordingUri && !isRecording && (
            <View style={styles.recordingDone}>
              <Ionicons name="checkmark-circle" size={24} color={Colors.success} />
              <Text style={{ color: Colors.textWhite, fontSize: FontSize.md, marginVertical: Spacing.xs }}>
                Recording ready ({formatDuration(recordingDuration)})
              </Text>
              <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                <TouchableOpacity style={styles.uploadBtn} onPress={uploadRecording} disabled={uploading}>
                  {uploading ? <ActivityIndicator size="small" color="#FFF" /> : <Ionicons name="cloud-upload" size={20} color="#FFF" />}
                  <Text style={styles.recordBtnText}>{uploading ? 'Uploading...' : 'Upload'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.discardBtn} onPress={() => { setRecordingUri(null); setRecordingDuration(0); }}>
                  <Ionicons name="trash" size={20} color={Colors.error} />
                  <Text style={[styles.recordBtnText, { color: Colors.error }]}>Discard</Text>
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

      {/* ── Agenda Items ───────────────────────────────────── */}
      {meeting.agendaItems && meeting.agendaItems.length > 0 && (
        <Card style={styles.section}>
          <SectionHeader title={`Agenda (${meeting.agendaItems.length})`} />
          {meeting.agendaItems.map((item: any, idx: number) => (
            <View key={item.id || idx} style={styles.agendaItem}>
              <View style={styles.agendaNum}><Text style={styles.agendaNumText}>{idx + 1}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.agendaTitle}>{item.title}</Text>
                {item.description && <Text style={styles.agendaDesc}>{item.description}</Text>}
                {item.duration_minutes && (
                  <View style={styles.agendaDurationRow}>
                    <Ionicons name="time-outline" size={12} color={Colors.textLight} />
                    <Text style={styles.agendaDuration}>{item.duration_minutes} min</Text>
                  </View>
                )}
              </View>
            </View>
          ))}
        </Card>
      )}

      {/* ── Attendance ─────────────────────────────────────── */}
      {meeting.attendance && meeting.attendance.length > 0 && (
        <Card style={styles.section}>
          <SectionHeader title={`Attendance (${meeting.attendance.length})`} />
          {meeting.attendance.map((a: any) => {
            const initials = `${(a.first_name?.[0] || '?').toUpperCase()}${(a.last_name?.[0] || '').toUpperCase()}`;
            return (
              <View key={a.id || a.user_id} style={styles.attendeeRow}>
                <Avatar name={initials} size={32} />
                <Text style={styles.attendeeName}>{a.first_name || a.user_id} {a.last_name || ''}</Text>
                <Badge variant={a.status === 'present' ? 'success' : 'warning'} label={a.status === 'present' ? 'Present' : 'Late'} />
              </View>
            );
          })}
        </Card>
      )}

      {/* ── Votes ──────────────────────────────────────────── */}
      {meeting.votes && meeting.votes.length > 0 && (
        <Card style={styles.section}>
          <SectionHeader title="Votes" />
          {meeting.votes.map((v: any) => (
            <View key={v.id} style={styles.voteCard}>
              <Text style={styles.voteQuestion}>{v.title}</Text>
              {v.description && <Text style={styles.voteType}>{v.description}</Text>}
              {v.status === 'open' ? (
                <View style={styles.voteOptions}>
                  {(typeof v.options === 'string' ? JSON.parse(v.options) : v.options || []).map((opt: string) => (
                    <TouchableOpacity key={opt} style={styles.voteOptionBtn} onPress={() => handleVote(v.id, opt)} activeOpacity={0.7}>
                      <Text style={styles.voteOptionText}>{opt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <View style={styles.voteResults}>
                  <Ionicons name="checkmark-done" size={14} color={Colors.textLight} />
                  <Text style={styles.voteClosed}>Vote closed — {v.result || 'Results pending'}</Text>
                </View>
              )}
            </View>
          ))}
        </Card>
      )}

      {/* ── AI Minutes ─────────────────────────────────────── */}
      {meeting.minutes && (
        <Card style={styles.section}>
          <View style={styles.aiHeader}>
            <Ionicons name="sparkles" size={16} color={Colors.highlight} />
            <Text style={styles.aiTitle}>AI Meeting Minutes</Text>
          </View>
          <View style={styles.minutesCard}>
            <Text style={styles.minutesLabel}>Summary</Text>
            <Text style={styles.minutesText}>{meeting.minutes.summary}</Text>

            {meeting.minutes.decisions?.length > 0 && (
              <>
                <Text style={styles.minutesLabel}>Key Decisions</Text>
                {meeting.minutes.decisions.map((d: string, i: number) => (
                  <View key={i} style={styles.bulletRow}>
                    <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
                    <Text style={styles.minutesBullet}>{d}</Text>
                  </View>
                ))}
              </>
            )}

            {meeting.minutes.action_items?.length > 0 && (
              <>
                <Text style={styles.minutesLabel}>Action Items</Text>
                {meeting.minutes.action_items.map((a: any, i: number) => (
                  <View key={i} style={styles.bulletRow}>
                    <Ionicons name="arrow-forward-circle" size={14} color={Colors.highlight} />
                    <Text style={styles.minutesBullet}>
                      {typeof a === 'string' ? a : `${a.task} → ${a.assignee || 'TBD'}`}
                    </Text>
                  </View>
                ))}
              </>
            )}

            {meeting.minutes.motions?.length > 0 && (
              <>
                <Text style={styles.minutesLabel}>Motions</Text>
                {meeting.minutes.motions.map((m: any, i: number) => (
                  <View key={i} style={styles.bulletRow}>
                    <Ionicons name="megaphone" size={14} color={Colors.warning} />
                    <Text style={styles.minutesBullet}>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background, gap: Spacing.md },
  errorText: { color: Colors.textLight, fontSize: FontSize.lg },
  headerCard: { margin: Spacing.md, padding: Spacing.lg, overflow: 'hidden' },
  liveAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: Colors.success },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  statusBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: 3, borderRadius: BorderRadius.full },
  statusText: { fontSize: FontSize.xs, fontWeight: FontWeight.bold as any, textTransform: 'uppercase', letterSpacing: 0.5 },
  aiBadgeMini: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.highlightSubtle, paddingHorizontal: 8, paddingVertical: 3, borderRadius: BorderRadius.full },
  aiBadgeText: { color: Colors.highlight, fontSize: FontSize.xs, fontWeight: FontWeight.bold as any },
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold as any, color: Colors.textWhite },
  description: { fontSize: FontSize.md, color: Colors.textLight, marginTop: Spacing.xs, lineHeight: 22 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  metaIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.highlightSubtle, alignItems: 'center', justifyContent: 'center' },
  metaText: { color: Colors.textSecondary, fontSize: FontSize.sm },
  actionArea: { marginHorizontal: Spacing.md, marginBottom: Spacing.sm, gap: Spacing.sm },
  cancelMeetingBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Spacing.sm, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.error },
  cancelMeetingText: { color: Colors.error, fontSize: FontSize.sm, fontWeight: FontWeight.medium as any },
  jitsiBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: '#6366F1', paddingVertical: Spacing.md, borderRadius: BorderRadius.lg, ...Shadow.md },
  jitsiBtnText: { color: '#FFF', fontSize: FontSize.md, fontWeight: FontWeight.semibold as any },
  attendanceBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.highlight, paddingVertical: Spacing.md, borderRadius: BorderRadius.lg, ...Shadow.md },
  attendanceBtnText: { color: Colors.textWhite, fontSize: FontSize.md, fontWeight: FontWeight.semibold as any },
  section: { marginHorizontal: Spacing.md, marginBottom: Spacing.md, padding: Spacing.md },
  row: { flexDirection: 'row', gap: Spacing.sm },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.sm },
  aiTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold as any, color: Colors.highlight },
  aiToggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  aiToggleLabel: { fontSize: FontSize.md, fontWeight: FontWeight.semibold as any, color: Colors.textWhite },
  aiToggleHint: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  aiCreditNote: { fontSize: FontSize.xs, color: Colors.warning, marginTop: Spacing.xs, fontStyle: 'italic' },
  editField: { marginBottom: Spacing.sm },
  editLabel: { color: Colors.textLight, fontSize: FontSize.sm, fontWeight: FontWeight.semibold as any, marginBottom: 4 },
  editInput: { backgroundColor: Colors.primaryLight, color: Colors.textWhite, fontSize: FontSize.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.accent },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.sm },
  cancelEditBtn: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md },
  agendaItem: { flexDirection: 'row', gap: Spacing.sm, paddingVertical: Spacing.sm, borderBottomWidth: 0.5, borderBottomColor: Colors.accent },
  agendaNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.highlightSubtle, alignItems: 'center', justifyContent: 'center' },
  agendaNumText: { color: Colors.highlight, fontWeight: FontWeight.bold as any, fontSize: FontSize.sm },
  agendaTitle: { color: Colors.textWhite, fontSize: FontSize.md, fontWeight: FontWeight.medium as any },
  agendaDesc: { color: Colors.textLight, fontSize: FontSize.sm, marginTop: 2 },
  agendaDurationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  agendaDuration: { color: Colors.textLight, fontSize: FontSize.xs },
  attendeeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs + 2, borderBottomWidth: 0.5, borderBottomColor: Colors.accent },
  attendeeName: { color: Colors.textWhite, fontSize: FontSize.md, flex: 1, fontWeight: FontWeight.medium as any },
  voteCard: { backgroundColor: Colors.primaryLight, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, borderWidth: 0.5, borderColor: Colors.accent },
  voteQuestion: { color: Colors.textWhite, fontSize: FontSize.md, fontWeight: FontWeight.semibold as any },
  voteType: { color: Colors.textLight, fontSize: FontSize.xs, marginTop: 2, marginBottom: Spacing.sm },
  voteOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  voteOptionBtn: { backgroundColor: Colors.highlight, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full, ...Shadow.sm },
  voteOptionText: { color: Colors.textWhite, fontSize: FontSize.md, fontWeight: FontWeight.medium as any },
  voteResults: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: Spacing.xs },
  voteClosed: { color: Colors.textLight, fontStyle: 'italic', fontSize: FontSize.sm },
  minutesCard: { backgroundColor: Colors.primaryLight, borderRadius: BorderRadius.md, padding: Spacing.md, borderWidth: 0.5, borderColor: Colors.accent },
  minutesLabel: { color: Colors.highlight, fontSize: FontSize.sm, fontWeight: FontWeight.bold as any, marginTop: Spacing.md, marginBottom: 4 },
  minutesText: { color: Colors.textWhite, fontSize: FontSize.md, lineHeight: 22 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 4 },
  minutesBullet: { color: Colors.textWhite, fontSize: FontSize.sm, flex: 1, lineHeight: 20 },
  recordBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.error, paddingVertical: Spacing.md, borderRadius: BorderRadius.lg, ...Shadow.md },
  recordBtnText: { color: '#FFF', fontSize: FontSize.md, fontWeight: FontWeight.semibold as any },
  stopBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.error, paddingVertical: Spacing.md, borderRadius: BorderRadius.lg, marginTop: Spacing.sm, ...Shadow.md },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.success, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: BorderRadius.lg, flex: 1 },
  discardBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: Colors.surface, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.error },
  recordingActive: { alignItems: 'center', paddingVertical: Spacing.md },
  recordingPulse: { width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.error, marginBottom: Spacing.sm },
  recordingTime: { fontSize: 36, fontWeight: FontWeight.bold as any, color: Colors.textWhite, fontVariant: ['tabular-nums'] as any },
  recordingDone: { alignItems: 'center', paddingVertical: Spacing.sm },
  videoContainer: { marginHorizontal: Spacing.md, marginBottom: Spacing.md, height: 400, borderRadius: BorderRadius.lg, overflow: 'hidden', backgroundColor: '#000' },
});
