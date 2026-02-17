// ============================================================
// OrgsLedger — Super Admin SaaS Dashboard
// Platform revenue, org management, wallet adjustments
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TextInput,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../src/theme';
import { Card, SectionHeader, ResponsiveScrollView } from '../../src/components/ui';
import { useResponsive } from '../../src/hooks/useResponsive';
import { showAlert } from '../../src/utils/alert';

type Tab = 'overview' | 'orgs' | 'adjust';

export default function SaasDashboard() {
  const globalRole = useAuthStore((s) => s.user?.globalRole);
  const canAccess = globalRole === 'developer';

  if (!canAccess) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background }}>
        <Text style={{ fontSize: 48, marginBottom: 16 }}>{String.fromCodePoint(0x1F512)}</Text>
        <Text style={{ color: Colors.text, fontSize: 18, fontWeight: '600' as const }}>Super Admin Access Only</Text>
        <Text style={{ color: Colors.textLight, fontSize: 14, marginTop: 8, textAlign: 'center' as const, paddingHorizontal: 32 }}>
          This dashboard is restricted to super admins and developers.
        </Text>
      </View>
    );
  }

  const responsive = useResponsive();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');

  // Overview
  const [revenue, setRevenue] = useState<any>(null);
  const [walletAnalytics, setWalletAnalytics] = useState<any>(null);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);

  // Orgs
  const [orgs, setOrgs] = useState<any[]>([]);

  // Adjust form
  const [adjustOrgId, setAdjustOrgId] = useState('');
  const [adjustType, setAdjustType] = useState<'ai' | 'translation'>('ai');
  const [adjustHours, setAdjustHours] = useState('');
  const [adjustDesc, setAdjustDesc] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [revRes, walletRes, subsRes, orgsRes] = await Promise.all([
        api.subscriptions.adminRevenue(),
        api.subscriptions.adminWalletAnalytics(),
        api.subscriptions.adminSubscriptions({ limit: 100 }),
        api.subscriptions.adminOrganizations(),
      ]);
      // Map revenue from getPlatformRevenue() nested structure to flat shape the template expects
      const rev = revRes.data?.data;
      setRevenue(rev ? {
        totalRevenue: rev.totalRevenue || 0,
        subscriptionRevenue: rev.subscriptions?.totalRevenue || 0,
        aiWalletRevenue: rev.aiWallet?.totalRevenue || 0,
        translationRevenue: rev.translationWallet?.totalRevenue || 0,
      } : null);
      // Map wallet analytics from snake_case API fields to camelCase the template expects
      const summary = walletRes.data?.summary;
      setWalletAnalytics(summary ? {
        aiHoursSold: summary.total_ai_sold_hours || 0,
        aiHoursUsed: summary.total_ai_used_hours || 0,
        translationHoursSold: summary.total_translation_sold_hours || 0,
        translationHoursUsed: summary.total_translation_used_hours || 0,
      } : null);
      setSubscriptions(subsRes.data?.subscriptions || []);
      setOrgs(orgsRes.data?.organizations || []);
    } catch (err: any) {
      setError('Failed to load SaaS dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { if (canAccess) loadData(); }, [canAccess, loadData]);
  const onRefresh = () => { setRefreshing(true); loadData(); };

  const handleSuspend = (org: any) => {
    const action = org.subscription_status === 'suspended' ? 'activate' : 'suspend';
    showAlert(
      `${action === 'suspend' ? 'Suspend' : 'Activate'} ${org.name}?`,
      action === 'suspend' ? 'This will block all members from accessing the platform.' : 'This will restore access for all members.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: action === 'suspend' ? 'destructive' : 'default',
          onPress: async () => {
            try {
              await api.subscriptions.adminOrgStatus({ organizationId: org.id, action });
              showAlert('Done', `Organization ${action === 'suspend' ? 'suspended' : 'activated'}.`);
              loadData();
            } catch (err: any) {
              showAlert('Error', err?.response?.data?.error || 'Action failed');
            }
          },
        },
      ]
    );
  };

  const handleAdjust = async () => {
    const hours = parseFloat(adjustHours);
    if (!adjustOrgId) return showAlert('Missing', 'Select an organization first.');
    if (!hours) return showAlert('Invalid', 'Enter hours to add (positive) or deduct (negative).');
    if (!adjustDesc.trim()) return showAlert('Missing', 'Add a description for the adjustment.');
    try {
      if (adjustType === 'ai') {
        await api.subscriptions.adminAdjustAiWallet({ organizationId: adjustOrgId, hours, description: adjustDesc });
      } else {
        await api.subscriptions.adminAdjustTranslationWallet({ organizationId: adjustOrgId, hours, description: adjustDesc });
      }
      showAlert('Success', `${Math.abs(hours)}h ${hours > 0 ? 'added to' : 'deducted from'} ${adjustType.toUpperCase()} wallet.`);
      setAdjustHours('');
      setAdjustDesc('');
      loadData();
    } catch (err: any) {
      showAlert('Error', err?.response?.data?.error || 'Adjustment failed');
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.highlight} />
      </View>
    );
  }

  const activeCount = subscriptions.filter((s: any) => s.status === 'active').length;
  const graceCount = subscriptions.filter((s: any) => s.status === 'grace_period').length;
  const expiredCount = subscriptions.filter((s: any) => s.status === 'expired').length;

  return (
    <ResponsiveScrollView
      style={styles.container}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {/* Tabs */}
      <View style={[styles.tabs, { marginHorizontal: responsive.contentPadding }]}>
        {([
          { key: 'overview', label: 'Overview', icon: 'stats-chart' },
          { key: 'orgs', label: 'Organizations', icon: 'business' },
          { key: 'adjust', label: 'Adjust', icon: 'construct' },
        ] as const).map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
          >
            <Ionicons name={t.icon as any} size={16} color={tab === t.key ? Colors.highlight : Colors.textLight} />
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Overview Tab ─────────────────────────────── */}
      {tab === 'overview' && (
        <View style={[styles.section, { padding: responsive.contentPadding }]}>
          {/* Revenue */}
          <SectionHeader title="Platform Revenue" />
          <View style={styles.statsGrid}>
            <StatCard label="Total Revenue" value={`$${fmtNum(revenue?.totalRevenue || 0)}`} icon="cash" color={Colors.success} />
            <StatCard label="Subscriptions" value={`$${fmtNum(revenue?.subscriptionRevenue || 0)}`} icon="card" color={Colors.highlight} />
            <StatCard label="AI Wallet" value={`$${fmtNum(revenue?.aiWalletRevenue || 0)}`} icon="sparkles" color={Colors.info} />
            <StatCard label="Translation" value={`$${fmtNum(revenue?.translationRevenue || 0)}`} icon="language" color={Colors.warning} />
          </View>

          {/* Subscription Breakdown */}
          <SectionHeader title="Subscription Status" />
          <View style={styles.statusRow}>
            <StatusPill label="Active" count={activeCount} color={Colors.success} />
            <StatusPill label="Grace" count={graceCount} color={Colors.warning} />
            <StatusPill label="Expired" count={expiredCount} color={Colors.error} />
            <StatusPill label="Total" count={subscriptions.length} color={Colors.info} />
          </View>

          {/* Wallet Analytics */}
          <SectionHeader title="Wallet Analytics" />
          <Card style={styles.analyticsCard}>
            <View style={styles.analyticRow}>
              <Ionicons name="sparkles" size={18} color={Colors.highlight} />
              <Text style={styles.analyticLabel}>AI Hours Sold</Text>
              <Text style={styles.analyticValue}>{fmtNum(walletAnalytics?.aiHoursSold || 0)}h</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.analyticRow}>
              <Ionicons name="sparkles" size={18} color={Colors.highlight} />
              <Text style={styles.analyticLabel}>AI Hours Used</Text>
              <Text style={styles.analyticValue}>{fmtNum(walletAnalytics?.aiHoursUsed || 0)}h</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.analyticRow}>
              <Ionicons name="language" size={18} color={Colors.info} />
              <Text style={styles.analyticLabel}>Translation Hours Sold</Text>
              <Text style={styles.analyticValue}>{fmtNum(walletAnalytics?.translationHoursSold || 0)}h</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.analyticRow}>
              <Ionicons name="language" size={18} color={Colors.info} />
              <Text style={styles.analyticLabel}>Translation Hours Used</Text>
              <Text style={styles.analyticValue}>{fmtNum(walletAnalytics?.translationHoursUsed || 0)}h</Text>
            </View>
          </Card>
        </View>
      )}

      {/* ── Organizations Tab ────────────────────────── */}
      {tab === 'orgs' && (
        <View style={[styles.section, { padding: responsive.contentPadding }]}>
          <SectionHeader title={`Organizations (${orgs.length})`} />
          {orgs.length === 0 ? (
            <Text style={styles.emptyText}>No organizations found</Text>
          ) : (
            orgs.map((org: any) => {
              const status = org.subscription_status || 'none';
              const statusColor =
                status === 'active' ? Colors.success :
                status === 'grace_period' ? Colors.warning :
                status === 'suspended' ? Colors.error : Colors.textLight;
              return (
                <Card key={org.id} style={styles.orgCard}>
                  <View style={styles.orgHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.orgName} numberOfLines={1}>{org.name}</Text>
                      <Text style={styles.orgDetail}>
                        {org.member_count || 0} members • {org.billing_currency || 'USD'}
                      </Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: statusColor + '20', borderColor: statusColor + '40' }]}>
                      <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                      <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                        {status.replace('_', ' ')}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.orgWallets}>
                    <View style={styles.orgWalletItem}>
                      <Ionicons name="card" size={14} color={Colors.textLight} />
                      <Text style={styles.orgWalletText}>{org.plan_name || 'No plan'}</Text>
                    </View>
                    <View style={styles.orgWalletItem}>
                      <Ionicons name="sparkles" size={14} color={Colors.highlight} />
                      <Text style={styles.orgWalletText}>
                        AI: {((parseFloat(org.ai_balance_minutes || '0')) / 60).toFixed(1)}h
                      </Text>
                    </View>
                    <View style={styles.orgWalletItem}>
                      <Ionicons name="language" size={14} color={Colors.info} />
                      <Text style={styles.orgWalletText}>
                        Trans: {((parseFloat(org.translation_balance_minutes || '0')) / 60).toFixed(1)}h
                      </Text>
                    </View>
                  </View>

                  <View style={styles.orgActions}>
                    <TouchableOpacity
                      style={[styles.orgActionBtn, status === 'suspended' ? styles.activateBtn : styles.suspendBtn]}
                      onPress={() => handleSuspend(org)}
                    >
                      <Ionicons
                        name={status === 'suspended' ? 'checkmark-circle' : 'ban'}
                        size={14}
                        color={status === 'suspended' ? Colors.success : Colors.error}
                      />
                      <Text style={[styles.orgActionText, { color: status === 'suspended' ? Colors.success : Colors.error }]}>
                        {status === 'suspended' ? 'Activate' : 'Suspend'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.adjustBtn}
                      onPress={() => { setAdjustOrgId(org.id); setTab('adjust'); }}
                    >
                      <Ionicons name="construct" size={14} color={Colors.highlight} />
                      <Text style={[styles.orgActionText, { color: Colors.highlight }]}>Adjust Wallet</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              );
            })
          )}
        </View>
      )}

      {/* ── Adjust Wallet Tab ────────────────────────── */}
      {tab === 'adjust' && (
        <View style={[styles.section, { padding: responsive.contentPadding }]}>
          <SectionHeader title="Adjust Organization Wallet" />
          <Text style={styles.adjustSubtitle}>
            Add or deduct wallet hours for any organization. Use negative values to deduct.
          </Text>

          <Card style={styles.adjustCard}>
            {/* Org selector */}
            <Text style={styles.fieldLabel}>Organization</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.orgPicker}>
              {orgs.map((o: any) => (
                <TouchableOpacity
                  key={o.id}
                  style={[styles.orgChip, adjustOrgId === o.id && styles.orgChipActive]}
                  onPress={() => setAdjustOrgId(o.id)}
                >
                  <Text style={[styles.orgChipText, adjustOrgId === o.id && { color: Colors.highlight }]} numberOfLines={1}>
                    {o.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Wallet type */}
            <Text style={styles.fieldLabel}>Wallet Type</Text>
            <View style={styles.walletToggle}>
              <TouchableOpacity
                style={[styles.toggleBtn, adjustType === 'ai' && styles.toggleActive]}
                onPress={() => setAdjustType('ai')}
              >
                <Ionicons name="sparkles" size={16} color={adjustType === 'ai' ? Colors.highlight : Colors.textLight} />
                <Text style={[styles.toggleText, adjustType === 'ai' && { color: Colors.highlight }]}>AI</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggleBtn, adjustType === 'translation' && styles.toggleActive]}
                onPress={() => setAdjustType('translation')}
              >
                <Ionicons name="language" size={16} color={adjustType === 'translation' ? Colors.info : Colors.textLight} />
                <Text style={[styles.toggleText, adjustType === 'translation' && { color: Colors.info }]}>Translation</Text>
              </TouchableOpacity>
            </View>

            {/* Hours */}
            <Text style={styles.fieldLabel}>Hours (negative to deduct)</Text>
            <TextInput
              style={styles.input}
              value={adjustHours}
              onChangeText={setAdjustHours}
              keyboardType="numeric"
              placeholder="e.g. 5 or -2"
              placeholderTextColor={Colors.textLight}
            />

            {/* Description */}
            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput
              style={[styles.input, { height: 60, textAlignVertical: 'top' }]}
              value={adjustDesc}
              onChangeText={setAdjustDesc}
              placeholder="Reason for adjustment..."
              placeholderTextColor={Colors.textLight}
              multiline
            />

            <TouchableOpacity style={styles.submitBtn} onPress={handleAdjust}>
              <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />
              <Text style={styles.submitBtnText}>Apply Adjustment</Text>
            </TouchableOpacity>
          </Card>
        </View>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>Powered by Globull</Text>
      </View>
    </ResponsiveScrollView>
  );
}

