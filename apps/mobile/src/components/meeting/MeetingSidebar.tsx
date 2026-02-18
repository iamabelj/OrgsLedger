// ============================================================
// OrgsLedger — MeetingSidebar
// Toggleable right sidebar with tabbed panels:
// Participants, Transcript, Minutes.
// ============================================================

import React, { memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../theme';
import { ParticipantsPanel } from './ParticipantsPanel';
import { TranscriptPanel } from './TranscriptPanel';
import { MinutesPanel } from './MinutesPanel';
import type { LKParticipant } from '../../hooks/useLiveKitRoom';

// ── Types ─────────────────────────────────────────────────

export type SidebarPanel = 'participants' | 'transcript' | 'minutes';

interface MeetingSidebarProps {
  activePanel: SidebarPanel;
  onChangePanel: (panel: SidebarPanel) => void;
  onClose: () => void;

  // Participants
  lkParticipants: LKParticipant[];
  activeSpeakerIds: string[];
  socketParticipants: Array<{ userId: string; name: string; isModerator?: boolean; handRaised?: boolean }>;
  attendance: any[];

  // Transcript
  transcripts: any[];
  transcriptsLoading: boolean;
  userId: string;
  onRefreshTranscripts: () => void;

  // Minutes
  minutes: any;
  minutesLoading: boolean;
  generateLoading: boolean;
  isAdmin: boolean;
  meetingStatus: string;
  aiEnabled: boolean;
  transcriptCount: number;
  onRefreshMinutes: () => void;
  onGenerateMinutes: () => void;
}

// ── Tab Button ────────────────────────────────────────────

function TabBtn({
  icon,
  label,
  active,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.tab, active && styles.tabActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Ionicons name={icon} size={14} color={active ? Colors.highlight : Colors.textLight} />
      <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Component ─────────────────────────────────────────────

function MeetingSidebarInner(props: MeetingSidebarProps) {
  const {
    activePanel,
    onChangePanel,
    onClose,
    lkParticipants,
    activeSpeakerIds,
    socketParticipants,
    attendance,
    transcripts,
    transcriptsLoading,
    userId,
    onRefreshTranscripts,
    minutes,
    minutesLoading,
    generateLoading,
    isAdmin,
    meetingStatus,
    aiEnabled,
    transcriptCount,
    onRefreshMinutes,
    onGenerateMinutes,
  } = props;

  return (
    <View style={styles.container}>
      {/* Header with close button */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {activePanel === 'participants' ? 'Participants' :
           activePanel === 'transcript' ? 'Transcript' : 'Minutes'}
        </Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
          <Ionicons name="close" size={18} color={Colors.textLight} />
        </TouchableOpacity>
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        <TabBtn
          icon="people"
          label="People"
          active={activePanel === 'participants'}
          onPress={() => onChangePanel('participants')}
        />
        <TabBtn
          icon="chatbubbles"
          label="Transcript"
          active={activePanel === 'transcript'}
          onPress={() => onChangePanel('transcript')}
        />
        <TabBtn
          icon="document-text"
          label="Minutes"
          active={activePanel === 'minutes'}
          onPress={() => onChangePanel('minutes')}
        />
      </View>

      {/* Panel Content */}
      <View style={styles.panelContent}>
        {activePanel === 'participants' && (
          <ParticipantsPanel
            participants={lkParticipants}
            activeSpeakerIds={activeSpeakerIds}
            socketParticipants={socketParticipants}
            attendance={attendance}
          />
        )}
        {activePanel === 'transcript' && (
          <TranscriptPanel
            transcripts={transcripts}
            loading={transcriptsLoading}
            userId={userId}
            onRefresh={onRefreshTranscripts}
          />
        )}
        {activePanel === 'minutes' && (
          <MinutesPanel
            minutes={minutes}
            loading={minutesLoading}
            generateLoading={generateLoading}
            isAdmin={isAdmin}
            meetingStatus={meetingStatus}
            aiEnabled={aiEnabled}
            transcriptCount={transcriptCount}
            onRefresh={onRefreshMinutes}
            onGenerate={onGenerateMinutes}
          />
        )}
      </View>
    </View>
  );
}

export const MeetingSidebar = memo(MeetingSidebarInner);

// ── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderLeftWidth: 1,
    borderLeftColor: Colors.accent,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.accent,
  },
  headerTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textWhite,
  },
  closeBtn: {
    padding: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  tabBar: {
    flexDirection: 'row',
    padding: 3,
    margin: Spacing.xs,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.sm,
  },
  tabActive: {
    backgroundColor: Colors.primaryMid,
  },
  tabText: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    fontWeight: FontWeight.medium,
  },
  tabTextActive: {
    color: Colors.highlight,
    fontWeight: FontWeight.semibold,
  },
  panelContent: {
    flex: 1,
  },
});
