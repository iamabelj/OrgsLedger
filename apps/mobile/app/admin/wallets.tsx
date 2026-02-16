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

type WalletType = 'ai' | 'translation';

export default function WalletsScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const memberships = useAuthStore((s) => s.memberships);
  const globalRole = useAuthStore((s) => s.user?.globalRole);
  const currentMembership = memberships.find((m) => m.organization_id === currentOrgId);
  const isAdmin = globalRole === 'super_admin' || globalRole === 'developer' || currentMembership?.role === 'org_admin';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeWallet, setActiveWallet] = useState<WalletType>('ai');
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

    const wallet = activeWallet === 'ai' ? aiWallet : translationWallet;
    const priceKey = activeWallet === 'ai' ? 'price_per_hour_usd' : 'price_per_hour_usd';
    const price = parseFloat(wallet?.[priceKey] || (activeWallet === 'ai' ? 10 : 25));
    const cost = hours * price;
    const label = activeWallet === 'ai' ? 'AI' : 'Translation';

    showAlert(`Top Up ${label} Wallet`, `Add ${hours} hour(s) for $${cost.toFixed(2)}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          try {
            if (activeWallet === 'ai') {
              await api.subscriptions.topUpAi(currentOrgId!, { hours });
            } else {
              await api.subscriptions.topUpTranslation(currentOrgId!, { hours });
            }
            showAlert('Success', `${hours} hour(s) added to ${label} wallet!`);
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

  const wallet = activeWallet === 'ai' ? aiWallet : translationWallet;
  const history = activeWallet === 'ai' ? aiHistory : transHistory;
  const balance = parseFloat(wallet?.balance_minutes || '0');
  const priceUsd = activeWallet === 'ai' ? '$10/hr' : '$25/hr';
  const priceNgn = activeWallet === 'ai' ? '₦18,000/hr' : '₦45,000/hr';
  const icon = activeWallet === 'ai' ? 'sparkles' : 'language';
  const color = activeWallet === 'ai' ? Colors.highlight : Colors.info;

  return (
    <ResponsiveScrollView
      style={styles.container}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {/* Wallet Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeWallet === 'ai' && styles.tabActive]}
          onPress={() => setActiveWallet('ai')}
        >
          <Ionicons name="sparkles" size={18} color={activeWallet === 'ai' ? Colors.highlight : Colors.textLight} />
          <Text style={[styles.tabText, activeWallet === 'ai' && styles.tabTextActive]}>AI Wallet</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeWallet === 'translation' && styles.tabActive]}
          onPress={() => setActiveWallet('translation')}
        >
          <Ionicons name="language" size={18} color={activeWallet === 'translation' ? Colors.info : Colors.textLight} />
          <Text style={[styles.tabText, activeWallet === 'translation' && { color: Colors.info, fontWeight: FontWeight.semibold as any }]}>Translation</Text>
        </TouchableOpacity>
      </View>

      {/* Balance Card */}
      <Card style={[styles.balanceCard, { borderColor: color + '40' }]}>
        <View style={styles.balanceHeader}>
          <Ionicons name={icon as any} size={32} color={color} />
          <View style={{ flex: 1, marginLeft: Spacing.md }}>
            <Text style={styles.balanceLabel}>
              {activeWallet === 'ai' ? 'AI' : 'Translation'} Balance
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
              Wallet empty — {activeWallet === 'ai' ? 'AI features' : 'translation'} disabled until topped up
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
              ${((parseFloat(topUpHours) || 0) * (activeWallet === 'ai' ? 10 : 25)).toFixed(2)}
            </Text>
          </View>
          <TouchableOpacity style={[styles.topUpBtn, { backgroundColor: color }]} onPress={handleTopUp}>
            <Ionicons name="add-circle" size={20} color={activeWallet === 'ai' ? Colors.primary : '#fff'} />
            <Text style={[styles.topUpBtnText, { color: activeWallet === 'ai' ? Colors.primary : '#fff' }]}>
              Top Up {activeWallet === 'ai' ? 'AI' : 'Translation'} Wallet
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
