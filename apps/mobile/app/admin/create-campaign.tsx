// ============================================================
// OrgsLedger Mobile — Create Campaign Screen (Admin)
// ============================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import { format, addMonths } from 'date-fns';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Card, Button, Input, Badge, SectionHeader, CrossPlatformDateTimePicker, ResponsiveScrollView } from '../../src/components/ui';
import { showAlert } from '../../src/utils/alert';

export default function CreateCampaignScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [goalAmount, setGoalAmount] = useState('');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(addMonths(new Date(), 1));
  const [startDateChosen, setStartDateChosen] = useState(false);
  const [endDateChosen, setEndDateChosen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) {
      showAlert('Validation', 'Campaign title is required');
      return;
    }
    if (!description.trim()) {
      showAlert('Validation', 'Campaign description is required');
      return;
    }
    const goal = parseFloat(goalAmount);
    if (!goal || goal <= 0) {
      showAlert('Validation', 'Please enter a valid goal amount');
      return;
    }
    if (!startDateChosen || !endDateChosen) {
      showAlert('Validation', 'Please select start and end dates');
      return;
    }
    if (endDate <= startDate) {
      showAlert('Validation', 'End date must be after start date');
      return;
    }
    if (!currentOrgId) return;

    setLoading(true);
    try {
      const res = await api.financials.createCampaign(currentOrgId, {
        title: title.trim(),
        description: description.trim(),
        goalAmount: goal,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
      showAlert('Success', `Campaign "${title}" created!`, [
        { text: 'OK', onPress: () => router.replace('/(tabs)/financials' as any) },
      ]);
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to create campaign');
    } finally {
      setLoading(false);
    }
  };

  const progress = goalAmount ? Math.min(100, 0) : 0; // New campaign starts at 0
  const goalNum = parseFloat(goalAmount || '0');

  return (
    <ResponsiveScrollView style={styles.container} maxWidth={700}>
      <Stack.Screen options={{ title: 'Create Campaign' }} />

      {/* Campaign Preview */}
      <Card variant="elevated" style={styles.previewCard}>
        <View style={styles.previewBanner}>
          <Ionicons name="megaphone" size={32} color={Colors.highlight} />
        </View>
        <Text style={styles.previewTitle}>{title || 'New Campaign'}</Text>
        <Text style={styles.previewDesc} numberOfLines={2}>
          {description || 'Add a compelling description for your campaign'}
        </Text>

        {/* Goal Progress Bar */}
        <View style={styles.goalContainer}>
          <View style={styles.goalBar}>
            <View style={[styles.goalFill, { width: `${progress}%` }]} />
          </View>
          <View style={styles.goalRow}>
            <Text style={styles.goalRaised}>$0.00 raised</Text>
            <Text style={styles.goalTarget}>
              of ${goalNum > 0 ? goalNum.toLocaleString() : '0'}
            </Text>
          </View>
        </View>

        {startDateChosen && endDateChosen && (
          <View style={styles.dateRange}>
            <Badge
              label={`${format(startDate, 'MMM dd')} → ${format(endDate, 'MMM dd, yyyy')}`}
              variant="info"
              size="md"
            />
          </View>
        )}
      </Card>

      <View style={styles.form}>
        <SectionHeader title="Campaign Details" />

        <Input
          label="TITLE"
          placeholder="e.g. Building Fund, Charity Drive"
          value={title}
          onChangeText={setTitle}
          icon="megaphone-outline"
        />

        <Input
          label="DESCRIPTION"
          placeholder="Tell your members why this campaign matters..."
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
          icon="document-text-outline"
        />

        <Input
          label="GOAL AMOUNT ($)"
          placeholder="10,000.00"
          value={goalAmount}
          onChangeText={setGoalAmount}
          keyboardType="decimal-pad"
          icon="trophy-outline"
        />

        <SectionHeader title="Campaign Duration" />

        {/* Start Date */}
        <CrossPlatformDateTimePicker
          label="START DATE"
          value={startDate}
          mode="date"
          hasValue={startDateChosen}
          onChange={(d) => {
            setStartDate(d);
            setStartDateChosen(true);
          }}
        />

        {/* End Date */}
        <CrossPlatformDateTimePicker
          label="END DATE"
          value={endDate}
          mode="date"
          hasValue={endDateChosen}
          onChange={(d) => {
            setEndDate(d);
            setEndDateChosen(true);
          }}
        />

        {startDateChosen && endDateChosen && (
          <View style={styles.durationNote}>
            <Ionicons name="time-outline" size={16} color={Colors.info} />
            <Text style={styles.durationText}>
              Campaign duration:{' '}
              {Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))} days
            </Text>
          </View>
        )}

        <Button
          title="Launch Campaign"
          onPress={handleCreate}
          loading={loading}
          icon="rocket"
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
    paddingVertical: Spacing.xl,
    gap: Spacing.xs,
  },
  previewBanner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  previewTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  previewDesc: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: Spacing.md,
    lineHeight: 20,
  },
  goalContainer: {
    width: '100%',
    paddingHorizontal: Spacing.md,
    marginTop: Spacing.sm,
  },
  goalBar: {
    height: 10,
    backgroundColor: Colors.accent,
    borderRadius: 5,
    overflow: 'hidden',
  },
  goalFill: {
    height: '100%',
    backgroundColor: Colors.highlight,
    borderRadius: 5,
  },
  goalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.xs,
  },
  goalRaised: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.highlight,
  },
  goalTarget: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
  },
  dateRange: {
    marginTop: Spacing.sm,
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
  durationNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.infoSubtle,
    padding: Spacing.sm,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.md,
  },
  durationText: {
    fontSize: FontSize.sm,
    color: Colors.info,
    fontWeight: FontWeight.medium,
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
