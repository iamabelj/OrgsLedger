// ============================================================
// OrgsLedger Mobile — Chat (Channel List) Screen (Royal Design)
// ============================================================

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { useChatStore } from '../../src/stores/chat.store';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { SearchBar, EmptyState, Avatar, Badge } from '../../src/components/ui';

export default function ChatScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const channels = useChatStore((s) => s.channels);
  const loadChannels = useChatStore((s) => s.loadChannels);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');

  useEffect(() => {
    if (currentOrgId) loadChannels(currentOrgId);
  }, [currentOrgId]);

  const onRefresh = async () => {
    if (!currentOrgId) return;
    setRefreshing(true);
    await loadChannels(currentOrgId);
    setRefreshing(false);
  };

  const filtered = channels.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (activeFilter === 'All') return true;
    return c.type.toLowerCase() === activeFilter.toLowerCase();
  });

  const channelIcon = (type: string): React.ComponentProps<typeof Ionicons>['name'] => {
    switch (type) {
      case 'announcement': return 'megaphone';
      case 'direct': return 'person';
      case 'committee': return 'people-circle';
      default: return 'chatbubble-ellipses';
    }
  };

  const channelColor = (type: string): string => {
    switch (type) {
      case 'announcement': return Colors.warning;
      case 'direct': return Colors.info;
      case 'committee': return Colors.success;
      default: return Colors.highlight;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchWrapper}>
        <SearchBar
          placeholder="Search channels..."
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Channel type filters */}
      <View style={styles.filterRow}>
        {['All', 'General', 'Announcement', 'Committee', 'Direct'].map((label) => {
          const isActive = activeFilter === label;
          return (
            <TouchableOpacity
              key={label}
              style={[styles.filterChip, isActive && styles.filterChipActive]}
              onPress={() => setActiveFilter(label)}
            >
              <Text style={[styles.filterText, isActive && styles.filterTextActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.highlight} />
        }
        contentContainerStyle={{ paddingBottom: Spacing.xxl }}
        ListEmptyComponent={
          <EmptyState
            icon="chatbubbles-outline"
            title="No Channels Yet"
            subtitle="Channels will appear here once your organization creates them"
          />
        }
        renderItem={({ item }) => {
          const color = channelColor(item.type);
          return (
            <TouchableOpacity
              style={styles.channelRow}
              onPress={() => {
                useChatStore.getState().setActiveChannel(item.id);
                router.push(`/chat/${item.id}`);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.channelIcon, { backgroundColor: color + '20' }]}>
                <Ionicons name={channelIcon(item.type)} size={20} color={color} />
              </View>
              <View style={styles.channelInfo}>
                <View style={styles.channelNameRow}>
                  <Text style={styles.channelName}>
                    {item.type === 'direct' ? '' : '# '}
                    {item.name}
                  </Text>
                  <Badge label={item.type} variant="default" size="sm" />
                </View>
                {item.description ? (
                  <Text style={styles.channelDesc} numberOfLines={1}>
                    {item.description}
                  </Text>
                ) : null}
              </View>
              {(item.unreadCount || 0) > 0 ? (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadText}>
                    {item.unreadCount > 99 ? '99+' : item.unreadCount}
                  </Text>
                </View>
              ) : (
                <Ionicons name="chevron-forward" size={16} color={Colors.textLight} />
              )}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  searchWrapper: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    gap: Spacing.xs,
  },
  filterChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },
  filterTextActive: {
    color: '#FFF',
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    gap: Spacing.sm,
  },
  channelIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelInfo: {
    flex: 1,
  },
  channelNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  channelName: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
  },
  channelDesc: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
    marginTop: 2,
  },
  unreadBadge: {
    backgroundColor: Colors.highlight,
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    color: '#FFF',
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold as any,
  },
});
