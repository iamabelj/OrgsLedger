// ============================================================
// OrgsLedger — VideoGrid Component
// Auto-adjusting video grid layout for meeting participants.
// Adapts from 1→fullscreen to 2→side-by-side to 3x3 grid.
// Handles screen sharing with presenter-focused layout.
// ============================================================

import React, { useMemo, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { Colors, Spacing, BorderRadius, FontSize, FontWeight } from '../../theme';
import { VideoTile } from './VideoTile';
import type { LKParticipant } from '../../hooks/useLiveKitRoom';

// ── Props ─────────────────────────────────────────────────

interface VideoGridProps {
  participants: LKParticipant[];
  activeSpeakerIds: string[];
}

// ── Grid Layout Calculator ────────────────────────────────

function getGridLayout(count: number, containerWidth: number, containerHeight: number) {
  if (count <= 0) return { cols: 1, rows: 1 };
  if (count === 1) return { cols: 1, rows: 1 };
  if (count === 2) return { cols: 2, rows: 1 };
  if (count <= 4) return { cols: 2, rows: 2 };
  if (count <= 6) return { cols: 3, rows: 2 };
  if (count <= 9) return { cols: 3, rows: 3 };
  if (count <= 12) return { cols: 4, rows: 3 };
  if (count <= 16) return { cols: 4, rows: 4 };
  return { cols: 5, rows: Math.ceil(count / 5) };
}

// ── VideoGrid Component ───────────────────────────────────

function VideoGridInner({ participants, activeSpeakerIds }: VideoGridProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  // Separate screen sharers from regular participants
  const { screenSharer, regularParticipants } = useMemo(() => {
    const sharer = participants.find((p) => p.isScreenSharing && p.screenTrack);
    return {
      screenSharer: sharer || null,
      regularParticipants: participants,
    };
  }, [participants]);

  // Screen share layout: large screen + thumbnails strip
  if (screenSharer) {
    return (
      <View style={styles.container}>
        {/* Main screen share area */}
        <View style={styles.screenShareMain}>
          <VideoTile
            participant={screenSharer}
            isActiveSpeaker={activeSpeakerIds.includes(screenSharer.sid)}
            style={styles.screenShareTile}
          />
        </View>

        {/* Thumbnail strip */}
        <ScrollView
          horizontal
          style={styles.thumbnailStrip}
          contentContainerStyle={styles.thumbnailContent}
          showsHorizontalScrollIndicator={false}
        >
          {regularParticipants.map((p) => (
            <VideoTile
              key={p.sid}
              participant={p}
              isActiveSpeaker={activeSpeakerIds.includes(p.sid)}
              style={styles.thumbnailTile}
            />
          ))}
        </ScrollView>
      </View>
    );
  }

  // Regular grid layout
  const count = regularParticipants.length;
  const gap = Spacing.xs;
  const { cols, rows } = getGridLayout(count, windowWidth, windowHeight);

  if (count === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Waiting for participants...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.grid}>
        {regularParticipants.map((participant, index) => {
          const row = Math.floor(index / cols);
          const col = index % cols;
          const isLastRow = row === rows - 1;
          const itemsInLastRow = count - (rows - 1) * cols;

          // Calculate tile dimensions
          const tileWidth = `${(100 / cols) - 0.5}%` as any;
          const tileHeight = count <= 2
            ? '100%'
            : `${(100 / Math.min(rows, Math.ceil(count / cols))) - 0.5}%` as any;

          return (
            <View
              key={participant.sid}
              style={[
                styles.tileWrapper,
                {
                  width: tileWidth,
                  height: tileHeight,
                  padding: gap / 2,
                },
                // Center items in last row if not full
                isLastRow && itemsInLastRow < cols && col === 0 && {
                  marginLeft: `${((cols - itemsInLastRow) / cols) * 50}%` as any,
                },
              ]}
            >
              <VideoTile
                participant={participant}
                isActiveSpeaker={activeSpeakerIds.includes(participant.sid)}
                isFocused={count === 1}
                style={styles.tileInner}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

export const VideoGrid = memo(VideoGridInner);

// ── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  grid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'center',
    justifyContent: 'center',
    padding: Spacing.xs,
  },
  tileWrapper: {
    padding: 2,
  },
  tileInner: {
    flex: 1,
    minHeight: 120,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  emptyText: {
    color: Colors.textLight,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.medium,
  },

  // Screen share layout
  screenShareMain: {
    flex: 1,
    padding: Spacing.xs,
  },
  screenShareTile: {
    flex: 1,
    minHeight: 300,
  },
  thumbnailStrip: {
    maxHeight: 120,
    borderTopWidth: 1,
    borderTopColor: Colors.accent,
    backgroundColor: Colors.surface,
  },
  thumbnailContent: {
    padding: Spacing.xs,
    gap: Spacing.xs,
    alignItems: 'center',
  },
  thumbnailTile: {
    width: 160,
    height: 100,
  },
});
