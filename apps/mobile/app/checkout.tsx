// ============================================================
// OrgsLedger — Checkout / Plan Selection Page
// Users land here from the landing page pricing CTAs.
// After selecting billing region + confirming, they proceed
// to the super-admin registration page.
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, ActivityIndicator, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { api } from '../src/api/client';
import {
  Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow,
} from '../src/theme';
import { Button, Card, PoweredByFooter } from '../src/components/ui';
import { useResponsive } from '../src/hooks/useResponsive';
import { LOGO } from '../src/logo';

// ── Plan features (static fallback) ─────────────────────────
const PLAN_FEATURES: Record<string, { maxMembers: string; features: string[] }> = {
  standard: {
    maxMembers: 'Up to 100 members',
    features: [
      'Real-Time Chat & Channels',
      'Meeting Management',
      'Dues & Donation Collection',
      'Polls & Voting',
      'Event Scheduling & RSVP',
      'Announcements & Documents',
      'Committees & Groups',
      'Mobile + Web Access',
    ],
  },
  professional: {
    maxMembers: 'Up to 300 members',
    features: [
      'Everything in Standard',
      'Advanced Analytics & Reports',
      'Data Export (CSV, Excel)',
      'Custom Branding',
      'AI Meeting Summaries',
      'Real-Time Translation',
      'Expense Tracking & Approval',
      'Priority Email Support',
    ],
  },
  enterprise: {
    maxMembers: 'Up to 500 members',
    features: [
      'Everything in Professional',
      'AI Meeting Summaries',
      'Real-Time Translation',
      'Dedicated Account Manager',
      'Full API Access',
      'Priority Phone & Chat Support',
      'Custom Integrations',
      'SLA Guarantee',
    ],
  },
};

const REGION_OPTIONS = [
  { id: 'global', label: '🌍 Global (USD)', currency: 'USD', symbol: '$' },
  { id: 'nigeria', label: '🇳🇬 Nigeria (NGN)', currency: 'NGN', symbol: '₦' },
];

