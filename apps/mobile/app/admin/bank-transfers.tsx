// ============================================================
// OrgsLedger Mobile — Bank Transfer Approval Screen
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../src/theme';
import { Card } from '../../src/components/ui';
import { showAlert } from '../../src/utils/alert';

interface Transfer {
  id: string;
  amount: number;
  currency: string;
  type: string;
  description: string;
  payment_gateway_id: string; // proof of payment
  first_name: string;
  last_name: string;
  email: string;
  created_at: string;
}

export default function BankTransfersScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  const loadTransfers = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const res = await api.payments.getPendingTransfers(currentOrgId);
      setTransfers(res.data.data || []);
    } catch {
      showAlert('Error', 'Failed to load pending transfers');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentOrgId]);

  useEffect(() => {
    loadTransfers();
  }, [loadTransfers]);

  const handleAction = async (transactionId: string, approved: boolean) => {
    const label = approved ? 'approve' : 'reject';
    showAlert(
      `${approved ? 'Approve' : 'Reject'} Transfer`,
      `Are you sure you want to ${label} this bank transfer?`,
      [
        { text: 'Cancel', style: 'cancel' as const },
        {
          text: approved ? 'Approve' : 'Reject',
          style: approved ? ('default' as const) : ('destructive' as const),
          onPress: async () => {
            setProcessing(transactionId);
            try {
              await api.payments.approveTransfer(currentOrgId!, { transactionId, approved });
              showAlert('Success', `Transfer ${label}d successfully`);
              loadTransfers();
            } catch (err: any) {
              showAlert('Error', err.response?.data?.error || `Failed to ${label} transfer`);
            } finally {
              setProcessing(null);
            }
          },
        },
      ]
    );
  };

  const renderTransfer = ({ item }: { item: Transfer }) => (
    <Card style={styles.transferCard}>
      <View style={styles.transferHeader}>
        <View style={styles.memberInfo}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {item.first_name?.[0]}{item.last_name?.[0]}
            </Text>
          </View>
          <View>
            <Text style={styles.memberName}>{item.first_name} {item.last_name}</Text>
            <Text style={styles.memberEmail}>{item.email}</Text>
          </View>
        </View>
        <Text style={styles.amount}>
          {item.currency} {Number(item.amount).toLocaleString()}
        </Text>
      </View>

      <View style={styles.detail}>
        <Text style={styles.detailLabel}>Type:</Text>
        <Text style={styles.detailValue}>{item.type}</Text>
      </View>
      {item.description ? (
        <View style={styles.detail}>
          <Text style={styles.detailLabel}>Description:</Text>
          <Text style={styles.detailValue}>{item.description}</Text>
        </View>
      ) : null}
      {item.payment_gateway_id ? (
        <View style={styles.detail}>
          <Text style={styles.detailLabel}>Proof:</Text>
          <Text style={styles.detailValue}>{item.payment_gateway_id}</Text>
        </View>
      ) : null}
      <View style={styles.detail}>
        <Text style={styles.detailLabel}>Submitted:</Text>
        <Text style={styles.detailValue}>
          {new Date(item.created_at).toLocaleString()}
        </Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.rejectBtn]}
          onPress={() => handleAction(item.id, false)}
          disabled={processing === item.id}
        >
          {processing === item.id ? (
            <ActivityIndicator size="small" color={Colors.error} />
          ) : (
            <>
              <Ionicons name="close-circle" size={18} color={Colors.error} />
              <Text style={[styles.actionText, { color: Colors.error }]}>Reject</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionBtn, styles.approveBtn]}
          onPress={() => handleAction(item.id, true)}
          disabled={processing === item.id}
        >
          {processing === item.id ? (
            <ActivityIndicator size="small" color={Colors.success} />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
              <Text style={[styles.actionText, { color: Colors.success }]}>Approve</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </Card>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {transfers.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="checkmark-done-circle" size={64} color={Colors.textSecondary} />
          <Text style={styles.emptyText}>No pending bank transfers</Text>
        </View>
      ) : (
        <FlatList
          data={transfers}
          keyExtractor={(item) => item.id}
          renderItem={renderTransfer}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadTransfers(); }} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  list: { padding: Spacing.md },
  transferCard: { marginBottom: Spacing.md, padding: Spacing.md },
  transferHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  memberInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.sm,
  },
  avatarText: { color: Colors.textPrimary, fontWeight: FontWeight.bold, fontSize: FontSize.sm },
  memberName: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textPrimary },
  memberEmail: { fontSize: FontSize.xs, color: Colors.textSecondary },
  amount: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.accent },
  detail: { flexDirection: 'row', marginBottom: 4 },
  detailLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, width: 90 },
  detailValue: { fontSize: FontSize.sm, color: Colors.textPrimary, flex: 1 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.md,
    marginTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  approveBtn: { backgroundColor: 'rgba(76,175,80,0.15)' },
  rejectBtn: { backgroundColor: 'rgba(244,67,54,0.15)' },
  actionText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold },
  emptyText: { fontSize: FontSize.md, color: Colors.textSecondary, marginTop: Spacing.md },
});
