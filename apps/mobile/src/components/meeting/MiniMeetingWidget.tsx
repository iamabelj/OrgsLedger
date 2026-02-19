// ============================================================
// OrgsLedger — MiniMeetingWidget
// Small floating meeting widget shown when meeting is minimized.
// Docked bottom-right, shows active speaker, mute/expand/chat.
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

interface MiniMeetingWidgetProps {
  title: string;
  participantCount: number;
  elapsedSeconds: number;
  isMicEnabled: boolean;
  unreadChatCount: number;
  isAudioOnly: boolean;
  onExpand: () => void;
  onToggleMic: () => void;
  onToggleChat: () => void;
  onLeave: () => void;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function MiniMeetingWidgetInner(props: MiniMeetingWidgetProps) {
  const {
    title,
    participantCount,
    elapsedSeconds,
    isMicEnabled,
    unreadChatCount,
    isAudioOnly,
    onExpand,
    onToggleMic,
    onToggleChat,
    onLeave,
  } = props;

  const { width: windowWidth } = useWindowDimensions();
  const isMobile = windowWidth < 768;
  const widgetWidth = isMobile ? Math.min(200, windowWidth - 40) : 280;

  return (
    <View style={[
      styles.container,
      { width: widgetWidth },
      isMobile && styles.containerMobile,
    ]}>
      {/* Top section — tap to expand */}
      <TouchableOpacity
        style={styles.topSection}
        onPress={onExpand}
        activeOpacity={0.8}
      >
        <View style={styles.liveRow}>
          <View style={styles.liveDot} />
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
        </View>
        <View style={styles.infoRow}>
          <View style={styles.infoBadge}>
            <Ionicons name="people" size={10} color={Colors.textLight} />
            <Text style={styles.infoText}>{participantCount}</Text>
          </View>
          <Text style={styles.timer}>{formatDuration(elapsedSeconds)}</Text>
          {isAudioOnly && (
            <View style={styles.infoBadge}>
              <Ionicons name="headset" size={10} color={Colors.textLight} />
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.controlBtn, !isMicEnabled && styles.controlBtnActive]}
          onPress={onToggleMic}
        >
          <Ionicons
            name={isMicEnabled ? 'mic' : 'mic-off'}
            size={16}
            color={isMicEnabled ? Colors.textWhite : Colors.error}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.controlBtn}
          onPress={onToggleChat}
        >
          <Ionicons name="chatbubble" size={14} color={Colors.textWhite} />
          {unreadChatCount > 0 && (
            <View style={styles.chatBadge}>
              <Text style={styles.chatBadgeText}>
                {unreadChatCount > 99 ? '99+' : unreadChatCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.controlBtn}
          onPress={onExpand}
        >
          <Ionicons name="expand" size={16} color={Colors.textWhite} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlBtn, styles.leaveBtn]}
          onPress={onLeave}
        >
          <Ionicons name="call" size={14} color="#FFF" style={{ transform: [{ rotate: '135deg' }] }} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export const MiniMeetingWidget = memo(MiniMeetingWidgetInner);

// ── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.accent,
    zIndex: 9999,
    ...(Shadow.lg as any),
    // Snap to edges — web gets fixed position
    ...(Platform.OS === 'web' ? {
      position: 'fixed' as any,
    } : {}),
  },
  containerMobile: {
    bottom: 80, // Above tab bar on mobile
    right: 12,
  },
  topSection: {
    padding: Spacing.sm,
    gap: 4,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
  title: {
    flex: 1,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textWhite,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  infoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
  infoText: {
    fontSize: 9,
    color: Colors.textLight,
  },
  timer: {
    fontSize: 11,
    fontWeight: FontWeight.bold,
    color: Colors.textWhite,
    fontVariant: ['tabular-nums'] as any,
    letterSpacing: 1,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: Spacing.xs,
    paddingBottom: Spacing.xs,
    gap: Spacing.xs,
  },
  controlBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  controlBtnActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  leaveBtn: {
    backgroundColor: Colors.error,
  },
  chatBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: Colors.error,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  chatBadgeText: {
    fontSize: 8,
    fontWeight: FontWeight.bold,
    color: '#FFF',
  },
});
