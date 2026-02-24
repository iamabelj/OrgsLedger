// ============================================================
// OrgsLedger — VideoTile Component
// Renders a single participant's video stream or avatar.
// Handles track attachment, active speaker glow, mic status,
// name badge, and connection quality indicator.
// ============================================================

import React, { useEffect, useRef, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../theme';
import type { LKParticipant } from '../../hooks/useLiveKitRoom';

// ── Props ─────────────────────────────────────────────────

interface VideoTileProps {
  participant: LKParticipant;
  isActiveSpeaker?: boolean;
  isFocused?: boolean;
  showName?: boolean;
  style?: any;
}

// ── Connection Quality Icon ───────────────────────────────

function ConnectionQualityIcon({ quality }: { quality: string }) {
  const bars =
    quality === 'excellent' ? 3 :
    quality === 'good' ? 2 :
    quality === 'poor' ? 1 : 0;
  const color =
    quality === 'excellent' ? Colors.success :
    quality === 'good' ? '#F59E0B' :
    quality === 'poor' ? Colors.error :
    Colors.textLight;

  return (
    <View style={styles.qualityIcon}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={[
            styles.qualityBar,
            { height: 4 + i * 3, backgroundColor: i < bars ? color : 'rgba(255,255,255,0.2)' },
          ]}
        />
      ))}
    </View>
  );
}

// ── Avatar Placeholder ────────────────────────────────────

function AvatarPlaceholder({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((w) => w[0]?.toUpperCase() || '')
    .slice(0, 2)
    .join('');

  // Generate consistent color from name
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;

  return (
    <View style={styles.avatarContainer}>
      <View style={[styles.avatarCircle, { backgroundColor: `hsl(${hue}, 45%, 35%)` }]}>
        <Text style={styles.avatarText}>{initials || '?'}</Text>
      </View>
    </View>
  );
}

// ── Web Video Renderer ────────────────────────────────────

function WebVideoElement({ track }: { track: any }) {
  const containerRef = useRef<View>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!track || Platform.OS !== 'web') return;
    const container = containerRef.current as any;
    if (!container) return;

    // Clean up previous element if track changed
    if (videoElRef.current) {
      try {
        track.detach(videoElRef.current);
        if (container.contains(videoElRef.current)) {
          container.removeChild(videoElRef.current);
        }
      } catch (_) {}
      videoElRef.current = null;
    }

    try {
      const el = track.attach();
      videoElRef.current = el;
      Object.assign(el.style, {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        borderRadius: 'inherit',
        transform: track.source === 'camera' ? 'scaleX(-1)' : 'none', // Mirror local camera
      });
      el.setAttribute('playsinline', 'true');
      el.setAttribute('autoplay', 'true');
      container.appendChild(el);

      // Ensure playback starts (autoplay policy)
      const playPromise = el.play?.();
      if (playPromise?.catch) {
        playPromise.catch(() => {}); // Ignore - will play on interaction
      }
    } catch (e) {
      console.warn('[VideoTile] Failed to attach video track:', e);
    }

    return () => {
      const el = videoElRef.current;
      if (el) {
        try {
          track.detach(el);
          if (container.contains(el)) container.removeChild(el);
        } catch (_) {}
        videoElRef.current = null;
      }
    };
  }, [track]);

  return <View ref={containerRef} style={styles.videoElement} />;
}

// ── VideoTile Component ───────────────────────────────────