export default function CheckoutScreen() {
  const responsive = useResponsive();
  const params = useLocalSearchParams<{ plan?: string }>();

  // Read plan from URL/route params
  const selectedPlan = params.plan || 'standard';

  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState('global');
  const [processing, setProcessing] = useState(false);
  
  // Fixed to monthly billing only
  const billingCycle = 'monthly';

  useEffect(() => {
    loadPlans();
  }, []);

  const loadPlans = async () => {
    try {
      const res = await api.subscriptions.getPlans();
      setPlans(res.data?.data || []);
    } catch {
      // Use static fallback
    } finally {
      setLoading(false);
    }
  };

  const currentRegion = REGION_OPTIONS.find((r) => r.id === region) || REGION_OPTIONS[0];
  const plan = plans.find((p: any) => p.slug === selectedPlan);

  const getPrice = () => {
    if (!plan) {
      // Fallback prices (monthly)
      const fallback: Record<string, Record<string, number>> = {
        standard: { USD: 25, NGN: 12500 },
        professional: { USD: 67, NGN: 33500 },
        enterprise: { USD: 210, NGN: 105000 },
      };
      return fallback[selectedPlan]?.[currentRegion.currency] || 0;
    }
    const curr = currentRegion.currency.toLowerCase();
    return plan[`price_${curr}_monthly`] || plan.price_usd_monthly || 0;
  };

  const price = getPrice();
  const planInfo = PLAN_FEATURES[selectedPlan];

  const handleProceedToPayment = () => {
    setProcessing(true);
    // Navigate to super admin registration with plan details
    // Payment will be handled post-registration by the org admin
    const params = new URLSearchParams({
      plan: selectedPlan,
      billing: billingCycle,
      region: region,
      price: String(price),
      currency: currentRegion.currency,
    });
    router.push(`/(auth)/admin-register?${params.toString()}`);
    // Reset in case user navigates back
    setTimeout(() => setProcessing(false), 1000);
  };

  const formatPrice = (amount: number) => {
    if (currentRegion.currency === 'NGN') {
      return `₦${amount.toLocaleString()}`;
    }
    return `$${amount.toLocaleString()}`;
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.scroll,
          { maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' },
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => {
              if (Platform.OS === 'web' && typeof window !== 'undefined') {
                window.location.href = 'https://orgsledger.com/#pricing';
              } else {
                router.back();
              }
            }}
            style={styles.backBtn}
          >
            <Ionicons name="arrow-back" size={20} color={Colors.textPrimary} />
            <Text style={styles.backText}>Back to Pricing</Text>
          </TouchableOpacity>
          <View style={styles.crest}>
            <Image source={LOGO} style={{ width: 48, height: 48 }} resizeMode="contain" />
          </View>
          <Text style={styles.title}>Complete Your Setup</Text>
          <Text style={styles.subtitle}>
            Review your plan and create your organization administrator account
          </Text>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Colors.highlight} />
          </View>
        ) : (
          <>
            {/* Plan Summary Card */}
            <Card style={styles.planCard}>
              <View style={styles.planHeader}>
                <View style={styles.planBadge}>
                  <Ionicons name="diamond-outline" size={16} color={Colors.highlight} />
                  <Text style={styles.planName}>
                    {selectedPlan.charAt(0).toUpperCase() + selectedPlan.slice(1)} Plan
                  </Text>
                </View>
                {planInfo && (
                  <Text style={styles.planMembers}>{planInfo.maxMembers}</Text>
                )}
              </View>

              {/* Features */}
              {planInfo && (
                <View style={styles.featuresList}>
                  {planInfo.features.map((f, i) => (
                    <View key={i} style={styles.featureRow}>
                      <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                      <Text style={styles.featureText}>{f}</Text>
                    </View>
                  ))}
                </View>
              )}
            </Card>

            {/* Billing Region */}
            <Card style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Billing Region</Text>
              <View style={styles.regionRow}>
                {REGION_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.id}
                    style={[
                      styles.regionBtn,
                      region === opt.id && styles.regionBtnActive,
                    ]}
                    onPress={() => setRegion(opt.id)}
                  >
                    <Text style={[
                      styles.regionBtnText,
                      region === opt.id && styles.regionBtnTextActive,
                    ]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Card>

            {/* Price Summary */}
            <Card style={styles.priceCard}>
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>Total</Text>
                <View>
                  <Text style={styles.priceAmount}>{formatPrice(price)}</Text>
                  <Text style={styles.pricePeriod}>/month</Text>
                </View>
              </View>

              <View style={styles.securityRow}>
                <Ionicons name="lock-closed" size={14} color={Colors.success} />
                <Text style={styles.securityText}>
                  Secure payment via Stripe & Paystack. Cancel anytime.
                </Text>
              </View>
            </Card>

            {/* CTA */}
            <Button
              title={processing ? 'Processing...' : 'Create Admin Account & Subscribe'}
              onPress={handleProceedToPayment}
              icon="arrow-forward-outline"
              fullWidth
              size="lg"
              disabled={processing}
              style={{ marginTop: Spacing.md }}
            />

            <Text style={styles.note}>
              You'll create your super admin account next. Payment will be processed
              after your organization is set up.
            </Text>
          </>
        )}

        <PoweredByFooter />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flexGrow: 1, padding: Spacing.lg },
  header: { alignItems: 'center', marginBottom: Spacing.xl, gap: Spacing.sm },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    alignSelf: 'flex-start',
    marginBottom: Spacing.md,
    padding: Spacing.xs,
  },
  backText: { color: Colors.textSecondary, fontSize: FontSize.md },
  crest: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.highlight,
  },
  title: {
    fontSize: FontSize.title, fontWeight: FontWeight.bold as any,
    color: Colors.textPrimary, textAlign: 'center',
  },
  subtitle: {
    fontSize: FontSize.md, color: Colors.textSecondary,
    textAlign: 'center', lineHeight: 22,
  },
  center: { alignItems: 'center', paddingVertical: Spacing.xxl },
  planCard: { padding: Spacing.xl, marginBottom: Spacing.md },
  planHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: Spacing.md,
  },
  planBadge: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.highlightSubtle,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  planName: {
    fontSize: FontSize.lg, fontWeight: FontWeight.bold as any,
    color: Colors.highlight,
  },
  planMembers: {
    fontSize: FontSize.sm, color: Colors.textSecondary,
  },
  featuresList: { gap: Spacing.sm },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  featureText: { fontSize: FontSize.md, color: Colors.textPrimary },
  sectionCard: { padding: Spacing.lg, marginBottom: Spacing.md },
  sectionTitle: {
    fontSize: FontSize.lg, fontWeight: FontWeight.semibold as any,
    color: Colors.textPrimary, marginBottom: Spacing.md,
  },
  regionRow: { flexDirection: 'row', gap: Spacing.sm },
  regionBtn: {
    flex: 1,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  regionBtnActive: {
    borderColor: Colors.highlight,
    backgroundColor: Colors.highlightSubtle,
  },
  regionBtnText: {
    fontSize: FontSize.md, color: Colors.textSecondary,
    fontWeight: FontWeight.medium as any,
  },
  regionBtnTextActive: { color: Colors.highlight },
  priceCard: {
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.highlight,
    backgroundColor: Colors.highlightSubtle,
  },
  priceRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center',
  },
  priceLabel: {
    fontSize: FontSize.xl, fontWeight: FontWeight.semibold as any,
    color: Colors.textPrimary,
  },
  priceAmount: {
    fontSize: FontSize.title, fontWeight: FontWeight.bold as any,
    color: Colors.highlight, textAlign: 'right',
  },
  pricePeriod: {
    fontSize: FontSize.sm, color: Colors.textSecondary,
    textAlign: 'right',
  },
  securityRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    marginTop: Spacing.md, paddingTop: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  securityText: { fontSize: FontSize.sm, color: Colors.textSecondary, flex: 1 },
  note: {
    fontSize: FontSize.sm, color: Colors.textLight,
    textAlign: 'center', marginTop: Spacing.md, lineHeight: 20,
  },
});