// ── Helper Components ─────────────────────────────────────

function StatCard({ label, value, icon, color }: { label: string; value: string; icon: string; color: string }) {
  return (
    <Card style={[styles.statCard, { borderColor: color + '30' }]}>
      <Ionicons name={icon as any} size={20} color={color} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Card>
  );
}

function StatusPill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <View style={[styles.pill, { borderColor: color + '40' }]}>
      <Text style={[styles.pillCount, { color }]}>{count}</Text>
      <Text style={styles.pillLabel}>{label}</Text>
    </View>
  );
}

function fmtNum(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toFixed(n % 1 === 0 ? 0 : 2);
}

// ── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background, gap: Spacing.md },
  deniedText: { fontSize: FontSize.md, color: Colors.textLight },
  section: { paddingTop: Spacing.md },

  // Tabs
  tabs: { flexDirection: 'row', marginTop: Spacing.md, marginBottom: 0, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: 4 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10, borderRadius: BorderRadius.sm },
  tabActive: { backgroundColor: Colors.primaryLight },
  tabText: { fontSize: FontSize.xs, color: Colors.textLight },
  tabTextActive: { color: Colors.highlight, fontWeight: FontWeight.semibold as any },

  // Stats grid
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.lg },
  statCard: { width: '48%' as any, borderWidth: 1, alignItems: 'center', paddingVertical: Spacing.md },
  statValue: { fontSize: FontSize.lg, fontWeight: FontWeight.bold as any, marginTop: Spacing.xs },
  statLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },

  // Status row
  statusRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
  pill: { flex: 1, alignItems: 'center', borderWidth: 1, borderRadius: BorderRadius.md, paddingVertical: Spacing.sm },
  pillCount: { fontSize: FontSize.lg, fontWeight: FontWeight.bold as any },
  pillLabel: { fontSize: FontSize.xs, color: Colors.textLight },

  // Analytics
  analyticsCard: { marginBottom: Spacing.md },
  analyticRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  analyticLabel: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary },
  analyticValue: { fontSize: FontSize.md, fontWeight: FontWeight.semibold as any, color: Colors.textPrimary },
  divider: { height: 1, backgroundColor: Colors.border },

  // Orgs
  emptyText: { fontSize: FontSize.sm, color: Colors.textLight, textAlign: 'center', paddingVertical: Spacing.xl },
  orgCard: { marginBottom: Spacing.sm },
  orgHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.sm },
  orgName: { fontSize: FontSize.md, fontWeight: FontWeight.semibold as any, color: Colors.textPrimary },
  orgDetail: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 2 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusBadgeText: { fontSize: 10, fontWeight: FontWeight.semibold as any, textTransform: 'capitalize' as any },
  orgWallets: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.sm },
  orgWalletItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  orgWalletText: { fontSize: FontSize.xs, color: Colors.textSecondary },
  orgActions: { flexDirection: 'row', gap: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm },
  orgActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: BorderRadius.sm, borderWidth: 1 },
  orgActionText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold as any },
  suspendBtn: { borderColor: Colors.dangerSubtle, backgroundColor: Colors.dangerSubtle },
  activateBtn: { borderColor: Colors.successSubtle, backgroundColor: Colors.successSubtle },
  adjustBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.highlightSubtle, backgroundColor: Colors.highlightSubtle },

  // Adjust form
  adjustSubtitle: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.md },
  adjustCard: {},
  fieldLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold as any, color: Colors.textPrimary, marginBottom: Spacing.xs, marginTop: Spacing.md },
  orgPicker: { maxHeight: 40 },
  orgChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, marginRight: Spacing.sm, backgroundColor: Colors.primaryLight },
  orgChipActive: { borderColor: Colors.highlight, backgroundColor: Colors.highlightSubtle },
  orgChipText: { fontSize: FontSize.xs, color: Colors.textSecondary, maxWidth: 100 },
  walletToggle: { flexDirection: 'row', gap: Spacing.sm },
  toggleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border },
  toggleActive: { borderColor: Colors.highlight, backgroundColor: Colors.highlightSubtle },
  toggleText: { fontSize: FontSize.sm, color: Colors.textLight },
  input: { backgroundColor: Colors.primaryLight, borderWidth: 1, borderColor: Colors.accent, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: 10, color: Colors.textPrimary, fontSize: FontSize.md, marginBottom: Spacing.xs },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.highlight, paddingVertical: 14, borderRadius: BorderRadius.md, marginTop: Spacing.lg },
  submitBtnText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold as any, color: Colors.primary },

  // Footer
  footer: { padding: Spacing.xl, alignItems: 'center' },
  footerText: { fontSize: FontSize.xs, color: Colors.textLight },
});
