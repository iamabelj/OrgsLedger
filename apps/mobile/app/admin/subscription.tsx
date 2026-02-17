// ============================================================
// OrgsLedger — Subscription Management Screen (Admin)
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import { api } from '../../src/api/client';
import { useAuthStore } from '../../src/stores/auth.store';
import {
  Colors, Spacing, FontSize, FontWeight, BorderRadius,
} from '../../src/theme';
import {
  Card, Button, Badge, SectionHeader, Divider, StatCard, ResponsiveScrollView,
} from '../../src/components/ui';
import { showAlert } from '../../src/utils/alert';

const PLAN_FEATURES: Record<string, string[]> = {
  standard: ['Up to 100 members', 'Basic financials', 'Chat & announcements', '5 GB storage'],
  professional: ['Up to 300 members', 'Advanced analytics', 'AI meeting transcription', 'Committees & sub-groups', '25 GB storage'],
  enterprise: ['Up to 500 members', 'White-label branding', 'Priority support', 'API access', '100 GB storage'],
  enterprise_pro: ['Unlimited members', 'Dedicated support', 'Custom integrations', 'SLA guarantee', 'Unlimited storage'],
};

export default function SubscriptionScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sub, setSub] = useState<any>(null);
  const [plans, setPlans] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const [subRes, plansRes] = await Promise.all([
        api.subscriptions.getSubscription(currentOrgId!),
        api.subscriptions.getPlans(),
      ]);
      setSub(subRes.data?.data || subRes.data);
      setPlans(plansRes.data?.data || plansRes.data || []);
    } catch (err: any) {
      // Subscription might not exist yet
      try {
        const plansRes = await api.subscriptions.getPlans();
        setPlans(plansRes.data?.data || plansRes.data || []);
      } catch {}
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentOrgId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const onRefresh = () => { setRefreshing(true); fetchData(); };

  const isActive = sub?.status === 'active';
  const isPending = sub?.status === 'pending';
  const daysLeft = sub?.end_date
    ? Math.max(0, Math.ceil((new Date(sub.end_date).getTime() - Date.now()) / 86400000))
    : 0;
  const isExpiring = daysLeft > 0 && daysLeft <= 14;

  const handleRenew = async () => {
    try {
      router.push('/admin/plans');
    } catch (err: any) {
      showAlert('Error', 'Could not navigate to plans');
    }
  };

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Subscription', headerStyle: { backgroundColor: Colors.primary }, headerTintColor: Colors.textWhite }} />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.highlight} />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Subscription', headerStyle: { backgroundColor: Colors.primary }, headerTintColor: Colors.textWhite }} />
      <ResponsiveScrollView
        style={styles.container}
        refreshing={refreshing}
        onRefresh={onRefresh}
      >
        {/* Current Plan Banner */}
        {sub ? (
          <Card style={styles.planBanner}>
            <View style={styles.planBannerRow}>
              <View>
                <Text style={styles.planLabel}>Current Plan</Text>
                <Text style={styles.planName}>{sub.plan_name || sub.planName || sub.plan?.name || (typeof sub.plan === 'string' ? sub.plan : 'Standard')}</Text>
              </View>
              <Badge
                label={isActive ? 'Active' : isPending ? 'Pending' : sub.status || 'Unknown'}
                variant={isActive ? 'success' : isPending ? 'warning' : 'danger'}
              />
            </View>

            <View style={styles.statRow}>
              <StatCard label="Status" value={isActive ? 'Active' : sub.status} icon="checkmark-circle" />
              <StatCard label="Days Left" value={String(daysLeft)} icon="time-outline" />
            </View>

            {isExpiring && (
              <View style={styles.warningBanner}>
                <Ionicons name="warning" size={18} color={Colors.warning} />
                <Text style={styles.warningText}>Your subscription expires in {daysLeft} days. Renew now to avoid service interruption.</Text>
              </View>
            )}

            {sub.end_date && (
              <View style={styles.dateRow}>
                <View style={styles.dateItem}>
                  <Text style={styles.dateLabel}>Start Date</Text>
                  <Text style={styles.dateValue}>{new Date(sub.start_date).toLocaleDateString()}</Text>
                </View>
                <View style={styles.dateItem}>
                  <Text style={styles.dateLabel}>End Date</Text>
                  <Text style={styles.dateValue}>{new Date(sub.end_date).toLocaleDateString()}</Text>
                </View>
              </View>
            )}

            <Button title="Manage Plans" onPress={handleRenew} variant="primary" />
          </Card>
        ) : (
          <Card style={styles.planBanner}>
            <View style={styles.noSubWrap}>
              <Ionicons name="alert-circle-outline" size={48} color={Colors.warning} />
              <Text style={styles.noSubTitle}>No Active Subscription</Text>
              <Text style={styles.noSubText}>Subscribe to unlock all features for your organization.</Text>
              <Button title="View Plans" onPress={handleRenew} variant="primary" />
            </View>
          </Card>
        )}

        {/* Features of Current Plan */}
        {sub && (
          <Card style={styles.featuresCard}>
            <SectionHeader title="Plan Features" />
            {(PLAN_FEATURES[(typeof sub.plan === 'string' ? sub.plan : sub.plan_name || sub.plan?.name || 'standard').toLowerCase()] || PLAN_FEATURES.standard).map((f, i) => (
              <View key={i} style={styles.featureRow}>
                <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
                <Text style={styles.featureText}>{f}</Text>
              </View>
            ))}
          </Card>
        )}

        {/* Billing History Teaser */}
        <Card style={styles.featuresCard}>
          <SectionHeader title="Quick Actions" />
          <ActionRow icon="card-outline" label="View Plans & Upgrade" onPress={() => router.push('/admin/plans')} />
          <ActionRow icon="wallet-outline" label="AI Credits Wallet" onPress={() => router.push('/admin/wallets')} />
          <ActionRow icon="people-outline" label="Invite Members" onPress={() => router.push('/admin/invites')} />
          <ActionRow icon="receipt-outline" label="Financial Reports" onPress={() => router.push('/admin/reports')} last />
        </Card>

        <View style={{ height: Spacing.xxl * 2 }} />
      </ResponsiveScrollView>
    </>
  );
}

