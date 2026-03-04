// ============================================================
// OrgsLedger — MeetingRoom Component
// Full-screen meeting room with LiveKit SDK integration.
// 3-zone layout: Video Grid + Sidebar + Control Bar.
// Composes VideoGrid, ControlBar, MeetingSidebar.
// ============================================================

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  useWindowDimensions,
  ScrollView,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../theme';
import { useLiveKitRoom } from '../../hooks/useLiveKitRoom';
import { VideoGrid } from './VideoGrid';
import { ControlBar } from './ControlBar';
import { MeetingSidebar, type SidebarPanel } from './MeetingSidebar';
import LiveTranslation, { type LiveTranslationRef } from '../ui/LiveTranslation';
import {
  ALL_LANGUAGES,
  isTtsSupported,
} from '../../utils/languages';
import { socketClient } from '../../api/socket';
import { showAlert } from '../../utils/alert';

// ── Props ─────────────────────────────────────────────────

interface MeetingRoomProps {
  meetingId: string;
  meeting: any;
  joinConfig: {
    url: string;
    token: string;
    roomName: string;
    meetingType: string;
  };
  userId: string;
  userName: string;
  isAdmin: boolean;

  // Join type
  joinType: 'video' | 'audio';

  // Transcripts
  transcripts: any[];
  transcriptsLoading: boolean;
  onRefreshTranscripts: () => void;

  // Minutes
  minutes: any;
  minutesLoading: boolean;
  generateLoading: boolean;
  onRefreshMinutes: () => void;
  onGenerateMinutes: () => void;

  // Elapsed
  elapsedSeconds: number;

  // Socket participants
  socketParticipants: Array<{ userId: string; name: string; isModerator?: boolean; handRaised?: boolean }>;

  // Recording state (from socket)
  isRecordingFromSocket: boolean;

  // Callbacks
  onLeave: () => void;
  onEnd?: () => void;
}

// ── Animated Pulse Dot ────────────────────────────────────

function RecordingIndicator() {
  return (
    <View style={styles.recordingIndicator}>
      <View style={styles.recordingDot} />
      <Text style={styles.recordingText}>REC</Text>
    </View>
  );
}

// ── MeetingRoom Component ─────────────────────────────────

