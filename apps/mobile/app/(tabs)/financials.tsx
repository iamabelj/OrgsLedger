// ============================================================
// OrgsLedger Mobile — Financials Tab Screen (Royal Design)
// ============================================================

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Linking,
  Platform,
  ActionSheetIOS,
  AppState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { format } from 'date-fns';
import { useAuthStore } from '../../src/stores/auth.store';
import { useFinancialStore } from '../../src/stores/financial.store';
import { useStripeSafe } from '../../src/utils/stripe';
import { useOrgCurrency } from '../../src/hooks/useOrgCurrency';
import { formatCurrency, formatCurrencyWhole, getCurrencySymbol } from '../../src/utils/currency';
import { api } from '../../src/api/client';
import { showAlert } from '../../src/utils/alert';
import {
  Colors, Spacing, FontSize, FontWeight,
  BorderRadius, Shadow,
} from '../../src/theme';
import {
  Card, Badge, StatCard, EmptyState, LoadingScreen,
  SectionHeader, Divider, ResponsiveScrollView,
} from '../../src/components/ui';

type TabKey = 'ledger' | 'dues' | 'fines' | 'donations';

const TXN_CONFIG: Record<string, {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  bg: string;
}> = {
  due:      { icon: 'receipt', color: Colors.highlight, bg: Colors.highlightSubtle },
  fine:     { icon: 'alert-circle', color: Colors.error, bg: Colors.errorSubtle },
  donation: { icon: 'heart', color: Colors.success, bg: Colors.successSubtle },
  refund:   { icon: 'return-down-back', color: Colors.warning, bg: Colors.warningSubtle },
  default:  { icon: 'cash', color: Colors.textLight, bg: Colors.accent },
};

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  completed: 'success',
  pending: 'warning',
  overdue: 'danger',
  refunded: 'neutral',
};