function ActionRow({ icon, label, onPress, last }: { icon: string; label: string; onPress: () => void; last?: boolean }) {
  return (
    <TouchableOpacity
      style={[actionStyles.row, !last && actionStyles.border]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={actionStyles.iconWrap}>
        <Ionicons name={icon as any} size={20} color={Colors.highlight} />
      </View>
      <Text style={actionStyles.label}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={Colors.textLight} />
    </TouchableOpacity>
  );
}

const actionStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  border: { borderBottomWidth: 0.5, borderBottomColor: Colors.accent },
  iconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.highlightSubtle, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontSize: FontSize.md, color: Colors.textWhite, fontWeight: FontWeight.medium as any },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  planBanner: { marginHorizontal: Spacing.md, marginTop: Spacing.md, padding: Spacing.lg, gap: Spacing.md },
  planBannerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planLabel: { fontSize: FontSize.xs, color: Colors.textLight, textTransform: 'uppercase', letterSpacing: 1 },
  planName: { fontSize: FontSize.xl, fontWeight: FontWeight.bold as any, color: Colors.highlight, textTransform: 'capitalize', marginTop: 2 },
  statRow: { flexDirection: 'row', gap: Spacing.sm },
  warningBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs, backgroundColor: Colors.warningSubtle, padding: Spacing.md, borderRadius: BorderRadius.md },
  warningText: { flex: 1, fontSize: FontSize.sm, color: Colors.warning, lineHeight: 20 },
  dateRow: { flexDirection: 'row', gap: Spacing.md },
  dateItem: { flex: 1 },
  dateLabel: { fontSize: FontSize.xs, color: Colors.textLight },
  dateValue: { fontSize: FontSize.md, color: Colors.textWhite, fontWeight: FontWeight.medium as any, marginTop: 2 },
  noSubWrap: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  noSubTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold as any, color: Colors.textPrimary },
  noSubText: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center' },
  featuresCard: { marginHorizontal: Spacing.md, marginTop: Spacing.md, padding: Spacing.lg },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs + 2 },
  featureText: { fontSize: FontSize.md, color: Colors.textSecondary },
});
