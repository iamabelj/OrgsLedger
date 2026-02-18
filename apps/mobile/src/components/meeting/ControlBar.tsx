// ============================================================
// OrgsLedger — ControlBar Component
// Zoom-class bottom control bar for meeting rooms.
// Mic, Camera, Screen Share, Hand, Language, Record, Leave.
// ============================================================

import React, { useState, memo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../theme';

// ── Props ─────────────────────────────────────────────────

interface ControlBarProps {
  // Media states
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isScreenSharing: boolean;

  // Translation states
  isTranslationListening: boolean;
  translationLang: string;
  translationEnabled: boolean;
  voiceToVoice: boolean;

  // Recording
  isRecording: boolean;

  // Hand
  handRaised: boolean;

  // Sidebar
  isSidebarOpen: boolean;
  activeSidebarPanel: string;

  // Counts
  participantCount: number;
  elapsedSeconds: number;

  // Admin
  isAdmin: boolean;

  // Handlers
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onToggleTranslation: () => void;
  onToggleVoiceToVoice: () => void;
  onOpenLanguagePicker: () => void;
  onToggleRecording: () => void;
  onRaiseHand: () => void;
  onToggleSidebar: (panel?: string) => void;
  onLeave: () => void;
  onEnd?: () => void;
}

// ── Control Button ────────────────────────────────────────

interface ControlBtnProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  active?: boolean;
  danger?: boolean;
  warning?: boolean;
  disabled?: boolean;
  badge?: string | number;
  onPress: () => void;
  activeColor?: string;
}

function ControlBtn({
  icon,
  label,
  active = false,
  danger = false,
  warning = false,
  disabled = false,
  badge,
  onPress,
  activeColor,
}: ControlBtnProps) {
  const bgColor = danger
    ? Colors.error
    : active
    ? (activeColor || Colors.highlight)
    : Colors.primaryMid;

  const iconColor = danger || active ? '#FFF' : Colors.textSecondary;
  const labelColor = danger
    ? Colors.error
    : active
    ? (activeColor || Colors.highlight)
    : Colors.textSecondary;

  return (
    <TouchableOpacity
      style={styles.controlBtn}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <View style={[styles.controlIcon, { backgroundColor: bgColor }]}>
        <Ionicons name={icon} size={20} color={iconColor} />
        {badge !== undefined && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.controlLabel, { color: labelColor }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Divider ───────────────────────────────────────────────

function Divider() {
  return <View style={styles.divider} />;
}

// ── Format Duration ───────────────────────────────────────

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── ControlBar Component ──────────────────────────────────

function ControlBarInner(props: ControlBarProps) {
  const {
    isMicEnabled,
    isCameraEnabled,
    isScreenSharing,
    isTranslationListening,
    translationLang,
    translationEnabled,
    voiceToVoice,
    isRecording,
    handRaised,
    isSidebarOpen,
    activeSidebarPanel,
    participantCount,
    elapsedSeconds,
    isAdmin,
    onToggleMic,
    onToggleCamera,
    onToggleScreenShare,
    onToggleTranslation,
    onToggleVoiceToVoice,
    onOpenLanguagePicker,
    onToggleRecording,
    onRaiseHand,
    onToggleSidebar,
    onLeave,
    onEnd,
  } = props;

  return (
    <View style={styles.container}>
      {/* Timer */}
      <View style={styles.timerSection}>
        <View style={styles.timerDot} />
        <Text style={styles.timerText}>{formatDuration(elapsedSeconds)}</Text>
      </View>

      {/* Main Controls */}
      <View style={styles.controlsRow}>
        {/* Microphone */}
        <ControlBtn
          icon={isMicEnabled ? 'mic' : 'mic-off'}
          label={isMicEnabled ? 'Mute' : 'Unmute'}
          active={isMicEnabled}
          activeColor="#10B981"
          onPress={onToggleMic}
        />

        {/* Camera */}
        <ControlBtn
          icon={(isCameraEnabled ? 'videocam' : 'videocam-off') as any}
          label={isCameraEnabled ? 'Stop' : 'Start'}
          active={isCameraEnabled}
          activeColor="#6366F1"
          onPress={onToggleCamera}
        />

        {/* Screen Share */}
        {Platform.OS === 'web' && (
          <ControlBtn
            icon={isScreenSharing ? 'stop-circle' : 'desktop-outline'}
            label={isScreenSharing ? 'Stop Share' : 'Share'}
            active={isScreenSharing}
            activeColor="#818CF8"
            onPress={onToggleScreenShare}
          />
        )}

        <Divider />

        {/* Translation Mic */}
        {translationEnabled && (
          <ControlBtn
            icon={isTranslationListening ? 'mic' : 'mic-off'}
            label={isTranslationListening ? 'STT On' : 'STT'}
            active={isTranslationListening}
            activeColor="#10B981"
            onPress={onToggleTranslation}
          />
        )}

        {/* Language Picker */}
        {translationEnabled && (
          <ControlBtn
            icon="language"
            label={translationLang.toUpperCase()}
            active={false}
            onPress={onOpenLanguagePicker}
          />
        )}

        {/* Voice-to-Voice */}
        {translationEnabled && (
          <ControlBtn
            icon={voiceToVoice ? 'volume-high' : 'volume-mute'}
            label={voiceToVoice ? 'V2V On' : 'V2V'}
            active={voiceToVoice}
            activeColor="#10B981"
            onPress={onToggleVoiceToVoice}
          />
        )}

        <Divider />

        {/* Raise Hand */}
        <ControlBtn
          icon="hand-left"
          label={handRaised ? 'Lower' : 'Raise'}
          active={handRaised}
          activeColor="#F59E0B"
          onPress={onRaiseHand}
        />

        {/* Participants */}
        <ControlBtn
          icon="people"
          label="People"
          active={isSidebarOpen && activeSidebarPanel === 'participants'}
          badge={participantCount}
          onPress={() => onToggleSidebar('participants')}
        />

        {/* Transcript */}
        <ControlBtn
          icon="chatbubbles"
          label="Transcript"
          active={isSidebarOpen && activeSidebarPanel === 'transcript'}
          onPress={() => onToggleSidebar('transcript')}
        />

        {/* Record */}
        {isAdmin && (
          <ControlBtn
            icon={isRecording ? 'stop-circle' : 'radio-button-on'}
            label={isRecording ? 'Stop Rec' : 'Record'}
            active={isRecording}
            activeColor={Colors.error}
            onPress={onToggleRecording}
          />
        )}

        <Divider />

        {/* Leave */}
        <ControlBtn
          icon="call"
          label="Leave"
          danger
          onPress={onLeave}
        />

        {/* End Meeting (admin) */}
        {isAdmin && onEnd && (
          <ControlBtn
            icon="stop-circle"
            label="End All"
            danger
            onPress={onEnd}
          />
        )}
      </View>
    </View>
  );
}

export const ControlBar = memo(ControlBarInner);

// ── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.accent,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    ...(Shadow.lg as any),
  },
  timerSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  timerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
  timerText: {
    color: Colors.textSecondary,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
    fontVariant: ['tabular-nums'] as any,
    letterSpacing: 1,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  controlBtn: {
    alignItems: 'center',
    gap: 2,
    minWidth: 52,
    paddingHorizontal: 2,
  },
  controlIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  controlLabel: {
    fontSize: 9,
    fontWeight: FontWeight.medium,
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: Colors.highlight,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: FontWeight.bold,
  },
  divider: {
    width: 1,
    height: 32,
    backgroundColor: Colors.accent,
    marginHorizontal: Spacing.xs,
  },
});
