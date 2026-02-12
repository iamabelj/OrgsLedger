// ============================================================
// OrgsLedger Mobile — Donate Screen (Royal Design)
// ============================================================

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { useAuthStore } from '../../../src/stores/auth.store';
import { api } from '../../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../../src/theme';
import { Card, Button, LoadingScreen, SectionHeader } from '../../../src/components/ui';
import { showAlert } from '../../../src/utils/alert';

const PRESET_AMOUNTS = [10, 25, 50, 100, 250, 500];

export default function DonateScreen() {
  const { campaignId } = useLocalSearchParams<{ campaignId: string }>();
  const currentOrgId = useAuthStore((s) => s.currentOrgId);

  const [campaign, setCampaign] = useState<any>(null);
  const [amount, setAmount] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadCampaign();
  }, [campaignId]);

  const loadCampaign = async () => {
    if (!currentOrgId) return;
    try {
      const res = await api.financials.getCampaigns(currentOrgId);
      const camps = res.data.data || [];
      const found = camps.find((c: any) => c.id === campaignId);
      setCampaign(found || null);
    } catch (err) {
      console.warn('Failed to load campaign:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDonate = async () => {
    const numAmt = parseFloat(amount);
    if (!numAmt || numAmt < 1) {
      showAlert('Error', 'Please enter a valid amount ($1 minimum)');
      return;
    }
    if (!currentOrgId || !campaignId) return;

    setSubmitting(true);
    try {
      await api.financials.makeDonation(currentOrgId, {
        campaignId,
        amount: numAmt,
        isAnonymous,
      });
      showAlert('Thank You!', `Your donation of $${numAmt.toFixed(2)} has been recorded.`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Donation failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingScreen />;

  const progressPct = campaign?.goal_amount ? Math.min(100, ((campaign.total_raised || 0) / campaign.goal_amount) * 100) : 0;

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Make a Donation',
          headerStyle: { backgroundColor: Colors.surface },
          headerTintColor: Colors.highlight,
          headerTitleStyle: { fontWeight: FontWeight.semibold as any, color: Colors.textWhite },
          headerShadowVisible: false,
        }}
      />

      {campaign && (
        <Card style={styles.campaignCard}>
          <View style={styles.heartCircle}>
            <Ionicons name="heart" size={28} color={Colors.success} />
          </View>
          <Text style={styles.campTitle}>{campaign.title}</Text>
          {campaign.description && (
            <Text style={styles.campDesc}>{campaign.description}</Text>
          )}
          {campaign.goal_amount && (
            <>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
              </View>
              <View style={styles.progressRow}>
                <Text style={styles.progressRaised}>${(campaign.total_raised || 0).toFixed(2)} raised</Text>
                <Text style={styles.progressGoal}>of ${campaign.goal_amount.toFixed(2)}</Text>
              </View>
              <Text style={styles.progressPct}>{progressPct.toFixed(0)}% funded</Text>
            </>
          )}
        </Card>
      )}

      {/* Preset amounts */}
      <Card style={styles.amountCard}>
        <SectionHeader title="Select Amount" />
        <View style={styles.presetsRow}>
          {PRESET_AMOUNTS.map((p) => {
            const active = amount === String(p);
            return (
              <TouchableOpacity key={p} style={[styles.presetBtn, active && styles.presetActive]} onPress={() => setAmount(String(p))} activeOpacity={0.7}>
                <Text style={[styles.presetText, active && styles.presetTextActive]}>${p}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.orLabel}>Or enter custom amount</Text>
        <View style={styles.customInputRow}>
          <Text style={styles.currencySign}>$</Text>
          <TextInput
            style={styles.customInput}
            placeholder="0.00"
            placeholderTextColor={Colors.textLight}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
        </View>

        {/* Anonymous toggle */}
        <TouchableOpacity style={styles.toggleRow} onPress={() => setIsAnonymous(!isAnonymous)} activeOpacity={0.7}>
          <View style={[styles.checkbox, isAnonymous && styles.checkboxActive]}>
            {isAnonymous && <Ionicons name="checkmark" size={14} color={Colors.textWhite} />}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleText}>Donate anonymously</Text>
            <Text style={styles.toggleSub}>Your name will not be shown publicly</Text>
          </View>
        </TouchableOpacity>
      </Card>

      <View style={styles.submitArea}>
        <Button
          title={submitting ? 'Processing...' : `Donate${amount ? ` $${parseFloat(amount || '0').toFixed(2)}` : ''}`}
          onPress={handleDonate}
          disabled={submitting}
          variant="primary"
        />
      </View>
      <View style={{ height: Spacing.xxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  campaignCard: { margin: Spacing.md, padding: Spacing.lg, alignItems: 'center' },
  heartCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.successSubtle, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  campTitle: { color: Colors.textWhite, fontSize: FontSize.xl, fontWeight: FontWeight.bold as any, textAlign: 'center' },
  campDesc: { color: Colors.textLight, fontSize: FontSize.md, textAlign: 'center', marginTop: Spacing.xs, lineHeight: 22 },
  progressBar: { width: '100%', height: 8, backgroundColor: Colors.accent, borderRadius: 4, marginTop: Spacing.md, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: Colors.success, borderRadius: 4 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 6 },
  progressRaised: { color: Colors.success, fontSize: FontSize.sm, fontWeight: FontWeight.semibold as any },
  progressGoal: { color: Colors.textLight, fontSize: FontSize.sm },
  progressPct: { color: Colors.textLight, fontSize: FontSize.xs, marginTop: 2 },
  amountCard: { marginHorizontal: Spacing.md, padding: Spacing.md },
  presetsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  presetBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  presetActive: { backgroundColor: Colors.highlight, borderColor: Colors.highlight, ...Shadow.sm },
  presetText: { color: Colors.textLight, fontSize: FontSize.md, fontWeight: FontWeight.semibold as any },
  presetTextActive: { color: Colors.textWhite },
  orLabel: { color: Colors.textLight, fontSize: FontSize.sm, marginTop: Spacing.lg, marginBottom: Spacing.xs },
  customInputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.primaryLight, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.accent, paddingHorizontal: Spacing.md },
  currencySign: { color: Colors.highlight, fontSize: FontSize.xl, fontWeight: FontWeight.bold as any, marginRight: Spacing.xs },
  customInput: { flex: 1, color: Colors.textWhite, fontSize: FontSize.xl, fontWeight: FontWeight.bold as any, paddingVertical: Spacing.md },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.lg, paddingVertical: Spacing.sm },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: Colors.highlight, borderColor: Colors.highlight },
  toggleText: { color: Colors.textWhite, fontSize: FontSize.md, fontWeight: FontWeight.medium as any },
  toggleSub: { color: Colors.textLight, fontSize: FontSize.xs, marginTop: 1 },
  submitArea: { marginHorizontal: Spacing.md, marginTop: Spacing.md },
});
