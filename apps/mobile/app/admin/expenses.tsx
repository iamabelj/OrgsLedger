// ============================================================
// OrgsLedger Mobile — Expense Management Screen
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../src/theme';
import { Card, Badge, SectionHeader, Button, Input, ResponsiveScrollView } from '../../src/components/ui';
import { CrossPlatformDateTimePicker } from '../../src/components/ui';
import { useOrgCurrency } from '../../src/hooks/useOrgCurrency';
import { getCurrencySymbol } from '../../src/utils/currency';
import { showAlert } from '../../src/utils/alert';
import EditHistoryModal from '../../src/components/EditHistoryModal';
import { useResponsive } from '../../src/hooks/useResponsive';

interface Expense {
  id: string;
  title?: string;
  description: string;
  amount: number;
  category: string;
  date: string;
  createdBy: {
    firstName: string;
    lastName: string;
  };
  createdAt: string;
}

type ViewMode = 'list' | 'create';

export default function ExpensesScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const memberships = useAuthStore((s) => s.memberships);
  const globalRole = useAuthStore((s) => s.user?.globalRole);
  const membership = memberships.find((m) => m.organization_id === currentOrgId);
  const isAdmin = globalRole === 'super_admin' || globalRole === 'developer' || membership?.role === 'org_admin' || membership?.role === 'executive';
  const orgCurrency = useOrgCurrency();
  const currencySymbol = getCurrencySymbol(orgCurrency);
  const responsive = useResponsive();

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [dateChosen, setDateChosen] = useState(true); // Default to today

  // Edit state
  const [editItem, setEditItem] = useState<Expense | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [editDescription, setEditDescription] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editDate, setEditDate] = useState<Date>(new Date());
  const [saving, setSaving] = useState(false);

  // History state
  const [showHistory, setShowHistory] = useState(false);
  const [historyEntityId, setHistoryEntityId] = useState<string | undefined>();
  const [historyLabel, setHistoryLabel] = useState<string | undefined>();

  useEffect(() => {
    loadExpenses();
  }, []);

  const loadExpenses = async () => {
    if (!currentOrgId) return;
    try {
      setError(null);
      setLoading(true);
      const res = await api.expenses.list(currentOrgId);
      setExpenses(res.data.data || []);
    } catch (err: any) {
      setError('Failed to load expenses');
      showAlert('Error', 'Failed to load expenses');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadExpenses();
    setRefreshing(false);
  };

  const handleCreate = async () => {
    if (!description.trim() || !amount.trim() || !category.trim()) {
      showAlert('Error', 'Please fill in all required fields');
      return;
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      showAlert('Error', 'Please enter a valid amount');
      return;
    }

    if (!currentOrgId) return;

    try {
      setCreating(true);
      await api.expenses.create(currentOrgId, {
        title: description.trim(),
        description: description.trim(),
        amount: numAmount,
        category: category.trim(),
        date: selectedDate.toISOString(),
      });

      showAlert('Success', 'Expense recorded successfully');
      setDescription('');
      setAmount('');
      setCategory('');
      setSelectedDate(new Date());
      setViewMode('list');
      loadExpenses();
    } catch (err: any) {
      // Error handled by showAlert below
      showAlert('Error', err.response?.data?.error || 'Failed to record expense');
    } finally {
      setCreating(false);
    }
  };

  const handleDateChange = (date: Date) => {
    setSelectedDate(date);
    setDateChosen(true);
  };

  const handleEdit = (item: Expense) => {
    setEditItem(item);
    setEditDescription(item.description || item.title || '');
    setEditAmount(String(item.amount));
    setEditCategory(item.category || '');
    setEditDate(new Date(item.date));
    setShowEdit(true);
  };

  const handleSaveEdit = async () => {
    if (!editDescription.trim() || !editAmount.trim()) {
      showAlert('Error', 'Description and amount are required');
      return;
    }
    const numAmount = parseFloat(editAmount);
    if (isNaN(numAmount) || numAmount <= 0) {
      showAlert('Error', 'Please enter a valid amount');
      return;
    }
    setSaving(true);
    try {
      await api.expenses.update(currentOrgId!, editItem!.id, {
        title: editDescription.trim(),
        description: editDescription.trim(),
        amount: numAmount,
        category: editCategory.trim() || undefined,
        date: editDate.toISOString(),
      });
      showAlert('Success', 'Expense updated');
      setShowEdit(false);
      setEditItem(null);
      loadExpenses();
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    showAlert('Delete Expense', 'Are you sure you want to delete this expense?', [
      { text: 'Cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.expenses.delete(currentOrgId!, id);
            loadExpenses();
          } catch (err: any) {
            showAlert('Error', err.response?.data?.error || 'Failed to delete');
          }
        },
      },
    ]);
  };

  const openHistory = (item?: Expense) => {
    setHistoryEntityId(item?.id);
    setHistoryLabel(item?.description || 'All Expenses');
    setShowHistory(true);
  };

  const renderExpense = ({ item }: { item: Expense }) => (
    <Card style={styles.expenseCard}>
      <View style={styles.expenseHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.expenseDescription}>{item.description}</Text>
          <Text style={styles.expenseCategory}>{item.category}</Text>
        </View>
        <Text style={styles.expenseAmount}>-{currencySymbol}{Number(item.amount || 0).toFixed(2)}</Text>
      </View>
      {isAdmin && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8, paddingTop: 4 }}>
          <TouchableOpacity
            onPress={() => handleEdit(item)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#2563EB', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 }}
          >
            <Ionicons name="create-outline" size={16} color="#FFFFFF" />
            <Text style={{ fontSize: 13, color: '#FFFFFF', fontWeight: '700' }}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleDelete(item.id)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#DC2626', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 }}
          >
            <Ionicons name="trash-outline" size={16} color="#FFFFFF" />
            <Text style={{ fontSize: 13, color: '#FFFFFF', fontWeight: '700' }}>Delete</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.expenseMeta}>
        <View style={styles.metaItem}>
          <Ionicons name="calendar-outline" size={14} color={Colors.textLight} />
          <Text style={styles.metaText}>
            {new Date(item.date).toLocaleDateString()}
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="person-outline" size={14} color={Colors.textLight} />
          <Text style={styles.metaText}>
            {item.createdBy?.firstName || 'Unknown'} {item.createdBy?.lastName || ''}
          </Text>
        </View>
        <TouchableOpacity onPress={() => openHistory(item)} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Ionicons name="time-outline" size={14} color={Colors.textLight} />
          <Text style={[styles.metaText, { color: Colors.primary || '#3B82F6' }]}>History</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );

  // List View
  if (viewMode === 'list') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <SectionHeader title="Organization Expenses" />
          <Button
            title="Add Expense"
            onPress={() => setViewMode('create')}
            variant="primary"
            icon="add-circle-outline"
            size="sm"
          />
        </View>

        {loading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={Colors.highlight} />
          </View>
        ) : expenses.length === 0 ? (
          <View style={styles.centerContainer}>
            <Ionicons name="receipt-outline" size={64} color={Colors.textLight} />
            <Text style={styles.emptyText}>No expenses recorded yet</Text>
            <Button
              title="Record First Expense"
              onPress={() => setViewMode('create')}
              variant="primary"
              style={{ marginTop: Spacing.lg }}
            />
          </View>
        ) : (
          <FlatList
            data={expenses}
            renderItem={renderExpense}
            keyExtractor={(item) => item.id}
            extraData={isAdmin}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={Colors.highlight}
              />
            }
          />
        )}

        {/* Edit Modal */}
        <Modal visible={showEdit} animationType="slide" transparent>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxWidth: responsive.contentMaxWidth }]}>
              <ScrollView>
                <Text style={styles.modalTitle}>Edit Expense</Text>
                <Input
                  label="DESCRIPTION"
                  placeholder="Expense description"
                  value={editDescription}
                  onChangeText={setEditDescription}
                />
                <Input
                  label="AMOUNT"
                  placeholder="0.00"
                  value={editAmount}
                  onChangeText={setEditAmount}
                  keyboardType="decimal-pad"
                />
                <Input
                  label="CATEGORY"
                  placeholder="e.g., Operations, Maintenance"
                  value={editCategory}
                  onChangeText={setEditCategory}
                />
                <CrossPlatformDateTimePicker
                  label="Date"
                  value={editDate}
                  mode="date"
                  hasValue={true}
                  onChange={(d: Date) => setEditDate(d)}
                />
                <View style={{ height: Spacing.md }} />
                <Button title={saving ? 'Saving...' : 'Save Changes'} onPress={handleSaveEdit} disabled={saving} />
                <Button title="Cancel" onPress={() => { setShowEdit(false); setEditItem(null); }} variant="ghost" style={{ marginTop: Spacing.sm }} />
              </ScrollView>
            </View>
          </View>
        </Modal>

        <EditHistoryModal
          visible={showHistory}
          onClose={() => setShowHistory(false)}
          entityType="expense"
          entityId={historyEntityId}
          orgId={currentOrgId || ''}
          label={historyLabel}
        />
      </View>
    );
  }

  // Create View
  return (
    <ResponsiveScrollView
      style={styles.container}
      contentContainerStyle={styles.formContainer}
    >
      <Card style={styles.formCard}>
        <View style={styles.formHeader}>
          <TouchableOpacity onPress={() => setViewMode('list')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="arrow-back" size={24} color={Colors.textWhite} />
          </TouchableOpacity>
          <Text style={styles.formTitle}>Record New Expense</Text>
          <View style={{ width: 24 }} />
        </View>

        <SectionHeader title="Expense Details" />
        <Input
          label="Description *"
          value={description}
          onChangeText={setDescription}
          placeholder="e.g., Office supplies, Equipment repair"
          icon="document-text-outline"
        />

        <Input
          label="Amount *"
          value={amount}
          onChangeText={setAmount}
          placeholder="0.00"
          keyboardType="decimal-pad"
          icon="cash-outline"
        />

        <Input
          label="Category *"
          value={category}
          onChangeText={setCategory}
          placeholder="e.g., Operations, Maintenance, Events"
          icon="folder-outline"
        />

        <CrossPlatformDateTimePicker
          label="Date *"
          value={selectedDate}
          mode="date"
          hasValue={dateChosen}
          onChange={handleDateChange}
        />

        <View style={{ height: Spacing.md }} />

        <Button
          title={creating ? 'Recording...' : 'Record Expense'}
          onPress={handleCreate}
          disabled={creating}
          variant="primary"
        />

        <Button
          title="Cancel"
          onPress={() => setViewMode('list')}
          variant="secondary"
          style={{ marginTop: Spacing.sm }}
        />
      </Card>
    </ResponsiveScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
  },
  listContent: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  expenseCard: {
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  expenseHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  expenseDescription: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold as any,
    color: Colors.textWhite,
    marginBottom: 4,
  },
  expenseCategory: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
  },
  expenseAmount: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold as any,
    color: Colors.error,
  },
  expenseMeta: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.accent,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
  },
  emptyText: {
    fontSize: FontSize.md,
    color: Colors.textLight,
    marginTop: Spacing.md,
  },
  formContainer: {
    padding: Spacing.md,
  },
  formCard: {
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  formTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold as any,
    color: Colors.textWhite,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: Spacing.md,
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    alignSelf: 'center',
    width: '100%',
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold as any,
    color: Colors.textWhite || Colors.textPrimary,
    marginBottom: Spacing.md,
  },
});
