// ============================================================
// OrgsLedger Mobile — Member Detail Screen (Admin)
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { format } from 'date-fns';
import { useAuthStore } from '../../../src/stores/auth.store';
import { api } from '../../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../../src/theme';
import { showAlert } from '../../../src/utils/alert';
import {
  Card,
  Button,
  Avatar,
  Badge,
  SectionHeader,
  Divider,
  StatCard,
  LoadingScreen,
  EmptyState,
  ResponsiveScrollView,
} from '../../../src/components/ui';

interface MemberDetail {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  role: string;
  joinedAt: string;
  avatarUrl?: string;
  committees?: { id: string; name: string }[];
  financials?: {
    totalPaid: number;
    totalOwed: number;
    dues: { id: string; title: string; amount: number; status: string; dueDate: string }[];
    fines: { id: string; reason: string; amount: number; status: string; createdAt: string }[];
    donations: { id: string; campaignTitle: string; amount: number; createdAt: string }[];
  };
}

interface ActivityItem {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  new_value: any;
  ip_address: string;
  created_at: string;
}

type TabKey = 'overview' | 'financial' | 'activity';

export default function MemberDetailScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMemberDetail();
  }, [userId]);

  useEffect(() => {
    if (activeTab === 'activity' && activities.length === 0) {
      loadActivity();
    }
  }, [activeTab]);

  const loadActivity = async () => {
    if (!currentOrgId || !userId) return;
    setActivitiesLoading(true);
    try {
      setError(null);
      const res = await api.orgs.getMemberActivity(currentOrgId, userId);
      setActivities(res.data?.data || []);
    } catch (err) {
      setError('Failed to load member activity');
    } finally {
      setActivitiesLoading(false);
    }
  };

  const getActivityIcon = (action: string): string => {
    switch (action) {
      case 'login': return 'log-in-outline';
      case 'create': return 'add-circle-outline';
      case 'update': return 'pencil-outline';
      case 'delete': return 'trash-outline';
      case 'payment': return 'card-outline';
      case 'role_change': return 'shield-outline';
      default: return 'ellipse-outline';
    }
  };

  const getActivityLabel = (item: ActivityItem): string => {
    const type = item.entity_type?.replace(/_/g, ' ');
    switch (item.action) {
      case 'login': return 'Logged in';
      case 'create': return `Created ${type}`;
      case 'update': return `Updated ${type}`;
      case 'delete': return `Deleted ${type}`;
      case 'payment': return `Made a payment`;
      case 'role_change': return `Role changed`;
      default: return `${item.action} ${type}`;
    }
  };

  const loadMemberDetail = async () => {
    if (!currentOrgId || !userId) return;
    setLoading(true);
    try {
      setError(null);
      const res = await api.orgs.getMember(currentOrgId, userId);
      setMember(res.data);
    } catch (err) {
      setError('Failed to load member details');
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = (newRole: string) => {
    if (!member || !currentOrgId) return;
    showAlert(
      'Change Role',
      `Change ${member.fullName}'s role to ${newRole}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            try {
              await api.orgs.updateMember(currentOrgId, member.id, { role: newRole });
              setMember((prev) => (prev ? { ...prev, role: newRole } : null));
              showAlert('Success', `Role updated to ${newRole}`);
            } catch (err: any) {
              showAlert('Error', err.response?.data?.error || 'Failed to update role');
            }
          },
        },
      ]
    );
  };

  const handleRemoveMember = () => {
    if (!member || !currentOrgId) return;
    showAlert(
      'Remove Member',
      `Remove ${member.fullName} from the organization? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.orgs.removeMember(currentOrgId, member.id);
              showAlert('Removed', `${member.fullName} has been removed`, [
                { text: 'OK', onPress: () => router.back() },
              ]);
            } catch (err: any) {
              showAlert('Error', err.response?.data?.error || 'Failed to remove member');
            }
          },
        },
      ]
    );
  };

  if (loading) return <LoadingScreen />;
  if (!member) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Member' }} />
        <EmptyState
          icon="person-outline"
          title="Member Not Found"
          subtitle="This member could not be loaded"
        />
      </View>
    );
  }

  const roleBadgeVariant =
    member.role === 'org_admin' ? 'warning' : member.role === 'executive' ? 'info' : 'default';
  const fin = member.financials;
  const balance = fin ? fin.totalOwed - fin.totalPaid : 0;

  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: 'overview', label: 'Overview', icon: 'person-outline' },
    { key: 'financial', label: 'Financial', icon: 'cash-outline' },
    { key: 'activity', label: 'Activity', icon: 'time-outline' },
  ];

  return (
    <ResponsiveScrollView style={styles.container}>
      <Stack.Screen options={{ title: member.fullName }} />

      {/* Profile Header */}
      <View style={styles.profileHeader}>
        <Avatar name={member.fullName} size={80} />
        <Text style={styles.profileName}>{member.fullName}</Text>
        <Text style={styles.profileEmail}>{member.email}</Text>
        {member.phone && (
          <Text style={styles.profilePhone}>{member.phone}</Text>
        )}
        <View style={styles.badgeRow}>
          <Badge label={member.role} variant={roleBadgeVariant} size="lg" />
          <Badge
            label={`Joined ${format(new Date(member.joinedAt), 'MMM yyyy')}`}
            variant="neutral"
            size="md"
          />
        </View>
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Ionicons
              name={tab.icon as any}
              size={18}
              color={activeTab === tab.key ? Colors.highlight : Colors.textLight}
            />
            <Text
              style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tab Content */}
      <View style={styles.content}>
        {activeTab === 'overview' && (
          <>
            {/* Quick Stats */}
            <View style={styles.quickStats}>
              <StatCard
                title="Total Paid"
                value={`$${fin?.totalPaid?.toLocaleString() || '0'}`}
                icon="checkmark-circle"
                trend="neutral"
              />
              <StatCard
                title="Outstanding"
                value={`$${fin?.totalOwed?.toLocaleString() || '0'}`}
                icon="alert-circle"
                trend={balance > 0 ? 'down' : 'neutral'}
              />
            </View>

            {/* Committees */}
            <SectionHeader title="Committees" />
            {member.committees && member.committees.length > 0 ? (
              <View style={styles.committees}>
                {member.committees.map((c) => (
                  <View key={c.id} style={styles.committeeChip}>
                    <Ionicons name="people" size={14} color={Colors.highlight} />
                    <Text style={styles.committeeChipText}>{c.name}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptyText}>Not assigned to any committees</Text>
            )}

            {/* Role Management */}
            <SectionHeader title="Role Management" />
            <View style={styles.roleOptions}>
              {['member', 'executive', 'org_admin'].map((role) => (
                <TouchableOpacity
                  key={role}
                  style={[
                    styles.roleChip,
                    member.role === role && styles.roleChipActive,
                  ]}
                  onPress={() => handleRoleChange(role)}
                  disabled={member.role === role}
                >
                  <Ionicons
                    name={
                      role === 'org_admin'
                        ? 'shield'
                        : role === 'executive'
                        ? 'briefcase'
                        : 'person'
                    }
                    size={16}
                    color={member.role === role ? Colors.highlight : Colors.textSecondary}
                  />
                  <Text
                    style={[
                      styles.roleChipText,
                      member.role === role && styles.roleChipTextActive,
                    ]}
                  >
                    {role === 'org_admin' ? 'Admin' : role.charAt(0).toUpperCase() + role.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Danger Zone */}
            <View style={styles.dangerSection}>
              <Button
                title="Remove from Organization"
                variant="danger"
                icon="person-remove"
                onPress={handleRemoveMember}
                fullWidth
              />
            </View>
          </>
        )}

        {activeTab === 'financial' && (
          <>
            {/* Financial Summary */}
            <Card variant="gold" style={styles.financialSummary}>
              <Text style={styles.financialLabel}>BALANCE</Text>
              <Text
                style={[
                  styles.financialBalance,
                  { color: balance > 0 ? Colors.error : Colors.success },
                ]}
              >
                {balance > 0 ? '-' : '+'}${Math.abs(balance).toLocaleString()}
              </Text>
            </Card>

            {/* Dues */}
            <SectionHeader title="Dues" />
            {fin?.dues?.length ? (
              fin.dues.map((due) => (
                <Card key={due.id} variant="elevated" style={styles.finItem}>
                  <View style={styles.finItemHeader}>
                    <View style={styles.finItemLeft}>
                      <Ionicons name="receipt" size={18} color={Colors.highlight} />
                      <View>
                        <Text style={styles.finItemTitle}>{due.title}</Text>
                        <Text style={styles.finItemDate}>
                          Due: {format(new Date(due.dueDate), 'MMM dd, yyyy')}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.finItemRight}>
                      <Text style={styles.finItemAmount}>${due.amount.toFixed(2)}</Text>
                      <Badge
                        label={due.status}
                        variant={due.status === 'paid' ? 'success' : 'warning'}
                        size="sm"
                      />
                    </View>
                  </View>
                </Card>
              ))
            ) : (
              <Text style={styles.emptyText}>No dues assigned</Text>
            )}

            {/* Fines */}
            <SectionHeader title="Fines" />
            {fin?.fines?.length ? (
              fin.fines.map((fine) => (
                <Card key={fine.id} variant="elevated" style={styles.finItem}>
                  <View style={styles.finItemHeader}>
                    <View style={styles.finItemLeft}>
                      <Ionicons name="warning" size={18} color={Colors.error} />
                      <View>
                        <Text style={styles.finItemTitle}>{fine.reason}</Text>
                        <Text style={styles.finItemDate}>
                          {format(new Date(fine.createdAt), 'MMM dd, yyyy')}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.finItemRight}>
                      <Text style={[styles.finItemAmount, { color: Colors.error }]}>
                        ${fine.amount.toFixed(2)}
                      </Text>
                      <Badge
                        label={fine.status}
                        variant={fine.status === 'paid' ? 'success' : 'danger'}
                        size="sm"
                      />
                    </View>
                  </View>
                </Card>
              ))
            ) : (
              <Text style={styles.emptyText}>No fines issued</Text>
            )}

            {/* Donations */}
            <SectionHeader title="Donations" />
            {fin?.donations?.length ? (
              fin.donations.map((don) => (
                <Card key={don.id} variant="elevated" style={styles.finItem}>
                  <View style={styles.finItemHeader}>
                    <View style={styles.finItemLeft}>
                      <Ionicons name="heart" size={18} color={Colors.success} />
                      <View>
                        <Text style={styles.finItemTitle}>{don.campaignTitle}</Text>
                        <Text style={styles.finItemDate}>
                          {format(new Date(don.createdAt), 'MMM dd, yyyy')}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.finItemAmount, { color: Colors.success }]}>
                      ${don.amount.toFixed(2)}
                    </Text>
                  </View>
                </Card>
              ))
            ) : (
              <Text style={styles.emptyText}>No donations made</Text>
            )}
          </>
        )}

        {activeTab === 'activity' && (
          activitiesLoading ? (
            <ActivityIndicator size="large" color={Colors.highlight} style={{ marginTop: Spacing.xl }} />
          ) : activities.length === 0 ? (
            <EmptyState
              icon="time-outline"
              title="No Activity Yet"
              subtitle="This member has no recorded activity in this organization."
            />
          ) : (
            activities.map((item) => (
              <Card key={item.id} variant="elevated" style={styles.activityItem}>
                <View style={styles.activityRow}>
                  <View style={styles.activityIconWrap}>
                    <Ionicons name={getActivityIcon(item.action) as any} size={18} color={Colors.highlight} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.activityLabel}>{getActivityLabel(item)}</Text>
                    <Text style={styles.activityDate}>
                      {format(new Date(item.created_at), 'MMM dd, yyyy h:mm a')}
                    </Text>
                  </View>
                </View>
              </Card>
            ))
          )
        )}
      </View>

      <View style={{ height: 60 }} />
    </ResponsiveScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  profileHeader: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  profileName: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
    marginTop: Spacing.sm,
  },
  profileEmail: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  profilePhone: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: Colors.highlight,
  },
  tabText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.textLight,
  },
  tabTextActive: {
    color: Colors.highlight,
    fontWeight: FontWeight.semibold,
  },

  content: {
    padding: Spacing.md,
  },

  quickStats: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },

  committees: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  committeeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.highlightSubtle,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.highlight,
  },
  committeeChipText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.highlight,
  },

  roleOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  roleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  roleChipActive: {
    borderColor: Colors.highlight,
    backgroundColor: Colors.highlightSubtle,
  },
  roleChipText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
  },
  roleChipTextActive: {
    color: Colors.highlight,
    fontWeight: FontWeight.semibold,
  },

  dangerSection: {
    marginTop: Spacing.lg,
  },

  emptyText: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
    fontStyle: 'italic',
    marginBottom: Spacing.md,
  },

  financialSummary: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    marginBottom: Spacing.md,
  },
  financialLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  financialBalance: {
    fontSize: 36,
    fontWeight: FontWeight.extrabold,
    letterSpacing: -1,
  },

  finItem: {
    marginBottom: Spacing.sm,
  },
  finItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  finItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
  },
  finItemTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
    color: Colors.textPrimary,
  },
  finItemDate: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    marginTop: 1,
  },
  finItemRight: {
    alignItems: 'flex-end',
    gap: Spacing.xs,
  },
  finItemAmount: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
    color: Colors.highlight,
  },
  activityItem: {
    marginBottom: Spacing.xs,
    padding: Spacing.md,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  activityIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityLabel: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
    color: Colors.textPrimary,
  },
  activityDate: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    marginTop: 2,
  },
});