function VideoTileInner({
  participant,
  isActiveSpeaker = false,
  isFocused = false,
  showName = true,
  style,
}: VideoTileProps) {
  // On web, use CSS animation for active speaker glow (zero JS overhead).
  // On native, use a simple static border (no Animated.loop).
  const tileRef = useRef<View>(null);

  // Inject CSS keyframes once for the active-speaker glow
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (document.getElementById('ol-speaker-glow-css')) return;
    const style = document.createElement('style');
    style.id = 'ol-speaker-glow-css';
    style.textContent = `
      @keyframes ol-speaker-glow {
        0%, 100% { box-shadow: 0 0 0 2px rgba(52,211,153,0.7); }
        50% { box-shadow: 0 0 8px 3px rgba(52,211,153,0.3); }
      }
      .ol-active-speaker { animation: ol-speaker-glow 1.6s ease-in-out infinite; }
    `;
    document.head.appendChild(style);
  }, []);

  // Toggle CSS class on the DOM element (no React re-render needed)
  useEffect(() => {
    if (Platform.OS !== 'web' || !tileRef.current) return;
    const el = (tileRef.current as any);
    // React Native for Web exposes the DOM node via the ref
    const dom: HTMLElement | null = el?._nativeTag ?? el;
    if (!dom?.classList) return;
    if (isActiveSpeaker) {
      dom.classList.add('ol-active-speaker');
    } else {
      dom.classList.remove('ol-active-speaker');
    }
  }, [isActiveSpeaker]);

  const hasVideo = participant.isCameraEnabled && participant.videoTrack;
  const hasScreen = participant.isScreenSharing && participant.screenTrack;
  const displayTrack = hasScreen ? participant.screenTrack : hasVideo ? participant.videoTrack : null;

  return (
    <View
      ref={tileRef}
      style={[
        styles.tile,
        isFocused && styles.tileFocused,
        isActiveSpeaker && styles.tileActiveSpeaker,
        style,
      ]}
    >
      {/* Video or Avatar */}
      {displayTrack && Platform.OS === 'web' ? (
        <WebVideoElement track={displayTrack} />
      ) : (
        <AvatarPlaceholder name={participant.name} />
      )}

      {/* Gradient overlay for name readability */}
      <View style={styles.bottomGradient} />

      {/* Name badge */}
      {showName && (
        <View style={styles.nameContainer}>
          <View style={styles.nameBadge}>
            {/* Mic status */}
            <View style={[styles.micIcon, !participant.isMicEnabled && styles.micIconMuted]}>
              <Ionicons
                name={participant.isMicEnabled ? 'mic' : 'mic-off'}
                size={10}
                color={participant.isMicEnabled ? Colors.success : '#EF4444'}
              />
            </View>
            <Text style={styles.nameText} numberOfLines={1}>
              {participant.isLocal ? `${participant.name} (You)` : participant.name}
            </Text>
          </View>

          {/* Screen sharing badge */}
          {participant.isScreenSharing && (
            <View style={styles.screenBadge}>
              <Ionicons name="desktop-outline" size={10} color="#818CF8" />
              <Text style={styles.screenBadgeText}>Screen</Text>
            </View>
          )}
        </View>
      )}

      {/* Connection quality (top right) */}
      {!participant.isLocal && (
        <View style={styles.qualityContainer}>
          <ConnectionQualityIcon quality={participant.connectionQuality} />
        </View>
      )}

      {/* Speaking indicator (top left) */}
      {isActiveSpeaker && (
        <View style={styles.speakingBadge}>
          <View style={styles.speakingDot} />
        </View>
      )}
    </View>
  );
}

export const VideoTile = memo(VideoTileInner);

// ── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  tile: {
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 2,
    borderColor: 'transparent',
    ...(Shadow.md as any),
  },
  tileFocused: {
    borderColor: Colors.highlight,
  },
  tileActiveSpeaker: {
    borderColor: 'rgba(52, 211, 153, 0.7)',
    borderWidth: 2,
  },
  videoElement: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  avatarContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primaryLight,
  },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    ...(Shadow.md as any),
  },
  avatarText: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.textWhite,
    letterSpacing: 1,
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 48,
    ...(Platform.OS === 'web'
      ? { background: 'linear-gradient(transparent, rgba(0,0,0,0.6))' }
      : { backgroundColor: 'rgba(0,0,0,0.3)' }) as any,
  },
  nameContainer: {
    position: 'absolute',
    bottom: Spacing.xs,
    left: Spacing.xs,
    right: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  nameBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.sm,
    maxWidth: '80%',
  },
  nameText: {
    color: Colors.textWhite,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium,
  },
  micIcon: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micIconMuted: {
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
  },
  screenBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(129, 140, 248, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  screenBadgeText: {
    color: '#818CF8',
    fontSize: 9,
    fontWeight: FontWeight.semibold,
  },
  qualityContainer: {
    position: 'absolute',
    top: Spacing.xs,
    right: Spacing.xs,
  },
  qualityIcon: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    padding: 3,
    borderRadius: BorderRadius.xs,
  },
  qualityBar: {
    width: 3,
    borderRadius: 1,
  },
  speakingBadge: {
    position: 'absolute',
    top: Spacing.xs,
    left: Spacing.xs,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    padding: 4,
    borderRadius: BorderRadius.full,
  },
  speakingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
  },
});
