// ============================================================
// OrgsLedger — ControlBar Component
// Zoom-class bottom control bar for meeting rooms.
// Clean layout: Mic | Camera | Share || Hand | People | Chat
//   | Language | Record || Leave | End
// ============================================================

import React, { memo } from 'react';
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

// ── Props ─────────────────────────────────────────────────

interface ControlBarProps {
  // Media states
  isMicEnabled: boolean;
  isCameraEnabled: boolean;
  isScreenSharing: boolean;

  // Translation
  translationLang: string;
  isTranslationListening: boolean;

  // Recording
  isRecording: boolean;

  // Hand
  handRaised: boolean;

  // Sidebar
  isSidebarOpen: boolean;
  activeSidebarPanel: string;

  // Counts
  participantCount: number;

  // Admin
  isAdmin: boolean;

  // Handlers
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
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
  disabled?: boolean;
  badge?: string | number;
  onPress: () => void;
  activeColor?: string;
  compact?: boolean;
}

function ControlBtn({
  icon,
  label,
  active = false,
  danger = false,
  disabled = false,
  badge,
  onPress,
  activeColor,
  compact = false,
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
      style={[styles.controlBtn, compact && styles.controlBtnCompact]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
    >
      <View style={[styles.controlIcon, compact && styles.controlIconCompact, { backgroundColor: bgColor }]}>
        <Ionicons name={icon} size={compact ? 16 : 20} color={iconColor} />
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

// ── ControlBar Component ──────────────────────────────────

function ControlBarInner(props: ControlBarProps) {
  const {
    isMicEnabled,
    isCameraEnabled,
    isScreenSharing,
    translationLang,
    isTranslationListening,
    isRecording,
    handRaised,
    isSidebarOpen,
    activeSidebarPanel,
    participantCount,
    isAdmin,
    onToggleMic,
    onToggleCamera,
    onToggleScreenShare,
    onOpenLanguagePicker,
    onToggleRecording,
    onRaiseHand,
    onToggleSidebar,
    onLeave,
    onEnd,
  } = props;

  const { width } = useWindowDimensions();
  const isNarrow = width < 640;

  return (
    <View style={styles.container}>
      <View style={styles.controlsRow}>
        {/* ── Media Controls ──────────────────────── */}
        <ControlBtn
          icon={isMicEnabled ? 'mic' : 'mic-off'}
          label={isMicEnabled ? 'Mute' : 'Unmute'}
          active={isMicEnabled}
          activeColor="#10B981"
          onPress={onToggleMic}
          compact={isNarrow}
        />

        <ControlBtn
          icon={(isCameraEnabled ? 'videocam' : 'videocam-off') as any}
          label={isCameraEnabled ? 'Stop Video' : 'Start Video'}
          active={isCameraEnabled}
          activeColor="#6366F1"
          onPress={onToggleCamera}
          compact={isNarrow}
        />

        {Platform.OS === 'web' && !isNarrow && (
          <ControlBtn
            icon={isScreenSharing ? 'stop-circle' : 'desktop-outline'}
            label={isScreenSharing ? 'Stop Share' : 'Share'}
            active={isScreenSharing}
            activeColor="#818CF8"
            onPress={onToggleScreenShare}
            compact={isNarrow}
          />
        )}

        <Divider />

        {/* ── Collaboration Controls ──────────────── */}
        <ControlBtn
          icon="hand-left"
          label={handRaised ? 'Lower' : 'Raise'}
          active={handRaised}
          activeColor="#F59E0B"
          onPress={onRaiseHand}
          compact={isNarrow}
        />

        <ControlBtn
          icon="people"
          label="People"
          active={isSidebarOpen && activeSidebarPanel === 'participants'}
          badge={participantCount}
          onPress={() => onToggleSidebar('participants')}
          compact={isNarrow}
        />

        <ControlBtn
          icon="chatbubbles"
          label="Transcript"
          active={isSidebarOpen && activeSidebarPanel === 'transcript'}
          onPress={() => onToggleSidebar('transcript')}
          compact={isNarrow}
        />

        {/* Language / Translation (always available) */}
        <ControlBtn
          icon="language"
          label={isTranslationListening ? translationLang.toUpperCase() : 'Language'}
          active={isTranslationListening}
          activeColor="#10B981"
          onPress={onOpenLanguagePicker}
          compact={isNarrow}
        />

        {/* Record (admin only) */}
        {isAdmin && (
          <>
            <Divider />
            <ControlBtn
              icon={isRecording ? 'stop-circle' : 'radio-button-on'}
              label={isRecording ? 'Stop Rec' : 'Record'}
              active={isRecording}
              activeColor={Colors.error}
              onPress={onToggleRecording}
              compact={isNarrow}
            />
          </>
        )}

        <Divider />

        {/* ── Session Controls ────────────────────── */}
        <ControlBtn
          icon="call"
          label="Leave"
          danger
          onPress={onLeave}
          compact={isNarrow}
        />

        {isAdmin && onEnd && (
          <ControlBtn
            icon="stop-circle"
            label="End All"
            danger
            onPress={onEnd}
            compact={isNarrow}
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
  controlBtnCompact: {
    minWidth: 40,
  },
  controlIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  controlIconCompact: {
    width: 36,
    height: 36,
    borderRadius: 18,
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
