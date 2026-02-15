// ============================================================
// OrgsLedger — Admin Compliance Dashboard
// Audit trail, data governance, policy status, GDPR/NDPA
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import { api } from '../../src/api/client';
import { useAuthStore } from '../../src/stores/auth.store';
import {
  Colors, Spacing, FontSize, FontWeight, BorderRadius,
} from '../../src/theme';
import {
  Card, SectionHeader, Badge, Divider, Button, StatCard, ResponsiveScrollView,
} from '../../src/components/ui';

const ACTION_FILTERS = ['all', 'payment', 'update', 'create', 'delete', 'login'];
const ENTITY_FILTERS = ['all', 'user', 'transaction', 'due', 'fine', 'donation', 'meeting', 'channel', 'membership', 'payment_methods'];

const ACTION_ICONS: Record<string, { icon: string; color: string }> = {
  payment: { icon: 'card', color: Colors.success },
  update: { icon: 'create', color: Colors.info },
  create: { icon: 'add-circle', color: Colors.highlight },
  delete: { icon: 'trash', color: Colors.error },
  login: { icon: 'log-in', color: Colors.warning },
  default: { icon: 'document-text', color: Colors.textLight },
};

interface AuditEntry {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  ip_address: string;
  created_at: string;
  email: string;
  first_name: string;
  last_name: string;
}

