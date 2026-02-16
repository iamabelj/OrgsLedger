// ============================================================
// OrgsLedger Mobile — Notifications Screen
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import { formatDistanceToNow } from 'date-fns';
import { useAuthStore } from '../src/stores/auth.store';
import { api } from '../src/api/client';
import { showAlert } from '../src/utils/alert';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../src/theme';
import {
  Card,
  Button,
  Badge,
  EmptyState,
  SectionHeader,
  ScreenWrapper,
  LoadingScreen,
  useContentStyle,
} from '../src/components/ui';

type NotificationType =
  | 'due_created'
  | 'due_reminder'
  | 'fine_issued'
  | 'payment_received'
  | 'payment_confirmed'
  | 'meeting_scheduled'
  | 'meeting_reminder'
  | 'campaign_created'
  | 'campaign_goal_reached'
  | 'member_joined'
  | 'member_removed'
  | 'role_changed'
  | 'announcement'
  | 'chat_mention'
  | 'general';

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  data?: Record<string, any>;
}

const NOTIFICATION_CONFIG: Record<NotificationType, { icon: string; color: string }> = {
  due_created: { icon: 'receipt', color: Colors.highlight },
  due_reminder: { icon: 'alarm', color: Colors.warning },
  fine_issued: { icon: 'warning', color: Colors.error },
  payment_received: { icon: 'checkmark-circle', color: Colors.success },
  payment_confirmed: { icon: 'shield-checkmark', color: Colors.success },
  meeting_scheduled: { icon: 'calendar', color: Colors.info },
  meeting_reminder: { icon: 'notifications', color: Colors.info },
  campaign_created: { icon: 'megaphone', color: Colors.highlight },
  campaign_goal_reached: { icon: 'trophy', color: Colors.highlight },
  member_joined: { icon: 'person-add', color: Colors.success },
  member_removed: { icon: 'person-remove', color: Colors.error },
  role_changed: { icon: 'shield', color: Colors.warning },
  announcement: { icon: 'megaphone', color: Colors.highlight },
  chat_mention: { icon: 'chatbubble', color: Colors.info },
  general: { icon: 'notifications', color: Colors.textSecondary },
};

type FilterTab = 'all' | 'unread' | 'financial' | 'meetings' | 'members';

const FILTER_TABS: { key: FilterTab; label: string; icon: string }[] = [
  { key: 'all', label: 'All', icon: 'apps-outline' },
  { key: 'unread', label: 'Unread', icon: 'mail-unread-outline' },
  { key: 'financial', label: 'Financial', icon: 'cash-outline' },
  { key: 'meetings', label: 'Meetings', icon: 'calendar-outline' },
  { key: 'members', label: 'Members', icon: 'people-outline' },
];

const FINANCIAL_TYPES: NotificationType[] = [
  'due_created', 'due_reminder', 'fine_issued', 'payment_received',
  'payment_confirmed', 'campaign_created', 'campaign_goal_reached',
];
const MEETING_TYPES: NotificationType[] = ['meeting_scheduled', 'meeting_reminder'];
const MEMBER_TYPES: NotificationType[] = ['member_joined', 'member_removed', 'role_changed'];

