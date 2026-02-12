// ============================================================
// OrgsLedger Mobile — Create Due Screen (Admin)
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import { format } from 'date-fns';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../src/theme';
import { Card, Button, Input, SectionHeader, Badge, CrossPlatformDateTimePicker } from '../../src/components/ui';
import { showAlert } from '../../src/utils/alert';

const RECURRENCE_OPTIONS = [
  { label: 'One-time', value: '' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Quarterly', value: 'quarterly' },
  { label: 'Yearly', value: 'yearly' },
];

export default function CreateDueScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(new Date());
  const [dateChosen, setDateChosen] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) {
      showAlert('Validation', 'Due title is required');
      return;
    }
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      showAlert('Validation', 'Please enter a valid amount');
      return;
    }
    if (!dateChosen) {
      showAlert('Validation', 'Please select a due date');
      return;
    }
    if (!currentOrgId) return;

    setLoading(true);
    try {
      await api.financials.createDue(currentOrgId, {
        title: title.trim(),
        description: description.trim() || undefined,
        amount: numAmount,
        dueDate: dueDate.toISOString(),
        isRecurring,
        recurrenceRule: isRecurring && recurrenceRule ? recurrenceRule : undefined,
      });
      showAlert('Success', `Due "${title}" created for $${numAmount.toFixed(2)}`, [
        { text: 'OK', onPress: () => router.replace('/(tabs)/financials' as any) },
      ]);
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to create due');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Create Due' }} />

      {/* Preview Card */}
      <Card variant="gold" style={styles.previewCard}>
        <View style={styles.previewHeader}>
          <Ionicons name="receipt" size={24} color={Colors.highlight} />
          <Text style={styles.previewTitle}>{title || 'New Due'}</Text>
        </View>
        <Text style={styles.previewAmount}>
          {amount ? `$${parseFloat(amount || '0').toFixed(2)}` : '$0.00'}
        </Text>
        {dateChosen && (
          <Text style={styles.previewDate}>Due: {format(dueDate, 'MMM dd, yyyy')}</Text>
        )}
        {isRecurring && recurrenceRule && (
          <Badge label={`Recurring: ${recurrenceRule}`} variant="info" size="md" />
        )}
      </Card>

      <View style={styles.form}>
        <Input
          label="TITLE"
          placeholder="e.g. Monthly Membership Fee"
          value={title}
          onChangeText={setTitle}
          icon="document-text-outline"
        />

        <Input
          label="DESCRIPTION"
          placeholder="Optional description..."
          value={description}
          onChangeText={setDescription}
          multiline
          icon="create-outline"
        />

        <Input
          label="AMOUNT ($)"
          placeholder="0.00"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          icon="cash-outline"
        />

        {/* Due Date */}
        <CrossPlatformDateTimePicker
          label="DUE DATE"
          value={dueDate}
          mode="date"
          hasValue={dateChosen}
          onChange={(date) => {
            setDueDate(date);
            setDateChosen(true);
          }}
        />

        {/* Recurring Toggle */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleLeft}>
            <Ionicons name="refresh-outline" size={20} color={Colors.textSecondary} />
            <View>
              <Text style={styles.toggleLabel}>Recurring Due</Text>
              <Text style={styles.toggleHint}>Automatically recur on schedule</Text>
            </View>
          </View>
          <Switch
            value={isRecurring}
            onValueChange={setIsRecurring}
            trackColor={{ false: Colors.accent, true: Colors.highlight }}
            thumbColor={Colors.textWhite}
          />
        </View>

        {/* Recurrence Options */}
        {isRecurring && (
          <View style={styles.recurrenceRow}>
            {RECURRENCE_OPTIONS.filter((o) => o.value !== '').map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.recurrenceChip,
                  recurrenceRule === opt.value && styles.recurrenceActive,
                ]}
                onPress={() => setRecurrenceRule(opt.value)}
              >
                <Text
                  style={[
                    styles.recurrenceText,
                    recurrenceRule === opt.value && styles.recurrenceTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Button
          title="Create Due"
          onPress={handleCreate}
          loading={loading}
          icon="checkmark-circle"
          fullWidth
          size="lg"
          style={{ marginTop: Spacing.lg, marginBottom: Spacing.xxl }}
        />
      </View>
    </ScrollView>
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
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  previewTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
  },
  previewAmount: {
    fontSize: FontSize.display,
    fontWeight: FontWeight.extrabold,
    color: Colors.highlight,
    letterSpacing: -1,
  },
  previewDate: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  form: { paddingHorizontal: Spacing.md },
  fieldLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginBottom: Spacing.xs,
  },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.accent,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    marginBottom: Spacing.md,
  },
  dateText: {
    fontSize: FontSize.md,
    color: Colors.textPrimary,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  toggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  toggleLabel: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
    color: Colors.textPrimary,
  },
  toggleHint: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    marginTop: 1,
  },
  recurrenceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  recurrenceChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  recurrenceActive: {
    backgroundColor: Colors.highlightSubtle,
    borderColor: Colors.highlight,
  },
  recurrenceText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },
  recurrenceTextActive: {
    color: Colors.highlight,
    fontWeight: FontWeight.semibold,
  },
  pickerModal: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: Colors.overlay,
  },
  pickerContainer: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    paddingBottom: 34,
  },
  pickerDone: {
    alignSelf: 'flex-end',
    padding: Spacing.md,
  },
  pickerDoneText: {
    color: Colors.highlight,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
  },
});
