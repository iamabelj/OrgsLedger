// ============================================================
// OrgsLedger — Login Screen (Split Layout — Royal Design)
// Desktop: Left panel (benefits + branding) | Right panel (login form)
// Mobile: Single column — branding → login
// ============================================================

import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Image,
} from 'react-native';
import { showAlert } from '../../src/utils/alert';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import {
  Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow,
} from '../../src/theme';
import { Input, Button, PoweredByFooter } from '../../src/components/ui';
import { useResponsive } from '../../src/hooks/useResponsive';

const LOGO = require('../../assets/logo-no-bg.png');

const BENEFITS = [
  {
    icon: 'wallet-outline' as const,
    title: 'Financial Transparency',
    desc: 'Track dues, payments, and expenses with full audit trails your members can trust.',
  },
  {
    icon: 'people-outline' as const,
    title: 'Member Management',
    desc: 'Onboard members, assign roles, and manage your entire roster effortlessly.',
  },
  {
    icon: 'chatbubbles-outline' as const,
    title: 'Built-in Communication',
    desc: 'Real-time chat, announcements, polls, and meeting coordination — all in one place.',
  },
  {
    icon: 'document-text-outline' as const,
    title: 'Document Vault',
    desc: 'Store minutes, receipts, and legal documents with secure role-based access.',
  },
  {
    icon: 'globe-outline' as const,
    title: 'Cross-Border Ready',
    desc: 'Multi-currency support with Stripe, Paystack, and Flutterwave integrations.',
  },
];

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const responsive = useResponsive();

  const handleLogin = async () => {
    if (!email || !password) {
      showAlert('Error', 'Please enter email and password');
      return;
    }
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      setTimeout(() => router.replace('/(tabs)/home'), 100);
    } catch (err: any) {
      showAlert('Login Failed', err.response?.data?.error || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  const isWide = responsive.isDesktop || responsive.isTablet;

  // ── Left Panel: Benefits & Branding ─────────────────────
  const BenefitsPanel = () => (
    <View style={[s.leftPanel, !isWide && s.leftPanelMobile]}>
      {/* Logo + Brand */}
      <View style={s.brandSection}>
        <Image source={LOGO} style={s.logoImage} resizeMode="contain" />
        <Text style={s.brandName}>OrgsLedger</Text>
        <View style={s.ornament}>
          <View style={s.ornamentLine} />
          <Ionicons name="diamond" size={8} color={Colors.highlight} />
          <View style={s.ornamentLine} />
        </View>
        <Text style={s.tagline}>Your organization's operational hub</Text>
      </View>

      {/* Benefits List */}
      {!responsive.isPhone && (
        <View style={s.benefitsList}>
          {BENEFITS.map((b, i) => (
            <View key={i} style={s.benefitRow}>
              <View style={s.benefitIcon}>
                <Ionicons name={b.icon} size={20} color={Colors.highlight} />
              </View>
              <View style={s.benefitContent}>
                <Text style={s.benefitTitle}>{b.title}</Text>
                <Text style={s.benefitDesc}>{b.desc}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Compact mobile benefits */}
      {responsive.isPhone && (
        <View style={s.benefitsCompact}>
          {BENEFITS.slice(0, 3).map((b, i) => (
            <View key={i} style={s.benefitChip}>
              <Ionicons name={b.icon} size={14} color={Colors.highlight} />
              <Text style={s.benefitChipText}>{b.title}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  // ── Right Panel: Login Form ─────────────────────────────
  const LoginForm = () => (
    <View style={[s.rightPanel, !isWide && s.rightPanelMobile]}>
      <View style={[s.formCard, responsive.isPhone && s.formCardPhone]}>
        <Text style={s.formTitle}>Welcome Back</Text>
        <Text style={s.formSubtitle}>Sign in to your account</Text>

        <View style={s.formFields}>
          <Input
            label="EMAIL ADDRESS"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            icon="mail-outline"
          />

          <View>
            <Input
              label="PASSWORD"
              placeholder="Your password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              icon="lock-closed-outline"
            />
            <TouchableOpacity
              style={s.eyeBtn}
              onPress={() => setShowPassword(!showPassword)}
            >
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color={Colors.textLight}
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={s.forgotBtn} onPress={() => router.push('/(auth)/forgot-password')}>
            <Text style={s.forgotText}>Forgot Password?</Text>
          </TouchableOpacity>

          <Button
            title="Sign In"
            onPress={handleLogin}
            loading={loading}
            icon="log-in-outline"
            fullWidth
            size="lg"
          />
        </View>

        {/* Footer info */}
        <View style={s.footerInfo}>
          <Text style={s.footerText}>
            Need an account? Contact your organization admin for an invite link.
          </Text>
        </View>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[
          s.scroll,
          isWide && s.scrollWide,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {isWide ? (
          /* ── Desktop / Tablet: side-by-side ──────────── */
          <View style={s.splitContainer}>
            <BenefitsPanel />
            <LoginForm />
          </View>
        ) : (
          /* ── Phone: stacked ──────────────────────────── */
          <View style={s.stackContainer}>
            <BenefitsPanel />
            <LoginForm />
            <PoweredByFooter />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flexGrow: 1,
  },
  scrollWide: {
    justifyContent: 'center',
    minHeight: '100%',
  },

  // ── Split Layout (Desktop/Tablet) ─────────────────────
  splitContainer: {
    flexDirection: 'row',
    flex: 1,
    minHeight: '100%',
  },

  // ── Stacked Layout (Phone) ────────────────────────────
  stackContainer: {
    padding: Spacing.md,
    gap: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },

  // ── Left Panel ────────────────────────────────────────
  leftPanel: {
    flex: 1,
    backgroundColor: Colors.primary,
    padding: Spacing.xxl,
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: Colors.accent,
  },
  leftPanelMobile: {
    padding: 0,
    borderRightWidth: 0,
    backgroundColor: 'transparent',
  },

  brandSection: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  logoImage: {
    width: 72,
    height: 72,
    marginBottom: Spacing.sm,
  },
  brandName: {
    fontSize: 30,
    fontWeight: FontWeight.extrabold,
    color: Colors.highlight,
    letterSpacing: 1.5,
  },
  ornament: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginVertical: Spacing.sm,
  },
  ornamentLine: {
    width: 40,
    height: 1,
    backgroundColor: Colors.highlight,
    opacity: 0.4,
  },
  tagline: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
  },

  // ── Benefits (Desktop/Tablet) ─────────────────────────
  benefitsList: {
    gap: Spacing.md,
    maxWidth: 420,
    alignSelf: 'center',
  },
  benefitRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    alignItems: 'flex-start',
  },
  benefitIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  benefitContent: {
    flex: 1,
  },
  benefitTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  benefitDesc: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 18,
  },

  // ── Benefits Compact (Phone) ──────────────────────────
  benefitsCompact: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    justifyContent: 'center',
  },
  benefitChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.highlightSubtle,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  benefitChipText: {
    fontSize: FontSize.xs,
    color: Colors.highlight,
    fontWeight: FontWeight.medium,
  },

  // ── Right Panel ───────────────────────────────────────
  rightPanel: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.xxl,
    maxWidth: 520,
  },
  rightPanelMobile: {
    padding: 0,
    maxWidth: '100%',
  },

  // ── Form Card ─────────────────────────────────────────
  formCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadow.md,
  },
  formCardPhone: {
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
  },
  formTitle: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  formSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: Spacing.lg,
  },
  formFields: {
    gap: Spacing.sm,
  },
  eyeBtn: {
    position: 'absolute',
    right: Spacing.md,
    top: 34,
    padding: Spacing.xs,
  },
  forgotBtn: {
    alignSelf: 'flex-end',
    marginBottom: Spacing.xs,
  },
  forgotText: {
    fontSize: FontSize.sm,
    color: Colors.highlight,
    fontWeight: FontWeight.medium,
  },
  footerInfo: {
    alignItems: 'center',
    marginTop: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  footerText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
});