export default function NotificationsScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const contentStyle = useContentStyle();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadNotifications();
  }, []);

  const loadNotifications = async () => {
    if (!currentOrgId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.notifications.list();
      setNotifications(res.data || []);
    } catch (err) {
      setError('Failed to load notifications');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await api.notifications.list();
      setNotifications(res.data || []);
    } catch (err) {
      setError('Failed to refresh notifications');
    } finally {
      setRefreshing(false);
    }
  }, [currentOrgId]);

  const markAsRead = async (notificationId: string) => {
    try {
      await api.notifications.markRead(notificationId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
    } catch (err) {
      showAlert('Error', 'Failed to mark notification as read');
    }
  };

  const markAllRead = async () => {
    try {
      await api.notifications.markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (err) {
      showAlert('Error', 'Failed to mark all as read');
    }
  };

  const filteredNotifications = notifications.filter((n) => {
    switch (activeFilter) {
      case 'unread':
        return !n.read;
      case 'financial':
        return FINANCIAL_TYPES.includes(n.type);
      case 'meetings':
        return MEETING_TYPES.includes(n.type);
      case 'members':
        return MEMBER_TYPES.includes(n.type);
      default:
        return true;
    }
  });

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleNotificationPress = (notification: Notification) => {
    if (!notification.read) {
      markAsRead(notification.id);
    }

    // Navigate based on type
    const data = notification.data;
    switch (notification.type) {
      case 'meeting_scheduled':
      case 'meeting_reminder':
        if (data?.meetingId) router.push(`/meetings/${data.meetingId}`);
        break;
      case 'chat_mention':
        if (data?.channelId) router.push(`/chat/${data.channelId}`);
        break;
      case 'due_created':
      case 'due_reminder':
      case 'fine_issued':
      case 'payment_received':
      case 'payment_confirmed':
        router.push('/(tabs)/financials');
        break;
      case 'campaign_created':
      case 'campaign_goal_reached':
        if (data?.campaignId) router.push(`/financials/donate/${data.campaignId}`);
        break;
      default:
        break;
    }
  };

  const renderNotificationItem = ({ item }: { item: Notification }) => {
    const config = NOTIFICATION_CONFIG[item.type] || NOTIFICATION_CONFIG.general;
    const timeAgo = formatDistanceToNow(new Date(item.createdAt), { addSuffix: true });

    return (
      <TouchableOpacity
        style={[styles.notifItem, !item.read && styles.notifItemUnread]}
        onPress={() => handleNotificationPress(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.notifIcon, { backgroundColor: config.color + '20' }]}>
          <Ionicons name={config.icon as any} size={20} color={config.color} />
        </View>

        <View style={styles.notifContent}>
          <View style={styles.notifHeader}>
            <Text style={[styles.notifTitle, !item.read && styles.notifTitleUnread]} numberOfLines={1}>
              {item.title}
            </Text>
            {!item.read && <View style={styles.unreadDot} />}
          </View>
          <Text style={styles.notifMessage} numberOfLines={2}>
            {item.message}
          </Text>
          <Text style={styles.notifTime}>{timeAgo}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderHeader = () => (
    <View>
      {/* Summary */}
      <View style={styles.summaryRow}>
        <Card variant="elevated" style={styles.summaryCard}>
          <View style={[styles.summaryIcon, { backgroundColor: Colors.highlightSubtle }]}>
            <Ionicons name="notifications" size={20} color={Colors.highlight} />
          </View>
          <Text style={styles.summaryNumber}>{notifications.length}</Text>
          <Text style={styles.summaryLabel}>Total</Text>
        </Card>
        <Card variant="elevated" style={styles.summaryCard}>
          <View style={[styles.summaryIcon, { backgroundColor: Colors.errorSubtle }]}>
            <Ionicons name="mail-unread" size={20} color={Colors.error} />
          </View>
          <Text style={styles.summaryNumber}>{unreadCount}</Text>
          <Text style={styles.summaryLabel}>Unread</Text>
        </Card>
      </View>

      {/* Mark All Read */}
      {unreadCount > 0 && (
        <TouchableOpacity style={styles.markAllBtn} onPress={markAllRead}>
          <Ionicons name="checkmark-done" size={18} color={Colors.highlight} />
          <Text style={styles.markAllText}>Mark all as read</Text>
        </TouchableOpacity>
      )}

      {/* Filter Tabs */}
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={FILTER_TABS}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.filterRow}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.filterChip, activeFilter === item.key && styles.filterChipActive]}
            onPress={() => setActiveFilter(item.key)}
          >
            <Ionicons
              name={item.icon as any}
              size={16}
              color={activeFilter === item.key ? Colors.primary : Colors.textSecondary}
            />
            <Text
              style={[
                styles.filterText,
                activeFilter === item.key && styles.filterTextActive,
              ]}
            >
              {item.label}
            </Text>
            {item.key === 'unread' && unreadCount > 0 && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
      />
    </View>
  );

  if (loading) return <LoadingScreen />;

  if (error) return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Notifications' }} />
      <EmptyState
        icon="alert-circle-outline"
        title="Something went wrong"
        subtitle={error}
        actionLabel="Retry"
        onAction={loadNotifications}
      />
    </View>
  );

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Notifications',
          headerRight: () =>
            unreadCount > 0 ? (
              <TouchableOpacity onPress={markAllRead} style={{ marginRight: Spacing.sm }}>
                <Ionicons name="checkmark-done" size={22} color={Colors.highlight} />
              </TouchableOpacity>
            ) : null,
        }}
      />

      <FlatList
        data={filteredNotifications}
        keyExtractor={(item) => item.id}
        renderItem={renderNotificationItem}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={[styles.listContent, contentStyle]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.highlight}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="notifications-off-outline"
            title={activeFilter === 'unread' ? 'All Caught Up!' : 'No Notifications'}
            subtitle={
              activeFilter === 'unread'
                ? "You've read all your notifications"
                : 'Notifications will appear here when there is activity'
            }
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  listContent: { paddingBottom: Spacing.xxl },

  summaryRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
  summaryCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
    gap: Spacing.xs,
  },
  summaryIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryNumber: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  summaryLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  markAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    alignSelf: 'flex-end',
  },
  markAllText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.highlight,
  },

  filterRow: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  filterChipActive: {
    backgroundColor: Colors.highlight,
    borderColor: Colors.highlight,
  },
  filterText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
  },
  filterTextActive: {
    color: Colors.primary,
    fontWeight: FontWeight.semibold,
  },
  filterBadge: {
    backgroundColor: Colors.error,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  filterBadgeText: {
    fontSize: 10,
    fontWeight: FontWeight.bold,
    color: Colors.textWhite,
  },

  notifItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  notifItemUnread: {
    backgroundColor: Colors.highlightSubtle,
  },
  notifIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  notifContent: {
    flex: 1,
  },
  notifHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  notifTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
    color: Colors.textPrimary,
    flex: 1,
  },
  notifTitleUnread: {
    fontWeight: FontWeight.bold,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.highlight,
  },
  notifMessage: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 18,
  },
  notifTime: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    marginTop: 4,
  },
});
