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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../src/theme';
import { Card, Badge, SectionHeader, Button, Input, ResponsiveScrollView } from '../../src/components/ui';
import { CrossPlatformDateTimePicker } from '../../src/components/ui';
import { showAlert } from '../../src/utils/alert';

interface Expense {
  id: string;
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

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);

  // Create form state
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [dateChosen, setDateChosen] = useState(true); // Default to today

  useEffect(() => {
    loadExpenses();
  }, []);

  const loadExpenses = async () => {
    if (!currentOrgId) return;
    try {
      setLoading(true);
      const res = await api.expenses.list(currentOrgId);
      setExpenses(res.data.data || []);
    } catch (err: any) {
      console.error('Failed to load expenses', err);
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
      console.error('Failed to create expense', err);
      showAlert('Error', err.response?.data?.error || 'Failed to record expense');
    } finally {
      setCreating(false);
    }
  };

  const handleDateChange = (date: Date) => {
    setSelectedDate(date);
    setDateChosen(true);
  };

  const renderExpense = ({ item }: { item: Expense }) => (
    <Card style={styles.expenseCard}>
      <View style={styles.expenseHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.expenseDescription}>{item.description}</Text>
          <Text style={styles.expenseCategory}>{item.category}</Text>
        </View>
        <Text style={styles.expenseAmount}>-${item.amount.toFixed(2)}</Text>
      </View>
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
            {item.createdBy.firstName} {item.createdBy.lastName}
          </Text>
        </View>
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
});
