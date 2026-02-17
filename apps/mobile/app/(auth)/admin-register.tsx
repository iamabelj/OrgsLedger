// ============================================================
// OrgsLedger — Super Admin Registration (Premium / Distinct)
// This page is for organization founders who are creating
// a new org. It collects admin details + org info in one step.
// ============================================================

import React, { useState, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Image,
} from 'react-native';
import { showAlert } from '../../src/utils/alert';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { LOGO } from '../../src/logo';
import { api } from '../../src/api/client';
import {
  Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow,
} from '../../src/theme';
import { Input, Button, PoweredByFooter } from '../../src/components/ui';
import { useResponsive } from '../../src/hooks/useResponsive';

export default function AdminRegisterScreen() {
  const params = useLocalSearchParams<{
    plan?: string; billing?: string; region?: string;
    price?: string; currency?: string;
  }>();
  const responsive = useResponsive();

  // Read plan details from URL params (web) or route params (mobile)
  const planDetails = useMemo(() => {
    let plan = params.plan || 'standard';
    let billing = params.billing || 'annual';
    let region = params.region || 'global';
    let price = params.price || '0';
    let currency = params.currency || 'USD';

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      plan = urlParams.get('plan') || plan;
      billing = urlParams.get('billing') || billing;
      region = urlParams.get('region') || region;
      price = urlParams.get('price') || price;
      currency = urlParams.get('currency') || currency;
    }

    return { plan, billing, region, price: Number(price), currency };
  }, [params]);

  // ── Admin account fields ──────────────────────────────
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // ── Organization fields ───────────────────────────────
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');

  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'account' | 'organization'>('account');

  const register = useAuthStore((s) => s.register);

  // Auto-generate slug from org name
  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 40);
  };

  const validateAccount = () => {
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedFirst || !trimmedLast || !trimmedEmail || !password) {
      showAlert('Error', 'Please fill in all required fields');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      showAlert('Error', 'Please enter a valid email address');
      return false;
    }
    if (password !== confirmPassword) {
      showAlert('Error', 'Passwords do not match');
      return false;
    }
    if (password.length < 8) {
      showAlert('Error', 'Password must be at least 8 characters');
      return false;
    }
    return true;
  };

  const handleContinueToOrg = () => {
    if (validateAccount()) {
      setStep('organization');
    }
  };

  const handleCreateOrganization = async () => {
    const trimmedOrgName = orgName.trim();
    const trimmedSlug = orgSlug.trim() || generateSlug(trimmedOrgName);

    if (!trimmedOrgName) {
      showAlert('Error', 'Organization name is required');
      return;
    }
    if (!trimmedSlug || trimmedSlug.length < 3) {
      showAlert('Error', 'Organization URL must be at least 3 characters');
      return;
    }

    setLoading(true);
    try {
      // Step 1: Register the admin account (uses the admin-register API)
      await api.auth.adminRegister({
        email: email.trim().toLowerCase(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
        orgName: trimmedOrgName,
        orgSlug: trimmedSlug,
        plan: planDetails.plan,
        billingCycle: planDetails.billing,
        billingRegion: planDetails.region,
        currency: planDetails.currency,
      });

      // Step 2: Login with the new credentials
      await useAuthStore.getState().login(email.trim().toLowerCase(), password);

      // Navigate to dashboard
      setTimeout(() => {
        router.replace('/(tabs)/home');
      }, 100);
    } catch (err: any) {
      const data = err.response?.data;
      let message = data?.error || 'Something went wrong';
      if (data?.details && Array.isArray(data.details)) {
        const fieldErrors = data.details.map((d: any) => d.message).join('\n');
        if (fieldErrors) message = fieldErrors;
      }
      showAlert('Registration Failed', message);
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = () => {
    if (planDetails.currency === 'NGN') {
      return `₦${planDetails.price.toLocaleString()}`;
    }
    return `$${planDetails.price.toLocaleString()}`;
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          responsive.isPhone && styles.scrollPhone,
          { maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Brand Section */}
        <View style={styles.brand}>
          <View style={styles.crest}>
            <Image source={LOGO} style={{ width: 36, height: 36 }} resizeMode="contain" />
          </View>
          <Text style={styles.logo}>
            {step === 'account' ? 'Create Admin Account' : 'Set Up Organization'}
          </Text>
          <Text style={styles.tagline}>
            {step === 'account'
              ? 'Set up your super administrator account'
              : 'Configure your organization details'
            }
          </Text>

          {/* Plan Badge */}
          <View style={styles.planBadge}>
            <Ionicons name="diamond" size={14} color={Colors.highlight} />
            <Text style={styles.planBadgeText}>
              {planDetails.plan.charAt(0).toUpperCase() + planDetails.plan.slice(1)} Plan
              {planDetails.price > 0 ? ` · ${formatPrice()}/${planDetails.billing === 'annual' ? 'yr' : 'mo'}` : ''}
            </Text>
          </View>

          {/* Step Indicator */}
          <View style={styles.stepRow}>
            <View style={[styles.stepDot, step === 'account' && styles.stepDotActive]} />
            <View style={[styles.stepLine, step === 'organization' && styles.stepLineActive]} />
            <View style={[styles.stepDot, step === 'organization' && styles.stepDotActive]} />
          </View>
          <View style={styles.stepLabelRow}>
            <Text style={[styles.stepLabel, step === 'account' && styles.stepLabelActive]}>
              Admin Account
            </Text>
            <Text style={[styles.stepLabel, step === 'organization' && styles.stepLabelActive]}>
              Organization
            </Text>
          </View>
        </View>

        {/* Form */}
        <View style={[styles.formCard, responsive.isPhone && styles.formCardPhone]}>
          {step === 'account' ? (
            <>
              {/* Admin Role Badge */}
              <View style={styles.roleBadge}>
                <Ionicons name="star" size={14} color={Colors.warning} />
                <Text style={styles.roleBadgeText}>Super Administrator Account</Text>
              </View>

              <View style={[styles.nameRow, responsive.isPhone && styles.nameRowPhone]}>
                <View style={responsive.isPhone ? { width: '100%' } : { flex: 1 }}>
                  <Input
                    label="FIRST NAME"
                    placeholder="John"
                    value={firstName}
                    onChangeText={setFirstName}
                    icon="person-outline"
                  />
                </View>
                <View style={responsive.isPhone ? { width: '100%' } : { flex: 1 }}>
                  <Input
                    label="LAST NAME"
                    placeholder="Doe"
                    value={lastName}
                    onChangeText={setLastName}
                    icon="person-outline"
                  />
                </View>
              </View>

              <Input
                label="EMAIL ADDRESS"
                placeholder="admin@yourorganization.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                icon="mail-outline"
              />

              <Input
                label="PHONE NUMBER (OPTIONAL)"
                placeholder="+234 XXX XXX XXXX"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                icon="call-outline"
              />

              <View>
                <Input
                  label="PASSWORD"
                  placeholder="Minimum 8 characters"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  icon="lock-closed-outline"
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={20}
                    color={Colors.textLight}
                  />
                </TouchableOpacity>
              </View>

              <Input
                label="CONFIRM PASSWORD"
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPassword}
                icon="shield-checkmark-outline"
              />

              {/* Password Rules */}
              <View style={styles.rulesList}>
                {[
                  { text: 'At least 8 characters', met: password.length >= 8 },
                  { text: 'Passwords match', met: password.length > 0 && password === confirmPassword },
                ].map((rule, i) => (
                  <View key={i} style={styles.ruleRow}>
                    <Ionicons
                      name={rule.met ? 'checkmark-circle' : 'ellipse-outline'}
                      size={16}
                      color={rule.met ? Colors.success : Colors.textLight}
                    />
                    <Text style={[styles.ruleText, rule.met && { color: Colors.success }]}>
                      {rule.text}
                    </Text>
                  </View>
                ))}
              </View>

              <Button
                title="Continue to Organization Setup"
                onPress={handleContinueToOrg}
                icon="arrow-forward-outline"
                fullWidth
                size="lg"
                style={{ marginTop: Spacing.sm }}
              />
            </>
          ) : (
            <>
              {/* Organization Setup */}
              <View style={styles.roleBadge}>
                <Ionicons name="business" size={14} color={Colors.highlight} />
                <Text style={styles.roleBadgeText}>Organization Details</Text>
              </View>

              <Input
                label="ORGANIZATION NAME"
                placeholder="My Organization"
                value={orgName}
                onChangeText={(text) => {
                  setOrgName(text);
                  if (!orgSlug || orgSlug === generateSlug(orgName)) {
                    setOrgSlug(generateSlug(text));
                  }
                }}
                icon="business-outline"
              />

              <Input
                label="ORGANIZATION URL"
                placeholder="my-organization"
                value={orgSlug}
                onChangeText={(text) => setOrgSlug(text.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                icon="link-outline"
                autoCapitalize="none"
              />
              <Text style={styles.slugPreview}>
                app.orgsledger.com/org/{orgSlug || 'your-org'}
              </Text>

              <View style={styles.btnRow}>
                <TouchableOpacity
                  style={styles.backStepBtn}
                  onPress={() => setStep('account')}
                >
                  <Ionicons name="arrow-back" size={18} color={Colors.textSecondary} />
                  <Text style={styles.backStepText}>Back</Text>
                </TouchableOpacity>

                <View style={{ flex: 1 }}>
                  <Button
                    title={loading ? 'Creating...' : 'Create Organization'}
                    onPress={handleCreateOrganization}
                    loading={loading}
                    icon="rocket-outline"
                    fullWidth
                    size="lg"
                  />
                </View>
              </View>
            </>
          )}
        </View>

        {/* Footer */}
        <TouchableOpacity
          onPress={() => router.push('/(auth)/login')}
          style={styles.footerLink}
        >
          <Text style={styles.footerText}>
            Already have an account?{' '}
            <Text style={styles.footerBold}>Sign In</Text>
          </Text>
        </TouchableOpacity>

        <PoweredByFooter />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: Spacing.lg },
  scrollPhone: { padding: Spacing.md },
  brand: { alignItems: 'center', marginBottom: Spacing.lg },
  crest: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.highlight,
    marginBottom: Spacing.sm,
  },
  logo: {
    fontSize: FontSize.xxl, fontWeight: FontWeight.bold as any,
    color: Colors.textPrimary,
  },
  tagline: {
    fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 4,
  },
  planBadge: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.highlightSubtle,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full, marginTop: Spacing.sm,
  },
  planBadgeText: {
    fontSize: FontSize.sm, fontWeight: FontWeight.semibold as any,
    color: Colors.highlight,
  },
  stepRow: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: Spacing.lg, gap: 0,
  },
  stepDot: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: Colors.border,
  },
  stepDotActive: { backgroundColor: Colors.highlight },
  stepLine: {
    width: 60, height: 2, backgroundColor: Colors.border,
  },
  stepLineActive: { backgroundColor: Colors.highlight },
  stepLabelRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    width: 84 + 60, marginTop: Spacing.xs,
  },
  stepLabel: {
    fontSize: FontSize.xs, color: Colors.textLight,
  },
  stepLabelActive: { color: Colors.highlight, fontWeight: FontWeight.semibold as any },
  roleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.highlightSubtle,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg, marginBottom: Spacing.md,
    alignSelf: 'flex-start',
  },
  roleBadgeText: {
    fontSize: FontSize.sm, fontWeight: FontWeight.semibold as any,
    color: Colors.highlight,
  },
  formCard: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.xl, borderWidth: 1,
    borderColor: Colors.borderLight, ...Shadow.md,
    gap: Spacing.xs,
  },
  formCardPhone: { padding: Spacing.md, borderRadius: BorderRadius.lg },
  nameRow: { flexDirection: 'row' as const, gap: Spacing.sm },
  nameRowPhone: { flexDirection: 'column' as const, gap: Spacing.xs },
  eyeBtn: {
    position: 'absolute', right: Spacing.md, top: 34, padding: Spacing.xs,
  },
  rulesList: { gap: Spacing.xs, marginTop: Spacing.xs },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  ruleText: { fontSize: FontSize.sm, color: Colors.textLight },
  slugPreview: {
    fontSize: FontSize.xs, color: Colors.textLight,
    marginTop: -Spacing.xs, marginBottom: Spacing.sm,
  },
  btnRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  backStepBtn: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    padding: Spacing.md,
  },
  backStepText: { fontSize: FontSize.md, color: Colors.textSecondary },
  footerLink: {
    alignItems: 'center', marginTop: Spacing.lg, paddingVertical: Spacing.md,
  },
  footerText: { color: Colors.textSecondary, fontSize: FontSize.md },
  footerBold: { color: Colors.highlight, fontWeight: FontWeight.bold as any },
});
