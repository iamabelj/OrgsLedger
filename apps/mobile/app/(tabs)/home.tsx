// ============================================================
// OrgsLedger Mobile — Home Dashboard (Royal Design)
// ============================================================

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
  Modal,
  FlatList,
} from 'react-native';
import { showAlert } from '../../src/utils/alert';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { format, isToday, isTomorrow } from 'date-fns';
import { useAuthStore } from '../../src/stores/auth.store';
import { useFinancialStore } from '../../src/stores/financial.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import {
  Card,
  Badge,
  Avatar,
  StatCard,
  SectionHeader,
  Divider,
  EmptyState,
} from '../../src/components/ui';
import { useResponsive } from '../../src/hooks/useResponsive';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function HomeScreen() {
  const user = useAuthStore((s) => s.user);
  const memberships = useAuthStore((s) => s.memberships);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const isLoading = useAuthStore((s) => s.isLoading);
  const setCurrentOrg = useAuthStore((s) => s.setCurrentOrg);
  const summary = useFinancialStore((s) => s.summary);
  const loadLedger = useFinancialStore((s) => s.loadLedger);
  const responsive = useResponsive();

  const [refreshing, setRefreshing] = useState(false);
  const [orgDetails, setOrgDetails] = useState<any>(null);
  const [upcomingMeetings, setUpcomingMeetings] = useState<any[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [showOrgSwitcher, setShowOrgSwitcher] = useState(false);
  const [aiHours, setAiHours] = useState<{ balance: number; used: number; remaining: number } | null>(null);

  const currentMembership = memberships.find((m) => m.organization_id === currentOrgId);
  const userRole = currentMembership?.role || 'member';
  const globalRole = user?.globalRole;
  const isSuperAdmin = globalRole === 'super_admin';
  const isOrgAdmin = isSuperAdmin || userRole === 'org_admin';
  const isExecutive = userRole === 'executive';
  const isAdmin = isOrgAdmin || isExecutive;

  useEffect(() => {
    if (!isLoading && memberships.length === 0 && user) {
      router.replace('/organization');
    }
  }, [isLoading, memberships, user]);

  const loadDashboard = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const [orgRes, meetRes] = await Promise.allSettled([
        api.orgs.get(currentOrgId),
        api.meetings.list(currentOrgId, { status: 'scheduled', limit: 3 }),
      ]);
      
      if (orgRes.status === 'fulfilled') {
        setOrgDetails(orgRes.value.data.data);
      }
      
      if (meetRes.status === 'fulfilled') {
        setUpcomingMeetings((meetRes.value.data.data || []).slice(0, 3));
      }
      
      await loadLedger(currentOrgId).catch(() => {});

      // Try to load notification count
      try {
        const notifRes = await api.notifications.list();
        const unread = (notifRes.data || []).filter((n: any) => !n.read).length;
        setUnreadNotifications(unread);
      } catch (_) {}

      // Load AI hours from wallet
      try {
        const walletRes = await api.subscriptions.getAiWallet(currentOrgId);
        const w = walletRes.data?.data;
        if (w) {
          const balance = parseFloat(w.total_topped_up || '0') / 60;
          const used = parseFloat(w.total_spent || '0') / 60;
          const remaining = parseFloat(w.balance_minutes || '0') / 60;
          setAiHours({ balance, used, remaining });
        }
      } catch (_) {}
    } catch (err) {
      console.error('[Home] loadDashboard error:', err);
      // Silently ignore
    }
  }, [currentOrgId]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDashboard();
    setRefreshing(false);
  };

  const handleOrgSwitch = () => {
    if (memberships.length <= 1) return;
    setShowOrgSwitcher(true);
  };

  const selectOrg = (orgId: string) => {
    setCurrentOrg(orgId);
    setShowOrgSwitcher(false);
    // Reload dashboard for the new org
    loadDashboard();
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  const formatMeetingDate = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isToday(date)) return `Today, ${format(date, 'h:mm a')}`;
    if (isTomorrow(date)) return `Tomorrow, ${format(date, 'h:mm a')}`;
    return format(date, 'MMM dd, h:mm a');
  };

  return (
    <>
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.highlight} />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* Header Section */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.greeting}>{getGreeting()},</Text>
          <Text style={styles.userName}>{user?.firstName || 'User'}</Text>
          {orgDetails && (
            <TouchableOpacity onPress={handleOrgSwitch} style={styles.orgRow}>
              <Ionicons name="business" size={14} color={Colors.highlight} />
              <Text style={styles.orgName}>
                {orgDetails.name}
                {memberships.length > 1 && ' ▾'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.notifBtn}
            onPress={() => router.push('/notifications')}
          >
            <Ionicons name="notifications-outline" size={24} color={Colors.textPrimary} />
            {unreadNotifications > 0 && (
              <View style={styles.notifBadge}>
                <Text style={styles.notifBadgeText}>
                  {unreadNotifications > 9 ? '9+' : unreadNotifications}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <Avatar name={user?.firstName + ' ' + (user?.lastName || '')} size={44} />
        </View>
      </View>

      {/* Role Badge */}
      {currentMembership && (
        <View style={styles.roleBadgeRow}>
          <Badge
            label={
              isOrgAdmin ? 'Super Admin' :
              isExecutive ? 'Executive' :
              userRole.replace('_', ' ')
            }
            variant={isOrgAdmin ? 'danger' : isExecutive ? 'info' : 'neutral'}
            size="md"
          />
        </View>
      )}

      {/* Financial Summary Card */}
      <View style={styles.section}>
        <Card variant="gold" style={styles.finCard}>
          <View style={styles.finCardHeader}>
            <Text style={styles.finCardTitle}>Financial Overview</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/financials')}>
              <Text style={styles.viewAllText}>View All</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.finCardGrid}>
            <View style={styles.finCardItem}>
              <Ionicons name="trending-up" size={20} color={Colors.success} />
              <Text style={styles.finCardValue}>
                ${summary ? summary.totalIncome.toFixed(0) : '0'}
              </Text>
              <Text style={styles.finCardLabel}>Total Income</Text>
            </View>
            <View style={styles.finCardDivider} />
            <View style={styles.finCardItem}>
              <Ionicons name="cash" size={20} color={Colors.highlight} />
              <Text style={styles.finCardValue}>
                ${summary ? summary.netBalance.toFixed(0) : '0'}
              </Text>
              <Text style={styles.finCardLabel}>Balance</Text>
            </View>
            <View style={styles.finCardDivider} />
            <View style={styles.finCardItem}>
              <Ionicons name="time" size={20} color={Colors.warning} />
              <Text style={styles.finCardValue}>
                ${summary ? summary.pendingAmount.toFixed(0) : '0'}
              </Text>
              <Text style={styles.finCardLabel}>Pending</Text>
            </View>
          </View>
        </Card>
      </View>

      {/* AI Hours Card */}
      {aiHours && (
        <View style={styles.section}>
          <Card variant="elevated" style={styles.aiCard}>
            <View style={styles.finCardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="sparkles" size={18} color={Colors.highlight} />
                <Text style={styles.finCardTitle}>AI Hours</Text>
              </View>
              {isAdmin && (
                <TouchableOpacity onPress={() => router.push('/admin/plans')}>
                  <Text style={styles.viewAllText}>Manage</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.finCardGrid}>
              <View style={styles.finCardItem}>
                <Ionicons name="time" size={20} color={Colors.success} />
                <Text style={styles.finCardValue}>
                  {aiHours.remaining.toFixed(1)}h
                </Text>
                <Text style={styles.finCardLabel}>Remaining</Text>
              </View>
              <View style={styles.finCardDivider} />
              <View style={styles.finCardItem}>
                <Ionicons name="play-circle" size={20} color={Colors.info} />
                <Text style={styles.finCardValue}>
                  {aiHours.used.toFixed(1)}h
                </Text>
                <Text style={styles.finCardLabel}>Used</Text>
              </View>
              <View style={styles.finCardDivider} />
              <View style={styles.finCardItem}>
                <Ionicons name="server" size={20} color={Colors.highlight} />
                <Text style={styles.finCardValue}>
                  {aiHours.balance.toFixed(1)}h
                </Text>
                <Text style={styles.finCardLabel}>Total</Text>
              </View>
            </View>
            {/* Usage bar */}
            <View style={styles.aiBarContainer}>
              <View style={styles.aiBarTrack}>
                <View
                  style={[
                    styles.aiBarFill,
                    {
                      width: aiHours.balance > 0
                        ? `${Math.min((aiHours.used / aiHours.balance) * 100, 100)}%`
                        : '0%',
                      backgroundColor: aiHours.remaining < 0.5 ? Colors.error : Colors.highlight,
                    },
                  ]}
                />
              </View>
            </View>
          </Card>
        </View>
      )}

      {/* Quick Actions */}
      <View style={styles.section}>
        <SectionHeader title="Quick Actions" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.quickActionsRow}
        >
          <QuickActionCard
            icon="chatbubbles"
            label="Chat"
            color={Colors.info}
            onPress={() => router.push('/(tabs)/chat')}
          />
          <QuickActionCard
            icon="calendar"
            label="Meetings"
            color={Colors.success}
            onPress={() => router.push('/(tabs)/meetings')}
          />
          <QuickActionCard
            icon="receipt"
            label="My Dues"
            color={Colors.warning}
            onPress={() => router.push('/(tabs)/financials')}
          />
          <QuickActionCard
            icon="heart"
            label="Donate"
            color={Colors.error}
            onPress={() => router.push('/(tabs)/financials')}
          />
          <QuickActionCard
            icon="time"
            label="History"
            color={Colors.textSecondary}
            onPress={() => router.push('/financials/history')}
          />
        </ScrollView>
      </View>

      {/* Admin Section — Super Admin (org_admin) gets full control */}
      {isOrgAdmin && (
        <View style={styles.section}>
          <SectionHeader title="Super Admin" />
          <View style={styles.adminGrid}>
            <AdminActionCard
              icon="people"
              label="Members"
              color={Colors.info}
              onPress={() => router.push('/admin/members')}
            />
            <AdminActionCard
              icon="receipt"
              label="Create Due"
              color={Colors.highlight}
              onPress={() => router.push('/admin/create-due')}
            />
            <AdminActionCard
              icon="warning"
              label="Issue Fine"
              color={Colors.error}
              onPress={() => router.push('/admin/create-fine')}
            />
            <AdminActionCard
              icon="megaphone"
              label="Campaign"
              color={Colors.success}
              onPress={() => router.push('/admin/create-campaign')}
            />
            <AdminActionCard
              icon="receipt-outline"
              label="Expenses"
              color={Colors.error}
              onPress={() => router.push('/admin/expenses')}
            />
            <AdminActionCard
              icon="people-circle"
              label="Committees"
              color={Colors.warning}
              onPress={() => router.push('/admin/committees')}
            />
            <AdminActionCard
              icon="bar-chart"
              label="Reports"
              color={Colors.highlight}
              onPress={() => router.push('/admin/reports')}
            />
            <AdminActionCard
              icon="sparkles"
              label="AI Plans"
              color={Colors.highlight}
              onPress={() => router.push('/admin/plans')}
            />
            <AdminActionCard
              icon="settings"
              label="Settings"
              color={Colors.textSecondary}
              onPress={() => router.push('/admin/settings')}
            />
            <AdminActionCard
              icon="megaphone-outline"
              label="Announce"
              color="#F59E0B"
              onPress={() => router.push('/announcements')}
            />
            <AdminActionCard
              icon="calendar"
              label="Events"
              color="#3B82F6"
              onPress={() => router.push('/events')}
            />
            <AdminActionCard
              icon="bar-chart-outline"
              label="Polls"
              color="#8B5CF6"
              onPress={() => router.push('/polls')}
            />
            <AdminActionCard
              icon="folder-open"
              label="Documents"
              color="#10B981"
              onPress={() => router.push('/documents')}
            />
            <AdminActionCard
              icon="analytics"
              label="Analytics"
              color="#EC4899"
              onPress={() => router.push('/admin/analytics')}
            />
            <AdminActionCard
              icon="swap-horizontal"
              label="Transfers"
              color="#0EA5E9"
              onPress={() => router.push('/admin/bank-transfers')}
            />
            <AdminActionCard
              icon="card"
              label="Pay Config"
              color="#6366F1"
              onPress={() => router.push('/admin/payment-methods')}
            />
          </View>
        </View>
      )}

      {/* Executive Section — limited admin features */}
      {isExecutive && !isOrgAdmin && (
        <View style={styles.section}>
          <SectionHeader title="Executive Dashboard" />
          <View style={styles.adminGrid}>
            <AdminActionCard
              icon="people"
              label="Members"
              color={Colors.info}
              onPress={() => router.push('/admin/members')}
            />
            <AdminActionCard
              icon="receipt"
              label="Create Due"
              color={Colors.highlight}
              onPress={() => router.push('/admin/create-due')}
            />
            <AdminActionCard
              icon="megaphone"
              label="Campaign"
              color={Colors.success}
              onPress={() => router.push('/admin/create-campaign')}
            />
            <AdminActionCard
              icon="receipt-outline"
              label="Expenses"
              color={Colors.error}
              onPress={() => router.push('/admin/expenses')}
            />
            <AdminActionCard
              icon="people-circle"
              label="Committees"
              color={Colors.warning}
              onPress={() => router.push('/admin/committees')}
            />
            <AdminActionCard
              icon="bar-chart"
              label="Reports"
              color={Colors.highlight}
              onPress={() => router.push('/admin/reports')}
            />
            <AdminActionCard
              icon="megaphone-outline"
              label="Announce"
              color="#F59E0B"
              onPress={() => router.push('/announcements')}
            />
            <AdminActionCard
              icon="calendar"
              label="Events"
              color="#3B82F6"
              onPress={() => router.push('/events')}
            />
            <AdminActionCard
              icon="bar-chart-outline"
              label="Polls"
              color="#8B5CF6"
              onPress={() => router.push('/polls')}
            />
            <AdminActionCard
              icon="folder-open"
              label="Documents"
              color="#10B981"
              onPress={() => router.push('/documents')}
            />
          </View>
        </View>
      )}

      {/* Quick Access for all members */}
      <View style={styles.section}>
        <SectionHeader title="Quick Access" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickRow}>
          <QuickActionCard icon="megaphone-outline" label="Announcements" color="#F59E0B" onPress={() => router.push('/announcements')} />
          <QuickActionCard icon="calendar-outline" label="Events" color="#3B82F6" onPress={() => router.push('/events')} />
          <QuickActionCard icon="bar-chart-outline" label="Polls" color="#8B5CF6" onPress={() => router.push('/polls')} />
          <QuickActionCard icon="folder-open-outline" label="Documents" color="#10B981" onPress={() => router.push('/documents')} />
          <QuickActionCard icon="people-outline" label="Members" color={Colors.info} onPress={() => router.push('/members')} />
        </ScrollView>
      </View>

      {/* Upcoming Meetings */}
      <View style={styles.section}>
        <SectionHeader
          title="Upcoming Meetings"
          actionLabel="See All"
          onAction={() => router.push('/(tabs)/meetings')}
        />
        {upcomingMeetings.length === 0 ? (
          <Card variant="elevated" style={styles.emptyMeetingCard}>
            <Ionicons name="calendar-outline" size={32} color={Colors.textLight} />
            <Text style={styles.emptyMeetingText}>No upcoming meetings</Text>
            {isAdmin && (
              <TouchableOpacity
                style={styles.scheduleMeetingBtn}
                onPress={() => router.push('/meetings/create')}
              >
                <Text style={styles.scheduleMeetingText}>Schedule One</Text>
              </TouchableOpacity>
            )}
          </Card>
        ) : (
          upcomingMeetings.map((m: any, idx: number) => (
            <TouchableOpacity
              key={m.id}
              style={styles.meetingItem}
              onPress={() => router.push(`/meetings/${m.id}`)}
              activeOpacity={0.7}
            >
              <View style={styles.meetingDateCol}>
                <Text style={styles.meetingDay}>
                  {format(new Date(m.scheduled_start), 'dd')}
                </Text>
                <Text style={styles.meetingMonth}>
                  {format(new Date(m.scheduled_start), 'MMM')}
                </Text>
              </View>
              <View style={styles.meetingInfo}>
                <Text style={styles.meetingTitle}>{m.title}</Text>
                <View style={styles.meetingTimeRow}>
                  <Ionicons name="time-outline" size={13} color={Colors.textLight} />
                  <Text style={styles.meetingTime}>
                    {formatMeetingDate(m.scheduled_start)}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textLight} />
            </TouchableOpacity>
          ))
        )}
      </View>

      <View style={{ height: Spacing.xxl }} />
    </ScrollView>

    {/* Org Switcher Modal */}
    <Modal visible={showOrgSwitcher} animationType="fade" transparent>
      <TouchableOpacity
        style={styles.orgModalOverlay}
        activeOpacity={1}
        onPress={() => setShowOrgSwitcher(false)}
      >
        <View style={styles.orgModalContent}>
          <Text style={styles.orgModalTitle}>Switch Organization</Text>
          {memberships.map((m) => {
            const isActive = m.organization_id === currentOrgId;
            return (
              <TouchableOpacity
                key={m.organization_id}
                style={[styles.orgOption, isActive && styles.orgOptionActive]}
                onPress={() => selectOrg(m.organization_id)}
              >
                <View style={styles.orgOptionIcon}>
                  <Ionicons
                    name="shield-checkmark"
                    size={24}
                    color={isActive ? Colors.highlight : Colors.textLight}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.orgOptionName, isActive && { color: Colors.highlight }]}>
                    {m.organizationName || m.organization_id}
                  </Text>
                  <Text style={styles.orgOptionRole}>{m.role?.replace('_', ' ')}</Text>
                </View>
                {isActive && (
                  <Ionicons name="checkmark-circle" size={22} color={Colors.highlight} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </TouchableOpacity>
    </Modal>
    </>
  );
}

/** Quick Action Card (horizontal scroll) */
function QuickActionCard({
  icon,
  label,
  color,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.quickCard} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.quickIcon, { backgroundColor: color + '20' }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={styles.quickLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Admin Action Card (grid) */
function AdminActionCard({
  icon,
  label,
  color,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.adminCard} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.adminIcon, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.adminLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  section: { paddingHorizontal: Spacing.md, marginBottom: Spacing.lg },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  headerLeft: { flex: 1 },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  greeting: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },
  userName: {
    fontSize: FontSize.header,
    fontWeight: FontWeight.extrabold,
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  orgRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  orgName: {
    fontSize: FontSize.sm,
    color: Colors.highlight,
    fontWeight: FontWeight.semibold,
  },
  notifBtn: {
    position: 'relative',
    padding: 4,
  },
  notifBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: Colors.error,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: Colors.background,
  },
  notifBadgeText: {
    fontSize: 10,
    fontWeight: FontWeight.bold,
    color: Colors.textWhite,
  },
  roleBadgeRow: {
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.md,
  },

  // Financial Card
  finCard: {
    paddingVertical: Spacing.lg,
  },
  finCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  finCardTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  viewAllText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.highlight,
  },
  finCardGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  finCardItem: {
    alignItems: 'center',
    gap: 4,
  },
  finCardValue: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.extrabold,
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  finCardLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  finCardDivider: {
    width: 1,
    height: 40,
    backgroundColor: Colors.borderLight,
  },

  // AI Hours Card
  aiCard: {
    paddingVertical: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.highlight + '25',
  },
  aiBarContainer: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xs,
  },
  aiBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.borderLight,
    overflow: 'hidden' as const,
  },
  aiBarFill: {
    height: '100%',
    borderRadius: 3,
  },

  // Quick Actions
  quickActionsRow: {
    paddingRight: Spacing.md,
    gap: Spacing.sm,
  },
  quickRow: {
    paddingRight: Spacing.md,
    gap: Spacing.sm,
  },
  quickCard: {
    alignItems: 'center',
    width: 76,
    gap: 6,
  },
  quickIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: {
    fontSize: 11,
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
    textAlign: 'center',
  },

  // Admin Grid
  adminGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  adminCard: {
    width: (SCREEN_WIDTH - Spacing.md * 2 - Spacing.sm * 3) / 4,
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing.sm,
  },
  adminIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminLabel: {
    fontSize: 11,
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
    textAlign: 'center',
  },

  // Meetings
  emptyMeetingCard: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.sm,
  },
  emptyMeetingText: {
    fontSize: FontSize.md,
    color: Colors.textLight,
  },
  scheduleMeetingBtn: {
    marginTop: Spacing.xs,
  },
  scheduleMeetingText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.highlight,
  },
  meetingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: Spacing.sm,
  },
  meetingDateCol: {
    width: 44,
    height: 50,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meetingDay: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.highlight,
    lineHeight: 24,
  },
  meetingMonth: {
    fontSize: 10,
    fontWeight: FontWeight.semibold,
    color: Colors.highlight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  meetingInfo: {
    flex: 1,
  },
  meetingTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
  },
  meetingTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  meetingTime: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
  },
  // Org Switcher Modal
  orgModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  orgModalContent: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    width: '100%',
    maxWidth: 400,
  },
  orgModalTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold as any,
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
  },
  orgOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.xs,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  orgOptionActive: {
    backgroundColor: Colors.highlight + '10',
    borderColor: Colors.highlight + '30',
  },
  orgOptionIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgOptionName: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold as any,
    color: Colors.textPrimary,
  },
  orgOptionRole: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    textTransform: 'capitalize',
    marginTop: 1,
  },
});
