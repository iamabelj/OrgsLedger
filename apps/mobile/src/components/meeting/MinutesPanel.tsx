// ============================================================
// OrgsLedger — MinutesPanel
// AI meeting minutes display for the meeting sidebar.
// Shows summary, decisions, action items, motions, contributions.
// ============================================================

import React, { memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../theme';

// ── Props ─────────────────────────────────────────────────

interface MinutesPanelProps {
  minutes: any;
  loading: boolean;
  generateLoading: boolean;
  isAdmin: boolean;
  meetingStatus: string;
  aiEnabled: boolean;
  transcriptCount: number;
  onRefresh: () => void;
  onGenerate: () => void;
}

// ── Component ─────────────────────────────────────────────

function MinutesPanelInner(props: MinutesPanelProps) {
  const {
    minutes,
    loading,
    generateLoading,
    isAdmin,
    meetingStatus,
    aiEnabled,
    transcriptCount,
    onRefresh,
    onGenerate,
  } = props;

  if (loading) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator size="small" color={Colors.highlight} />
        <Text style={styles.stateText}>Loading minutes...</Text>
      </View>
    );
  }

  if (minutes?.status === 'processing') {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator size="large" color={Colors.highlight} />
        <Text style={styles.stateTitle}>Generating Minutes...</Text>
        <Text style={styles.stateHint}>AI is analyzing the transcript</Text>
      </View>
    );
  }

  if (minutes?.status === 'failed') {
    return (
      <View style={styles.centerState}>
        <Ionicons name="alert-circle" size={32} color={Colors.error} />
        <Text style={[styles.stateTitle, { color: Colors.error }]}>Generation Failed</Text>
        <Text style={styles.stateHint}>{minutes.error_message || 'An error occurred'}</Text>
        {isAdmin && (
          <TouchableOpacity style={styles.retryBtn} onPress={onGenerate} disabled={generateLoading}>
            <Text style={styles.retryText}>{generateLoading ? 'Retrying...' : 'Retry'}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (minutes?.status === 'completed') {
    return (
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* Summary */}
        {minutes.summary && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Summary</Text>
            <Text style={styles.sectionContent}>{minutes.summary}</Text>
          </View>
        )}

        {/* Decisions */}
        {minutes.decisions?.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Key Decisions</Text>
            {minutes.decisions.map((d: string, i: number) => (
              <View key={i} style={styles.bulletRow}>
                <Ionicons name="checkmark-circle" size={12} color={Colors.success} />
                <Text style={styles.bulletText}>{d}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Motions */}
        {minutes.motions?.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Motions</Text>
            {minutes.motions.map((m: any, i: number) => (
              <View key={i} style={styles.bulletRow}>
                <Ionicons name="megaphone" size={12} color={Colors.warning} />
                <Text style={styles.bulletText}>
                  {typeof m === 'string' ? m : `${m.text}${m.movedBy ? ` — ${m.movedBy}` : ''}${m.result ? ` (${m.result})` : ''}`}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Action Items */}
        {minutes.action_items?.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Action Items</Text>
            {minutes.action_items.map((a: any, i: number) => (
              <View key={i} style={styles.bulletRow}>
                <Ionicons name="arrow-forward-circle" size={12} color={Colors.highlight} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.bulletText}>
                    {typeof a === 'string' ? a : a.description || a.task}
                  </Text>
                  {typeof a !== 'string' && (a.assigneeName || a.assignee) && (
                    <Text style={styles.assignee}>
                      → {a.assigneeName || a.assignee}{a.dueDate ? ` (due ${a.dueDate})` : ''}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Contributions */}
        {minutes.contributions?.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contributions</Text>
            {minutes.contributions.map((c: any, i: number) => (
              <View key={i} style={styles.contributionCard}>
                <Text style={styles.contributionName}>{c.userName}</Text>
                {c.speakingTimeSeconds > 0 && (
                  <Text style={styles.contributionTime}>
                    {Math.floor(c.speakingTimeSeconds / 60)}m {c.speakingTimeSeconds % 60}s
                  </Text>
                )}
                {c.keyPoints?.map((kp: string, j: number) => (
                  <Text key={j} style={styles.keyPoint}>• {kp}</Text>
                ))}
              </View>
            ))}
          </View>
        )}

        {minutes.generated_at && (
          <Text style={styles.generatedAt}>
            Generated {new Date(minutes.generated_at).toLocaleString()}
          </Text>
        )}

        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    );
  }

  // No minutes yet
  return (
    <View style={styles.centerState}>
      <Ionicons name="document-text-outline" size={32} color={Colors.textLight} />
      <Text style={styles.stateText}>No minutes generated yet</Text>
      <Text style={styles.stateHint}>
        Minutes auto-generate when the meeting ends.
      </Text>
      {isAdmin && meetingStatus === 'ended' && transcriptCount > 0 && (
        <TouchableOpacity style={styles.retryBtn} onPress={onGenerate} disabled={generateLoading}>
          <Text style={styles.retryText}>
            {generateLoading ? 'Generating...' : 'Generate from Transcript'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export const MinutesPanel = memo(MinutesPanelInner);

// ── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.sm,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  stateTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.highlight,
  },
  stateText: {
    color: Colors.textLight,
    fontSize: FontSize.sm,
  },
  stateHint: {
    color: Colors.textLight,
    fontSize: FontSize.xs,
    textAlign: 'center',
    lineHeight: 16,
  },
  retryBtn: {
    marginTop: Spacing.sm,
    backgroundColor: Colors.highlight,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.md,
  },
  retryText: {
    color: '#FFF',
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
  },
  section: {
    marginTop: Spacing.md,
    paddingBottom: Spacing.md,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.accent,
  },
  sectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.highlight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  sectionContent: {
    fontSize: FontSize.sm,
    color: Colors.textWhite,
    lineHeight: 20,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: Spacing.xs,
  },
  bulletText: {
    fontSize: FontSize.xs,
    color: Colors.textWhite,
    flex: 1,
    lineHeight: 18,
  },
  assignee: {
    fontSize: 10,
    color: Colors.textLight,
    marginTop: 1,
  },
  contributionCard: {
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
    marginTop: Spacing.xs,
    borderWidth: 0.5,
    borderColor: Colors.accent,
  },
  contributionName: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textWhite,
  },
  contributionTime: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    marginTop: 1,
  },
  keyPoint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  generatedAt: {
    color: Colors.textLight,
    fontSize: 9,
    textAlign: 'center',
    marginTop: Spacing.md,
  },
});
