// ============================================================
// OrgsLedger — TranscriptPanel
// Live transcript display for the meeting sidebar.
// Shows real-time transcripts with speaker, time, translations.
// ============================================================

import React, { useRef, useEffect, memo, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../theme';
import { getLanguageFlag } from '../../utils/languages';

// ── Props ─────────────────────────────────────────────────

interface TranscriptPanelProps {
  transcripts: any[];
  loading: boolean;
  userId: string;
  onRefresh: () => void;
}

// ── Component ─────────────────────────────────────────────

function TranscriptPanelInner({ transcripts, loading, userId, onRefresh }: TranscriptPanelProps) {
  const listRef = useRef<FlatList>(null);

  // Auto-scroll to bottom on new transcripts
  useEffect(() => {
    if (transcripts.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [transcripts.length]);

  // Memoize rendered items to prevent re-renders of unchanged entries
  const renderItem = useMemo(() => {
    return ({ item: t, index }: { item: any; index: number }) => {
      const time = new Date(parseInt(t.spoken_at)).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const isSelf = t.speaker_id === userId;
      const translations =
        typeof t.translations === 'string'
          ? JSON.parse(t.translations || '{}')
          : t.translations || {};

      return (
        <View style={[styles.entry, isSelf && styles.entrySelf]}>
          <View style={styles.entryHeader}>
            <Text style={styles.speakerName}>
              {getLanguageFlag(t.source_lang)} {isSelf ? 'You' : t.speaker_name}
            </Text>
            <Text style={styles.timestamp}>{time}</Text>
          </View>
          <Text style={styles.originalText}>{t.original_text}</Text>
          {Object.keys(translations).length > 0 && (
            <View style={styles.translationsContainer}>
              {Object.entries(translations).map(([lang, text]) => (
                <Text key={lang} style={styles.translationText}>
                  {getLanguageFlag(lang)} {text as string}
                </Text>
              ))}
            </View>
          )}
        </View>
      );
    };
  }, [userId]);

  // Get item layout hint for fixed-height items (improves FlatList performance)
  const getItemLayout = (_: any, index: number) => ({
    length: 100, // Approximate height of each item
    offset: 100 * index,
    index,
  });

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.liveDot} />
          <Text style={styles.headerTitle}>Live Transcript</Text>
        </View>
        <TouchableOpacity onPress={onRefresh} style={styles.refreshBtn} activeOpacity={0.7}>
          <Ionicons name="refresh" size={14} color={Colors.textLight} />
        </TouchableOpacity>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator size="small" color={Colors.highlight} />
          <Text style={styles.emptyText}>Loading transcripts...</Text>
        </View>
      ) : transcripts.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="chatbubbles-outline" size={32} color={Colors.textLight} />
          <Text style={styles.emptyText}>No transcripts yet</Text>
          <Text style={styles.emptyHint}>
            Speak during the meeting to generate a live transcript.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={transcripts}
          renderItem={renderItem}
          keyExtractor={(item, index) => item.id || `transcript-${index}`}
          style={styles.flatList}
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          updateCellsBatchingPeriod={50}
          initialNumToRender={15}
          getItemLayout={getItemLayout}
          ListFooterComponent={<View style={{ height: Spacing.md }} />}
          scrollIndicatorInsets={{ right: 1 }}
        />
      )}
    </View>
  );
}

export const TranscriptPanel = memo(TranscriptPanelInner);

// ── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.accent,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.success,
  },
  headerTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textWhite,
  },
  refreshBtn: {
    padding: Spacing.xs,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  emptyText: {
    color: Colors.textLight,
    fontSize: FontSize.sm,
  },
  emptyHint: {
    color: Colors.textLight,
    fontSize: FontSize.xs,
    textAlign: 'center',
    lineHeight: 16,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: Spacing.xs,
  },
  flatList: {
    flex: 1,
  },
  entry: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs + 2,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.accent,
  },
  entrySelf: {
    backgroundColor: 'rgba(129, 140, 248, 0.06)',
  },
  entryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  speakerName: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.highlight,
  },
  timestamp: {
    fontSize: 9,
    color: Colors.textLight,
    fontVariant: ['tabular-nums'] as any,
  },
  originalText: {
    fontSize: FontSize.sm,
    color: Colors.textWhite,
    lineHeight: 18,
  },
  translationsContainer: {
    marginTop: Spacing.xs,
    paddingTop: Spacing.xs,
    borderTopWidth: 0.5,
    borderTopColor: Colors.accent,
  },
  translationText: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 16,
    marginTop: 1,
  },
});
