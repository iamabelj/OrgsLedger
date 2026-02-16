// ============================================================
// OrgsLedger Mobile — Reports & Analytics Screen (Admin)
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  ActivityIndicator,
  Share,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { showAlert } from '../../src/utils/alert';
import {
  Card,
  Button,
  Badge,
  SectionHeader,
  Divider,
  StatCard,
  ScreenWrapper,
  LoadingScreen,
  PoweredByFooter,
  ResponsiveScrollView,
} from '../../src/components/ui';
import { useResponsive } from '../../src/hooks/useResponsive';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Period = '1m' | '3m' | '6m' | '1y' | 'all';

interface FinancialSummary {
  totalIncome: number;
  totalExpenses: number;
  duesCollected: number;
  finesCollected: number;
  donationsReceived: number;
  outstandingDues: number;
  outstandingFines: number;
  memberPaymentRate: number;
}

interface IncomeBreakdown {
  category: string;
  amount: number;
  percentage: number;
  color: string;
  icon: string;
}

export default function ReportsScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const responsive = useResponsive();
  const [period, setPeriod] = useState<Period>('3m');
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<FinancialSummary>({
    totalIncome: 0,
    totalExpenses: 0,
    duesCollected: 0,
    finesCollected: 0,
    donationsReceived: 0,
    outstandingDues: 0,
    outstandingFines: 0,
    memberPaymentRate: 0,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadReportData();
  }, [period]);

  const loadReportData = async () => {
    if (!currentOrgId) return;
    setLoading(true);
    try {
      setError(null);
      // Load financial summary from API
      const res = await api.analytics.dashboard(currentOrgId);
      const data = res.data;
      setSummary({
        totalIncome: data?.totalIncome || 0,
        totalExpenses: data?.totalExpenses || 0,
        duesCollected: data?.duesCollected || 0,
        finesCollected: data?.finesCollected || 0,
        donationsReceived: data?.donationsReceived || 0,
        outstandingDues: data?.outstandingDues || 0,
        outstandingFines: data?.outstandingFines || 0,
        memberPaymentRate: data?.memberPaymentRate || 0,
      });
    } catch (err) {
      setError('Failed to load report data');
    } finally {
      setLoading(false);
    }
  };

  const netBalance = summary.totalIncome - summary.totalExpenses;

  const incomeBreakdown: IncomeBreakdown[] = [
    {
      category: 'Membership Dues',
      amount: summary.duesCollected,
      percentage: summary.totalIncome > 0
        ? (summary.duesCollected / summary.totalIncome) * 100
        : 0,
      color: Colors.highlight,
      icon: 'receipt-outline',
    },
    {
      category: 'Fines',
      amount: summary.finesCollected,
      percentage: summary.totalIncome > 0
        ? (summary.finesCollected / summary.totalIncome) * 100
        : 0,
      color: Colors.error,
      icon: 'warning-outline',
    },
    {
      category: 'Donations',
      amount: summary.donationsReceived,
      percentage: summary.totalIncome > 0
        ? (summary.donationsReceived / summary.totalIncome) * 100
        : 0,
      color: Colors.success,
      icon: 'heart-outline',
    },
  ];

  const renderPeriodSelector = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.periodRow}
    >
      {([
        { key: '1m', label: '1 Month' },
        { key: '3m', label: '3 Months' },
        { key: '6m', label: '6 Months' },
        { key: '1y', label: '1 Year' },
        { key: 'all', label: 'All Time' },
      ] as const).map((p) => (
        <TouchableOpacity
          key={p.key}
          style={[styles.periodChip, period === p.key && styles.periodChipActive]}
          onPress={() => setPeriod(p.key)}
        >
          <Text
            style={[
              styles.periodChipText,
              period === p.key && styles.periodChipTextActive,
            ]}
          >
            {p.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const renderVisualBar = (item: IncomeBreakdown) => (
    <View key={item.category} style={styles.breakdownItem}>
      <View style={styles.breakdownHeader}>
        <View style={styles.breakdownLeft}>
          <View style={[styles.breakdownDot, { backgroundColor: item.color }]} />
          <Ionicons name={item.icon as any} size={16} color={item.color} />
          <Text style={styles.breakdownLabel}>{item.category}</Text>
        </View>
        <Text style={styles.breakdownAmount}>${item.amount.toLocaleString()}</Text>
      </View>
      <View style={styles.breakdownBarBg}>
        <View
          style={[
            styles.breakdownBarFill,
            {
              width: `${Math.max(item.percentage, 2)}%`,
              backgroundColor: item.color,
            },
          ]}
        />
      </View>
      <Text style={styles.breakdownPercent}>{item.percentage.toFixed(1)}%</Text>
    </View>
  );

  if (loading) return <LoadingScreen />;

  return (
    <ResponsiveScrollView style={styles.container}>
      <Stack.Screen options={{ title: 'Reports' }} />

      {/* Period Selector */}
      {renderPeriodSelector()}

      {/* Main Financial Summary */}
      <View style={styles.section}>
        <Card variant="gold" style={styles.heroCard}>
          <Text style={styles.heroLabel}>NET BALANCE</Text>
          <Text
            style={[
              styles.heroAmount,
              { color: netBalance >= 0 ? Colors.success : Colors.error },
            ]}
          >
            {netBalance >= 0 ? '+' : ''}${Math.abs(netBalance).toLocaleString()}
          </Text>
          <View style={styles.heroRow}>
            <View style={styles.heroItem}>
              <Ionicons name="trending-up" size={18} color={Colors.success} />
              <View>
                <Text style={styles.heroItemLabel}>Income</Text>
                <Text style={[styles.heroItemAmount, { color: Colors.success }]}>
                  ${summary.totalIncome.toLocaleString()}
                </Text>
              </View>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroItem}>
              <Ionicons name="trending-down" size={18} color={Colors.error} />
              <View>
                <Text style={styles.heroItemLabel}>Expenses</Text>
                <Text style={[styles.heroItemAmount, { color: Colors.error }]}>
                  ${summary.totalExpenses.toLocaleString()}
                </Text>
              </View>
            </View>
          </View>
        </Card>
      </View>

      {/* Stats Grid */}
      <View style={styles.section}>
        <View style={styles.statsGrid}>
          <StatCard
            title="Dues Collected"
            value={`$${summary.duesCollected.toLocaleString()}`}
            icon="receipt"
            trend="neutral"
          />
          <StatCard
            title="Fines Collected"
            value={`$${summary.finesCollected.toLocaleString()}`}
            icon="warning"
            trend="neutral"
          />
          <StatCard
            title="Donations"
            value={`$${summary.donationsReceived.toLocaleString()}`}
            icon="heart"
            trend="neutral"
          />
          <StatCard
            title="Payment Rate"
            value={`${summary.memberPaymentRate}%`}
            icon="stats-chart"
            trend={summary.memberPaymentRate >= 80 ? 'up' : 'down'}
          />
        </View>
      </View>

      {/* Income Breakdown */}
      <View style={styles.section}>
        <SectionHeader title="Income Breakdown" />
        <Card variant="elevated">
          {incomeBreakdown.map(renderVisualBar)}
        </Card>
      </View>

      {/* Outstanding */}
      <View style={styles.section}>
        <SectionHeader title="Outstanding Balances" />

        <View style={styles.outstandingRow}>
          <Card variant="elevated" style={styles.outstandingCard}>
            <View style={[styles.outstandingIcon, { backgroundColor: Colors.warningSubtle }]}>
              <Ionicons name="time-outline" size={22} color={Colors.warning} />
            </View>
            <Text style={styles.outstandingLabel}>Outstanding Dues</Text>
            <Text style={[styles.outstandingAmount, { color: Colors.warning }]}>
              ${summary.outstandingDues.toLocaleString()}
            </Text>
          </Card>

          <Card variant="elevated" style={styles.outstandingCard}>
            <View style={[styles.outstandingIcon, { backgroundColor: Colors.errorSubtle }]}>
              <Ionicons name="alert-circle-outline" size={22} color={Colors.error} />
            </View>
            <Text style={styles.outstandingLabel}>Outstanding Fines</Text>
            <Text style={[styles.outstandingAmount, { color: Colors.error }]}>
              ${summary.outstandingFines.toLocaleString()}
            </Text>
          </Card>
        </View>
      </View>

      {/* Quick Actions */}
      <View style={styles.section}>
        <SectionHeader title="Export & Share" />

        <View style={styles.exportRow}>
          <Button
            title="Export CSV"
            variant="outline"
            icon="download-outline"
            onPress={async () => {
              if (!currentOrgId) return;
              try {
                const res = await api.financials.exportLedger(currentOrgId);
                if (Platform.OS === 'web') {
                  const blob = new Blob([res.data], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `ledger_${currentOrgId}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                } else {
                  showAlert('Exported', 'CSV data ready. Share sheet integration coming in a future update.');
                }
              } catch (err: any) {
                showAlert('Error', err.response?.data?.error || 'Failed to export CSV');
              }
            }}
            style={{ flex: 1 }}
          />
          <Button
            title="Share Report"
            variant="outline"
            icon="share-outline"
            onPress={async () => {
              try {
                const reportText = `Financial Report\n\nTotal Income: ${summary.totalIncome.toLocaleString()}\nTotal Expenses: ${summary.totalExpenses.toLocaleString()}\nNet Balance: ${(summary.totalIncome - summary.totalExpenses).toLocaleString()}\nDues Collected: ${summary.duesCollected.toLocaleString()}\nFines Collected: ${summary.finesCollected.toLocaleString()}\nDonations: ${summary.donationsReceived.toLocaleString()}\nPayment Rate: ${summary.memberPaymentRate}%`;
                await Share.share({ message: reportText, title: 'Financial Report' });
              } catch {
                // User cancelled share
              }
            }}
            style={{ flex: 1 }}
          />
        </View>
      </View>

      {/* Collection Rate Visualization */}
      <View style={styles.section}>
        <SectionHeader title="Collection Efficiency" />

        <Card variant="elevated" style={styles.efficiencyCard}>
          <View style={styles.efficiencyCircle}>
            <Text style={styles.efficiencyPercent}>{summary.memberPaymentRate}%</Text>
            <Text style={styles.efficiencyLabel}>Collected</Text>
          </View>
          <View style={styles.efficiencyInfo}>
            <Text style={styles.efficiencyTitle}>Member Payment Rate</Text>
            <Text style={styles.efficiencyDesc}>
              {summary.memberPaymentRate >= 90
                ? 'Excellent! Nearly all members are paying on time.'
                : summary.memberPaymentRate >= 70
                ? 'Good performance. Some members need reminders.'
                : summary.memberPaymentRate >= 50
                ? 'Room for improvement. Consider sending reminders.'
                : 'Low collection rate. Review your payment processes.'}
            </Text>
            <View style={styles.efficiencyBar}>
              <View
                style={[
                  styles.efficiencyBarFill,
                  {
                    width: `${summary.memberPaymentRate}%`,
                    backgroundColor:
                      summary.memberPaymentRate >= 80
                        ? Colors.success
                        : summary.memberPaymentRate >= 50
                        ? Colors.warning
                        : Colors.error,
                  },
                ]}
              />
            </View>
          </View>
        </Card>
      </View>

      <PoweredByFooter />
    </ResponsiveScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  section: { paddingHorizontal: Spacing.md, marginBottom: Spacing.lg },

  periodRow: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
    flexDirection: 'row',
  },
  periodChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  periodChipActive: {
    backgroundColor: Colors.highlight,
    borderColor: Colors.highlight,
  },
  periodChipText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.textSecondary,
  },
  periodChipTextActive: {
    color: Colors.primary,
    fontWeight: FontWeight.semibold,
  },

  heroCard: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
  },
  heroLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: Spacing.xs,
  },
  heroAmount: {
    fontSize: 42,
    fontWeight: FontWeight.extrabold,
    letterSpacing: -1.5,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.md,
    gap: Spacing.lg,
  },
  heroItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  heroItemLabel: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
  },
  heroItemAmount: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.bold,
  },
  heroDivider: {
    width: 1,
    height: 32,
    backgroundColor: Colors.borderLight,
  },

  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },

  breakdownItem: {
    marginBottom: Spacing.md,
  },
  breakdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  breakdownLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  breakdownDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  breakdownLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.textPrimary,
  },
  breakdownAmount: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
  },
  breakdownBarBg: {
    height: 8,
    backgroundColor: Colors.accent,
    borderRadius: 4,
    overflow: 'hidden',
  },
  breakdownBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  breakdownPercent: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    marginTop: 2,
    textAlign: 'right',
  },

  outstandingRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  outstandingCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    gap: Spacing.xs,
  },
  outstandingIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outstandingLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  outstandingAmount: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
  },

  exportRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },

  efficiencyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  efficiencyCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: Colors.highlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  efficiencyPercent: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.extrabold,
    color: Colors.highlight,
  },
  efficiencyLabel: {
    fontSize: FontSize.xxs || 10,
    color: Colors.textLight,
    marginTop: -2,
  },
  efficiencyInfo: {
    flex: 1,
  },
  efficiencyTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
  },
  efficiencyDesc: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    lineHeight: 16,
    marginTop: 4,
  },
  efficiencyBar: {
    height: 6,
    backgroundColor: Colors.accent,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: Spacing.xs,
  },
  efficiencyBarFill: {
    height: '100%',
    borderRadius: 3,
  },
});
