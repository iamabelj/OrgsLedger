// ============================================================
// OrgsLedger — Developer Console
// Comprehensive platform management for developers
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
  Modal,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../src/theme';
import { Card, SectionHeader, ResponsiveScrollView } from '../../src/components/ui';
import { showAlert } from '../../src/utils/alert';

type Tab = 'overview' | 'plans' | 'orgs' | 'users' | 'audit';

interface SubscriptionPlan {
  id: string;
  name: string;
  slug: string;
  description?: string;
  max_members: number;
  price_usd_annual: number;
  price_usd_monthly?: number;
  price_ngn_annual: number;
  price_ngn_monthly?: number;
  features: Record<string, boolean>;
  is_active: boolean;
  sort_order: number;
  subscriber_count?: number;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  status: string;
  subscription_status: string;
  billing_currency: string;
  member_count: number;
  plan_name?: string;
  plan_slug?: string;
  ai_balance_minutes: number;
  translation_balance_minutes: number;
  created_at: string;
}

interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  global_role: string;
  is_verified: boolean;
  org_count: number;
  created_at: string;
  last_login_at?: string;
}

export default function DeveloperConsole() {
  const globalRole = useAuthStore((s) => s.user?.globalRole);
  const isDeveloper = globalRole === 'developer' || globalRole === 'super_admin';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');

  // Data states
  const [revenue, setRevenue] = useState<any>(null);
  const [walletAnalytics, setWalletAnalytics] = useState<any>(null);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [riskData, setRiskData] = useState<any>(null);

  // Search/filter
  const [userSearch, setUserSearch] = useState('');
  const [orgSearch, setOrgSearch] = useState('');

  // Modals
  const [planModal, setPlanModal] = useState<{ visible: boolean; plan?: SubscriptionPlan }>({ visible: false });
  const [orgModal, setOrgModal] = useState<{ visible: boolean; org?: Organization; mode: 'edit' | 'create' }>({ visible: false, mode: 'create' });
  const [userModal, setUserModal] = useState<{ visible: boolean; user?: User }>({ visible: false });

  // Form states
  const [planForm, setPlanForm] = useState({
    name: '',
    slug: '',
    description: '',
    maxMembers: '100',
    priceUsdAnnual: '0',
    priceUsdMonthly: '',
    priceNgnAnnual: '0',
    priceNgnMonthly: '',
    sortOrder: '0',
    isActive: true,
  });

  const [orgForm, setOrgForm] = useState({
    name: '',
    slug: '',
    ownerEmail: '',
    plan: 'standard',
    currency: 'USD',
    status: 'active',
    subscriptionStatus: 'active',
  });

  const [userForm, setUserForm] = useState({
    firstName: '',
    lastName: '',
    globalRole: 'user',
    isVerified: true,
  });

  // ── Data Loading ──────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [revRes, walletRes, subsRes, orgsRes, plansRes, usersRes, auditRes, riskRes] = await Promise.all([
        api.subscriptions.adminRevenue().catch(() => ({ data: {} })),
        api.subscriptions.adminWalletAnalytics().catch(() => ({ data: {} })),
        api.subscriptions.adminSubscriptions({ limit: 200 }).catch(() => ({ data: { subscriptions: [] } })),
        api.subscriptions.adminOrganizations().catch(() => ({ data: { organizations: [] } })),
        api.subscriptions.adminPlans().catch(() => ({ data: { data: [] } })),
        api.subscriptions.adminUsers({ limit: 100 }).catch(() => ({ data: { data: [] } })),
        api.subscriptions.adminAuditLogs({ limit: 50 }).catch(() => ({ data: { data: [] } })),
        api.subscriptions.adminRiskLowBalances().catch(() => ({ data: { low_balances: [] } })),
      ]);

      setRevenue(revRes.data);
      setWalletAnalytics(walletRes.data?.summary || walletRes.data);
      setSubscriptions(revRes.data?.subscriptions || subsRes.data?.subscriptions || []);
      setOrgs(orgsRes.data?.organizations || []);
      setPlans(plansRes.data?.data || []);
      setUsers(usersRes.data?.data || []);
      setAuditLogs(auditRes.data?.data || []);
      setRiskData(riskRes.data);
    } catch (err: any) {
      console.error('Developer console error', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isDeveloper) loadData();
  }, [isDeveloper, loadData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // ── Access Denied Screen ──────────────────────────────────
  if (!isDeveloper) {
    return (
      <View style={styles.center}>
        <Ionicons name="shield" size={64} color={Colors.error} />
        <Text style={styles.deniedTitle}>Developer Access Only</Text>
        <Text style={styles.deniedText}>
          This console is restricted to platform developers.
        </Text>
      </View>
    );
  }

  // ── Loading Screen ────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.highlight} />
        <Text style={styles.loadingText}>Loading Developer Console...</Text>
      </View>
    );
  }

  // ── Plan CRUD Handlers ────────────────────────────────────
  const openPlanModal = (plan?: SubscriptionPlan) => {
    if (plan) {
      setPlanForm({
        name: plan.name,
        slug: plan.slug,
        description: plan.description || '',
        maxMembers: String(plan.max_members),
        priceUsdAnnual: String(plan.price_usd_annual),
        priceUsdMonthly: plan.price_usd_monthly ? String(plan.price_usd_monthly) : '',
        priceNgnAnnual: String(plan.price_ngn_annual),
        priceNgnMonthly: plan.price_ngn_monthly ? String(plan.price_ngn_monthly) : '',
        sortOrder: String(plan.sort_order),
        isActive: plan.is_active,
      });
    } else {
      setPlanForm({
        name: '',
        slug: '',
        description: '',
        maxMembers: '100',
        priceUsdAnnual: '0',
        priceUsdMonthly: '',
        priceNgnAnnual: '0',
        priceNgnMonthly: '',
        sortOrder: String(plans.length),
        isActive: true,
      });
    }
    setPlanModal({ visible: true, plan });
  };

  const savePlan = async () => {
    try {
      const data = {
        name: planForm.name,
        slug: planForm.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        description: planForm.description || undefined,
        maxMembers: parseInt(planForm.maxMembers) || 100,
        priceUsdAnnual: parseFloat(planForm.priceUsdAnnual) || 0,
        priceUsdMonthly: planForm.priceUsdMonthly ? parseFloat(planForm.priceUsdMonthly) : undefined,
        priceNgnAnnual: parseFloat(planForm.priceNgnAnnual) || 0,
        priceNgnMonthly: planForm.priceNgnMonthly ? parseFloat(planForm.priceNgnMonthly) : undefined,
        sortOrder: parseInt(planForm.sortOrder) || 0,
        isActive: planForm.isActive,
      };

      if (planModal.plan) {
        await api.subscriptions.adminUpdatePlan(planModal.plan.id, {
          name: data.name,
          description: data.description,
          max_members: data.maxMembers,
          price_usd_annual: data.priceUsdAnnual,
          price_usd_monthly: data.priceUsdMonthly,
          price_ngn_annual: data.priceNgnAnnual,
          price_ngn_monthly: data.priceNgnMonthly,
          sort_order: data.sortOrder,
          is_active: data.isActive,
        });
        showAlert('Success', 'Plan updated successfully');
      } else {
        await api.subscriptions.adminCreatePlan(data);
        showAlert('Success', 'Plan created successfully');
      }

      setPlanModal({ visible: false });
      loadData();
    } catch (err: any) {
      showAlert('Error', err?.response?.data?.error || 'Failed to save plan');
    }
  };

  const deletePlan = (plan: SubscriptionPlan) => {
    showAlert(
      `Delete "${plan.name}"?`,
      plan.subscriber_count && plan.subscriber_count > 0
        ? `This plan has ${plan.subscriber_count} active subscribers. It will be archived instead of deleted.`
        : 'This will permanently delete the plan.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.subscriptions.adminDeletePlan(plan.id);
              showAlert('Success', 'Plan deleted');
              loadData();
            } catch (err: any) {
              showAlert('Error', err?.response?.data?.error || 'Failed to delete plan');
            }
          },
        },
      ]
    );
  };

  // ── Organization CRUD Handlers ────────────────────────────
  const openOrgModal = (org?: Organization, mode: 'edit' | 'create' = 'edit') => {
    if (org && mode === 'edit') {
      setOrgForm({
        name: org.name,
        slug: org.slug,
        ownerEmail: '',
        plan: org.plan_slug || 'standard',
        currency: org.billing_currency || 'USD',
        status: org.status || 'active',
        subscriptionStatus: org.subscription_status || 'active',
      });
      setOrgModal({ visible: true, org, mode: 'edit' });
    } else {
      setOrgForm({
        name: '',
        slug: '',
        ownerEmail: '',
        plan: 'standard',
        currency: 'USD',
        status: 'active',
        subscriptionStatus: 'active',
      });
      setOrgModal({ visible: true, mode: 'create' });
    }
  };

  const saveOrg = async () => {
    try {
      if (orgModal.mode === 'create') {
        await api.subscriptions.adminCreateOrganization({
          name: orgForm.name,
          slug: orgForm.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          ownerEmail: orgForm.ownerEmail,
          plan: orgForm.plan as any,
          currency: orgForm.currency as any,
        });
        showAlert('Success', 'Organization created successfully');
      } else if (orgModal.org) {
        await api.subscriptions.adminUpdateOrganization(orgModal.org.id, {
          name: orgForm.name,
          slug: orgForm.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          status: orgForm.status,
          subscriptionStatus: orgForm.subscriptionStatus,
          billingCurrency: orgForm.currency,
        });
        showAlert('Success', 'Organization updated successfully');
      }

      setOrgModal({ visible: false, mode: 'create' });
      loadData();
    } catch (err: any) {
      showAlert('Error', err?.response?.data?.error || 'Failed to save organization');
    }
  };

  const deleteOrg = (org: Organization) => {
    showAlert(
      `Delete "${org.name}"?`,
      `This will permanently delete the organization and all its data. This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.subscriptions.adminDeleteOrganization(org.id, true);
              showAlert('Success', 'Organization deleted');
              loadData();
            } catch (err: any) {
              showAlert('Error', err?.response?.data?.error || 'Failed to delete organization');
            }
          },
        },
      ]
    );
  };

  const suspendOrg = (org: Organization) => {
    const action = org.subscription_status === 'suspended' ? 'activate' : 'suspend';
    showAlert(
      `${action === 'suspend' ? 'Suspend' : 'Activate'} "${org.name}"?`,
      action === 'suspend'
        ? 'Members will lose access to the platform.'
        : 'Members will regain access to the platform.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: action === 'suspend' ? 'destructive' : 'default',
          onPress: async () => {
            try {
              await api.subscriptions.adminOrgStatus({ organizationId: org.id, action });
              showAlert('Success', `Organization ${action}d`);
              loadData();
            } catch (err: any) {
              showAlert('Error', err?.response?.data?.error || 'Action failed');
            }
          },
        },
      ]
    );
  };

  // ── User Handlers ─────────────────────────────────────────
  const openUserModal = (user: User) => {
    setUserForm({
      firstName: user.first_name,
      lastName: user.last_name,
      globalRole: user.global_role,
      isVerified: user.is_verified,
    });
    setUserModal({ visible: true, user });
  };

  const saveUser = async () => {
    if (!userModal.user) return;
    try {
      await api.subscriptions.adminUpdateUser(userModal.user.id, {
        firstName: userForm.firstName,
        lastName: userForm.lastName,
        globalRole: userForm.globalRole,
        isVerified: userForm.isVerified,
      });
      showAlert('Success', 'User updated successfully');
      setUserModal({ visible: false });
      loadData();
    } catch (err: any) {
      showAlert('Error', err?.response?.data?.error || 'Failed to update user');
    }
  };

  // ── Filter Helpers ────────────────────────────────────────
  const filteredOrgs = orgs.filter(
    (o) =>
      !orgSearch ||
      o.name.toLowerCase().includes(orgSearch.toLowerCase()) ||
      o.slug.toLowerCase().includes(orgSearch.toLowerCase())
  );

  const filteredUsers = users.filter(
    (u) =>
      !userSearch ||
      u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
      `${u.first_name} ${u.last_name}`.toLowerCase().includes(userSearch.toLowerCase())
  );

  // ── Stats Calculations ────────────────────────────────────
  const activeCount = subscriptions.filter((s: any) => s.status === 'active').length;
  const graceCount = subscriptions.filter((s: any) => s.status === 'grace_period').length;
  const expiredCount = subscriptions.filter((s: any) => s.status === 'expired').length;

  // ── Render ────────────────────────────────────────────────
  return (
    <ResponsiveScrollView
      style={styles.container}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Developer Console</Text>
        <Text style={styles.headerSubtitle}>Platform Management</Text>
      </View>

      {/* Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll}>
        <View style={styles.tabs}>
          {([
            { key: 'overview', label: 'Overview', icon: 'stats-chart' },
            { key: 'plans', label: 'Plans', icon: 'layers' },
            { key: 'orgs', label: 'Organizations', icon: 'business' },
            { key: 'users', label: 'Users', icon: 'people' },
            { key: 'audit', label: 'Audit', icon: 'document-text' },
          ] as const).map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, tab === t.key && styles.tabActive]}
              onPress={() => setTab(t.key)}
            >
              <Ionicons name={t.icon as any} size={18} color={tab === t.key ? Colors.highlight : Colors.textLight} />
              <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* ════════════════════════════════════════════════════════ */}
      {/* OVERVIEW TAB */}
      {/* ════════════════════════════════════════════════════════ */}
      {tab === 'overview' && (
        <View style={styles.section}>
          <SectionHeader title="Platform Metrics" />
          <View style={styles.statsGrid}>
            <StatCard label="Total Revenue (USD)" value={`$${fmtNum(revenue?.total_revenue_usd || 0)}`} icon="cash" color={Colors.success} />
            <StatCard label="Total Revenue (NGN)" value={`₦${fmtNum(revenue?.total_revenue_ngn || 0)}`} icon="cash" color={Colors.success} />
            <StatCard label="Organizations" value={String(orgs.length)} icon="business" color={Colors.highlight} />
            <StatCard label="Users" value={String(users.length)} icon="people" color={Colors.info} />
          </View>

          <SectionHeader title="Subscription Status" />
          <View style={styles.statusRow}>
            <StatusPill label="Active" count={activeCount} color={Colors.success} />
            <StatusPill label="Grace" count={graceCount} color={Colors.warning} />
            <StatusPill label="Expired" count={expiredCount} color={Colors.error} />
          </View>

          <SectionHeader title="Wallet Analytics" />
          <Card style={styles.card}>
            <View style={styles.analyticRow}>
              <Ionicons name={"sparkles" as any} size={18} color={Colors.highlight} />
              <Text style={styles.analyticLabel}>AI Hours (Balance/Used)</Text>
              <Text style={styles.analyticValue}>
                {fmtNum(walletAnalytics?.total_ai_balance_hours || 0)}h / {fmtNum(walletAnalytics?.total_ai_used_hours || 0)}h
              </Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.analyticRow}>
              <Ionicons name="language" size={18} color={Colors.info} />
              <Text style={styles.analyticLabel}>Translation Hours (Balance/Used)</Text>
              <Text style={styles.analyticValue}>
                {fmtNum(walletAnalytics?.total_translation_balance_hours || 0)}h / {fmtNum(walletAnalytics?.total_translation_used_hours || 0)}h
              </Text>
            </View>
          </Card>

          {/* Risk Alerts */}
          {riskData?.low_balances?.length > 0 && (
            <>
              <SectionHeader title="Risk Alerts" />
              <Card style={{ ...styles.card, borderColor: Colors.warning + '50' }}>
                <View style={styles.riskHeader}>
                  <Ionicons name="warning" size={20} color={Colors.warning} />
                  <Text style={styles.riskTitle}>{riskData.low_balances.length} Low Balance Wallets</Text>
                </View>
                {riskData.low_balances.slice(0, 5).map((r: any, i: number) => (
                  <Text key={i} style={styles.riskItem}>
                    • {r.name}: AI {r.ai_balance_hours?.toFixed(1)}h, Trans {r.translation_balance_hours?.toFixed(1)}h
                  </Text>
                ))}
              </Card>
            </>
          )}
        </View>
      )}

      {/* ════════════════════════════════════════════════════════ */}
      {/* PLANS TAB */}
      {/* ════════════════════════════════════════════════════════ */}
      {tab === 'plans' && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <SectionHeader title={`Subscription Plans (${plans.length})`} />
            <TouchableOpacity style={styles.addBtn} onPress={() => openPlanModal()}>
              <Ionicons name="add" size={20} color={Colors.highlight} />
              <Text style={styles.addBtnText}>New Plan</Text>
            </TouchableOpacity>
          </View>

          {plans.map((plan) => (
            <Card key={plan.id} style={!plan.is_active ? { ...styles.card, ...styles.cardInactive } : styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{plan.name}</Text>
                  <Text style={styles.cardSubtitle}>/{plan.slug}</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: plan.is_active ? Colors.success + '20' : Colors.textLight + '20' }]}>
                  <Text style={[styles.badgeText, { color: plan.is_active ? Colors.success : Colors.textLight }]}>
                    {plan.is_active ? 'Active' : 'Inactive'}
                  </Text>
                </View>
              </View>

              {plan.description && (
                <Text style={styles.cardDescription}>{plan.description}</Text>
              )}

              <View style={styles.planDetails}>
                <View style={styles.planDetailItem}>
                  <Ionicons name="people" size={14} color={Colors.textLight} />
                  <Text style={styles.planDetailText}>Max {plan.max_members} members</Text>
                </View>
                <View style={styles.planDetailItem}>
                  <Ionicons name="card" size={14} color={Colors.textLight} />
                  <Text style={styles.planDetailText}>
                    ${plan.price_usd_annual}/yr • ₦{fmtNum(plan.price_ngn_annual)}/yr
                  </Text>
                </View>
                {plan.subscriber_count !== undefined && (
                  <View style={styles.planDetailItem}>
                    <Ionicons name="business" size={14} color={Colors.highlight} />
                    <Text style={[styles.planDetailText, { color: Colors.highlight }]}>
                      {plan.subscriber_count} subscriber{plan.subscriber_count !== 1 ? 's' : ''}
                    </Text>
                  </View>
                )}
              </View>

              <View style={styles.cardActions}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => openPlanModal(plan)}>
                  <Ionicons name="pencil" size={16} color={Colors.highlight} />
                  <Text style={[styles.actionBtnText, { color: Colors.highlight }]}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => deletePlan(plan)}>
                  <Ionicons name="trash" size={16} color={Colors.error} />
                  <Text style={[styles.actionBtnText, { color: Colors.error }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </Card>
          ))}
        </View>
      )}

      {/* ════════════════════════════════════════════════════════ */}
      {/* ORGANIZATIONS TAB */}
      {/* ════════════════════════════════════════════════════════ */}
      {tab === 'orgs' && (
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <SectionHeader title={`Organizations (${filteredOrgs.length})`} />
            <TouchableOpacity style={styles.addBtn} onPress={() => openOrgModal(undefined, 'create')}>
              <Ionicons name="add" size={20} color={Colors.highlight} />
              <Text style={styles.addBtnText}>New Org</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.searchInput}
            value={orgSearch}
            onChangeText={setOrgSearch}
            placeholder="Search organizations..."
            placeholderTextColor={Colors.textLight}
          />

          {filteredOrgs.map((org) => {
            const statusColor = 
              org.subscription_status === 'active' ? Colors.success :
              org.subscription_status === 'grace_period' ? Colors.warning :
              org.subscription_status === 'suspended' ? Colors.error : Colors.textLight;

            return (
              <Card key={org.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{org.name}</Text>
                    <Text style={styles.cardSubtitle}>/{org.slug} • {org.member_count} members</Text>
                  </View>
                  <View style={[styles.badge, { backgroundColor: statusColor + '20' }]}>
                    <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                    <Text style={[styles.badgeText, { color: statusColor }]}>
                      {org.subscription_status?.replace('_', ' ') || 'none'}
                    </Text>
                  </View>
                </View>

                <View style={styles.orgDetails}>
                  <View style={styles.orgDetailItem}>
                    <Ionicons name="card" size={14} color={Colors.textLight} />
                    <Text style={styles.orgDetailText}>{org.plan_name || 'No plan'}</Text>
                  </View>
                  <View style={styles.orgDetailItem}>
                    <Ionicons name={"sparkles" as any} size={14} color={Colors.highlight} />
                    <Text style={styles.orgDetailText}>
                      AI: {((org.ai_balance_minutes || 0) / 60).toFixed(1)}h
                    </Text>
                  </View>
                  <View style={styles.orgDetailItem}>
                    <Ionicons name="language" size={14} color={Colors.info} />
                    <Text style={styles.orgDetailText}>
                      Trans: {((org.translation_balance_minutes || 0) / 60).toFixed(1)}h
                    </Text>
                  </View>
                </View>

                <View style={styles.cardActions}>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => openOrgModal(org, 'edit')}>
                    <Ionicons name="pencil" size={16} color={Colors.highlight} />
                    <Text style={[styles.actionBtnText, { color: Colors.highlight }]}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => suspendOrg(org)}>
                    <Ionicons
                      name={(org.subscription_status === 'suspended' ? 'checkmark-circle' : 'ban') as any}
                      size={16}
                      color={org.subscription_status === 'suspended' ? Colors.success : Colors.warning}
                    />
                    <Text style={[styles.actionBtnText, { color: org.subscription_status === 'suspended' ? Colors.success : Colors.warning }]}>
                      {org.subscription_status === 'suspended' ? 'Activate' : 'Suspend'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.actionBtn} onPress={() => deleteOrg(org)}>
                    <Ionicons name="trash" size={16} color={Colors.error} />
                    <Text style={[styles.actionBtnText, { color: Colors.error }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </Card>
            );
          })}
        </View>
      )}

      {/* ════════════════════════════════════════════════════════ */}
      {/* USERS TAB */}
      {/* ════════════════════════════════════════════════════════ */}
      {tab === 'users' && (
        <View style={styles.section}>
          <SectionHeader title={`Platform Users (${filteredUsers.length})`} />

          <TextInput
            style={styles.searchInput}
            value={userSearch}
            onChangeText={setUserSearch}
            placeholder="Search users by email or name..."
            placeholderTextColor={Colors.textLight}
          />

          {filteredUsers.map((user) => (
            <Card key={user.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{user.first_name} {user.last_name}</Text>
                  <Text style={styles.cardSubtitle}>{user.email}</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: roleColor(user.global_role) + '20' }]}>
                  <Text style={[styles.badgeText, { color: roleColor(user.global_role) }]}>
                    {user.global_role}
                  </Text>
                </View>
              </View>

              <View style={styles.userDetails}>
                <View style={styles.userDetailItem}>
                  <Ionicons name="business" size={14} color={Colors.textLight} />
                  <Text style={styles.userDetailText}>{user.org_count} organization{user.org_count !== 1 ? 's' : ''}</Text>
                </View>
                <View style={styles.userDetailItem}>
                  <Ionicons name={user.is_verified ? 'checkmark-circle' : 'close-circle'} size={14} color={user.is_verified ? Colors.success : Colors.error} />
                  <Text style={styles.userDetailText}>{user.is_verified ? 'Verified' : 'Not verified'}</Text>
                </View>
                <View style={styles.userDetailItem}>
                  <Ionicons name="calendar" size={14} color={Colors.textLight} />
                  <Text style={styles.userDetailText}>Joined {formatDate(user.created_at)}</Text>
                </View>
              </View>

              <View style={styles.cardActions}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => openUserModal(user)}>
                  <Ionicons name="pencil" size={16} color={Colors.highlight} />
                  <Text style={[styles.actionBtnText, { color: Colors.highlight }]}>Edit</Text>
                </TouchableOpacity>
              </View>
            </Card>
          ))}
        </View>
      )}

      {/* ════════════════════════════════════════════════════════ */}
      {/* AUDIT TAB */}
      {/* ════════════════════════════════════════════════════════ */}
      {tab === 'audit' && (
        <View style={styles.section}>
          <SectionHeader title="Recent Audit Logs" />

          {auditLogs.length === 0 ? (
            <Text style={styles.emptyText}>No audit logs found</Text>
          ) : (
            auditLogs.map((log: any, idx: number) => (
              <Card key={log.id || idx} style={styles.auditCard}>
                <View style={styles.auditHeader}>
                  <Ionicons name={actionIcon(log.action)} size={16} color={actionColor(log.action)} />
                  <Text style={styles.auditAction}>{log.action}</Text>
                  <Text style={styles.auditTime}>{formatDateTime(log.created_at)}</Text>
                </View>
                <Text style={styles.auditEntity}>
                  {log.entity_type} • {log.email || 'System'}
                </Text>
                {log.entity_id && (
                  <Text style={styles.auditId} numberOfLines={1}>ID: {log.entity_id}</Text>
                )}
              </Card>
            ))
          )}
        </View>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>OrgsLedger Developer Console v1.0</Text>
      </View>

      {/* ════════════════════════════════════════════════════════ */}
      {/* PLAN MODAL */}
      {/* ════════════════════════════════════════════════════════ */}
      <Modal visible={planModal.visible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {planModal.plan ? 'Edit Plan' : 'New Plan'}
              </Text>
              <TouchableOpacity onPress={() => setPlanModal({ visible: false })}>
                <Ionicons name="close" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <FormField label="Name" value={planForm.name} onChangeText={(v) => setPlanForm({ ...planForm, name: v })} placeholder="e.g. Enterprise" />
              <FormField label="Slug" value={planForm.slug} onChangeText={(v) => setPlanForm({ ...planForm, slug: v })} placeholder="e.g. enterprise" editable={!planModal.plan} />
              <FormField label="Description" value={planForm.description} onChangeText={(v) => setPlanForm({ ...planForm, description: v })} placeholder="Plan description..." multiline />
              <FormField label="Max Members" value={planForm.maxMembers} onChangeText={(v) => setPlanForm({ ...planForm, maxMembers: v })} keyboardType="numeric" />
              
              <Text style={styles.formSectionTitle}>Pricing (USD)</Text>
              <View style={styles.formRow}>
                <FormField label="Annual" value={planForm.priceUsdAnnual} onChangeText={(v) => setPlanForm({ ...planForm, priceUsdAnnual: v })} keyboardType="numeric" style={{ flex: 1 }} />
                <FormField label="Monthly" value={planForm.priceUsdMonthly} onChangeText={(v) => setPlanForm({ ...planForm, priceUsdMonthly: v })} keyboardType="numeric" style={{ flex: 1 }} />
              </View>

              <Text style={styles.formSectionTitle}>Pricing (NGN)</Text>
              <View style={styles.formRow}>
                <FormField label="Annual" value={planForm.priceNgnAnnual} onChangeText={(v) => setPlanForm({ ...planForm, priceNgnAnnual: v })} keyboardType="numeric" style={{ flex: 1 }} />
                <FormField label="Monthly" value={planForm.priceNgnMonthly} onChangeText={(v) => setPlanForm({ ...planForm, priceNgnMonthly: v })} keyboardType="numeric" style={{ flex: 1 }} />
              </View>

              <FormField label="Sort Order" value={planForm.sortOrder} onChangeText={(v) => setPlanForm({ ...planForm, sortOrder: v })} keyboardType="numeric" />
              
              <TouchableOpacity
                style={styles.toggleField}
                onPress={() => setPlanForm({ ...planForm, isActive: !planForm.isActive })}
              >
                <Text style={styles.toggleLabel}>Active</Text>
                <Ionicons
                  name={planForm.isActive ? 'checkbox' : 'square-outline'}
                  size={24}
                  color={planForm.isActive ? Colors.success : Colors.textLight}
                />
              </TouchableOpacity>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setPlanModal({ visible: false })}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={savePlan}>
                <Text style={styles.saveBtnText}>Save Plan</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ════════════════════════════════════════════════════════ */}
      {/* ORG MODAL */}
      {/* ════════════════════════════════════════════════════════ */}
      <Modal visible={orgModal.visible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {orgModal.mode === 'create' ? 'Create Organization' : 'Edit Organization'}
              </Text>
              <TouchableOpacity onPress={() => setOrgModal({ visible: false, mode: 'create' })}>
                <Ionicons name="close" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              <FormField label="Name" value={orgForm.name} onChangeText={(v) => setOrgForm({ ...orgForm, name: v })} placeholder="Organization name" />
              <FormField label="Slug" value={orgForm.slug} onChangeText={(v) => setOrgForm({ ...orgForm, slug: v })} placeholder="organization-slug" />
              
              {orgModal.mode === 'create' && (
                <>
                  <FormField label="Owner Email" value={orgForm.ownerEmail} onChangeText={(v) => setOrgForm({ ...orgForm, ownerEmail: v })} placeholder="admin@example.com" keyboardType="email-address" />
                  
                  <Text style={styles.fieldLabel}>Plan</Text>
                  <View style={styles.selectRow}>
                    {['standard', 'professional', 'enterprise'].map((p) => (
                      <TouchableOpacity
                        key={p}
                        style={[styles.selectOption, orgForm.plan === p && styles.selectOptionActive]}
                        onPress={() => setOrgForm({ ...orgForm, plan: p })}
                      >
                        <Text style={[styles.selectOptionText, orgForm.plan === p && styles.selectOptionTextActive]}>
                          {p.charAt(0).toUpperCase() + p.slice(1)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              <Text style={styles.fieldLabel}>Currency</Text>
              <View style={styles.selectRow}>
                {['USD', 'NGN'].map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.selectOption, orgForm.currency === c && styles.selectOptionActive]}
                    onPress={() => setOrgForm({ ...orgForm, currency: c })}
                  >
                    <Text style={[styles.selectOptionText, orgForm.currency === c && styles.selectOptionTextActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {orgModal.mode === 'edit' && (
                <>
                  <Text style={styles.fieldLabel}>Subscription Status</Text>
                  <View style={styles.selectRow}>
                    {['active', 'grace_period', 'suspended', 'expired'].map((s) => (
                      <TouchableOpacity
                        key={s}
                        style={[styles.selectOption, orgForm.subscriptionStatus === s && styles.selectOptionActive]}
                        onPress={() => setOrgForm({ ...orgForm, subscriptionStatus: s })}
                      >
                        <Text style={[styles.selectOptionText, orgForm.subscriptionStatus === s && styles.selectOptionTextActive]}>
                          {s.replace('_', ' ')}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setOrgModal({ visible: false, mode: 'create' })}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveOrg}>
                <Text style={styles.saveBtnText}>{orgModal.mode === 'create' ? 'Create' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ════════════════════════════════════════════════════════ */}
      {/* USER MODAL */}
      {/* ════════════════════════════════════════════════════════ */}
      <Modal visible={userModal.visible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit User</Text>
              <TouchableOpacity onPress={() => setUserModal({ visible: false })}>
                <Ionicons name="close" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody}>
              {userModal.user && (
                <Text style={styles.userEmail}>{userModal.user.email}</Text>
              )}

              <FormField label="First Name" value={userForm.firstName} onChangeText={(v) => setUserForm({ ...userForm, firstName: v })} />
              <FormField label="Last Name" value={userForm.lastName} onChangeText={(v) => setUserForm({ ...userForm, lastName: v })} />

              <Text style={styles.fieldLabel}>Global Role</Text>
              <View style={styles.selectRow}>
                {['user', 'developer', 'super_admin'].map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.selectOption, userForm.globalRole === r && styles.selectOptionActive]}
                    onPress={() => setUserForm({ ...userForm, globalRole: r })}
                  >
                    <Text style={[styles.selectOptionText, userForm.globalRole === r && styles.selectOptionTextActive]}>
                      {r.replace('_', ' ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={styles.toggleField}
                onPress={() => setUserForm({ ...userForm, isVerified: !userForm.isVerified })}
              >
                <Text style={styles.toggleLabel}>Email Verified</Text>
                <Ionicons
                  name={userForm.isVerified ? 'checkbox' : 'square-outline'}
                  size={24}
                  color={userForm.isVerified ? Colors.success : Colors.textLight}
                />
              </TouchableOpacity>
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setUserModal({ visible: false })}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveUser}>
                <Text style={styles.saveBtnText}>Save User</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ResponsiveScrollView>
  );
}

// ── Helper Components ─────────────────────────────────────────

function StatCard({ label, value, icon, color }: { label: string; value: string; icon: string; color: string }) {
  return (
    <Card style={{ ...styles.statCard, borderColor: color + '30' }}>
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

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  multiline = false,
  editable = true,
  style,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'email-address';
  multiline?: boolean;
  editable?: boolean;
  style?: any;
}) {
  return (
    <View style={[styles.formField, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline, !editable && styles.inputDisabled]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textLight}
        keyboardType={keyboardType}
        multiline={multiline}
        editable={editable}
      />
    </View>
  );
}

function fmtNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toFixed(n % 1 === 0 ? 0 : 2);
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function roleColor(role: string): string {
  if (role === 'developer' || role === 'super_admin') return Colors.highlight;
  return Colors.textSecondary;
}

function actionIcon(action: string): any {
  if (action.includes('create')) return 'add-circle';
  if (action.includes('update') || action.includes('change')) return 'pencil';
  if (action.includes('delete')) return 'trash';
  if (action.includes('login')) return 'log-in';
  if (action.includes('suspend')) return 'ban';
  if (action.includes('activate')) return 'checkmark-circle';
  return 'document-text';
}

function actionColor(action: string): string {
  if (action.includes('create')) return Colors.success;
  if (action.includes('delete') || action.includes('suspend')) return Colors.error;
  if (action.includes('update') || action.includes('change')) return Colors.highlight;
  return Colors.textSecondary;
}

// ── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background, gap: Spacing.md, padding: Spacing.xl },
  deniedTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold as any, color: Colors.textPrimary, marginTop: Spacing.md },
  deniedText: { fontSize: FontSize.md, color: Colors.textLight, textAlign: 'center' },
  loadingText: { fontSize: FontSize.sm, color: Colors.textLight, marginTop: Spacing.md },

  // Header
  header: { padding: Spacing.lg, paddingBottom: 0 },
  headerTitle: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold as any, color: Colors.textPrimary },
  headerSubtitle: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },

  // Tabs
  tabsScroll: { marginVertical: Spacing.md },
  tabs: { flexDirection: 'row', paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 16, borderRadius: BorderRadius.md, backgroundColor: Colors.surface },
  tabActive: { backgroundColor: Colors.highlightSubtle },
  tabText: { fontSize: FontSize.sm, color: Colors.textLight },
  tabTextActive: { color: Colors.highlight, fontWeight: FontWeight.semibold as any },

  // Section
  section: { padding: Spacing.lg },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  // Stats
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.lg },
  statCard: { width: '48%' as any, borderWidth: 1, alignItems: 'center', paddingVertical: Spacing.md },
  statValue: { fontSize: FontSize.lg, fontWeight: FontWeight.bold as any, marginTop: Spacing.xs },
  statLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2, textAlign: 'center' },

  // Status
  statusRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
  pill: { flex: 1, alignItems: 'center', borderWidth: 1, borderRadius: BorderRadius.md, paddingVertical: Spacing.sm },
  pillCount: { fontSize: FontSize.lg, fontWeight: FontWeight.bold as any },
  pillLabel: { fontSize: FontSize.xs, color: Colors.textLight },

  // Cards
  card: { marginBottom: Spacing.md },
  cardInactive: { opacity: 0.6 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: Spacing.sm },
  cardTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold as any, color: Colors.textPrimary },
  cardSubtitle: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 2 },
  cardDescription: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.sm },
  cardActions: { flexDirection: 'row', gap: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm, marginTop: Spacing.sm },

  // Badge
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 10, fontWeight: FontWeight.semibold as any, textTransform: 'capitalize' as any },
  statusDot: { width: 6, height: 6, borderRadius: 3 },

  // Action buttons
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: BorderRadius.sm, backgroundColor: Colors.surface },
  actionBtnText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold as any },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: BorderRadius.md, backgroundColor: Colors.highlightSubtle },
  addBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold as any, color: Colors.highlight },

  // Plan details
  planDetails: { gap: 4, marginBottom: Spacing.sm },
  planDetailItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  planDetailText: { fontSize: FontSize.xs, color: Colors.textSecondary },

  // Org details
  orgDetails: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.sm },
  orgDetailItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  orgDetailText: { fontSize: FontSize.xs, color: Colors.textSecondary },

  // User details
  userDetails: { gap: 4, marginBottom: Spacing.sm },
  userDetailItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  userDetailText: { fontSize: FontSize.xs, color: Colors.textSecondary },

  // Analytics
  analyticRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  analyticLabel: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary },
  analyticValue: { fontSize: FontSize.md, fontWeight: FontWeight.semibold as any, color: Colors.textPrimary },
  divider: { height: 1, backgroundColor: Colors.border },

  // Risk
  riskHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  riskTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold as any, color: Colors.warning },
  riskItem: { fontSize: FontSize.xs, color: Colors.textSecondary, paddingVertical: 2 },

  // Search
  searchInput: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: 10, color: Colors.textPrimary, fontSize: FontSize.sm, marginBottom: Spacing.md },

  // Audit
  auditCard: { marginBottom: Spacing.sm, padding: Spacing.sm },
  auditHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  auditAction: { flex: 1, fontSize: FontSize.sm, fontWeight: FontWeight.semibold as any, color: Colors.textPrimary },
  auditTime: { fontSize: FontSize.xs, color: Colors.textLight },
  auditEntity: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 4 },
  auditId: { fontSize: 10, color: Colors.textLight, marginTop: 2 },

  // Empty
  emptyText: { fontSize: FontSize.sm, color: Colors.textLight, textAlign: 'center', paddingVertical: Spacing.xl },

  // Footer
  footer: { padding: Spacing.xl, alignItems: 'center' },
  footerText: { fontSize: FontSize.xs, color: Colors.textLight },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: Colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold as any, color: Colors.textPrimary },
  modalBody: { padding: Spacing.lg, maxHeight: 400 },
  modalFooter: { flexDirection: 'row', gap: Spacing.sm, padding: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.border },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: BorderRadius.md, backgroundColor: Colors.surface, alignItems: 'center' },
  cancelBtnText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold as any, color: Colors.textSecondary },
  saveBtn: { flex: 1, paddingVertical: 14, borderRadius: BorderRadius.md, backgroundColor: Colors.highlight, alignItems: 'center' },
  saveBtnText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold as any, color: Colors.primary },

  // Form
  formField: { marginBottom: Spacing.md },
  fieldLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold as any, color: Colors.textPrimary, marginBottom: Spacing.xs },
  input: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: 12, color: Colors.textPrimary, fontSize: FontSize.md },
  inputMultiline: { height: 80, textAlignVertical: 'top' },
  inputDisabled: { opacity: 0.5 },
  formSectionTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.bold as any, color: Colors.highlight, marginTop: Spacing.md, marginBottom: Spacing.sm },
  formRow: { flexDirection: 'row', gap: Spacing.md },
  toggleField: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.md },
  toggleLabel: { fontSize: FontSize.md, color: Colors.textPrimary },
  selectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  selectOption: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  selectOptionActive: { borderColor: Colors.highlight, backgroundColor: Colors.highlightSubtle },
  selectOptionText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  selectOptionTextActive: { color: Colors.highlight, fontWeight: FontWeight.semibold as any },
  userEmail: { fontSize: FontSize.sm, color: Colors.textLight, marginBottom: Spacing.md },
});
