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
  Modal,
  FlatList,
  useWindowDimensions,
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
  ResponsiveScrollView,
} from '../../src/components/ui';
import { useResponsive } from '../../src/hooks/useResponsive';
import { useOrgCurrency } from '../../src/hooks/useOrgCurrency';
import { formatCurrencyWhole } from '../../src/utils/currency';

export default function HomeScreen() {
  const user = useAuthStore((s) => s.user);
  const memberships = useAuthStore((s) => s.memberships);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const isLoading = useAuthStore((s) => s.isLoading);
  const setCurrentOrg = useAuthStore((s) => s.setCurrentOrg);
  const summary = useFinancialStore((s) => s.summary);
  const loadLedger = useFinancialStore((s) => s.loadLedger);
  const responsive = useResponsive();
  const orgCurrency = useOrgCurrency();

  const [refreshing, setRefreshing] = useState(false);
  const [orgDetails, setOrgDetails] = useState<any>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [showOrgSwitcher, setShowOrgSwitcher] = useState(false);
  const [bundleHours, setBundleHours] = useState<{ balance: number; used: number; remaining: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Enhanced dashboard data
  const [memberCount, setMemberCount] = useState(0);
  const [pendingTransfers, setPendingTransfers] = useState(0);
  const [recentAnnouncements, setRecentAnnouncements] = useState<any[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<any[]>([]);
  const [activeCampaigns, setActiveCampaigns] = useState<any[]>([]);
  const [pendingDues, setPendingDues] = useState(0);
  const [pendingFines, setPendingFines] = useState(0);
  const [activePolls, setActivePolls] = useState<any[]>([]);

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
      setError(null);
      const [orgRes, annRes, eventRes, campaignRes, duesRes, finesRes, pollsRes, walletsRes] = await Promise.allSettled([
        api.orgs.get(currentOrgId),
        api.announcements.list(currentOrgId, { limit: 3 }),
        api.events.list(currentOrgId, { limit: 3 }),
        api.financials.getCampaigns(currentOrgId),
        api.financials.getDues(currentOrgId),
        api.financials.getFines(currentOrgId),
        api.polls.list(currentOrgId, { limit: 5 }),
        api.subscriptions.getWallets(currentOrgId),
      ]);
      
      if (orgRes.status === 'fulfilled') {
        setOrgDetails(orgRes.value.data.data);
      }
      
      if (annRes.status === 'fulfilled') {
        setRecentAnnouncements((annRes.value.data.data || []).slice(0, 3));
      }

      if (eventRes.status === 'fulfilled') {
        setUpcomingEvents((eventRes.value.data.data || []).slice(0, 3));
      }

      if (campaignRes.status === 'fulfilled') {
        const campaigns = campaignRes.value.data.data || [];
        setActiveCampaigns(campaigns.filter((c: any) => c.status === 'active').slice(0, 3));
      }

      if (duesRes.status === 'fulfilled') {
        const dues = duesRes.value.data.data || [];
        const pending = dues.filter((d: any) => d.status === 'pending' || d.status === 'partial');
        setPendingDues(pending.length);
      }

      if (finesRes.status === 'fulfilled') {
        const fines = finesRes.value.data.data || [];
        const pending = fines.filter((f: any) => f.status === 'pending' || f.status === 'unpaid');
        setPendingFines(pending.length);
      }

      if (pollsRes.status === 'fulfilled') {
        const polls = pollsRes.value.data.data || [];
        setActivePolls(polls.filter((p: any) => p.status === 'active' || !p.closed_at).slice(0, 3));
      }

      await loadLedger(currentOrgId).catch(() => {});

      // Try to load notification count
      try {
        const notifRes = await api.notifications.list();
        const unread = (notifRes.data || []).filter((n: any) => !n.read).length;
        setUnreadNotifications(unread);
      } catch (_) {}

      // Load members count
      try {
        const memberRes = await api.orgs.listMembers(currentOrgId, { limit: 1 });
        setMemberCount(memberRes.data?.meta?.total || memberRes.data?.data?.length || 0);
      } catch (_) {}

      // Load pending bank transfers (admins only)
      if (isAdmin) {
        try {
          const transferRes = await api.payments.getPendingTransfers(currentOrgId);
          const transfers = transferRes.data?.data || [];
          setPendingTransfers(transfers.length);
        } catch (_) {}
      }

      if (walletsRes.status === 'fulfilled') {
        const walletData = walletsRes.value.data?.data;
        const bundleWallet = walletData?.ai || walletData?.translation;
        if (bundleWallet) {
          const balance = parseFloat(bundleWallet.total_topped_up || '0') / 60;
          const used = parseFloat(bundleWallet.total_spent || '0') / 60;
          const remaining = parseFloat(bundleWallet.balance_minutes || '0') / 60;
          setBundleHours({ balance, used, remaining });
        } else {
          setBundleHours(null);
        }
      }
    } catch (err) {
      setError('Failed to load dashboard');
    }
  }, [currentOrgId, isAdmin]);

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
    // useEffect on loadDashboard will re-trigger when currentOrgId changes
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  return (
    <>
    <ResponsiveScrollView
      style={styles.container}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {/* Hero Header */}
      <View style={styles.heroSection}>
        <View style={styles.heroTop}>
          <View style={styles.headerLeft}>
            <Text style={styles.greeting}>{getGreeting()},</Text>
            <Text style={styles.userName}>{user?.firstName || 'User'}</Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.notifBtn}
              onPress={() => router.push('/(tabs)/profile')}
            >
              <Ionicons name="settings-outline" size={22} color={Colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.notifBtn}
              onPress={() => router.push('/notifications')}
            >
              <Ionicons name="notifications-outline" size={22} color={Colors.textPrimary} />
              {unreadNotifications > 0 && (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeText}>
                    {unreadNotifications > 9 ? '9+' : unreadNotifications}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>
        {orgDetails && (
          <TouchableOpacity onPress={handleOrgSwitch} style={styles.orgPill} activeOpacity={0.7}>
            <View style={styles.orgPillIcon}>
              <Ionicons name="shield-checkmark" size={14} color={Colors.highlight} />
            </View>
            <Text style={styles.orgName} numberOfLines={1}>
              {orgDetails.name}
            </Text>
            {currentMembership && (
              <View style={styles.rolePill}>
                <Text style={styles.rolePillText}>
                  {isOrgAdmin ? 'Admin' : isExecutive ? 'Executive' : userRole.replace(/_/g, ' ')}
                </Text>
              </View>
            )}
            {memberships.length > 1 && (
              <Ionicons name="chevron-down" size={14} color={Colors.textLight} style={{ marginLeft: 2 }} />
            )}
          </TouchableOpacity>
        )}
      </View>

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
                {formatCurrencyWhole(summary ? summary.totalIncome : 0, orgCurrency)}
              </Text>
              <Text style={styles.finCardLabel}>Total Income</Text>
            </View>
            <View style={styles.finCardDivider} />
            <View style={styles.finCardItem}>
              <Ionicons name="cash" size={20} color={Colors.highlight} />
              <Text style={styles.finCardValue}>
                {formatCurrencyWhole(summary ? summary.netBalance : 0, orgCurrency)}
              </Text>
              <Text style={styles.finCardLabel}>Balance</Text>
            </View>
            <View style={styles.finCardDivider} />
            <View style={styles.finCardItem}>
              <Ionicons name="time" size={20} color={Colors.warning} />
              <Text style={styles.finCardValue}>
                {formatCurrencyWhole(summary ? summary.pendingAmount : 0, orgCurrency)}
              </Text>
              <Text style={styles.finCardLabel}>Pending</Text>
            </View>
          </View>
        </Card>
      </View>

      {/* Add-On Bundle Card */}
      {bundleHours && (
        <View style={styles.section}>
          <Card variant="elevated" style={styles.aiCard}>
            <View style={styles.finCardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name={"rocket" as any} size={18} color={Colors.highlight} />
                <Text style={styles.finCardTitle}>Add-On Bundle</Text>
              </View>
              {isAdmin && (
                <TouchableOpacity onPress={() => router.push('/admin/plans')}>
                  <Text style={styles.viewAllText}>Manage</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.bundleSubtitle}>AI + Translation</Text>
            <View style={styles.finCardGrid}>
              <View style={styles.finCardItem}>
                <Ionicons name="time" size={20} color={Colors.success} />
                <Text style={styles.finCardValue}>
                  {bundleHours.remaining.toFixed(1)}h
                </Text>
                <Text style={styles.finCardLabel}>Remaining</Text>
              </View>
              <View style={styles.finCardDivider} />
              <View style={styles.finCardItem}>
                <Ionicons name="play-circle" size={20} color={Colors.info} />
                <Text style={styles.finCardValue}>
                  {bundleHours.used.toFixed(1)}h
                </Text>
                <Text style={styles.finCardLabel}>Used</Text>
              </View>
              <View style={styles.finCardDivider} />
              <View style={styles.finCardItem}>
                <Ionicons name="server" size={20} color={Colors.highlight} />
                <Text style={styles.finCardValue}>
                  {bundleHours.balance.toFixed(1)}h
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
                      width: bundleHours.balance > 0
                        ? `${Math.min((bundleHours.used / bundleHours.balance) * 100, 100)}%`
                        : '0%',
                      backgroundColor: bundleHours.remaining < 0.5 ? Colors.error : Colors.highlight,
                    },
                  ]}
                />
              </View>
            </View>
            <Text style={styles.bundleNote}>
              One shared balance powers AI meeting minutes and real-time translation.
            </Text>
          </Card>
        </View>
      )}

      {/* Quick Actions */}
      <View style={styles.section}>
        <SectionHeader title="Quick Actions" />
        <View style={styles.quickActionsGrid}>
          <QuickActionCard icon="chatbubbles" label="Chat" color={Colors.info} onPress={() => router.push('/(tabs)/chat')} />
          <QuickActionCard icon="videocam" label="Meetings" color={Colors.highlight} onPress={() => router.push('/meetings')} />
          <QuickActionCard icon="receipt" label="My Dues" color={Colors.warning} onPress={() => router.push('/(tabs)/financials')} />
          <QuickActionCard icon="heart" label="Donate" color={Colors.error} onPress={() => router.push('/(tabs)/financials')} />
          <QuickActionCard icon="time" label="History" color={Colors.textSecondary} onPress={() => router.push('/financials/history')} />
          <QuickActionCard icon="people-outline" label="Members" color={Colors.info} onPress={() => router.push('/members')} />
        </View>
      </View>

      {/* Admin Section — org admins get full control */}
      {isOrgAdmin && (
        <View style={styles.section}>
          <SectionHeader title="Administration" />
          <View style={styles.adminGrid}>
            <AdminActionCard
              icon="videocam"
              label="Meetings"
              color="#2563EB"
              onPress={() => router.push('/meetings')}
            />
            <AdminActionCard
              icon="people"
              label="Members"
              color={Colors.info}
              onPress={() => router.push('/admin/members')}
            />
            <AdminActionCard
              icon="link"
              label="Org Invites"
              color="#0EA5E9"
              onPress={() => router.push('/admin/invites')}
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
              icon={"sparkles" as any}
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

      {/* Executive Section — enhanced admin features */}
      {isExecutive && !isOrgAdmin && (
        <View style={styles.section}>
          <SectionHeader title="Executive Dashboard" />
          <View style={styles.adminGrid}>
            <AdminActionCard
              icon="videocam"
              label="Meetings"
              color="#2563EB"
              onPress={() => router.push('/meetings')}
            />
            <AdminActionCard
              icon="people"
              label="Members"
              color={Colors.info}
              onPress={() => router.push('/admin/members')}
            />
            <AdminActionCard
              icon="link"
              label="Org Invites"
              color="#0EA5E9"
              onPress={() => router.push('/admin/invites')}
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
              icon="analytics"
              label="Analytics"
              color="#EC4899"
              onPress={() => router.push('/admin/analytics')}
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
              icon="swap-horizontal"
              label="Transfers"
              color="#0EA5E9"
              onPress={() => router.push('/admin/bank-transfers')}
            />
          </View>
        </View>
      )}

      {/* Org Pulse — Live status counters for admins */}
      {isAdmin && (
        <View style={styles.section}>
          <SectionHeader title="Organization Pulse" />
          <View style={styles.pulseGrid}>
            <TouchableOpacity style={styles.pulseCard} onPress={() => router.push('/admin/members')}>
              <View style={[styles.pulseIcon, { backgroundColor: Colors.info + '18' }]}>
                <Ionicons name="people" size={18} color={Colors.info} />
              </View>
              <Text style={styles.pulseValue}>{memberCount}</Text>
              <Text style={styles.pulseLabel}>Members</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pulseCard} onPress={() => router.push('/(tabs)/financials')}>
              <View style={[styles.pulseIcon, { backgroundColor: Colors.warning + '18' }]}>
                <Ionicons name="receipt" size={18} color={Colors.warning} />
              </View>
              <Text style={styles.pulseValue}>{pendingDues}</Text>
              <Text style={styles.pulseLabel}>Pending Dues</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pulseCard} onPress={() => router.push('/(tabs)/financials')}>
              <View style={[styles.pulseIcon, { backgroundColor: Colors.error + '18' }]}>
                <Ionicons name="warning" size={18} color={Colors.error} />
              </View>
              <Text style={styles.pulseValue}>{pendingFines}</Text>
              <Text style={styles.pulseLabel}>Open Fines</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pulseCard} onPress={() => router.push('/admin/bank-transfers')}>
              <View style={[styles.pulseIcon, { backgroundColor: '#6366F1' + '18' }]}>
                <Ionicons name="swap-horizontal" size={18} color="#6366F1" />
              </View>
              <Text style={styles.pulseValue}>{pendingTransfers}</Text>
              <Text style={styles.pulseLabel}>Transfers</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Quick Access for all members */}
      <View style={styles.section}>
        <SectionHeader title="Quick Access" />
        <View style={styles.quickActionsGrid}>
          <QuickActionCard icon="videocam-outline" label="Meetings" color={Colors.highlight} onPress={() => router.push('/meetings')} />
          <QuickActionCard icon="megaphone-outline" label="Announce" color="#F59E0B" onPress={() => router.push('/announcements')} />
          <QuickActionCard icon="calendar-outline" label="Events" color="#3B82F6" onPress={() => router.push('/events')} />
          <QuickActionCard icon="bar-chart-outline" label="Polls" color="#8B5CF6" onPress={() => router.push('/polls')} />
          <QuickActionCard icon="folder-open-outline" label="Documents" color="#10B981" onPress={() => router.push('/documents')} />
          <QuickActionCard icon="help-circle-outline" label="Help" color={Colors.textSecondary} onPress={() => router.push('/help')} />
          <QuickActionCard icon="shield-checkmark-outline" label="Legal" color="#64748B" onPress={() => router.push('/legal')} />
        </View>
      </View>

      {/* Active Polls — vote now */}
      {activePolls.length > 0 && (
        <View style={styles.section}>
          <SectionHeader
            title="Active Polls"
            actionLabel="All Polls"
            onAction={() => router.push('/polls')}
          />
          {activePolls.map((poll: any) => (
            <TouchableOpacity
              key={poll.id}
              style={styles.activityItem}
              onPress={() => router.push(`/polls/${poll.id}`)}
              activeOpacity={0.7}
            >
              <View style={[styles.activityDot, { backgroundColor: '#8B5CF6' }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.activityTitle} numberOfLines={1}>{poll.question || poll.title}</Text>
                <Text style={styles.activitySub} numberOfLines={1}>
                  {poll.totalVotes || 0} votes {String.fromCodePoint(0x00B7)} {poll.options?.length || 0} options
                </Text>
              </View>
              <View style={styles.voteBadge}>
                <Text style={styles.voteBadgeText}>Vote</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Recent Announcements */}
      {recentAnnouncements.length > 0 && (
        <View style={styles.section}>
          <SectionHeader
            title="Recent Announcements"
            actionLabel="See All"
            onAction={() => router.push('/announcements')}
          />
          {recentAnnouncements.map((ann: any) => (
            <TouchableOpacity
              key={ann.id}
              style={styles.activityItem}
              onPress={() => router.push(`/announcements`)}
              activeOpacity={0.7}
            >
              <View style={[styles.activityDot, { backgroundColor: '#F59E0B' }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.activityTitle} numberOfLines={1}>{ann.title}</Text>
                <Text style={styles.activitySub} numberOfLines={1}>
                  {ann.content?.substring(0, 80) || 'No content'}
                </Text>
              </View>
              {ann.pinned && (
                <Ionicons name="pin" size={14} color={Colors.highlight} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Upcoming Events */}
      {upcomingEvents.length > 0 && (
        <View style={styles.section}>
          <SectionHeader
            title="Upcoming Events"
            actionLabel="See All"
            onAction={() => router.push('/events')}
          />
          {upcomingEvents.map((evt: any) => (
            <TouchableOpacity
              key={evt.id}
              style={styles.listItem}
              onPress={() => router.push(`/events/${evt.id}`)}
              activeOpacity={0.7}
            >
              <View style={[styles.dateCol, { backgroundColor: '#3B82F6' + '18' }]}>
                <Text style={[styles.dateDay, { color: '#3B82F6' }]}>
                  {evt.event_date ? format(new Date(evt.event_date), 'dd') : '--'}
                </Text>
                <Text style={[styles.dateMonth, { color: '#3B82F6' }]}>
                  {evt.event_date ? format(new Date(evt.event_date), 'MMM') : ''}
                </Text>
              </View>
              <View style={styles.listItemInfo}>
                <Text style={styles.listItemTitle} numberOfLines={1}>{evt.title}</Text>
                <View style={styles.listItemSubRow}>
                  <Ionicons name="location-outline" size={13} color={Colors.textLight} />
                  <Text style={styles.listItemSubText} numberOfLines={1}>
                    {evt.location || 'No location set'}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textLight} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Active Campaigns */}
      {activeCampaigns.length > 0 && (
        <View style={styles.section}>
          <SectionHeader title="Active Campaigns" />
          {activeCampaigns.map((c: any) => {
            const goal = parseFloat(c.goal_amount || '0');
            const raised = parseFloat(c.raised_amount || c.total_donated || '0');
            const pct = goal > 0 ? Math.min((raised / goal) * 100, 100) : 0;
            return (
              <Card key={c.id} variant="elevated" style={styles.campaignCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={styles.campaignTitle} numberOfLines={1}>{c.title || c.name}</Text>
                  <Text style={[styles.campaignPct, pct >= 100 ? { color: Colors.success } : {}]}>
                    {pct.toFixed(0)}%
                  </Text>
                </View>
                <View style={styles.aiBarContainer}>
                  <View style={styles.aiBarTrack}>
                    <View
                      style={[styles.aiBarFill, { width: `${pct}%`, backgroundColor: pct >= 100 ? Colors.success : Colors.highlight }]}
                    />
                  </View>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, flexWrap: 'wrap' }}>
                  <Text style={[styles.finCardLabel, { flexShrink: 1 }]}>{formatCurrencyWhole(raised, orgCurrency)} raised</Text>
                  <Text style={[styles.finCardLabel, { flexShrink: 1 }]}>Goal: {formatCurrencyWhole(goal, orgCurrency)}</Text>
                </View>
              </Card>
            );
          })}
        </View>
      )}

      <View style={{ height: Spacing.xxl }} />
    </ResponsiveScrollView>

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
                  <Text style={styles.orgOptionRole}>{m.role?.replace(/_/g, ' ')}</Text>
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

/** Quick Action Card (grid) */
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
      <View style={[styles.quickIcon, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={styles.quickLabel} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Admin Action Card (grid) — responsive width */
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
  const { width: screenW } = useWindowDimensions();
  const cols = screenW >= 1024 ? 6 : screenW >= 768 ? 5 : 4;
  const cardW = (screenW - Spacing.md * 2 - Spacing.sm * (cols - 1)) / cols;
  return (
    <TouchableOpacity style={[styles.adminCard, { width: cardW }]} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.adminIcon, { backgroundColor: color + '15' }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.adminLabel} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  section: { paddingHorizontal: Spacing.md, marginBottom: Spacing.lg },

  // Hero Header
  heroSection: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    marginBottom: Spacing.sm,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: { flex: 1 },
  headerRight: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  greeting: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium as any,
    letterSpacing: 0.3,
  },
  userName: {
    fontSize: FontSize.header,
    fontWeight: FontWeight.extrabold as any,
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  orgPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.sm,
    backgroundColor: Colors.highlightSubtle,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.highlight + '25',
  },
  orgPillIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.highlight + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgName: {
    fontSize: FontSize.xs,
    color: Colors.highlight,
    fontWeight: FontWeight.semibold as any,
    maxWidth: 180,
  },
  rolePill: {
    backgroundColor: Colors.highlight + '15',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: BorderRadius.xs,
  },
  rolePillText: {
    fontSize: 10,
    fontWeight: FontWeight.bold as any,
    color: Colors.highlight,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  notifBtn: {
    position: 'relative' as const,
    padding: 8,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  notifBadge: {
    position: 'absolute' as const,
    top: 2,
    right: 2,
    backgroundColor: Colors.error,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  notifBadgeText: {
    fontSize: 10,
    fontWeight: FontWeight.bold as any,
    color: Colors.textWhite,
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
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  finCardItem: {
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  finCardValue: {
    fontSize: FontSize.lg,
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
  bundleSubtitle: {
    marginTop: -4,
    marginBottom: Spacing.md,
    fontSize: FontSize.sm,
    color: Colors.textLight,
  },
  bundleNote: {
    marginTop: Spacing.md,
    fontSize: FontSize.sm,
    color: Colors.textLight,
    lineHeight: 20,
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

  // Quick Actions (Grid)
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  quickCard: {
    alignItems: 'center',
    flexBasis: 68,
    flexGrow: 1,
    maxWidth: 80,
    gap: 6,
    paddingVertical: Spacing.xs,
  },
  quickIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: {
    fontSize: 11,
    fontWeight: FontWeight.medium as any,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
  },

  // Admin Grid
  adminGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  adminCard: {
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

  // List items (used by events)
  listItem: {
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
  dateCol: {
    width: 44,
    height: 50,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateDay: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.highlight,
    lineHeight: 24,
  },
  dateMonth: {
    fontSize: 10,
    fontWeight: FontWeight.semibold,
    color: Colors.highlight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  listItemInfo: {
    flex: 1,
  },
  listItemTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
  },
  listItemSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  listItemSubText: {
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

  // Org Pulse Grid
  pulseGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  pulseCard: {
    flexBasis: '46%',
    flexGrow: 1,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    alignItems: 'center',
    gap: 6,
  },
  pulseIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseValue: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.extrabold,
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  pulseLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },

  // Platform Card
  platformCard: {
    paddingVertical: Spacing.lg,
    borderWidth: 1,
    borderColor: '#7C3AED' + '25',
  },

  // Activity Items
  activityItem: {
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
  activityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  activityTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
  },
  activitySub: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    marginTop: 2,
  },

  // Vote Badge
  voteBadge: {
    backgroundColor: '#8B5CF6' + '18',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.sm,
  },
  voteBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: '#8B5CF6',
  },

  // Campaign Card
  campaignCard: {
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  campaignTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
    flex: 1,
  },
  campaignPct: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: Colors.highlight,
    marginLeft: Spacing.sm,
  },
});
