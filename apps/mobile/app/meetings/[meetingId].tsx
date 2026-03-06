// ============================================================
// OrgsLedger Mobile — Meeting Detail Screen (Zoom-like UX)
// Full-featured: Waiting room, raise hand, participant list,
// recording toggle, meeting timer, join countdown,
// custom org branding, bandwidth auto-detection.
// ============================================================

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  TextInput,
  Modal,
  Animated,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { useMeetingStore } from '../../src/stores/meeting.store';
import { api } from '../../src/api/client';
import { socketClient } from '../../src/api/socket';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Card, Badge, Button, Avatar, SectionHeader, LoadingScreen, CrossPlatformDateTimePicker, ResponsiveScrollView } from '../../src/components/ui/index';
import LiveTranslation, { LANGUAGES, LANG_FLAGS, LiveTranslationRef } from '../../src/components/ui/LiveTranslation';
import { ALL_LANGUAGES, getLanguageFlag, getLanguageName, isTtsSupported } from '../../src/utils/languages';
import { showAlert } from '../../src/utils/alert';
import { useGlobalMeeting } from '../../src/contexts/MeetingContext';

// ── Constants ──────────────────────────────────────────────
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: string; label: string }> = {
  scheduled: { color: '#818CF8', bg: 'rgba(129, 140, 248, 0.12)', icon: 'calendar', label: 'Scheduled' },
  live:      { color: '#34D399', bg: 'rgba(52, 211, 153, 0.12)', icon: 'radio', label: 'Live Now' },
  ended:     { color: Colors.textLight, bg: Colors.accent, icon: 'checkmark-circle', label: 'Completed' },
  completed: { color: Colors.textLight, bg: Colors.accent, icon: 'checkmark-circle', label: 'Completed' },
  cancelled: { color: Colors.error, bg: Colors.errorSubtle, icon: 'close-circle', label: 'Cancelled' },
};

// ── Helpers ────────────────────────────────────────────────
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function MeetingDetailScreen() {
  // ...existing code...
}
