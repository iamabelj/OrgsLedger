// ============================================================
// OrgsLedger — GlobalMeetingOverlay
// Persistent meeting UI rendered at the root layout level.
// Full-screen when expanded, floating widget when minimized.
// LiveKit connection lives HERE — navigation never unmounts it.
// ============================================================

import React, { useRef, useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../theme';
import { useGlobalMeeting } from '../../contexts/MeetingContext';
import { useLiveKitRoom } from '../../hooks/useLiveKitRoom';
import { VideoGrid } from './VideoGrid';
import { ControlBar } from './ControlBar';
import { MeetingSidebar, type SidebarPanel } from './MeetingSidebar';
import { ChatDrawer } from './ChatDrawer';
import { MiniMeetingWidget } from './MiniMeetingWidget';
import LiveTranslation, { type LiveTranslationRef } from '../ui/LiveTranslation';
import { socketClient } from '../../api/socket';
import { showAlert } from '../../utils/alert';

// ── Recording Indicator ───────────────────────────────────

function RecordingIndicator() {
  return (
    <View style={styles.recordingIndicator}>
      <View style={styles.recordingDot} />
      <Text style={styles.recordingText}>REC</Text>
    </View>
  );
}

// ── Main Overlay Component ────────────────────────────────

export function GlobalMeetingOverlay() {
  const gm = useGlobalMeeting();

  // Don't render anything if no active meeting
  if (!gm.isActive || !gm.joinConfig) return null;

  // Delegate to either the full meeting room or the mini widget
  if (gm.isMinimized) {
    return <MinimizedOverlay />;
  }

  return <FullMeetingOverlay />;
}

// ── Minimized Overlay (floating widget) ───────────────────

function MinimizedOverlay() {
  const gm = useGlobalMeeting();
  const lk = useLiveKitRoom();

  // When minimized, we keep the LiveKit connection alive in the
  // global context but don't render heavy video elements.
  // The useLiveKitRoom hook persists because GlobalMeetingOverlay
  // never unmounts while isActive is true.

  return (
    <>
      <MiniMeetingWidget
        title={gm.meeting?.title || 'Meeting'}
        participantCount={lk.participants.length || gm.liveParticipants.length}
        elapsedSeconds={gm.elapsedSeconds}
        isMicEnabled={lk.isMicEnabled}
        unreadChatCount={gm.unreadChatCount}
        isAudioOnly={gm.isAudioOnly}
        onExpand={gm.maximize}
        onToggleMic={lk.toggleMic}
        onToggleChat={gm.toggleChat}
        onLeave={gm.leaveMeeting}
      />
      {/* Chat drawer even when minimized */}
      {gm.isChatOpen && (
        <View style={styles.floatingChat}>
          <ChatDrawer
            messages={gm.chatMessages}
            currentUserId={gm.userId}
            onSend={gm.sendChatMessage}
            onClose={gm.closeChat}
          />
        </View>
      )}
    </>
  );
}

// ── Full Meeting Overlay ──────────────────────────────────

function FullMeetingOverlay() {
  const gm = useGlobalMeeting();
  const lk = useLiveKitRoom();
  const { width: windowWidth } = useWindowDimensions();
  const isNarrow = windowWidth < 768;

  // ── Sidebar State ─────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(!isNarrow);
  const [activePanel, setActivePanel] = useState<SidebarPanel>('participants');

  // ── Translation State ─────────────────────────────────
  const [translationListening, setTranslationListening] = useState(false);
  const translationRef = useRef<LiveTranslationRef>(null);

  // ── Hand Raised ───────────────────────────────────────
  const [handRaised, setHandRaised] = useState(false);

  // ── Recording (local) ─────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);

  // ── Connect to LiveKit on overlay mount ───────────────
  useEffect(() => {
    if (gm.joinConfig?.url && gm.joinConfig?.token && !lk.isConnected && !lk.isConnecting) {
      const enableVideo = gm.joinType === 'video' && !gm.isAudioOnly;
      lk.connect(gm.joinConfig.url, gm.joinConfig.token, {
        audio: true,
        video: enableVideo,
      }).catch((err) => {
        console.error('[GlobalMeetingOverlay] Failed to connect:', err);
        showAlert('Connection Failed', err.message || 'Could not connect to meeting');
      });
    }
    // Cleanup: disconnect from LiveKit when overlay unmounts (meeting ends)
    return () => {
      lk.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Graceful exit on tab close / page refresh ─────────
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handleBeforeUnload = () => {
      lk.disconnect();
      if (gm.meetingId) socketClient.leaveMeeting(gm.meetingId);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [gm.meetingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Transcription does NOT auto-start ─────────────────
  // User manually toggles transcription via the Transcribe button.
  // AI minutes toggle is separate (admin-only, controls post-meeting AI minutes).

  // ── Toggle transcription (manual control) ─────────────
  const handleToggleTranscription = useCallback(() => {
    if (translationListening) {
      // Stop transcription
      translationRef.current?.stopListening();
      setTranslationListening(false);
      console.debug('[GlobalMeetingOverlay] Transcription stopped by user');
    } else {
      // Start transcription
      if (translationRef.current) {
        translationRef.current.startListening();
        setTranslationListening(true);
        console.debug('[GlobalMeetingOverlay] Transcription started by user');
      }
    }
  }, [translationListening]);

  // ── Toggle sidebar panel ──────────────────────────────
  const handleToggleSidebar = useCallback((panel?: string) => {
    if (panel === 'chat') {
      // Intercept chat panel — use our ChatDrawer instead
      gm.toggleChat();
      return;
    }
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
  }, [sidebarOpen, activePanel, gm]);

  // ── Raise Hand ────────────────────────────────────────
  const handleRaiseHand = useCallback(() => {
    const newState = !handRaised;
    setHandRaised(newState);
    socketClient.emit('meeting:raise-hand', {
      meetingId: gm.meetingId,
      userId: gm.userId,
      name: gm.userName,
      raised: newState,
    });
  }, [handRaised, gm.meetingId, gm.userId, gm.userName]);

  // ── Recording ─────────────────────────────────────────
  const handleToggleRecording = useCallback(() => {
    if (isRecording) {
      setIsRecording(false);
      showAlert('Recording', 'Recording stopped');
    } else {
      setIsRecording(true);
      showAlert('Recording', 'Recording started');
    }
  }, [isRecording]);

  // ── Leave handler ─────────────────────────────────────
  const handleLeave = useCallback(() => {
    lk.disconnect();
    translationRef.current?.stopListening();
    setTranslationListening(false);
    gm.leaveMeeting();
  }, [lk, gm]);

  // ── End Meeting ───────────────────────────────────────
  // Don't disconnect LK or stop translation here — endMeeting() shows
  // a confirmation dialog first. If user cancels, they stay connected.
  // Cleanup happens reactively when meeting:ended event sets status='ended'.
  const handleEnd = useCallback(() => {
    gm.endMeeting();
  }, [gm]);

  // ── Reactive cleanup when meeting ends ────────────────
  // Triggered by meeting:ended socket event (status → 'ended') for ALL
  // participants, not just the admin who clicked End.
  useEffect(() => {
    if (gm.meeting?.status === 'ended') {
      lk.disconnect();
      translationRef.current?.stopListening();
      setTranslationListening(false);
    }
  }, [gm.meeting?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Minimize handler ──────────────────────────────────
  const handleMinimize = useCallback(() => {
    gm.minimize();
  }, [gm]);

  // ── Format Duration ───────────────────────────────────
  const formatDuration = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const sidebarWidth = isNarrow ? windowWidth : Math.min(360, windowWidth * 0.28);

  return (
    <View style={styles.fullContainer}>
      {/* ═══ HEADER BAR ══════════════════════════════════════ */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.liveDot} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {gm.meeting?.title || 'Meeting'}
          </Text>
          <View style={styles.participantsBadge}>
            <Ionicons name="people" size={11} color={Colors.textLight} />
            <Text style={styles.participantsCount}>{lk.participants.length}</Text>
          </View>
        </View>

        <View style={styles.headerCenter}>
          <Text style={styles.timerDisplay}>{formatDuration(gm.elapsedSeconds)}</Text>
        </View>

        <View style={styles.headerRight}>
          {lk.isReconnecting && (
            <View style={[styles.statusBadge, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
              <Ionicons name="reload" size={11} color="#F59E0B" />
              <Text style={[styles.statusText, { color: '#F59E0B' }]}>Reconnecting</Text>
            </View>
          )}
          {(isRecording || gm.isRecordingFromSocket) && <RecordingIndicator />}
          {lk.error && (
            <View style={styles.errorBadge}>
              <Ionicons name="warning" size={12} color={Colors.error} />
            </View>
          )}
          {/* Minimize button */}
          <TouchableOpacity
            style={styles.minimizeBtn}
            onPress={handleMinimize}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="contract" size={18} color={Colors.textWhite} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ═══ MAIN CONTENT (VIDEO + SIDEBAR + CHAT) ═══════════ */}
      <View style={styles.mainArea}>
        {/* Video Grid */}
        <View style={[
          styles.videoArea,
          sidebarOpen && !isNarrow && { marginRight: sidebarWidth },
          gm.isChatOpen && !isNarrow && !sidebarOpen && { marginRight: 320 },
        ]}>
          {lk.isConnecting ? (
            <View style={styles.connectingOverlay}>
              <View style={styles.connectingSpinner}>
                <Ionicons name="videocam" size={40} color={Colors.highlight} />
              </View>
              <Text style={styles.connectingText}>Connecting to meeting...</Text>
              <Text style={styles.connectingHint}>Setting up your audio and video</Text>
            </View>
          ) : lk.error && !lk.isConnected && gm.meeting?.status !== 'ended' ? (
            <View style={styles.connectingOverlay}>
              <Ionicons name="alert-circle" size={40} color={Colors.error} />
              <Text style={[styles.connectingText, { color: Colors.error }]}>Connection Error</Text>
              <Text style={styles.connectingHint}>{lk.error}</Text>
              {gm.joinConfig && (
                <TouchableOpacity
                  style={styles.retryBtn}
                  onPress={() => lk.connect(gm.joinConfig!.url, gm.joinConfig!.token, {
                    audio: true,
                    video: gm.joinType === 'video' && !gm.isAudioOnly,
                  })}
                >
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : gm.isAudioOnly ? (
            // Audio-only mode — show participant avatars in a grid
            <View style={styles.audioOnlyContainer}>
              <Ionicons name="headset" size={48} color={Colors.highlight} />
              <Text style={styles.audioOnlyTitle}>Audio Only Mode</Text>
              <Text style={styles.audioOnlyHint}>
                {lk.participants.length} participant{lk.participants.length !== 1 ? 's' : ''} connected
              </Text>
              <View style={styles.audioOnlyParticipants}>
                {lk.participants.slice(0, 12).map((p) => (
                  <View key={p.identity || p.sid} style={[
                    styles.audioOnlyAvatar,
                    lk.activeSpeakerIds?.includes(p.identity || p.sid) && styles.audioOnlyAvatarActive,
                  ]}>
                    <Text style={styles.audioOnlyAvatarText}>
                      {(p.name || p.identity || '?')[0]?.toUpperCase()}
                    </Text>
                  </View>
                ))}
              </View>
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
              socketParticipants={gm.liveParticipants}
              attendance={gm.meeting?.attendance || []}
              transcripts={gm.transcripts}
              transcriptsLoading={gm.transcriptsLoading}
              userId={gm.userId || ''}
              onRefreshTranscripts={gm.refreshTranscripts}
              minutes={gm.minutes}
              minutesLoading={gm.minutesLoading}
              generateLoading={gm.generateLoading}
              isAdmin={gm.isAdmin}
              meetingStatus={gm.meeting?.status || 'live'}
              aiEnabled={gm.meeting?.ai_enabled ?? false}
              transcriptCount={gm.transcripts.length}
              onRefreshMinutes={gm.refreshMinutes}
              onGenerateMinutes={gm.generateMinutes}
            />
          </View>
        )}

        {/* Chat Drawer (side panel when full-screen) */}
        {gm.isChatOpen && !isNarrow && (
          <View style={[
            styles.chatSidePanel,
            sidebarOpen && { right: sidebarWidth },
          ]}>
            <ChatDrawer
              messages={gm.chatMessages}
              currentUserId={gm.userId}
              onSend={gm.sendChatMessage}
              onClose={gm.closeChat}
            />
          </View>
        )}

        {/* Chat Drawer (full-screen overlay on mobile) */}
        {gm.isChatOpen && isNarrow && (
          <View style={styles.chatFullScreen}>
            <ChatDrawer
              messages={gm.chatMessages}
              currentUserId={gm.userId}
              onSend={gm.sendChatMessage}
              onClose={gm.closeChat}
            />
          </View>
        )}
      </View>

      {/* ═══ CONTROL BAR ═════════════════════════════════════ */}
      <ControlBar
        isMicEnabled={lk.isMicEnabled}
        isCameraEnabled={!gm.isAudioOnly && lk.isCameraEnabled}
        isScreenSharing={lk.isScreenSharing}
        isTranslationListening={translationListening}
        isRecording={isRecording || gm.isRecordingFromSocket}
        handRaised={handRaised}
        isSidebarOpen={sidebarOpen}
        activeSidebarPanel={activePanel}
        participantCount={lk.participants.length}
        unreadChatCount={gm.unreadChatCount}
        isChatOpen={gm.isChatOpen}
        isAdmin={gm.isAdmin}
        aiEnabled={gm.meeting?.ai_enabled ?? false}
        onToggleMic={lk.toggleMic}
        onToggleCamera={gm.isAudioOnly ? gm.toggleAudioOnly : lk.toggleCamera}
        onToggleScreenShare={lk.toggleScreenShare}
        onToggleTranscription={handleToggleTranscription}
        onToggleRecording={handleToggleRecording}
        onRaiseHand={handleRaiseHand}
        onToggleSidebar={handleToggleSidebar}
        onToggleAi={gm.toggleAi}
        onLeave={handleLeave}
        onEnd={gm.isAdmin ? handleEnd : undefined}
      />

      {/* ═══ HIDDEN LIVE TRANSLATION CONTROLLER ══════════════ */}
      {gm.userId && (
        <LiveTranslation
          ref={translationRef}
          meetingId={gm.meetingId!}
          userId={gm.userId}
          hideControls
          autoTTS
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Full-screen overlay
  fullContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    ...(Platform.OS === 'web' ? {
      position: 'fixed' as any,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 9999,
    } : {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 9999,
    }),
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
  minimizeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
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

  // Chat panels
  chatSidePanel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 320,
    zIndex: 101,
    borderLeftWidth: 1,
    borderLeftColor: Colors.accent,
  },
  chatFullScreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 200,
    backgroundColor: Colors.surface,
  },
  floatingChat: {
    position: Platform.OS === 'web' ? ('fixed' as any) : 'absolute',
    bottom: 100,
    right: 20,
    width: 320,
    height: 400,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.accent,
    zIndex: 10000,
    ...(Shadow.lg as any),
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

  // Audio-only mode
  audioOnlyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.background,
    padding: Spacing.xl,
  },
  audioOnlyTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.textWhite,
  },
  audioOnlyHint: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
  },
  audioOnlyParticipants: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    maxWidth: 400,
  },
  audioOnlyAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  audioOnlyAvatarActive: {
    borderColor: Colors.success,
  },
  audioOnlyAvatarText: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.textWhite,
  },
});
