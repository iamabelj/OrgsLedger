// ============================================================
// OrgsLedger Mobile — Meetings List Screen (Royal Design)
// ============================================================

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { format, isToday, isTomorrow, isThisWeek, isPast } from 'date-fns';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { socketClient } from '../../src/api/socket';
import {
  Colors, Spacing, FontSize, FontWeight,
  BorderRadius, Shadow,
} from '../../src/theme';
import {
  Card, Badge, SearchBar, EmptyState, LoadingScreen,
  SectionHeader, StatCard, useContentStyle,
} from '../../src/components/ui';

type MeetingStatus = 'scheduled' | 'live' | 'ended' | 'cancelled';

const STATUS_CONFIG: Record<string, {
  color: string; bg: string; icon: React.ComponentProps<typeof Ionicons>['name']; label: string;
}> = {
  scheduled: { color: Colors.highlight, bg: Colors.highlightSubtle, icon: 'calendar', label: 'Scheduled' },
  live:      { color: Colors.success, bg: Colors.successSubtle, icon: 'radio-button-on', label: 'Live Now' },
  ended:     { color: Colors.textLight, bg: Colors.accent, icon: 'checkmark-circle', label: 'Ended' },
  cancelled: { color: Colors.error, bg: Colors.errorSubtle, icon: 'close-circle', label: 'Cancelled' },
};