export default function ComplianceScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const memberships = useAuthStore((s) => s.memberships);
  const currentMembership = memberships.find((m) => m.organization_id === currentOrgId);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('all');
  const [entityFilter, setEntityFilter] = useState('all');
  const [memberCount, setMemberCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchLogs = useCallback(async (pg = 1, append = false) => {
    if (!currentOrgId) return;
    try {
      const params: any = { page: pg, limit: 30 };
      if (actionFilter !== 'all') params.action = actionFilter;
      if (entityFilter !== 'all') params.entityType = entityFilter;

      const res = await api.orgs.getAuditLogs(currentOrgId, params);
      const data = res.data?.data || [];
      const meta = res.data?.meta || {};
      if (append) {
        setLogs((prev) => [...prev, ...data]);
      } else {
        setLogs(data);
      }
      setTotal(meta.total || 0);
    } catch (err) {
      console.error('Failed to load audit logs', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [currentOrgId, actionFilter, entityFilter]);

  useEffect(() => {
    setPage(1);
    setLoading(true);
    fetchLogs(1);
  }, [fetchLogs]);

  // Get member count for stats
  useEffect(() => {
    if (!currentOrgId) return;
    api.orgs.listMembers(currentOrgId, { limit: 1 }).then((res: any) => {
      setMemberCount(res.data?.meta?.total || res.data?.data?.length || 0);
    }).catch(() => {});
  }, [currentOrgId]);

  const onRefresh = () => { setRefreshing(true); setPage(1); fetchLogs(1); };
  const loadMore = () => {
    if (loadingMore || logs.length >= total) return;
    setLoadingMore(true);
    const next = page + 1;
    setPage(next);
    fetchLogs(next, true);
  };

  const orgName = currentMembership?.organizationName || 'Organization';

  // Compliance checklist items
  const complianceItems = [
    { label: 'Terms of Service', icon: 'document-text', status: 'active', path: '/legal/terms' },
    { label: 'Privacy Policy', icon: 'shield-checkmark', status: 'active', path: '/legal/privacy' },
    { label: 'Data Processing Agreement', icon: 'briefcase', status: 'active', path: '/legal/dpa' },
    { label: 'Acceptable Use Policy', icon: 'hand-left', status: 'active', path: '/legal/acceptable-use' },
    { label: 'GDPR Compliance', icon: 'globe', status: 'active', path: null },
    { label: 'NDPA Compliance (Nigeria)', icon: 'flag', status: 'active', path: null },
    { label: 'Audit Logging', icon: 'list', status: total > 0 ? 'active' : 'pending', path: null },
    { label: 'Data Encryption (at rest & transit)', icon: 'lock-closed', status: 'active', path: null },
    { label: 'Role-Based Access Control', icon: 'people', status: 'active', path: null },
    { label: 'Payment Security (PCI DSS via Stripe/Paystack)', icon: 'card', status: 'active', path: null },
  ];

  const activeCount = complianceItems.filter((c) => c.status === 'active').length;
  const complianceScore = Math.round((activeCount / complianceItems.length) * 100);

  return (
    <>
      <Stack.Screen options={{ title: 'Compliance', headerStyle: { backgroundColor: Colors.primary }, headerTintColor: Colors.textWhite }} />
      <ResponsiveScrollView
        style={styles.container}
        refreshing={refreshing}
        onRefresh={onRefresh}
      >
        {/* Compliance Score */}
        <Card style={styles.scoreCard}>
          <View style={styles.scoreRow}>
            <View style={styles.scoreCircle}>
              <Text style={styles.scoreValue}>{complianceScore}%</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.scoreTitle}>Compliance Health</Text>
              <Text style={styles.scoreSub}>{activeCount}/{complianceItems.length} controls active</Text>
              <Text style={styles.orgLabel}>{orgName}</Text>
            </View>
          </View>
        </Card>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <StatCard label="Audit Events" value={String(total)} icon="list-outline" />
          <StatCard label="Members" value={String(memberCount)} icon="people-outline" />
          <StatCard label="Policies" value={String(complianceItems.length)} icon="shield-outline" />
        </View>

        {/* Compliance Checklist */}
        <Card style={styles.card}>
          <SectionHeader title="Compliance Checklist" />
          {complianceItems.map((item, i) => (
            <TouchableOpacity
              key={i}
              style={[checkStyles.row, i < complianceItems.length - 1 && checkStyles.border]}
              onPress={item.path ? () => router.push(item.path as any) : undefined}
              activeOpacity={item.path ? 0.7 : 1}
            >
              <View style={[checkStyles.iconWrap, { backgroundColor: item.status === 'active' ? Colors.successSubtle : Colors.warningSubtle }]}>
                <Ionicons
                  name={item.icon as any}
                  size={18}
                  color={item.status === 'active' ? Colors.success : Colors.warning}
                />
              </View>
              <Text style={checkStyles.label}>{item.label}</Text>
              <Badge
                label={item.status === 'active' ? 'Active' : 'Pending'}
                variant={item.status === 'active' ? 'success' : 'warning'}
              />
              {item.path && <Ionicons name="chevron-forward" size={16} color={Colors.textLight} />}
            </TouchableOpacity>
          ))}
        </Card>

        {/* Data Governance */}
        <Card style={styles.card}>
          <SectionHeader title="Data Governance" />
          <GovRow icon="server" label="Data Storage" value="Neon PostgreSQL (US-East)" />
          <GovRow icon="lock-closed" label="Encryption" value="TLS 1.3 in transit, AES-256 at rest" />
          <GovRow icon="key" label="Authentication" value="JWT with bcrypt passwords" />
          <GovRow icon="time" label="Token Expiry" value="1 hour (access) / 7 days (refresh)" />
          <GovRow icon="eye-off" label="PII Handling" value="Minimal collection, purpose-limited" />
          <GovRow icon="trash" label="Data Retention" value="Active during subscription + 30 days" last />
        </Card>

        {/* Audit Trail */}
        <Card style={styles.card}>
          <View style={styles.auditHeader}>
            <SectionHeader title="Audit Trail" />
            <Text style={styles.totalLabel}>{total} events</Text>
          </View>

          {/* Filters */}
          <Text style={styles.filterLabel}>Action</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
            {ACTION_FILTERS.map((f) => (
              <TouchableOpacity
                key={f}
                style={[styles.filterChip, actionFilter === f && styles.filterChipActive]}
                onPress={() => setActionFilter(f)}
              >
                <Text style={[styles.filterChipText, actionFilter === f && styles.filterChipTextActive]}>
                  {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.filterLabel}>Entity</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
            {ENTITY_FILTERS.map((f) => (
              <TouchableOpacity
                key={f}
                style={[styles.filterChip, entityFilter === f && styles.filterChipActive]}
                onPress={() => setEntityFilter(f)}
              >
                <Text style={[styles.filterChipText, entityFilter === f && styles.filterChipTextActive]}>
                  {f === 'all' ? 'All' : f.replace('_', ' ')}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Divider />

          {loading ? (
            <ActivityIndicator size="large" color={Colors.highlight} style={{ padding: Spacing.xl }} />
          ) : logs.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Ionicons name="document-text-outline" size={40} color={Colors.textLight} />
              <Text style={styles.emptyText}>No audit events found</Text>
            </View>
          ) : (
            <>
              {logs.map((log) => {
                const ai = ACTION_ICONS[log.action] || ACTION_ICONS.default;
                const time = new Date(log.created_at);
                const userName = log.first_name
                  ? `${log.first_name} ${log.last_name || ''}`
                  : log.email || 'System';

                return (
                  <View key={log.id} style={logStyles.row}>
                    <View style={[logStyles.iconWrap, { backgroundColor: ai.color + '22' }]}>
                      <Ionicons name={ai.icon as any} size={16} color={ai.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={logStyles.action}>
                        <Text style={logStyles.actionBold}>{log.action}</Text>
                        {' '}{log.entity_type}
                        {log.entity_id ? ` #${log.entity_id.slice(0, 8)}` : ''}
                      </Text>
                      <Text style={logStyles.meta}>
                        {userName} · {time.toLocaleDateString()} {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {log.ip_address ? ` · ${log.ip_address}` : ''}
                      </Text>
                    </View>
                  </View>
                );
              })}

              {logs.length < total && (
                <TouchableOpacity style={styles.loadMoreBtn} onPress={loadMore} disabled={loadingMore}>
                  {loadingMore ? (
                    <ActivityIndicator size="small" color={Colors.highlight} />
                  ) : (
                    <Text style={styles.loadMoreText}>Load More ({total - logs.length} remaining)</Text>
                  )}
                </TouchableOpacity>
              )}
            </>
          )}
        </Card>

        {/* Quick Links */}
        <Card style={styles.card}>
          <SectionHeader title="Compliance Resources" />
          <LinkRow icon="document-text" label="Terms of Service" onPress={() => router.push('/legal/terms')} />
          <LinkRow icon="shield-checkmark" label="Privacy Policy" onPress={() => router.push('/legal/privacy')} />
          <LinkRow icon="briefcase" label="Data Processing Agreement" onPress={() => router.push('/legal/dpa')} />
          <LinkRow icon="hand-left" label="Acceptable Use Policy" onPress={() => router.push('/legal/acceptable-use')} last />
        </Card>

        <View style={{ height: Spacing.xxl * 2 }} />
      </ResponsiveScrollView>
    </>
  );
}

function GovRow({ icon, label, value, last }: { icon: string; label: string; value: string; last?: boolean }) {
  return (
    <View style={[govStyles.row, !last && govStyles.border]}>
      <Ionicons name={icon as any} size={16} color={Colors.highlight} />
      <View style={{ flex: 1 }}>
        <Text style={govStyles.label}>{label}</Text>
        <Text style={govStyles.value}>{value}</Text>
      </View>
    </View>
  );
}

function LinkRow({ icon, label, onPress, last }: { icon: string; label: string; onPress: () => void; last?: boolean }) {
  return (
    <TouchableOpacity style={[lrStyles.row, !last && lrStyles.border]} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon as any} size={18} color={Colors.textLight} />
      <Text style={lrStyles.label}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={Colors.textLight} />
    </TouchableOpacity>
  );
}

const checkStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm + 2 },
  border: { borderBottomWidth: 0.5, borderBottomColor: Colors.accent },
  iconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontSize: FontSize.md, color: Colors.textWhite, fontWeight: FontWeight.medium as any },
});

const govStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, paddingVertical: Spacing.sm + 2 },
  border: { borderBottomWidth: 0.5, borderBottomColor: Colors.accent },
  label: { fontSize: FontSize.sm, color: Colors.textLight },
  value: { fontSize: FontSize.sm, color: Colors.textWhite, fontWeight: FontWeight.medium as any, marginTop: 1 },
});

const logStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, paddingVertical: Spacing.sm + 2, borderBottomWidth: 0.5, borderBottomColor: Colors.accent },
  iconWrap: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  action: { fontSize: FontSize.sm, color: Colors.textSecondary },
  actionBold: { fontWeight: FontWeight.semibold as any, color: Colors.textWhite, textTransform: 'capitalize' },
  meta: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 2 },
});

const lrStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm + 4 },
  border: { borderBottomWidth: 0.5, borderBottomColor: Colors.accent },
  label: { flex: 1, fontSize: FontSize.md, color: Colors.textWhite, fontWeight: FontWeight.medium as any },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scoreCard: { marginHorizontal: Spacing.md, marginTop: Spacing.md, padding: Spacing.lg },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  scoreCircle: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 4, borderColor: Colors.success,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.successSubtle,
  },
  scoreValue: { fontSize: FontSize.xl, fontWeight: FontWeight.bold as any, color: Colors.success },
  scoreTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold as any, color: Colors.textPrimary },
  scoreSub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  orgLabel: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: Spacing.sm, marginHorizontal: Spacing.md, marginTop: Spacing.md },
  card: { marginHorizontal: Spacing.md, marginTop: Spacing.md, padding: Spacing.lg },
  auditHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: FontSize.xs, color: Colors.textLight },
  filterLabel: { fontSize: FontSize.xs, color: Colors.textLight, fontWeight: FontWeight.bold as any, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: Spacing.sm, marginBottom: Spacing.xs },
  filterRow: { flexDirection: 'row', marginBottom: Spacing.xs },
  filterChip: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full, borderWidth: 1,
    borderColor: Colors.accent, backgroundColor: Colors.surface,
    marginRight: Spacing.xs,
  },
  filterChipActive: { borderColor: Colors.highlight, backgroundColor: Colors.highlightSubtle },
  filterChipText: { fontSize: FontSize.xs, color: Colors.textLight, textTransform: 'capitalize' },
  filterChipTextActive: { color: Colors.highlight, fontWeight: FontWeight.semibold as any },
  emptyWrap: { alignItems: 'center', paddingVertical: Spacing.xl, gap: Spacing.sm },
  emptyText: { fontSize: FontSize.md, color: Colors.textLight },
  loadMoreBtn: { alignItems: 'center', paddingVertical: Spacing.md },
  loadMoreText: { color: Colors.highlight, fontSize: FontSize.sm, fontWeight: FontWeight.medium as any },
});
