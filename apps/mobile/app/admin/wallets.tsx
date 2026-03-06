// ============================================================
// OrgsLedger — Wallet Management (AI + Translation)
// Detailed wallet balances, transaction history, top-up flows
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
  FlatList,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../src/theme';
import { Card, SectionHeader, ResponsiveScrollView } from '../../src/components/ui';
import { showAlert } from '../../src/utils/alert';

// Unified Add-On Bundle (AI + Translation)

export default function WalletsScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const memberships = useAuthStore((s) => s.memberships);
  const globalRole = useAuthStore((s) => s.user?.globalRole);
  const currentMembership = memberships.find((m) => m.organization_id === currentOrgId);
  const isAdmin = globalRole === 'super_admin' || globalRole === 'developer' || currentMembership?.role === 'org_admin';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Using AI wallet for unified bundle balance
  const [aiWallet, setAiWallet] = useState<any>(null);
  const [translationWallet, setTranslationWallet] = useState<any>(null);
  const [aiHistory, setAiHistory] = useState<any[]>([]);
  const [transHistory, setTransHistory] = useState<any[]>([]);
  const [topUpHours, setTopUpHours] = useState('1');

  const loadData = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const [walletsRes, aiHistRes, transHistRes] = await Promise.all([
        api.subscriptions.getWallets(currentOrgId),
        api.subscriptions.getAiHistory(currentOrgId, { limit: 50 }),
        api.subscriptions.getTranslationHistory(currentOrgId, { limit: 50 }),
      ]);
      setAiWallet(walletsRes.data?.data?.ai);
      setTranslationWallet(walletsRes.data?.data?.translation);
      setAiHistory(aiHistRes.data?.data || []);
      setTransHistory(transHistRes.data?.data || []);
    } catch (err: any) {
      setError('Failed to load wallet data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentOrgId]);

  useEffect(() => { loadData(); }, [loadData]);
  const onRefresh = () => { setRefreshing(true); loadData(); };

  const handleTopUp = async () => {
    if (!isAdmin || !currentOrgId) return;
    const hours = parseFloat(topUpHours);
    if (!hours || hours < 1) return showAlert('Invalid', 'Enter at least 1 hour.');

    const price = parseFloat(aiWallet?.price_per_hour_usd || 20);
    const priceNgn = parseFloat(aiWallet?.price_per_hour_ngn || 25000);
    const cost = hours * price;
    const costNgn = hours * priceNgn;

    showAlert('Top Up Add-On Bundle', `Add ${hours} hour(s) for $${cost.toFixed(2)} (₦${costNgn.toLocaleString()})?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          try {
            // Top up both AI and Translation wallets together
            await api.subscriptions.topUpAi(currentOrgId!, { hours });
            await api.subscriptions.topUpTranslation(currentOrgId!, { hours });
            showAlert('Success', `${hours} hour(s) added to your Add-On bundle!`);
            setTopUpHours('1');
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

  // Unified wallet display
  const balance = parseFloat(aiWallet?.balance_minutes || '0');
  const priceUsd = '$20/hr';
  const priceNgn = '₦25,000/hr';
  const icon = 'rocket';
  const color = Colors.highlight;
  // Combined history from both wallets
  const history = [...aiHistory, ...transHistory].sort((a, b) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return (
    <ResponsiveScrollView
      style={styles.container}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {/* Add-On Bundle Header */}
      <View style={styles.headerSection}>
        <Ionicons name="rocket" size={24} color={Colors.highlight} />
        <Text style={styles.headerTitle}>Add-On Bundle</Text>
        <Text style={styles.headerSubtitle}>AI + Translation</Text>
      </View>

      {/* Balance Card */}
      <Card style={[styles.balanceCard, { borderColor: color + '40' }]}>
        <View style={styles.balanceHeader}>
          <Ionicons name={icon as any} size={32} color={color} />
          <View style={{ flex: 1, marginLeft: Spacing.md }}>
            <Text style={styles.balanceLabel}>
              Bundle Balance
            </Text>
            <Text style={[styles.balanceValue, { color }]}>
              {(balance / 60).toFixed(1)} hours
            </Text>
            <Text style={styles.balanceMinutes}>{balance.toFixed(0)} minutes remaining</Text>
          </View>
        </View>

        <View style={styles.rateRow}>
          <View style={styles.rateItem}>
            <Text style={styles.rateLabel}>USD Rate</Text>
            <Text style={styles.rateValue}>{priceUsd}</Text>
          </View>
          <View style={[styles.rateDivider]} />
          <View style={styles.rateItem}>
            <Text style={styles.rateLabel}>NGN Rate</Text>
            <Text style={styles.rateValue}>{priceNgn}</Text>
          </View>
          <View style={[styles.rateDivider]} />
          <View style={styles.rateItem}>
            <Text style={styles.rateLabel}>Billing</Text>
            <Text style={styles.rateValue}>Per-min</Text>
          </View>
        </View>

        {balance <= 0 && (
          <View style={styles.emptyBanner}>
            <Ionicons name="alert-circle" size={18} color={Colors.warning} />
            <Text style={styles.emptyBannerText}>
              Bundle empty — AI and translation features disabled until topped up
            </Text>
          </View>
        )}
      </Card>

      {/* Top Up Section */}
      {isAdmin && (
        <Card style={styles.topUpCard}>
          <Text style={styles.topUpTitle}>Add Hours</Text>
          <View style={styles.topUpRow}>
            {[1, 5, 10, 25].map((h) => (
              <TouchableOpacity
                key={h}
                style={[styles.quickBtn, topUpHours === String(h) && { borderColor: color, backgroundColor: color + '15' }]}
                onPress={() => setTopUpHours(String(h))}
              >
                <Text style={[styles.quickBtnText, topUpHours === String(h) && { color }]}>{h}h</Text>
              </TouchableOpacity>
            ))}
            <TextInput
              style={styles.customInput}
              value={topUpHours}
              onChangeText={setTopUpHours}
              keyboardType="numeric"
              placeholder="Hrs"
              placeholderTextColor={Colors.textLight}
            />
          </View>
          <View style={styles.costRow}>
            <Text style={styles.costLabel}>Total cost:</Text>
            <Text style={[styles.costValue, { color }]}>
              ${((parseFloat(topUpHours) || 0) * 20).toFixed(2)}
            </Text>
          </View>
          <TouchableOpacity style={[styles.topUpBtn, { backgroundColor: color }]} onPress={handleTopUp}>
            <Ionicons name="add-circle" size={20} color={Colors.primary} />
            <Text style={[styles.topUpBtnText, { color: Colors.primary }]}>
              Top Up Add-On Bundle
            </Text>
          </TouchableOpacity>
        </Card>
      )}

      {/* Transaction History */}
      <View style={styles.historySection}>
        <SectionHeader title="Transaction History" />
        {history.length === 0 ? (
          <View style={styles.emptyHistory}>
            <Ionicons name="receipt-outline" size={36} color={Colors.textLight} />
            <Text style={styles.emptyHistoryText}>No transactions yet</Text>
          </View>
        ) : (
          history.map((tx: any, idx: number) => {
            const isCredit = parseFloat(tx.amount_minutes || tx.minutes_added || '0') > 0;
            const mins = Math.abs(
              parseFloat(tx.amount_minutes || tx.minutes_added || tx.minutes_used || '0')
            );
            return (
              <View key={tx.id || idx} style={styles.txRow}>
                <View style={[styles.txIcon, { backgroundColor: isCredit ? Colors.successSubtle : Colors.dangerSubtle }]}>
                  <Ionicons
                    name={isCredit ? 'arrow-down' : 'arrow-up'}
                    size={16}
                    color={isCredit ? Colors.success : Colors.error}
                  />
                </View>
                <View style={styles.txInfo}>
                  <Text style={styles.txDesc} numberOfLines={1}>
                    {tx.description || tx.type || (isCredit ? 'Top-up' : 'Usage')}
                  </Text>
                  <Text style={styles.txDate}>
                    {new Date(tx.created_at).toLocaleDateString()} {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
                <View style={styles.txAmount}>
                  <Text style={[styles.txMins, { color: isCredit ? Colors.success : Colors.error }]}>
                    {isCredit ? '+' : '-'}{(mins / 60).toFixed(1)}h
                  </Text>
                  <Text style={styles.txMinsSmall}>{mins.toFixed(0)} min</Text>
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>Powered by Globull</Text>
      </View>
    </ResponsiveScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },

  // Tabs
  tabs: { flexDirection: 'row', margin: Spacing.lg, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: 4 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: BorderRadius.sm },
  tabActive: { backgroundColor: Colors.primaryLight },
  tabText: { fontSize: FontSize.sm, color: Colors.textLight },
  tabTextActive: { color: Colors.highlight, fontWeight: FontWeight.semibold as any },

  // Header Section
  headerSection: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, margin: Spacing.lg, marginBottom: Spacing.md },
  headerTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold as any, color: Colors.textPrimary },
  headerSubtitle: { fontSize: FontSize.sm, color: Colors.textLight, marginLeft: 'auto' },

  // Balance
  balanceCard: { marginHorizontal: Spacing.lg, marginBottom: Spacing.md, borderWidth: 1 },
  balanceHeader: { flexDirection: 'row', alignItems: 'center' },
  balanceLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  balanceValue: { fontSize: 28, fontWeight: FontWeight.bold as any },
  balanceMinutes: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 2 },
  rateRow: { flexDirection: 'row', marginTop: Spacing.md, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.border },
  rateItem: { flex: 1, alignItems: 'center' },
  rateLabel: { fontSize: FontSize.xs, color: Colors.textLight, marginBottom: 2 },
  rateValue: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold as any, color: Colors.textPrimary },
  rateDivider: { width: 1, backgroundColor: Colors.border, marginVertical: 2 },
  emptyBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.warningSubtle, padding: Spacing.sm, borderRadius: BorderRadius.sm, marginTop: Spacing.md },
  emptyBannerText: { fontSize: FontSize.xs, color: Colors.warning, flex: 1 },

  // Top up
  topUpCard: { marginHorizontal: Spacing.lg, marginBottom: Spacing.md },
  topUpTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold as any, color: Colors.textPrimary, marginBottom: Spacing.sm },
  topUpRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  quickBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border },
  quickBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold as any, color: Colors.textSecondary },
  customInput: { width: 55, backgroundColor: Colors.primaryLight, borderWidth: 1, borderColor: Colors.accent, borderRadius: BorderRadius.md, paddingHorizontal: 8, paddingVertical: 6, color: Colors.textPrimary, fontSize: FontSize.sm, textAlign: 'center' },
  costRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.md },
  costLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  costValue: { fontSize: FontSize.md, fontWeight: FontWeight.bold as any },
  topUpBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: BorderRadius.md },
  topUpBtnText: { fontSize: FontSize.md, fontWeight: FontWeight.semibold as any },

  // History
  historySection: { paddingHorizontal: Spacing.lg, marginTop: Spacing.sm },
  emptyHistory: { alignItems: 'center', paddingVertical: Spacing.xxl, gap: Spacing.sm },
  emptyHistoryText: { fontSize: FontSize.sm, color: Colors.textLight },
  txRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  txIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  txInfo: { flex: 1, marginLeft: Spacing.md },
  txDesc: { fontSize: FontSize.sm, color: Colors.textPrimary },
  txDate: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 2 },
  txAmount: { alignItems: 'flex-end' },
  txMins: { fontSize: FontSize.md, fontWeight: FontWeight.semibold as any },
  txMinsSmall: { fontSize: FontSize.xs, color: Colors.textLight },

  // Footer
  footer: { padding: Spacing.xl, alignItems: 'center' },
  footerText: { fontSize: FontSize.xs, color: Colors.textLight },
});
