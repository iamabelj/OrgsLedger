// ============================================================
// OrgsLedger — Subscription Plans & Wallets (SaaS)
// Plans, subscription status, AI wallet, Translation wallet
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
import { Card, SectionHeader } from '../../src/components/ui';
import { showAlert } from '../../src/utils/alert';

export default function PlansScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const memberships = useAuthStore((s) => s.memberships);
  const globalRole = useAuthStore((s) => s.user?.globalRole);
  const currentMembership = memberships.find((m) => m.organization_id === currentOrgId);
  const isAdmin = globalRole === 'super_admin' || globalRole === 'developer' || currentMembership?.role === 'org_admin';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [plans, setPlans] = useState<any[]>([]);
  const [subscription, setSubscription] = useState<any>(null);
  const [aiWallet, setAiWallet] = useState<any>(null);
  const [translationWallet, setTranslationWallet] = useState<any>(null);
  const [aiTopUpHours, setAiTopUpHours] = useState('1');
  const [transTopUpHours, setTransTopUpHours] = useState('1');
  const [tab, setTab] = useState<'plans' | 'ai' | 'translation'>('plans');

  const loadData = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const [plansRes, subRes, walletsRes] = await Promise.all([
        api.subscriptions.getPlans(),
        api.subscriptions.getSubscription(currentOrgId),
        api.subscriptions.getWallets(currentOrgId),
      ]);
      setPlans(plansRes.data?.data || []);
      setSubscription(subRes.data?.data);
      setAiWallet(walletsRes.data?.data?.ai);
      setTranslationWallet(walletsRes.data?.data?.translation);
    } catch (err: any) {
      console.error('Load plans error', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentOrgId]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = () => { setRefreshing(true); loadData(); };

  const handleSubscribe = async (planSlug: string) => {
    if (!isAdmin) return showAlert('Permission Denied', 'Only admins can manage subscriptions.');
    if (!currentOrgId) return;
    try {
      await api.subscriptions.subscribe(currentOrgId, { planSlug, billingCycle: 'annual' });
      showAlert('Success', 'Subscription activated!');
      loadData();
    } catch (err: any) {
      showAlert('Error', err?.response?.data?.error || 'Subscription failed');
    }
  };

  const handleRenew = async () => {
    if (!isAdmin || !currentOrgId) return;
    try {
      await api.subscriptions.renew(currentOrgId);
      showAlert('Success', 'Subscription renewed!');
      loadData();
    } catch (err: any) {
      showAlert('Error', err?.response?.data?.error || 'Renewal failed');
    }
  };

  const handleAiTopUp = async () => {
    if (!isAdmin || !currentOrgId) return;
    const hours = parseFloat(aiTopUpHours);
    if (!hours || hours < 1) return showAlert('Invalid', 'Enter at least 1 hour.');
    const pricePerHour = aiWallet?.price_per_hour_usd || 10;
    const cost = hours * pricePerHour;
    showAlert('Top Up AI Wallet', `Add ${hours} hour(s) for $${cost.toFixed(2)}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          try {
            await api.subscriptions.topUpAi(currentOrgId!, { hours });
            showAlert('Success', `${hours} hour(s) added to AI wallet!`);
            loadData();
          } catch (err: any) {
            showAlert('Error', err?.response?.data?.error || 'Top-up failed');
          }
        },
      },
    ]);
  };

  const handleTranslationTopUp = async () => {
    if (!isAdmin || !currentOrgId) return;
    const hours = parseFloat(transTopUpHours);
    if (!hours || hours < 1) return showAlert('Invalid', 'Enter at least 1 hour.');
    const pricePerHour = translationWallet?.price_per_hour_usd || 25;
    const cost = hours * pricePerHour;
    showAlert('Top Up Translation Wallet', `Add ${hours} hour(s) for $${cost.toFixed(2)}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          try {
            await api.subscriptions.topUpTranslation(currentOrgId!, { hours });
            showAlert('Success', `${hours} hour(s) added to Translation wallet!`);
            loadData();
          } catch (err: any) {
            showAlert('Error', err?.response?.data?.error || 'Top-up failed');
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.highlight} />
      </View>
    );
  }

  const currentPlanSlug = subscription?.plan?.slug;
  const subStatus = subscription?.status || 'none';
  const statusColor = subStatus === 'active' ? Colors.success : subStatus === 'grace_period' ? Colors.warning : Colors.error;
  const aiBalance = parseFloat(aiWallet?.balance_minutes || '0');
  const transBalance = parseFloat(translationWallet?.balance_minutes || '0');

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.highlight} />}
    >
      {/* Subscription Status Banner */}
      {subscription && (
        <Card style={styles.statusCard}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={styles.statusText}>
              {subscription.plan?.name} — {subStatus.replace('_', ' ').toUpperCase()}
            </Text>
          </View>
          <Text style={styles.statusDetail}>
            {subStatus === 'active' ? `Renews ${new Date(subscription.current_period_end).toLocaleDateString()}` :
             subStatus === 'grace_period' ? `Grace period ends ${new Date(subscription.grace_period_end).toLocaleDateString()}` :
             'Subscription expired'}
          </Text>
          {(subStatus === 'grace_period' || subStatus === 'expired') && isAdmin && (
            <TouchableOpacity style={styles.renewBtn} onPress={handleRenew}>
              <Text style={styles.renewBtnText}>Renew Now</Text>
            </TouchableOpacity>
          )}
        </Card>
      )}

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['plans', 'ai', 'translation'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Ionicons
              name={t === 'plans' ? 'card' : t === 'ai' ? 'sparkles' : 'language'}
              size={16}
              color={tab === t ? Colors.highlight : Colors.textLight}
            />
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'plans' ? 'Plans' : t === 'ai' ? 'AI Wallet' : 'Translation'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Plans Tab */}
      {tab === 'plans' && (
        <View style={styles.section}>
          <SectionHeader title="Subscription Plans" />
          <Text style={styles.subtitle}>Annual subscription — all core features included</Text>

          {plans.map((plan) => {
            const isCurrent = plan.slug === currentPlanSlug;
            return (
              <Card key={plan.id} style={[styles.planCard, isCurrent && styles.planCardActive]}>
                {isCurrent && (
                  <View style={styles.currentBadge}>
                    <Text style={styles.currentBadgeText}>CURRENT</Text>
                  </View>
                )}
                <Text style={styles.planName}>{plan.name}</Text>
                <Text style={styles.planDesc}>{plan.description}</Text>
                <View style={styles.priceRow}>
                  <Text style={styles.priceUsd}>${parseFloat(plan.price_usd_annual).toLocaleString()}</Text>
                  <Text style={styles.priceInterval}>/year</Text>
                </View>
                <Text style={styles.priceNgn}>
                  or ₦{parseFloat(plan.price_ngn_annual).toLocaleString()}/year
                </Text>
                <View style={styles.features}>
                  <FeatureRow icon="people" text={`Up to ${plan.max_members} members`} />
                  <FeatureRow icon="chatbubbles" text="Team chat & channels" />
                  <FeatureRow icon="videocam" text="Meetings & minutes" />
                  <FeatureRow icon="cash" text="Financial management" />
                  <FeatureRow icon="document-text" text="Document storage" />
                  {plan.features?.analytics && <FeatureRow icon="bar-chart" text="Advanced analytics" />}
                  {plan.features?.prioritySupport && <FeatureRow icon="headset" text="Priority support" />}
                </View>
                {!isCurrent && isAdmin && (
                  <TouchableOpacity style={styles.subscribeBtn} onPress={() => handleSubscribe(plan.slug)}>
                    <Text style={styles.subscribeBtnText}>Subscribe</Text>
                  </TouchableOpacity>
                )}
              </Card>
            );
          })}
        </View>
      )}

      {/* AI Wallet Tab */}
      {tab === 'ai' && (
        <View style={styles.section}>
          <SectionHeader title="AI Wallet" />
          <Text style={styles.subtitle}>Prepaid AI meeting transcription & summaries</Text>

          <Card style={styles.walletCard}>
            <View style={styles.walletHeader}>
              <Ionicons name="sparkles" size={24} color={Colors.highlight} />
              <View style={{ flex: 1, marginLeft: Spacing.md }}>
                <Text style={styles.walletLabel}>AI Balance</Text>
                <Text style={styles.walletBalance}>
                  {(aiBalance / 60).toFixed(1)} hours
                </Text>
                <Text style={styles.walletMinutes}>{aiBalance.toFixed(0)} minutes remaining</Text>
              </View>
            </View>

            <View style={styles.pricingRow}>
              <Text style={styles.pricingText}>$10/hour</Text>
              <Text style={styles.pricingDivider}>|</Text>
              <Text style={styles.pricingText}>₦18,000/hour</Text>
            </View>

            {isAdmin && (
              <View style={styles.topUpSection}>
                <Text style={styles.topUpLabel}>Top Up</Text>
                <View style={styles.topUpRow}>
                  <TextInput
                    style={styles.topUpInput}
                    value={aiTopUpHours}
                    onChangeText={setAiTopUpHours}
                    keyboardType="numeric"
                    placeholder="Hours"
                    placeholderTextColor={Colors.textLight}
                  />
                  <TouchableOpacity style={styles.topUpBtn} onPress={handleAiTopUp}>
                    <Ionicons name="add" size={18} color={Colors.primary} />
                    <Text style={styles.topUpBtnText}>Add Hours</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {aiBalance <= 0 && (
              <View style={styles.emptyNotice}>
                <Ionicons name="alert-circle" size={16} color={Colors.warning} />
                <Text style={styles.emptyText}>AI wallet empty — AI features disabled until topped up</Text>
              </View>
            )}
          </Card>

          <View style={styles.featureList}>
            <Text style={styles.featureListTitle}>AI Features Include:</Text>
            <FeatureRow icon="mic" text="Meeting transcription" />
            <FeatureRow icon="document-text" text="Automatic summaries" />
            <FeatureRow icon="checkmark-circle" text="Action item extraction" />
            <FeatureRow icon="trending-up" text="Financial insights" />
            <FeatureRow icon="time" text="Per-minute billing — pay only for what you use" />
          </View>
        </View>
      )}

      {/* Translation Wallet Tab */}
      {tab === 'translation' && (
        <View style={styles.section}>
          <SectionHeader title="Translation Wallet" />
          <Text style={styles.subtitle}>Real-time multilingual meeting translation</Text>

          <Card style={styles.walletCard}>
            <View style={styles.walletHeader}>
              <Ionicons name="language" size={24} color={Colors.info} />
              <View style={{ flex: 1, marginLeft: Spacing.md }}>
                <Text style={styles.walletLabel}>Translation Balance</Text>
                <Text style={[styles.walletBalance, { color: Colors.info }]}>
                  {(transBalance / 60).toFixed(1)} hours
                </Text>
                <Text style={styles.walletMinutes}>{transBalance.toFixed(0)} minutes remaining</Text>
              </View>
            </View>

            <View style={styles.pricingRow}>
              <Text style={styles.pricingText}>$25/hour</Text>
              <Text style={styles.pricingDivider}>|</Text>
              <Text style={styles.pricingText}>₦45,000/hour</Text>
            </View>

            {isAdmin && (
              <View style={styles.topUpSection}>
                <Text style={styles.topUpLabel}>Top Up</Text>
                <View style={styles.topUpRow}>
                  <TextInput
                    style={styles.topUpInput}
                    value={transTopUpHours}
                    onChangeText={setTransTopUpHours}
                    keyboardType="numeric"
                    placeholder="Hours"
                    placeholderTextColor={Colors.textLight}
                  />
                  <TouchableOpacity style={[styles.topUpBtn, { backgroundColor: Colors.info }]} onPress={handleTranslationTopUp}>
                    <Ionicons name="add" size={18} color="#fff" />
                    <Text style={[styles.topUpBtnText, { color: '#fff' }]}>Add Hours</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {transBalance <= 0 && (
              <View style={styles.emptyNotice}>
                <Ionicons name="alert-circle" size={16} color={Colors.warning} />
                <Text style={styles.emptyText}>Translation wallet empty — translation disabled until topped up</Text>
              </View>
            )}
          </Card>

          <View style={styles.featureList}>
            <Text style={styles.featureListTitle}>Translation Features Include:</Text>
            <FeatureRow icon="globe" text="Real-time speech-to-text" />
            <FeatureRow icon="language" text="Live translation to target language" />
            <FeatureRow icon="volume-high" text="Optional voice playback" />
            <FeatureRow icon="people" text="Per-participant language preference" />
            <FeatureRow icon="time" text="Per-minute billing" />
          </View>
        </View>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>Powered by Globull</Text>
      </View>
    </ScrollView>
  );
}

function FeatureRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.featureRow}>
      <Ionicons name={icon as any} size={16} color={Colors.highlight} />
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  section: { padding: Spacing.lg },
  subtitle: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.lg, marginTop: -Spacing.sm },

  // Status banner
  statusCard: { margin: Spacing.lg, marginBottom: 0, borderWidth: 1, borderColor: Colors.borderGold },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold as any, color: Colors.textPrimary },
  statusDetail: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.xs },
  renewBtn: { backgroundColor: Colors.highlight, paddingVertical: 10, paddingHorizontal: Spacing.lg, borderRadius: BorderRadius.md, marginTop: Spacing.md, alignSelf: 'flex-start' },
  renewBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold as any, color: Colors.primary },

  // Tabs
  tabs: { flexDirection: 'row', marginHorizontal: Spacing.lg, marginTop: Spacing.lg, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: 4 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: BorderRadius.sm },
  tabActive: { backgroundColor: Colors.primaryLight },
  tabText: { fontSize: FontSize.sm, color: Colors.textLight },
  tabTextActive: { color: Colors.highlight, fontWeight: FontWeight.semibold as any },

  // Plan cards
  planCard: { marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  planCardActive: { borderColor: Colors.highlight, borderWidth: 2 },
  currentBadge: { backgroundColor: Colors.highlightSubtle, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, alignSelf: 'flex-start', marginBottom: Spacing.sm },
  currentBadgeText: { fontSize: 10, fontWeight: FontWeight.bold as any, color: Colors.highlight, letterSpacing: 1 },
  planName: { fontSize: FontSize.lg, fontWeight: FontWeight.bold as any, color: Colors.textPrimary, marginBottom: 4 },
  planDesc: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.md },
  priceRow: { flexDirection: 'row', alignItems: 'baseline' },
  priceUsd: { fontSize: 28, fontWeight: FontWeight.bold as any, color: Colors.highlight },
  priceInterval: { fontSize: FontSize.sm, color: Colors.textSecondary, marginLeft: 4 },
  priceNgn: { fontSize: FontSize.sm, color: Colors.textLight, marginTop: 2, marginBottom: Spacing.md },
  features: { marginTop: Spacing.sm },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  featureText: { fontSize: FontSize.sm, color: Colors.textSecondary, flex: 1 },
  subscribeBtn: { backgroundColor: Colors.highlight, paddingVertical: 12, borderRadius: BorderRadius.md, alignItems: 'center', marginTop: Spacing.md },
  subscribeBtnText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold as any, color: Colors.primary },

  // Wallet
  walletCard: { borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.md },
  walletHeader: { flexDirection: 'row', alignItems: 'center' },
  walletLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  walletBalance: { fontSize: 24, fontWeight: FontWeight.bold as any, color: Colors.highlight },
  walletMinutes: { fontSize: FontSize.xs, color: Colors.textLight },
  pricingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.md, marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.border },
  pricingText: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: FontWeight.semibold as any },
  pricingDivider: { color: Colors.textLight },
  topUpSection: { marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.border },
  topUpLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold as any, color: Colors.textPrimary, marginBottom: Spacing.sm },
  topUpRow: { flexDirection: 'row', gap: Spacing.sm },
  topUpInput: { flex: 1, backgroundColor: Colors.primaryLight, borderWidth: 1, borderColor: Colors.accent, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: 10, color: Colors.textPrimary, fontSize: FontSize.md },
  topUpBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.highlight, paddingHorizontal: Spacing.lg, borderRadius: BorderRadius.md },
  topUpBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold as any, color: Colors.primary },
  emptyNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.warningSubtle, padding: Spacing.sm, borderRadius: BorderRadius.sm, marginTop: Spacing.md },
  emptyText: { fontSize: FontSize.xs, color: Colors.warning, flex: 1 },

  // Feature list
  featureList: { marginTop: Spacing.md },
  featureListTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold as any, color: Colors.textPrimary, marginBottom: Spacing.sm },

  // Footer
  footer: { padding: Spacing.xl, alignItems: 'center' },
  footerText: { fontSize: FontSize.xs, color: Colors.textLight },
});
