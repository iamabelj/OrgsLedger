// ============================================================
// OrgsLedger Mobile — Analytics Dashboard Screen
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Card, SectionHeader, StatCard, LoadingScreen, PoweredByFooter } from '../../src/components/ui';
import { useResponsive } from '../../src/hooks/useResponsive';

export default function AnalyticsScreen() {
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const memberships = useAuthStore((s) => s.memberships);
  const currentOrg = memberships.find((m) => m.organization_id === currentOrgId);
  const responsive = useResponsive();

  const loadAnalytics = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const res = await api.analytics.dashboard(currentOrgId);
      setAnalytics(res.data.data);
    } catch (err) {
      console.error('Failed to load analytics', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentOrgId]);

  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);

  if (loading) return <LoadingScreen />;

  const data = analytics || { members: {}, finances: {}, meetings: {} };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', minimumFractionDigits: 0 }).format(amount);
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAnalytics(); }} />
      }
      contentContainerStyle={{ maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' }}
    >
      <View style={styles.header}>
        <Text style={styles.screenTitle}>Analytics</Text>
        <Text style={styles.orgName}>{currentOrg?.organizationName || 'Organization'}</Text>
      </View>

      {/* Member Stats */}
      <View style={styles.section}>
        <SectionHeader title="Members" />
        <View style={styles.statRow}>
          <StatCard
            label="Total Members"
            value={data.members?.total?.toString() || '0'}
            icon="people"
          />
          <StatCard
            label="New This Month"
            value={data.members?.newThisMonth?.toString() || '0'}
            icon="person-add"
          />
        </View>
      </View>

      {/* Financial Stats */}
      <View style={styles.section}>
        <SectionHeader title="Finances" />
        <View style={styles.statRow}>
          <StatCard
            label="Total Revenue"
            value={formatCurrency(data.finances?.totalRevenue || 0)}
            icon="trending-up"
          />
          <StatCard
            label="Monthly Revenue"
            value={formatCurrency(data.finances?.monthlyRevenue || 0)}
            icon="cash"
          />
        </View>
        <View style={styles.statRow}>
          <StatCard
            label="Total Expenses"
            value={formatCurrency(data.finances?.totalExpenses || 0)}
            icon="trending-down"
          />
          <StatCard
            label="Net Balance"
            value={formatCurrency(data.finances?.netBalance || 0)}
            icon="wallet"
          />
        </View>
        <View style={styles.statRow}>
          <StatCard
            label="Outstanding Dues"
            value={formatCurrency(data.finances?.outstandingDues || 0)}
            icon="alert-circle"
          />
          <StatCard
            label="Collection Rate"
            value={`${data.finances?.collectionRate || 0}%`}
            icon="pie-chart"
          />
        </View>
      </View>

      {/* Meeting Stats */}
      <View style={styles.section}>
        <SectionHeader title="Meetings" />
        <View style={styles.statRow}>
          <StatCard
            label="Total Meetings"
            value={data.meetings?.total?.toString() || '0'}
            icon="videocam"
          />
          <StatCard
            label="This Month"
            value={data.meetings?.thisMonth?.toString() || '0'}
            icon="calendar"
          />
        </View>
      </View>

      {/* Monthly Breakdown */}
      {data.monthlyBreakdown?.length > 0 && (
        <View style={styles.section}>
          <SectionHeader title="Monthly Revenue Trend" />
          <Card style={styles.chartCard}>
            {data.monthlyBreakdown.map((item: any, idx: number) => {
              const maxVal = Math.max(...data.monthlyBreakdown.map((i: any) => parseFloat(i.total) || 0), 1);
              const pct = Math.round(((parseFloat(item.total) || 0) / maxVal) * 100);
              return (
                <View key={idx} style={styles.barRow}>
                  <Text style={styles.barLabel}>{item.month}</Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${pct}%` }]} />
                  </View>
                  <Text style={styles.barValue}>{formatCurrency(parseFloat(item.total) || 0)}</Text>
                </View>
              );
            })}
          </Card>
        </View>
      )}

      {/* Recent Activity */}
      {data.recentActivity?.length > 0 && (
        <View style={styles.section}>
          <SectionHeader title="Recent Activity" />
          <Card>
            {data.recentActivity.map((activity: any, idx: number) => (
              <View key={idx} style={styles.activityRow}>
                <View style={styles.activityDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityText}>
                    {activity.first_name} {activity.last_name} — {activity.action} {activity.entity_type}
                  </Text>
                  <Text style={styles.activityTime}>
                    {new Date(activity.created_at).toLocaleString()}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </View>
      )}

      <PoweredByFooter />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { padding: Spacing.md, paddingTop: Spacing.lg },
  screenTitle: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold as any, color: Colors.textPrimary },
  orgName: { fontSize: FontSize.sm, color: Colors.textLight, marginTop: 2 },
  section: { paddingHorizontal: Spacing.md, marginBottom: Spacing.lg },
  statRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  chartCard: { padding: Spacing.md },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  barLabel: { width: 60, fontSize: FontSize.xs, color: Colors.textLight },
  barTrack: { flex: 1, height: 16, backgroundColor: Colors.border, borderRadius: BorderRadius.sm, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: BorderRadius.sm },
  barValue: { width: 80, fontSize: FontSize.xs, color: Colors.textPrimary, textAlign: 'right' },
  activityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, paddingVertical: Spacing.xs, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
  activityDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary, marginTop: 5 },
  activityText: { fontSize: FontSize.sm, color: Colors.textPrimary },
  activityTime: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 1 },
});