export default function FinancialsScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const userId = useAuthStore((s) => s.user?.id);
  const globalRole = useAuthStore((s) => s.user?.globalRole);
  const membership = useAuthStore((s) =>
    s.memberships.find((m) => m.organization_id === s.currentOrgId)
  );
  const {
    transactions, summary, dues, fines,
    loadLedger, loadDues, loadFines,
  } = useFinancialStore();

  const [tab, setTab] = useState<TabKey>('ledger');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [donationCampaigns, setDonationCampaigns] = useState<any[]>([]);

  const orgCurrency = useOrgCurrency();

  const isAdmin = globalRole === 'super_admin' || globalRole === 'developer' || (membership &&
    ['org_admin', 'executive'].includes(membership.role));

  const loadAll = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      await Promise.all([
        loadLedger(currentOrgId),
        loadDues(currentOrgId),
        loadFines(currentOrgId),
      ]);
      const campRes = await api.financials.getCampaigns(currentOrgId);
      setDonationCampaigns(campRes.data.data || []);
    } catch (err) {
      console.warn('Failed to load financial data:', err);
    }
  }, [currentOrgId]);

  useEffect(() => {
    setLoading(true);
    loadAll().finally(() => setLoading(false));
  }, [loadAll]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  };

  const { initPaymentSheet, presentPaymentSheet } = useStripeSafe();

  const handlePay = async (transactionId: string, amount: number) => {
    if (!currentOrgId) return;
    let gateways: { id: string; name: string; type: string }[] = [];
    try {
      const gwRes = await api.payments.getGateways(currentOrgId);
      gateways = gwRes.data.data || [];
    } catch {
      gateways = [{ id: 'stripe', name: 'Default', type: 'dev' }];
    }

    const pickAndPay = async (gateway: string) => {
      try {
        // Bank transfer — show details and submit with note
        if (gateway === 'bank_transfer') {
          const gw = gateways.find((g: any) => g.id === 'bank_transfer') as any;
          const bd = gw?.bankDetails || {};
          const detailLines = [
            bd.bankName ? `Bank: ${bd.bankName}` : '',
            bd.accountNumber ? `Account: ${bd.accountNumber}` : '',
            bd.accountName ? `Name: ${bd.accountName}` : '',
            bd.instructions || 'Transfer and submit proof of payment.',
          ].filter(Boolean).join('\n');

          showAlert(
            'Bank Transfer Details',
            `${detailLines}\n\nAmount: ${formatCurrency(amount, orgCurrency)}\n\nAfter transferring, tap "I've Paid" so admin can verify.`,
            [
              { text: 'Cancel', style: 'cancel' as const },
              {
                text: "I've Paid",
                onPress: async () => {
                  try {
                    const res = await api.payments.pay(currentOrgId!, {
                      transactionId,
                      gateway: 'bank_transfer',
                      proofOfPayment: 'Member confirmed transfer',
                    });
                    showAlert('Submitted', res.data.data?.message || 'Your payment is awaiting admin approval.');
                    await loadAll();
                  } catch (err: any) {
                    showAlert('Error', err.response?.data?.error || 'Failed to submit');
                  }
                },
              },
            ]
          );
          return;
        }

        const res = await api.payments.pay(currentOrgId, { transactionId, gateway });
        const data = res.data.data;
        if (gateway === 'stripe' && data.status === 'completed') {
          showAlert('Success', 'Payment completed!');
          await loadAll();
        } else if (gateway === 'stripe' && data.clientSecret) {
          const { error: initError } = await initPaymentSheet({
            paymentIntentClientSecret: data.clientSecret,
            merchantDisplayName: 'OrgsLedger',
          });
          if (initError) { showAlert('Payment Error', initError.message); return; }
          const { error: presentError } = await presentPaymentSheet();
          if (presentError) {
            if (presentError.code !== 'Canceled') showAlert('Payment Error', presentError.message);
          } else {
            showAlert('Success', 'Payment completed!');
            await loadAll();
          }
        } else if (data.authorizationUrl) {
          await Linking.openURL(data.authorizationUrl).catch(() => {});
          // Wait for user to return from payment page, then verify
          const verifyOnReturn = () => {
            const sub = AppState.addEventListener('change', async (state) => {
              if (state === 'active') {
                sub.remove();
                try {
                  const verify = await api.payments.verify(currentOrgId, transactionId);
                  if (verify.data.data?.status === 'completed') {
                    showAlert('Success', 'Payment completed!');
                    await loadAll();
                  } else {
                    showAlert('Pending', 'Payment is still processing. Pull down to refresh.');
                  }
                } catch {}
              }
            });
            // Fallback timeout in case AppState doesn't fire
            setTimeout(() => sub.remove(), 300000);
          };
          if (Platform.OS === 'web') {
            // On web, verify after a delay since there's no AppState
            setTimeout(async () => {
              try {
                const verify = await api.payments.verify(currentOrgId, transactionId);
                if (verify.data.data?.status === 'completed') {
                  showAlert('Success', 'Payment completed!');
                  await loadAll();
                }
              } catch {}
            }, 5000);
          } else {
            verifyOnReturn();
          }
        } else if (data.paymentLink) {
          await Linking.openURL(data.paymentLink).catch(() => {});
          if (Platform.OS === 'web') {
            setTimeout(async () => {
              try {
                const verify = await api.payments.verify(currentOrgId, transactionId);
                if (verify.data.data?.status === 'completed') {
                  showAlert('Success', 'Payment completed!');
                  await loadAll();
                }
              } catch {}
            }, 5000);
          } else {
            const sub = AppState.addEventListener('change', async (state) => {
              if (state === 'active') {
                sub.remove();
                try {
                  const verify = await api.payments.verify(currentOrgId, transactionId);
                  if (verify.data.data?.status === 'completed') {
                    showAlert('Success', 'Payment completed!');
                    await loadAll();
                  } else {
                    showAlert('Pending', 'Payment is still processing. Pull down to refresh.');
                  }
                } catch {}
              }
            });
            setTimeout(() => sub.remove(), 300000);
          }
        } else if (data.note) {
          showAlert('Success', data.note);
          await loadAll();
        }
      } catch (err: any) {
        showAlert('Payment Error', err.response?.data?.error || 'Payment failed');
      }
    };

    if (gateways.length === 1) { await pickAndPay(gateways[0].id); return; }
    const names = gateways.map((g) => g.name);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'Choose Payment Method', options: ['Cancel', ...names], cancelButtonIndex: 0 },
        (index) => { if (index > 0) pickAndPay(gateways[index - 1].id); }
      );
    } else {
      showAlert('Choose Payment Method', 'Select a gateway', [
        ...gateways.map((g) => ({ text: g.name, onPress: () => pickAndPay(g.id) })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  };

  // Pending count
  const pendingCount = useMemo(
    () => transactions.filter((t: any) => t.status === 'pending' && t.user_id === userId).length,
    [transactions, userId]
  );

  const tabs: { key: TabKey; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; count?: number }[] = [
    { key: 'ledger', label: 'Ledger', icon: 'book-outline' },
    { key: 'dues', label: 'Dues', icon: 'receipt-outline', count: dues.length },
    { key: 'fines', label: 'Fines', icon: 'alert-circle-outline', count: fines.length },
    { key: 'donations', label: 'Donate', icon: 'heart-outline', count: donationCampaigns.length },
  ];

  if (loading) return <LoadingScreen />;

  return (
    <View style={styles.container}>
      {/* Summary Hero */}
      {summary && (
        <Card variant="gold" style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.heroLabel}>Net Balance</Text>
              <Text style={styles.heroValue}>
                {formatCurrency(summary.netBalance, orgCurrency)}
              </Text>
            </View>
            <View style={styles.heroIconWrap}>
              <Ionicons name="wallet" size={28} color={Colors.highlight} />
            </View>
          </View>
          <Divider style={{ marginVertical: Spacing.sm, backgroundColor: 'rgba(201,168,76,0.2)' }} />
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Ionicons name="trending-up" size={16} color={Colors.success} />
              <Text style={styles.heroStatLabel}>Income</Text>
              <Text style={[styles.heroStatVal, { color: Colors.success }]}>
                {formatCurrency(summary.totalIncome, orgCurrency)}
              </Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <Ionicons name="time" size={16} color={Colors.warning} />
              <Text style={styles.heroStatLabel}>Pending</Text>
              <Text style={[styles.heroStatVal, { color: Colors.warning }]}>
                {formatCurrency(summary.pendingAmount, orgCurrency)}
              </Text>
            </View>
          </View>
        </Card>
      )}

      {/* Tab selector */}
      <View style={styles.tabRow}>
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tabBtn, active && styles.tabActive]}
              onPress={() => setTab(t.key)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={t.icon}
                size={16}
                color={active ? Colors.primary : Colors.textLight}
              />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {t.label}
              </Text>
              {!!(t.count && t.count > 0) && (
                <View style={[styles.tabCount, active && styles.tabCountActive]}>
                  <Text style={[styles.tabCountText, active && { color: Colors.highlight }]}>
                    {t.count}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content */}
      <ResponsiveScrollView
        style={{ flex: 1 }}
        refreshing={refreshing}
        onRefresh={onRefresh}
      >
        {/* LEDGER TAB */}
        {tab === 'ledger' && (
          <View style={styles.listPadding}>
            {transactions.length === 0 ? (
              <EmptyState
                icon="book-outline"
                title="No Transactions Yet"
                subtitle="Financial activities will appear here"
              />
            ) : (
              transactions.map((txn: any) => {
                const cfg = TXN_CONFIG[txn.type] || TXN_CONFIG.default;
                return (
                  <View key={txn.id} style={styles.txnCard}>
                    <View style={[styles.txnIcon, { backgroundColor: cfg.bg }]}>
                      <Ionicons name={cfg.icon} size={20} color={cfg.color} />
                    </View>
                    <View style={styles.txnBody}>
                      <Text style={styles.txnDesc} numberOfLines={1}>
                        {txn.description || txn.type}
                      </Text>
                      <Text style={styles.txnDate}>
                        {format(new Date(txn.created_at), 'MMM d, yyyy')}
                      </Text>
                    </View>
                    <View style={styles.txnRight}>
                      <Text style={[styles.txnAmount, { color: cfg.color }]}>
                        {formatCurrency(txn.amount, orgCurrency)}
                      </Text>
                      <Badge
                        label={txn.status}
                        variant={STATUS_VARIANT[txn.status] || 'default'}
                      />
                    </View>
                  </View>
                );
              })
            )}

            {userId && transactions.length > 0 && (
              <TouchableOpacity
                style={styles.historyLink}
                onPress={() => router.push('/financials/history')}
                activeOpacity={0.7}
              >
                <View style={styles.historyLinkInner}>
                  <Ionicons name="time-outline" size={18} color={Colors.highlight} />
                  <Text style={styles.historyLinkText}>View My Payment History</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.highlight} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* DUES TAB */}
        {tab === 'dues' && (
          <View style={styles.listPadding}>
            {dues.length === 0 ? (
              <EmptyState
                icon="receipt-outline"
                title="No Dues Assigned"
                subtitle="Membership dues will appear here when created"
              />
            ) : (
              dues.map((due: any) => (
                <Card key={due.id} style={styles.dueCard}>
                  <View style={styles.dueTop}>
                    <View style={[styles.txnIcon, { backgroundColor: Colors.highlightSubtle }]}>
                      <Ionicons name="receipt" size={20} color={Colors.highlight} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.dueTitle}>{due.title}</Text>
                      <Text style={styles.dueDate}>
                        Due: {format(new Date(due.due_date), 'MMM d, yyyy')}
                      </Text>
                    </View>
                    <Text style={styles.dueAmount}>
                      {formatCurrency(due.amount, orgCurrency)}
                    </Text>
                  </View>
                  {due.is_recurring && (
                    <View style={styles.recurringBadge}>
                      <Ionicons name="repeat" size={12} color={Colors.highlight} />
                      <Text style={styles.recurringText}>{due.recurrence_rule}</Text>
                    </View>
                  )}
                </Card>
              ))
            )}
          </View>
        )}

        {/* FINES TAB */}
        {tab === 'fines' && (
          <View style={styles.listPadding}>
            {fines.length === 0 ? (
              <EmptyState
                icon="alert-circle-outline"
                title="No Fines"
                subtitle="You're in good standing!"
              />
            ) : (
              fines.map((fine: any) => (
                <Card key={fine.id} style={styles.dueCard}>
                  <View style={styles.dueTop}>
                    <View style={[styles.txnIcon, { backgroundColor: Colors.errorSubtle }]}>
                      <Ionicons name="alert-circle" size={20} color={Colors.error} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.dueTitle}>{fine.reason}</Text>
                      <Text style={styles.dueDate}>
                        {format(new Date(fine.created_at), 'MMM d, yyyy')}
                      </Text>
                    </View>
                    <Text style={[styles.dueAmount, { color: Colors.error }]}>
                      {formatCurrency(fine.amount, orgCurrency)}
                    </Text>
                  </View>
                </Card>
              ))
            )}
          </View>
        )}

        {/* DONATIONS TAB */}
        {tab === 'donations' && (
          <View style={styles.listPadding}>
            {donationCampaigns.length === 0 ? (
              <EmptyState
                icon="heart-outline"
                title="No Active Campaigns"
                subtitle="Donation campaigns will appear here"
              />
            ) : (
              donationCampaigns.map((camp: any) => {
                const raised = camp.total_raised || 0;
                const goal = camp.goal_amount || 0;
                const pct = goal > 0 ? Math.min(100, (raised / goal) * 100) : 0;
                return (
                  <Card key={camp.id} variant="elevated" style={styles.campaignCard}>
                    <View style={styles.campHeader}>
                      <View style={[styles.txnIcon, { backgroundColor: Colors.successSubtle }]}>
                        <Ionicons name="heart" size={20} color={Colors.success} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.campTitle}>{camp.title}</Text>
                        {camp.description && (
                          <Text style={styles.campDesc} numberOfLines={2}>
                            {camp.description}
                          </Text>
                        )}
                      </View>
                    </View>

                    {goal > 0 && (
                      <View style={styles.progressSection}>
                        <View style={styles.progressBar}>
                          <View style={[styles.progressFill, { width: `${pct}%` }]} />
                        </View>
                        <View style={styles.progressLabels}>
                          <Text style={styles.progressRaised}>
                            {formatCurrency(raised, orgCurrency)} raised
                          </Text>
                          <Text style={styles.progressGoal}>
                            {formatCurrency(goal, orgCurrency)} goal
                          </Text>
                        </View>
                      </View>
                    )}

                    <TouchableOpacity
                      style={styles.donateBtn}
                      onPress={() => router.push(`/financials/donate/${camp.id}`)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="heart" size={16} color={Colors.textWhite} />
                      <Text style={styles.donateBtnText}>Donate Now</Text>
                    </TouchableOpacity>
                  </Card>
                );
              })
            )}
          </View>
        )}

        <View style={{ height: Spacing.xxl * 2 }} />
      </ResponsiveScrollView>

      {/* Pending payments FAB */}
      {pendingCount > 0 && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => {
            const pending = transactions.filter(
              (t: any) => t.status === 'pending' && t.user_id === userId
            );
            if (pending.length === 1) {
              handlePay(pending[0].id, pending[0].amount);
            } else if (pending.length > 1) {
              // Show picker for multiple pending transactions
              const buttons = pending.slice(0, 5).map((t: any) => ({
                text: `${t.description || t.type} — ${formatCurrency(t.amount, orgCurrency)}`,
                onPress: () => handlePay(t.id, t.amount),
              }));
              buttons.push({ text: 'Cancel', onPress: () => {}, style: 'cancel' });
              showAlert('Select Payment', 'Choose which transaction to pay:', buttons);
            }
          }}
          activeOpacity={0.8}
        >
          <Ionicons name="card" size={22} color={Colors.textWhite} />
          <Text style={styles.fabText}>Pay Now</Text>
          {pendingCount > 1 && (
            <View style={styles.fabBadge}>
              <Text style={styles.fabBadgeText}>{pendingCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  heroCard: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.md,
    padding: Spacing.lg,
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  heroLabel: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
    fontWeight: FontWeight.medium as any,
  },
  heroValue: {
    fontSize: 26,
    fontWeight: FontWeight.bold as any,
    color: Colors.highlight,
    marginTop: 2,
    flexShrink: 1,
  },
  heroIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroStat: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroStatDivider: {
    width: 1,
    height: 24,
    backgroundColor: Colors.accent,
    marginHorizontal: Spacing.sm,
  },
  heroStatLabel: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
  },
  heroStatVal: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold as any,
  },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
  },
  tabActive: {
    backgroundColor: Colors.highlight,
  },
  tabText: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    fontWeight: FontWeight.medium as any,
  },
  tabTextActive: {
    color: Colors.primary,
    fontWeight: FontWeight.semibold as any,
  },
  tabCount: {
    backgroundColor: Colors.accent,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 8,
    minWidth: 18,
    alignItems: 'center',
  },
  tabCountActive: {
    backgroundColor: 'rgba(11,20,38,0.2)',
  },
  tabCountText: {
    fontSize: 10,
    fontWeight: FontWeight.bold as any,
    color: Colors.textLight,
  },
  listPadding: { padding: Spacing.md },

  // Transaction card
  txnCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    ...Shadow.sm,
  },
  txnIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
  },
  txnBody: { flex: 1 },
  txnDesc: {
    color: Colors.textWhite,
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium as any,
  },
  txnDate: {
    color: Colors.textLight,
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  txnRight: { alignItems: 'flex-end', gap: 4 },
  txnAmount: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold as any,
  },
  historyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.highlightSubtle,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.2)',
  },
  historyLinkInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  historyLinkText: {
    color: Colors.highlight,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold as any,
  },

  // Due/Fine card
  dueCard: {
    marginBottom: Spacing.sm,
    padding: Spacing.md,
  },
  dueTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dueTitle: {
    color: Colors.textWhite,
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium as any,
  },
  dueDate: {
    color: Colors.textLight,
    fontSize: FontSize.xs,
    marginTop: 2,
  },
  dueAmount: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold as any,
    color: Colors.highlight,
  },
  recurringBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.highlightSubtle,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.full,
    marginTop: Spacing.sm,
    marginLeft: Spacing.md,
  },
  recurringText: {
    color: Colors.highlight,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium as any,
    textTransform: 'capitalize',
  },

  // Campaign card
  campaignCard: {
    marginBottom: Spacing.md,
    padding: Spacing.lg,
  },
  campHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 0,
  },
  campTitle: {
    color: Colors.textWhite,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold as any,
    flex: 1,
  },
  campDesc: {
    color: Colors.textLight,
    fontSize: FontSize.sm,
    marginTop: 4,
    lineHeight: 20,
  },
  progressSection: { marginTop: Spacing.md },
  progressBar: {
    height: 8,
    backgroundColor: Colors.accent,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.success,
    borderRadius: 4,
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    flexWrap: 'wrap',
  },
  progressRaised: {
    color: Colors.success,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold as any,
    flexShrink: 1,
  },
  progressGoal: {
    color: Colors.textLight,
    fontSize: FontSize.sm,
    flexShrink: 1,
  },
  donateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.success,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
    marginTop: Spacing.md,
  },
  donateBtnText: {
    color: Colors.textWhite,
    fontWeight: FontWeight.semibold as any,
    fontSize: FontSize.md,
  },

  // FAB
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    bottom: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.success,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.full,
    ...Shadow.lg,
  },
  fabText: {
    color: Colors.textWhite,
    fontWeight: FontWeight.semibold as any,
    fontSize: FontSize.md,
  },
  fabBadge: {
    backgroundColor: Colors.error,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  fabBadgeText: {
    color: Colors.textWhite,
    fontSize: 10,
    fontWeight: FontWeight.bold as any,
  },
});