export function MeetingRoom(props: MeetingRoomProps) {
  const {
    meetingId,
    meeting,
    joinConfig,
    userId,
    userName,
    isAdmin,
    joinType,
    transcripts,
    transcriptsLoading,
    onRefreshTranscripts,
    minutes,
    minutesLoading,
    generateLoading,
    onRefreshMinutes,
    onGenerateMinutes,
    elapsedSeconds,
    socketParticipants,
    isRecordingFromSocket,
    onLeave,
    onEnd,
  } = props;

  const { width: windowWidth } = useWindowDimensions();
  const isNarrow = windowWidth < 768;

  // ── LiveKit Room ────────────────────────────────────────
  const lk = useLiveKitRoom();

  // ── Sidebar State ───────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(!isNarrow);
  const [activePanel, setActivePanel] = useState<SidebarPanel>('participants');

  // ── Translation State ───────────────────────────────────
  const [translationLang, setTranslationLang] = useState('en');
  const [translationListening, setTranslationListening] = useState(false);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [langSearch, setLangSearch] = useState('');
  const translationRef = useRef<LiveTranslationRef>(null);

  // ── Hand Raised ─────────────────────────────────────────
  const [handRaised, setHandRaised] = useState(false);

  // ── Recording (local audio) ─────────────────────────────
  const [isRecording, setIsRecording] = useState(false);

  // Filtered languages
  const filteredLangs = useMemo(() => {
    if (!langSearch.trim()) return ALL_LANGUAGES;
    const q = langSearch.toLowerCase().trim();
    return ALL_LANGUAGES.filter(
      (l) => l.name.toLowerCase().includes(q) || l.nativeName.toLowerCase().includes(q) || l.code.includes(q)
    );
  }, [langSearch]);

  // ── Connect to LiveKit on mount ─────────────────────────
  useEffect(() => {
    if (joinConfig?.url && joinConfig?.token) {
      const enableVideo = joinType === 'video';
      lk.connect(joinConfig.url, joinConfig.token, {
        audio: true,
        video: enableVideo,
      }).catch((err) => {
        console.error('[MeetingRoom] Failed to connect:', err);
        showAlert('Connection Failed', err.message || 'Could not connect to meeting');
      });
    }

    return () => {
      lk.disconnect();
    };
  }, [joinConfig?.url, joinConfig?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Graceful exit on tab close / page refresh ───────────
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handleBeforeUnload = () => {
      // Best-effort cleanup (synchronous only)
      lk.disconnect();
      socketClient.leaveMeeting(meetingId);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [meetingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toggle sidebar panel ────────────────────────────────
  const handleToggleSidebar = useCallback((panel?: string) => {
    if (panel) {
      if (sidebarOpen && activePanel === panel) {
        setSidebarOpen(false);
      } else {
        setActivePanel(panel as SidebarPanel);
        setSidebarOpen(true);
      }
    } else {
      setSidebarOpen(!sidebarOpen);
    }
  }, [sidebarOpen, activePanel]);

  // ── Raise Hand ──────────────────────────────────────────
  const handleRaiseHand = useCallback(() => {
    const newState = !handRaised;
    setHandRaised(newState);
    socketClient.emit('meeting:raise-hand', {
      meetingId,
      userId,
      name: userName,
      raised: newState,
    });
  }, [handRaised, meetingId, userId, userName]);

  // ── Translation Controls ────────────────────────────────
  // Selecting a language auto-starts STT and enables voice-to-voice.
  // The Language button in the picker both configures and toggles.

  const handleSelectLanguage = useCallback((code: string) => {
    setTranslationLang(code);
    translationRef.current?.selectLanguage(code);
    // Auto-start listening when a language is picked
    if (!translationListening) {
      translationRef.current?.startListening();
      setTranslationListening(true);
    }
    // V2V always on by default (users hear translations spoken)
    translationRef.current?.setAutoTTS(true);
    setShowLangPicker(false);
    setLangSearch('');
  }, [translationListening]);

  // ── Recording Controls ──────────────────────────────────
  const handleToggleRecording = useCallback(() => {
    // Local recording toggle — in a real implementation this would
    // start/stop expo-av recording and upload (existing logic from page)
    if (isRecording) {
      setIsRecording(false);
      showAlert('Recording', 'Recording stopped');
    } else {
      setIsRecording(true);
      showAlert('Recording', 'Recording started');
    }
  }, [isRecording]);

  // ── Leave handler ───────────────────────────────────────
  const handleLeave = useCallback(() => {
    lk.disconnect();
    translationRef.current?.stopListening();
    setTranslationListening(false);
    onLeave();
  }, [lk, onLeave]);

  // ── End Meeting ─────────────────────────────────────────
  const handleEnd = useCallback(() => {
    if (onEnd) {
      showAlert('End Meeting', 'Are you sure? All participants will be disconnected.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Meeting',
          style: 'destructive',
          onPress: () => {
            lk.disconnect();
            translationRef.current?.stopListening();
            setTranslationListening(false);
            onEnd();
          },
        },
      ]);
    }
  }, [lk, onEnd]);

  // ── Format Duration ─────────────────────────────────────
  const formatDuration = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // ── Sidebar width ───────────────────────────────────────
  const sidebarWidth = isNarrow ? windowWidth : Math.min(360, windowWidth * 0.28);

  return (
    <View style={styles.container}>
      {/* ═══ HEADER BAR ══════════════════════════════════════ */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.liveDot} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {meeting?.title || 'Meeting'}
          </Text>
          <View style={styles.participantsBadge}>
            <Ionicons name="people" size={11} color={Colors.textLight} />
            <Text style={styles.participantsCount}>{lk.participants.length}</Text>
          </View>
        </View>

        <View style={styles.headerCenter}>
          <Text style={styles.timerDisplay}>{formatDuration(elapsedSeconds)}</Text>
        </View>

        <View style={styles.headerRight}>
          {lk.isReconnecting && (
            <View style={[styles.statusBadge, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
              <Ionicons name="reload" size={11} color="#F59E0B" />
              <Text style={[styles.statusText, { color: '#F59E0B' }]}>Reconnecting</Text>
            </View>
          )}
          {(isRecording || isRecordingFromSocket) && <RecordingIndicator />}
          {lk.error && (
            <View style={styles.errorBadge}>
              <Ionicons name="warning" size={12} color={Colors.error} />
            </View>
          )}
        </View>
      </View>

      {/* ═══ MAIN CONTENT (VIDEO + SIDEBAR) ══════════════════ */}
      <View style={styles.mainArea}>
        {/* Video Grid */}
        <View style={[styles.videoArea, sidebarOpen && !isNarrow && { marginRight: sidebarWidth }]}>
          {lk.isConnecting ? (
            <View style={styles.connectingOverlay}>
              <View style={styles.connectingSpinner}>
                <Ionicons name="videocam" size={40} color={Colors.highlight} />
              </View>
              <Text style={styles.connectingText}>Connecting to meeting...</Text>
              <Text style={styles.connectingHint}>Setting up your audio and video</Text>
            </View>
          ) : lk.error && !lk.isConnected ? (
            <View style={styles.connectingOverlay}>
              <Ionicons name="alert-circle" size={40} color={Colors.error} />
              <Text style={[styles.connectingText, { color: Colors.error }]}>Connection Error</Text>
              <Text style={styles.connectingHint}>{lk.error}</Text>
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => lk.connect(joinConfig.url, joinConfig.token, {
                  audio: true,
                  video: joinType === 'video',
                })}
              >
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <VideoGrid
              participants={lk.participants}
              activeSpeakerIds={lk.activeSpeakerIds}
            />
          )}
        </View>

        {/* Sidebar */}
        {sidebarOpen && (
          <View
            style={[
              styles.sidebar,
              isNarrow
                ? styles.sidebarFullScreen
                : { width: sidebarWidth, position: 'absolute' as any, top: 0, right: 0, bottom: 0 },
            ]}
          >
            <MeetingSidebar
              activePanel={activePanel}
              onChangePanel={setActivePanel}
              onClose={() => setSidebarOpen(false)}
              lkParticipants={lk.participants}
              activeSpeakerIds={lk.activeSpeakerIds}
              socketParticipants={socketParticipants}
              attendance={meeting?.attendance || []}
              transcripts={transcripts}
              transcriptsLoading={transcriptsLoading}
              userId={userId}
              onRefreshTranscripts={onRefreshTranscripts}
              minutes={minutes}
              minutesLoading={minutesLoading}
              generateLoading={generateLoading}
              isAdmin={isAdmin}
              meetingStatus={meeting?.status || 'live'}
              aiEnabled={meeting?.ai_enabled ?? false}
              transcriptCount={transcripts.length}
              onRefreshMinutes={onRefreshMinutes}
              onGenerateMinutes={onGenerateMinutes}
            />
          </View>
        )}
      </View>

      {/* ═══ LANGUAGE PICKER OVERLAY ═════════════════════════ */}
      {showLangPicker && (
        <View style={styles.langPickerOverlay}>
          <View style={styles.langPickerCard}>
            <View style={styles.langPickerHeader}>
              <Ionicons name="language" size={18} color={Colors.highlight} />
              <Text style={styles.langPickerTitle}>Select Language</Text>
              <TouchableOpacity onPress={() => { setShowLangPicker(false); setLangSearch(''); }}>
                <Ionicons name="close" size={20} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.langSearchWrap}>
              <Ionicons name="search" size={14} color={Colors.textLight} />
              <TextInput
                style={styles.langSearchInput}
                placeholder="Search language..."
                placeholderTextColor={Colors.textLight}
                value={langSearch}
                onChangeText={setLangSearch}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {langSearch.length > 0 && (
                <TouchableOpacity onPress={() => setLangSearch('')}>
                  <Ionicons name="close-circle" size={14} color={Colors.textLight} />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView style={styles.langList} keyboardShouldPersistTaps="handled">
              {filteredLangs.length === 0 && (
                <Text style={styles.langNoResults}>No languages match "{langSearch}"</Text>
              )}
              {filteredLangs.map((lang) => {
                const isActive = translationLang === lang.code;
                return (
                  <TouchableOpacity
                    key={lang.code}
                    style={[styles.langItem, isActive && styles.langItemActive]}
                    onPress={() => handleSelectLanguage(lang.code)}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 18 }}>{lang.flag || '🌐'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.langName, isActive && { color: Colors.highlight }]}>
                        {lang.name}
                      </Text>
                      {lang.nativeName !== lang.name && (
                        <Text style={styles.langNative}>{lang.nativeName}</Text>
                      )}
                    </View>
                    {isTtsSupported(lang.code) && (
                      <Ionicons name="volume-medium-outline" size={12} color={Colors.textLight} />
                    )}
                    {isActive && <Ionicons name="checkmark-circle" size={16} color={Colors.highlight} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      )}

      {/* ═══ CONTROL BAR ═════════════════════════════════════ */}
      <ControlBar
        isMicEnabled={lk.isMicEnabled}
        isCameraEnabled={lk.isCameraEnabled}
        isScreenSharing={lk.isScreenSharing}
        isChatOpen={false}
        unreadChatCount={0}
        currentLanguage={translationLang}
        isRecording={isRecording || isRecordingFromSocket}
        handRaised={handRaised}
        isSidebarOpen={sidebarOpen}
        activeSidebarPanel={activePanel}
        participantCount={lk.participants.length}
        isAdmin={isAdmin}
        onToggleMic={lk.toggleMic}
        onToggleCamera={lk.toggleCamera}
        onToggleScreenShare={lk.toggleScreenShare}
        onToggleChat={() => {}} // Legacy path doesn't use chat drawer
        onOpenLanguagePick={() => setShowLangPicker(true)}
        onToggleTranscribe={() => {}} // Legacy path handled by LiveTranslation
        onToggleRecording={handleToggleRecording}
        onRaiseHand={handleRaiseHand}
        onToggleSidebar={handleToggleSidebar}
        onLeave={handleLeave}
        onEnd={isAdmin ? handleEnd : undefined}
      />

      {/* ═══ HIDDEN LIVE TRANSLATION CONTROLLER ══════════════ */}
      {userId && (
        <LiveTranslation
          ref={translationRef}
          meetingId={meetingId}
          userId={userId}
          hideControls
          autoTTS
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    ...(Platform.OS === 'web' ? {
      position: 'fixed' as any,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 9999,
    } : {}),
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.accent,
    minHeight: 48,
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
  headerTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textWhite,
    flexShrink: 1,
  },
  headerCenter: {
    paddingHorizontal: Spacing.md,
  },
  timerDisplay: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: Colors.textWhite,
    fontVariant: ['tabular-nums'] as any,
    letterSpacing: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexShrink: 1,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  participantsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
  participantsCount: {
    color: Colors.textLight,
    fontSize: 10,
    fontWeight: FontWeight.semibold,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
  },
  statusText: {
    fontSize: 10,
    fontWeight: FontWeight.semibold,
    letterSpacing: 0.5,
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(192, 57, 43, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.error,
  },
  recordingText: {
    color: Colors.error,
    fontSize: 10,
    fontWeight: FontWeight.bold,
    letterSpacing: 1,
  },
  errorBadge: {
    padding: 4,
  },

  // Main area
  mainArea: {
    flex: 1,
    position: 'relative',
  },
  videoArea: {
    flex: 1,
  },
  sidebar: {},
  sidebarFullScreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },

  // Connecting overlay
  connectingOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.background,
  },
  connectingSpinner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.highlight,
  },
  connectingText: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.textWhite,
  },
  connectingHint: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
  },
  retryBtn: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.highlight,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  retryText: {
    color: '#FFF',
    fontWeight: FontWeight.semibold,
  },

  // Language picker
  langPickerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(6, 13, 24, 0.7)',
    zIndex: 200,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  langPickerCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.md,
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    ...(Shadow.lg as any),
  },
  langPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  langPickerTitle: {
    flex: 1,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textWhite,
  },
  langSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    marginBottom: Spacing.sm,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  langSearchInput: {
    flex: 1,
    color: Colors.textWhite,
    fontSize: FontSize.sm,
    padding: 0,
  },
  langList: {
    maxHeight: 400,
  },
  langNoResults: {
    color: Colors.textLight,
    fontSize: FontSize.xs,
    textAlign: 'center',
    paddingVertical: Spacing.md,
  },
  langItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs + 2,
    paddingHorizontal: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  langItemActive: {
    backgroundColor: Colors.highlightSubtle,
  },
  langName: {
    color: Colors.textWhite,
    fontSize: FontSize.sm,
  },
  langNative: {
    color: Colors.textLight,
    fontSize: 10,
  },
});
