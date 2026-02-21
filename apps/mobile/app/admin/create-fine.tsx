// ============================================================
// OrgsLedger Mobile — Create Fine Screen (Admin)
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Card, Button, Input, Avatar, Badge, SearchBar, SectionHeader, ResponsiveScrollView } from '../../src/components/ui';
import { showAlert } from '../../src/utils/alert';
import { useOrgCurrency } from '../../src/hooks/useOrgCurrency';
import { getCurrencySymbol } from '../../src/utils/currency';

interface Member {
  id: string;
  fullName: string;
  email: string;
  role: string;
  avatarUrl?: string;
}

export default function CreateFineScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const orgCurrency = useOrgCurrency();
  const currencySymbol = getCurrencySymbol(orgCurrency);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMembers();
  }, []);

  const loadMembers = async () => {
    if (!currentOrgId) return;
    setLoadingMembers(true);
    try {
      setError(null);
      const res = await api.orgs.listMembers(currentOrgId);
      const rawMembers = res.data?.data || [];
      // Normalize: API returns first_name/last_name/userId, we need fullName/id
      const normalized = rawMembers.map((m: any) => ({
        id: m.userId || m.user_id || m.id,
        fullName: m.fullName || `${m.first_name || ''} ${m.last_name || ''}`.trim() || 'Unknown',
        email: m.email || '',
        role: m.role || 'member',
        avatarUrl: m.avatar_url || m.avatarUrl || undefined,
      }));
      setMembers(normalized);
    } catch (err) {
      setError('Failed to load members');
    } finally {
      setLoadingMembers(false);
    }
  };

  const toggleMember = (memberId: string) => {
    setSelectedMembers((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
  };

  const selectAll = () => {
    if (selectedMembers.length === filteredMembers.length) {
      setSelectedMembers([]);
    } else {
      setSelectedMembers(filteredMembers.map((m) => m.id));
    }
  };

  const filteredMembers = members.filter(
    (m) =>
      (m.fullName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.email || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreate = async () => {
    if (!reason.trim()) {
      showAlert('Validation', 'Fine reason is required');
      return;
    }
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      showAlert('Validation', 'Please enter a valid amount');
      return;
    }
    if (selectedMembers.length === 0) {
      showAlert('Validation', 'Select at least one member');
      return;
    }
    if (!currentOrgId) return;

    setLoading(true);
    try {
      const promises = selectedMembers.map((userId) =>
        api.financials.createFine(currentOrgId, {
          userId,
          type: 'other',
          amount: numAmount,
          currency: orgCurrency,
          reason: reason.trim(),
        })
      );
      await Promise.all(promises);
      const memberCount = selectedMembers.length;
      showAlert(
        'Success',
        `Fine of ${currencySymbol}${numAmount.toFixed(2)} issued to ${memberCount} member${memberCount > 1 ? 's' : ''}`,

        [{ text: 'OK', onPress: () => router.replace('/(tabs)/financials' as any) }]
      );
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to create fine');
    } finally {
      setLoading(false);
    }
  };

  const renderMemberItem = ({ item }: { item: Member }) => {
    const isSelected = selectedMembers.includes(item.id);
    return (
      <TouchableOpacity
        style={[styles.memberItem, isSelected && styles.memberItemSelected]}
        onPress={() => toggleMember(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.memberLeft}>
          <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
            {isSelected && <Ionicons name="checkmark" size={14} color={Colors.primary} />}
          </View>
          <Avatar name={item.fullName} size={38} imageUrl={item.avatarUrl} />
          <View>
            <Text style={styles.memberName}>{item.fullName}</Text>
            <Text style={styles.memberEmail}>{item.email}</Text>
          </View>
        </View>
        <Badge
          label={item.role}
          variant={item.role === 'admin' ? 'info' : 'neutral'}
          size="sm"
        />
      </TouchableOpacity>
    );
  };

  return (
    <ResponsiveScrollView style={styles.container} maxWidth={700}>
      <Stack.Screen options={{ title: 'Issue Fine' }} />

      {/* Preview */}
      <Card variant="elevated" style={styles.previewCard}>
        <View style={styles.previewIcon}>
          <Ionicons name="warning" size={28} color={Colors.error} />
        </View>
        <Text style={styles.previewTitle}>Issue a Fine</Text>
        <Text style={styles.previewSubtitle}>
          {selectedMembers.length > 0
            ? `${selectedMembers.length} member${selectedMembers.length > 1 ? 's' : ''} selected`
            : 'Select members below'}
        </Text>
        {amount && (
          <Text style={styles.previewAmount}>{currencySymbol}{parseFloat(amount || '0').toFixed(2)}</Text>
        )}
      </Card>

      <View style={styles.form}>
        <Input
          label="REASON"
          placeholder="e.g. Late to meeting, Missed event"
          value={reason}
          onChangeText={setReason}
          icon="alert-circle-outline"
        />

        <Input
          label="AMOUNT"
          placeholder="0.00"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          icon="cash-outline"
        />

        <Input
          label="NOTES (OPTIONAL)"
          placeholder="Additional notes..."
          value={notes}
          onChangeText={setNotes}
          multiline
          icon="document-text-outline"
        />

        {/* Member Selection */}
        <SectionHeader title="Select Members" />

        <SearchBar
          placeholder="Search members..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />

        <TouchableOpacity style={styles.selectAllBtn} onPress={selectAll}>
          <Ionicons
            name={
              selectedMembers.length === filteredMembers.length && filteredMembers.length > 0
                ? 'checkbox'
                : 'square-outline'
            }
            size={20}
            color={Colors.highlight}
          />
          <Text style={styles.selectAllText}>
            {selectedMembers.length === filteredMembers.length && filteredMembers.length > 0
              ? 'Deselect All'
              : 'Select All'}
          </Text>
        </TouchableOpacity>

        {loadingMembers ? (
          <ActivityIndicator size="small" color={Colors.highlight} style={{ marginVertical: 24 }} />
        ) : (
          <View style={styles.memberList}>
            {filteredMembers.map((member) => (
              <React.Fragment key={member.id}>{renderMemberItem({ item: member })}</React.Fragment>
            ))}
            {filteredMembers.length === 0 && (
              <Text style={styles.noMembers}>No members found</Text>
            )}
          </View>
        )}

        <Button
          title={`Issue Fine${selectedMembers.length > 0 ? ` to ${selectedMembers.length}` : ''}`}
          onPress={handleCreate}
          loading={loading}
          icon="warning"
          variant="danger"
          fullWidth
          size="lg"
          style={{ marginTop: Spacing.lg, marginBottom: Spacing.xxl }}
        />
      </View>
    </ResponsiveScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  previewCard: {
    margin: Spacing.md,
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    gap: Spacing.xs,
  },
  previewIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.errorSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.error,
  },
  previewSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  previewAmount: {
    fontSize: FontSize.display,
    fontWeight: FontWeight.extrabold,
    color: Colors.error,
    letterSpacing: -1,
  },
  form: { paddingHorizontal: Spacing.md },
  selectAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  selectAllText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.highlight,
  },
  memberList: { gap: Spacing.xs },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  memberItemSelected: {
    borderColor: Colors.error,
    backgroundColor: Colors.errorSubtle,
  },
  memberLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: BorderRadius.xs,
    borderWidth: 2,
    borderColor: Colors.textLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    borderColor: Colors.highlight,
    backgroundColor: Colors.highlight,
  },
  memberName: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
    color: Colors.textPrimary,
  },
  memberEmail: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
  },
  noMembers: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
    textAlign: 'center',
    marginVertical: Spacing.lg,
  },
});
