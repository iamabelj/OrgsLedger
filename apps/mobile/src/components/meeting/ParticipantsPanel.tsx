// ============================================================
// OrgsLedger — ParticipantsPanel
// Participant list for meeting sidebar.
// Shows live participants with mic/camera status, hand raised,
// role badges, and connection quality.
// ============================================================

import React, { memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../theme';
import type { LKParticipant } from '../../hooks/useLiveKitRoom';

// ── Props ─────────────────────────────────────────────────

interface ParticipantsPanelProps {
  participants: LKParticipant[];
  activeSpeakerIds: string[];
  socketParticipants: Array<{ userId: string; name: string; isModerator?: boolean; handRaised?: boolean }>;
  attendance: any[];
}

// ── Avatar ────────────────────────────────────────────────

function MiniAvatar({ name, speaking }: { name: string; speaking: boolean }) {
  const initial = name?.[0]?.toUpperCase() || '?';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;

  return (
    <View style={[styles.avatar, speaking && styles.avatarSpeaking, { backgroundColor: `hsl(${hue}, 40%, 32%)` }]}>
      <Text style={styles.avatarText}>{initial}</Text>
    </View>
  );
}

// ── Component ─────────────────────────────────────────────

function ParticipantsPanelInner({
  participants,
  activeSpeakerIds,
  socketParticipants,
  attendance,
}: ParticipantsPanelProps) {
  // Merge LiveKit and socket participants (LiveKit has media info, socket has metadata)
  const mergedParticipants = participants.map((lkp) => {
    const socketP = socketParticipants.find(
      (sp) => sp.name === lkp.name || sp.userId === lkp.identity
    );
    return {
      ...lkp,
      isModerator: socketP?.isModerator ?? false,
      handRaised: socketP?.handRaised ?? false,
    };
  });

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Header */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>In Meeting ({mergedParticipants.length})</Text>
      </View>

      {/* LiveKit participants */}
      {mergedParticipants.length > 0 ? (
        mergedParticipants.map((p) => {
          const isSpeaking = activeSpeakerIds.includes(p.sid);
          return (
            <View key={p.sid} style={[styles.row, isSpeaking && styles.rowSpeaking]}>
              <MiniAvatar name={p.name} speaking={isSpeaking} />
              <View style={styles.info}>
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>
                    {p.isLocal ? `${p.name} (You)` : p.name}
                  </Text>
                  {p.isModerator && (
                    <View style={styles.moderatorBadge}>
                      <Text style={styles.moderatorText}>MOD</Text>
                    </View>
                  )}
                </View>
                <View style={styles.statusRow}>
                  {/* Mic */}
                  <Ionicons
                    name={p.isMicEnabled ? 'mic' : 'mic-off'}
                    size={12}
                    color={p.isMicEnabled ? Colors.success : Colors.error}
                  />
                  {/* Camera */}
                  <Ionicons
                    name={(p.isCameraEnabled ? 'videocam' : 'videocam-off') as any}
                    size={12}
                    color={p.isCameraEnabled ? Colors.success : Colors.textLight}
                  />
                  {/* Screen share */}
                  {p.isScreenSharing && (
                    <Ionicons name="desktop-outline" size={12} color="#818CF8" />
                  )}
                </View>
              </View>
              {/* Hand raised */}
              {p.handRaised && (
                <View style={styles.handIcon}>
                  <Text style={{ fontSize: 14 }}>✋</Text>
                </View>
              )}
              {/* Connection quality */}
              {!p.isLocal && (
                <View style={styles.qualityDot}>
                  <View
                    style={[
                      styles.dot,
                      {
                        backgroundColor:
                          p.connectionQuality === 'excellent' ? Colors.success :
                          p.connectionQuality === 'good' ? '#F59E0B' :
                          Colors.error,
                      },
                    ]}
                  />
                </View>
              )}
            </View>
          );
        })
      ) : (
        <Text style={styles.emptyText}>No participants in meeting yet</Text>
      )}

      {/* Socket-only participants (not in LiveKit but joined via socket) */}
      {socketParticipants
        .filter((sp) => !mergedParticipants.find((mp) => mp.identity === sp.userId || mp.name === sp.name))
        .length > 0 && (
        <>
          <View style={[styles.sectionHeader, { marginTop: Spacing.md }]}>
            <Text style={styles.sectionTitle}>Watching</Text>
          </View>
          {socketParticipants
            .filter((sp) => !mergedParticipants.find((mp) => mp.identity === sp.userId || mp.name === sp.name))
            .map((sp, i) => (
              <View key={sp.userId || i} style={styles.row}>
                <MiniAvatar name={sp.name} speaking={false} />
                <View style={styles.info}>
                  <Text style={styles.name} numberOfLines={1}>{sp.name}</Text>
                  {sp.isModerator && (
                    <View style={styles.moderatorBadge}>
                      <Text style={styles.moderatorText}>MOD</Text>
                    </View>
                  )}
                </View>
                {sp.handRaised && (
                  <View style={styles.handIcon}>
                    <Text style={{ fontSize: 14 }}>✋</Text>
                  </View>
                )}
              </View>
            ))}
        </>
      )}

      {/* Attendance from DB */}
      {attendance.length > 0 && (
        <>
          <View style={[styles.sectionHeader, { marginTop: Spacing.md }]}>
            <Text style={styles.sectionTitle}>Attendance ({attendance.length})</Text>
          </View>
          {attendance.map((a: any, i: number) => (
            <View key={a.id || a.user_id || i} style={styles.row}>
              <MiniAvatar name={`${a.first_name || '?'} ${a.last_name || ''}`} speaking={false} />
              <View style={styles.info}>
                <Text style={styles.name} numberOfLines={1}>
                  {a.first_name || a.user_id} {a.last_name || ''}
                </Text>
              </View>
              <View style={[styles.statusChip, a.status === 'present' ? styles.presentChip : styles.lateChip]}>
                <Text style={[styles.statusChipText, a.status === 'present' ? styles.presentText : styles.lateText]}>
                  {a.status === 'present' ? 'Present' : 'Late'}
                </Text>
              </View>
            </View>
          ))}
        </>
      )}

      <View style={{ height: Spacing.xl }} />
    </ScrollView>
  );
}

export const ParticipantsPanel = memo(ParticipantsPanelInner);

// ── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  sectionHeader: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  sectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.textLight,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs + 2,
    gap: Spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.accent,
  },
  rowSpeaking: {
    backgroundColor: 'rgba(52, 211, 153, 0.06)',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSpeaking: {
    borderWidth: 2,
    borderColor: Colors.success,
  },
  avatarText: {
    color: Colors.textWhite,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
  },
  info: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  name: {
    color: Colors.textWhite,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    flexShrink: 1,
  },
  moderatorBadge: {
    backgroundColor: Colors.highlightSubtle,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: BorderRadius.xs,
  },
  moderatorText: {
    color: Colors.highlight,
    fontSize: 8,
    fontWeight: FontWeight.bold,
    letterSpacing: 0.5,
  },
  statusRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginTop: 2,
  },
  handIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qualityDot: {
    padding: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  emptyText: {
    color: Colors.textLight,
    fontSize: FontSize.sm,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
  },
  statusChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
  },
  presentChip: {
    backgroundColor: Colors.successSubtle,
  },
  lateChip: {
    backgroundColor: Colors.warningSubtle,
  },
  statusChipText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
  },
  presentText: {
    color: Colors.success,
  },
  lateText: {
    color: Colors.warning,
  },
});