export default function MeetingsScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const globalRole = useAuthStore((s) => s.user?.globalRole);
  const membership = useAuthStore((s) =>
    s.memberships.find((m) => m.organization_id === s.currentOrgId)
  );
  const [meetings, setMeetings] = useState<any[]>([]);
  const [filter, setFilter] = useState<MeetingStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const contentStyle = useContentStyle({ paddingBottom: 100 });

  const canCreate = globalRole === 'super_admin' || globalRole === 'developer' || (membership &&
    ['org_admin', 'executive'].includes(membership.role));

  const loadMeetings = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const params: any = { limit: 50 };
      if (filter !== 'all') params.status = filter;
      const res = await api.meetings.list(currentOrgId, params);
      setMeetings(res.data.data || []);
    } catch (err) {
      console.warn('Failed to load meetings:', err);
    }
  }, [currentOrgId, filter]);

  useEffect(() => {
    setLoading(true);
    loadMeetings().finally(() => setLoading(false));
  }, [loadMeetings]);

  // ── Socket: Real-time meeting state sync ────────────────
  useEffect(() => {
    const handleMeetingStarted = (data: any) => {
      setMeetings((prev) => {
        const exists = prev.some((m) => m.id === data.meetingId);
        if (exists) {
          return prev.map((m) =>
            m.id === data.meetingId
              ? { ...m, status: 'live', actual_start: new Date().toISOString() }
              : m
          );
        }
        // Meeting not in local list — add a stub so users see it immediately.
        // The next refresh will fill in full details.
        return [
          {
            id: data.meetingId,
            title: data.title || 'Meeting',
            status: 'live',
            actual_start: new Date().toISOString(),
          },
          ...prev,
        ];
      });
    };
    const handleMeetingEnded = (data: any) => {
      setMeetings((prev) =>
        prev.map((m) => m.id === data.meetingId ? { ...m, status: 'ended', actual_end: new Date().toISOString() } : m)
      );
    };

    // On socket reconnect, refetch meetings to catch events missed during disconnect
    const handleReconnect = () => {
      loadMeetings();
    };

    const unsub1 = socketClient.on('meeting:started', handleMeetingStarted);
    const unsub2 = socketClient.on('meeting:ended', handleMeetingEnded);
    const unsub3 = socketClient.on('connect', handleReconnect);

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [loadMeetings]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadMeetings();
    setRefreshing(false);
  };

  // Stats
  const stats = useMemo(() => {
    const live = meetings.filter((m) => m.status === 'live').length;
    const upcoming = meetings.filter((m) => m.status === 'scheduled').length;
    const total = meetings.length;
    return { live, upcoming, total };
  }, [meetings]);

  // Filter + search
  const filtered = useMemo(() => {
    let list = meetings;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (m) =>
          m.title?.toLowerCase().includes(q) ||
          m.location?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [meetings, search]);

  // Group by date section
  const getDateLabel = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isToday(d)) return 'Today';
    if (isTomorrow(d)) return 'Tomorrow';
    if (isThisWeek(d)) return format(d, 'EEEE');
    return format(d, 'MMMM d, yyyy');
  };

  const filters: { label: string; value: MeetingStatus | 'all'; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
    { label: 'All', value: 'all', icon: 'grid-outline' },
    { label: 'Upcoming', value: 'scheduled', icon: 'calendar-outline' },
    { label: 'Live', value: 'live', icon: 'radio-button-on' },
    { label: 'Past', value: 'ended', icon: 'checkmark-done-outline' },
  ];

  if (loading) return <LoadingScreen />;

  return (
    <View style={styles.container}>
      {/* Stats Row */}
      <View style={styles.statsRow}>
        <StatCard
          label="Total"
          value={String(stats.total)}
          icon="calendar"
          iconColor={Colors.highlight}
        />
        <StatCard
          label="Upcoming"
          value={String(stats.upcoming)}
          icon="time"
          iconColor={Colors.info}
        />
        <StatCard
          label="Live"
          value={String(stats.live)}
          icon="radio-button-on"
          iconColor={Colors.success}
        />
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          placeholder="Search meetings..."
        />
      </View>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {filters.map((f) => {
          const active = filter === f.value;
          return (
            <TouchableOpacity
              key={f.value}
              style={[styles.filterChip, active && styles.filterActive]}
              onPress={() => setFilter(f.value)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={f.icon}
                size={14}
                color={active ? Colors.textWhite : Colors.textLight}
              />
              <Text style={[styles.filterText, active && styles.filterTextActive]}>
                {f.label}
              </Text>
              {f.value === 'live' && stats.live > 0 && (
                <View style={styles.liveDot} />
              )}
            </TouchableOpacity>
          );
        })}

        {/* Create Meeting Button */}
        {canCreate && (
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => router.push('/meetings/create')}
            activeOpacity={0.7}
          >
            <Ionicons name="add" size={18} color={Colors.textWhite} />
            <Text style={styles.createButtonText}>New</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Meeting List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={contentStyle}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.highlight}
            colors={[Colors.highlight]}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="calendar-outline"
            title="No Meetings Found"
            subtitle={
              search
                ? 'Try a different search term'
                : filter !== 'all'
                ? 'No meetings with this status'
                : 'Schedule your first meeting to get started'
            }
          />
        }
        renderItem={({ item }) => {
          const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.scheduled;
          const meetDate = item.scheduled_start ? new Date(item.scheduled_start) : new Date();
          const isLive = item.status === 'live';

          return (
            <TouchableOpacity
              style={[styles.card, isLive && styles.cardLive]}
              onPress={() => router.push(`/meetings/${item.id}`)}
              activeOpacity={0.7}
            >
              {/* Date column */}
              <View style={[styles.dateCol, { backgroundColor: cfg.bg }]}>
                <Text style={[styles.dateDay, { color: cfg.color }]}>
                  {format(meetDate, 'd')}
                </Text>
                <Text style={[styles.dateMonth, { color: cfg.color }]}>
                  {format(meetDate, 'MMM')}
                </Text>
                {isLive && (
                  <View style={styles.liveIndicator}>
                    <View style={styles.livePulse} />
                  </View>
                )}
              </View>

              {/* Content */}
              <View style={styles.cardContent}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Badge
                    label={cfg.label}
                    variant={
                      item.status === 'live'
                        ? 'success'
                        : item.status === 'scheduled'
                        ? 'info'
                        : item.status === 'cancelled'
                        ? 'danger'
                        : 'neutral'
                    }
                  />
                </View>

                <View style={styles.metaRow}>
                  <Ionicons name="time-outline" size={14} color={Colors.textLight} />
                  <Text style={styles.metaText}>
                    {format(meetDate, 'h:mm a')}
                  </Text>
                </View>

                {item.location && (
                  <View style={styles.metaRow}>
                    <Ionicons name="location-outline" size={14} color={Colors.textLight} />
                    <Text style={styles.metaText} numberOfLines={1}>
                      {item.location}
                    </Text>
                  </View>
                )}

                {item.agenda_items?.length > 0 && (
                  <View style={styles.metaRow}>
                    <Ionicons name="list-outline" size={14} color={Colors.highlight} />
                    <Text style={[styles.metaText, { color: Colors.highlight }]}>
                      {item.agenda_items.length} agenda item{item.agenda_items.length > 1 ? 's' : ''}
                    </Text>
                  </View>
                )}
              </View>

              <Ionicons name="chevron-forward" size={18} color={Colors.textLight} />
            </TouchableOpacity>
          );
        }}
      />

      {/* Create FAB */}
      {canCreate && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push('/meetings/create')}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={28} color={Colors.primary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, overflow: 'hidden' },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
  searchContainer: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    gap: 6,
  },
  filterActive: {
    backgroundColor: Colors.highlight,
  },
  filterText: {
    color: Colors.textLight,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium as any,
  },
  filterTextActive: {
    color: Colors.textWhite,
    fontWeight: FontWeight.semibold as any,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.success,
    gap: 4,
    marginLeft: 'auto',
  },
  createButtonText: {
    color: Colors.textWhite,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold as any,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.success,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    ...Shadow.sm,
    borderLeftWidth: 0,
  },
  cardLive: {
    borderWidth: 1,
    borderColor: Colors.success,
    backgroundColor: Colors.successSubtle,
  },
  dateCol: {
    width: 52,
    height: 56,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  dateDay: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold as any,
  },
  dateMonth: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold as any,
    textTransform: 'uppercase',
    marginTop: -2,
  },
  liveIndicator: {
    position: 'absolute',
    top: -2,
    right: -2,
  },
  livePulse: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.success,
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  cardContent: { flex: 1 },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.xs,
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold as any,
    color: Colors.textWhite,
    flex: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  metaText: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
  },
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    bottom: Spacing.lg,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: Colors.highlight,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.lg,
    ...Platform.select({
      ios: {},
      android: { elevation: 8 },
    }),
  },
});
