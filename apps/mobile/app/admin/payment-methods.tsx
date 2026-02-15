// ============================================================
// OrgsLedger Mobile — Payment Methods Config Screen
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../src/theme';
import { Card, Button, Input, SectionHeader, ResponsiveScrollView } from '../../src/components/ui';
import { showAlert } from '../../src/utils/alert';

interface PaymentMethodConfig {
  enabled: boolean;
  label: string;
  bank_name?: string;
  account_number?: string;
  account_name?: string;
  instructions?: string;
}

interface PaymentMethods {
  paystack: PaymentMethodConfig;
  flutterwave: PaymentMethodConfig;
  stripe: PaymentMethodConfig;
  bank_transfer: PaymentMethodConfig;
}

const DEFAULT_METHODS: PaymentMethods = {
  paystack: { enabled: true, label: 'Pay with Paystack' },
  flutterwave: { enabled: true, label: 'Pay with Flutterwave' },
  stripe: { enabled: false, label: 'Pay with Card (Stripe)' },
  bank_transfer: {
    enabled: false,
    label: 'Bank Transfer',
    bank_name: '',
    account_number: '',
    account_name: '',
    instructions: 'Please transfer to the above account and submit proof of payment.',
  },
};

export default function PaymentMethodsScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const [methods, setMethods] = useState<PaymentMethods>(DEFAULT_METHODS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadMethods();
  }, []);

  const loadMethods = async () => {
    if (!currentOrgId) return;
    try {
      const res = await api.payments.getPaymentMethods(currentOrgId);
      setMethods({ ...DEFAULT_METHODS, ...res.data.data });
    } catch {
      // Use defaults
    } finally {
      setLoading(false);
    }
  };

  const toggleGateway = (key: keyof PaymentMethods, enabled: boolean) => {
    setMethods((prev) => ({
      ...prev,
      [key]: { ...prev[key], enabled },
    }));
  };

  const updateField = (key: keyof PaymentMethods, field: string, value: string) => {
    setMethods((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  };

  const handleSave = async () => {
    if (!currentOrgId) return;
    setSaving(true);
    try {
      await api.payments.updatePaymentMethods(currentOrgId, methods);
      showAlert('Saved', 'Payment methods updated successfully');
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <ResponsiveScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.subtitle}>
        Configure which payment methods are available for your members when paying dues, fines, and donations.
      </Text>

      {/* Paystack */}
      <Card style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.gatewayName}>Paystack</Text>
          <Switch
            value={methods.paystack.enabled}
            onValueChange={(v) => toggleGateway('paystack', v)}
            trackColor={{ false: Colors.border, true: Colors.accent }}
          />
        </View>
        <Text style={styles.gatewayDesc}>Nigerian card & bank payments (auto-verified)</Text>
      </Card>

      {/* Flutterwave */}
      <Card style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.gatewayName}>Flutterwave</Text>
          <Switch
            value={methods.flutterwave.enabled}
            onValueChange={(v) => toggleGateway('flutterwave', v)}
            trackColor={{ false: Colors.border, true: Colors.accent }}
          />
        </View>
        <Text style={styles.gatewayDesc}>African card & mobile money payments (auto-verified)</Text>
      </Card>

      {/* Stripe */}
      <Card style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.gatewayName}>Stripe</Text>
          <Switch
            value={methods.stripe.enabled}
            onValueChange={(v) => toggleGateway('stripe', v)}
            trackColor={{ false: Colors.border, true: Colors.accent }}
          />
        </View>
        <Text style={styles.gatewayDesc}>International card payments in USD (auto-verified)</Text>
      </Card>

      {/* Bank Transfer */}
      <Card style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.gatewayName}>Bank Transfer</Text>
          <Switch
            value={methods.bank_transfer.enabled}
            onValueChange={(v) => toggleGateway('bank_transfer', v)}
            trackColor={{ false: Colors.border, true: Colors.accent }}
          />
        </View>
        <Text style={styles.gatewayDesc}>Manual bank transfer — requires admin approval</Text>

        {methods.bank_transfer.enabled && (
          <View style={styles.bankFields}>
            <SectionHeader title="Bank Details" />
            <Input
              label="Bank Name"
              value={methods.bank_transfer.bank_name || ''}
              onChangeText={(v) => updateField('bank_transfer', 'bank_name', v)}
              placeholder="e.g. GTBank"
            />
            <Input
              label="Account Number"
              value={methods.bank_transfer.account_number || ''}
              onChangeText={(v) => updateField('bank_transfer', 'account_number', v)}
              placeholder="e.g. 0123456789"
              keyboardType="numeric"
            />
            <Input
              label="Account Name"
              value={methods.bank_transfer.account_name || ''}
              onChangeText={(v) => updateField('bank_transfer', 'account_name', v)}
              placeholder="e.g. My Organization"
            />
            <Input
              label="Instructions"
              value={methods.bank_transfer.instructions || ''}
              onChangeText={(v) => updateField('bank_transfer', 'instructions', v)}
              placeholder="Instructions shown to members"
              multiline
            />
          </View>
        )}
      </Card>

      <Button
        title={saving ? 'Saving...' : 'Save Payment Methods'}
        onPress={handleSave}
        disabled={saving}
        style={styles.saveBtn}
      />
    </ResponsiveScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  subtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.lg,
    lineHeight: 20,
  },
  card: { marginBottom: Spacing.md, padding: Spacing.md },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  gatewayName: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textPrimary },
  gatewayDesc: { fontSize: FontSize.xs, color: Colors.textSecondary },
  bankFields: { marginTop: Spacing.md },
  saveBtn: { marginTop: Spacing.lg },
});
