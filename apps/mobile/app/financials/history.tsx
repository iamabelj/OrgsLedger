// ============================================================
// OrgsLedger Mobile — Payment History Screen (Royal Design)
// ============================================================

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { format } from 'date-fns';
import { useAuthStore } from '../../src/stores/auth.store';
import { useFinancialStore } from '../../src/stores/financial.store';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Card, Badge, EmptyState, LoadingScreen, useContentStyle } from '../../src/components/ui';

const TXN_ICON: Record<string, { icon: string; color: string; bg: string }> = {
  due_payment: { icon: 'card', color: Colors.highlight, bg: Colors.highlightSubtle },
  fine_payment: { icon: 'alert-circle', color: Colors.error, bg: Colors.errorSubtle },
  donation: { icon: 'heart', color: Colors.success, bg: Colors.successSubtle },
  refund: { icon: 'return-down-back', color: Colors.warning, bg: Colors.warningSubtle },
};

export default function PaymentHistoryScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const userId = useAuthStore((s) => s.user?.id);
  const userHistory = useFinancialStore((s) => s.userHistory);
  const loadUserHistory = useFinancialStore((s) => s.loadUserHistory);
  const [loading, setLoading] = useState(true);
  const contentStyle = useContentStyle();

  useEffect(() => {
    if (currentOrgId && userId) {
      setLoading(true);
      loadUserHistory(currentOrgId, userId).finally(() => setLoading(false));
    }
  }, [currentOrgId, userId]);

  if (loading) return <LoadingScreen />;

  const transactions = userHistory?.transactions || [];

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Payment History',
        }}
      />

      {/* Summary Strip */}
      {transactions.length > 0 && (
        <View style={styles.summaryStrip}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{transactions.length}</Text>
            <Text style={styles.summaryLabel}>Transactions</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: Colors.highlight }]}>
              ${transactions.reduce((sum: number, t: any) => sum + parseFloat(t.amount || 0), 0).toFixed(2)}
            </Text>
            <Text style={styles.summaryLabel}>Total Paid</Text>
          </View>
        </View>
      )}

      <FlatList
        data={transactions}
        keyExtractor={(item: any) => item.id}
        contentContainerStyle={[{ padding: Spacing.md }, contentStyle]}
        ListEmptyComponent={
          <EmptyState icon="wallet-outline" title="No Payment History" message="Your transaction history will appear here." />
        }
        renderItem={({ item }: { item: any }) => {
          const tc = TXN_ICON[item.type] || TXN_ICON.due_payment;
          return (
            <Card style={styles.txnCard}>
              <View style={[styles.txnIcon, { backgroundColor: tc.bg }]}>
                <Ionicons name={tc.icon as any} size={18} color={tc.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.txnDesc}>{item.description || item.type?.replace('_', ' ')}</Text>
                <Text style={styles.txnDate}>
                  {format(new Date(item.created_at), 'MMM d, yyyy \u00b7 h:mm a')}
                </Text>
              </View>
              <View style={styles.txnRight}>
                <Text style={styles.txnAmount}>${parseFloat(item.amount).toFixed(2)}</Text>
                <Badge
                  variant={item.status === 'completed' ? 'success' : item.status === 'pending' ? 'warning' : item.status === 'overdue' ? 'danger' : 'default'}
                  label={item.status}
                />
              </View>
            </Card>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  summaryStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    ...Shadow.sm,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryValue: { fontSize: FontSize.xl, fontWeight: FontWeight.bold as any, color: Colors.textWhite },
  summaryLabel: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 2 },
  summaryDivider: { width: 1, height: 30, backgroundColor: Colors.accent },
  txnCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, marginBottom: Spacing.xs },
  txnIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  txnDesc: { color: Colors.textWhite, fontSize: FontSize.md, fontWeight: FontWeight.medium as any, textTransform: 'capitalize' },
  txnDate: { color: Colors.textLight, fontSize: FontSize.xs, marginTop: 2 },
  txnRight: { alignItems: 'flex-end', gap: 4 },
  txnAmount: { color: Colors.textWhite, fontSize: FontSize.lg, fontWeight: FontWeight.bold as any },
});
