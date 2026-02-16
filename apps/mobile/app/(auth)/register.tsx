// ============================================================
// OrgsLedger Mobile — Register Screen (Royal Design)
// Registration requires a valid signup invite code.
// ============================================================

import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { showAlert } from '../../src/utils/alert';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Input, Button, PoweredByFooter } from '../../src/components/ui';
import { useResponsive } from '../../src/hooks/useResponsive';

export default function RegisterScreen() {
  const params = useLocalSearchParams<{ org?: string; invite?: string }>();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteValid, setInviteValid] = useState<boolean | null>(null);
  const [inviteChecking, setInviteChecking] = useState(false);
  const [inviteInfo, setInviteInfo] = useState<any>(null);
  const register = useAuthStore((s) => s.register);
  const responsive = useResponsive();

  // Detect invite code from URL params or web window location
  const initialInviteCode = useMemo(() => {
    if (params.invite) return params.invite;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const inviteParam = urlParams.get('invite');
      if (inviteParam) return inviteParam;
    }
    return '';
  }, [params.invite]);

  // Detect org slug from URL params or web window location
  const orgSlug = useMemo(() => {
    if (params.org) return params.org;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const orgParam = urlParams.get('org');
      if (orgParam) return orgParam;
      const pathMatch = window.location.pathname.match(/\/join\/([a-z0-9-]+)/i);
      if (pathMatch) return pathMatch[1];
    }
    return undefined;
  }, [params.org]);

  // If no invite code from URL, redirect to login (signup hidden)
  const hasInviteFromUrl = !!initialInviteCode;

  useEffect(() => {
    if (initialInviteCode) {
      setInviteCode(initialInviteCode);
      validateInviteCode(initialInviteCode);
    }
  }, [initialInviteCode]);

  const validateInviteCode = async (code: string) => {
    if (!code.trim()) {
      setInviteValid(null);
      setInviteInfo(null);
      return;
    }
    setInviteChecking(true);
    try {
      const res = await api.subscriptions.validateSignupInvite(code.trim());
      setInviteValid(res.data.valid);
      setInviteInfo(res.data.data);
      // Auto-fill email if invite is targeted
      if (res.data.data?.email) {
        setEmail(res.data.data.email);
      }
    } catch (err: any) {
      setInviteValid(false);
      setInviteInfo(null);
    } finally {
      setInviteChecking(false);
    }
  };

  const handleRegister = async () => {
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPhone = phone.trim();
    const trimmedInvite = inviteCode.trim();

    if (!trimmedInvite) {
      showAlert('Error', 'An invite code is required to create an account');
      return;
    }
    if (!trimmedFirst || !trimmedLast || !trimmedEmail || !password) {
      showAlert('Error', 'Please fill in all required fields');
      return;
    }
    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      showAlert('Error', 'Please enter a valid email address');
      return;
    }
    if (password !== confirmPassword) {
      showAlert('Error', 'Passwords do not match');
      return;
    }
    if (password.length < 8) {
      showAlert('Error', 'Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      await register({
        email: trimmedEmail,
        password,
        firstName: trimmedFirst,
        lastName: trimmedLast,
        phone: trimmedPhone || undefined,
        orgSlug: orgSlug || undefined,
        inviteCode: trimmedInvite,
      });
      // Use setTimeout to ensure state update completes before navigation
      setTimeout(() => {
        router.replace('/(tabs)/home');
      }, 100);
    } catch (err: any) {
      const data = err.response?.data;
      let message = data?.error || 'Something went wrong';
      // Show specific validation details if available
      if (data?.details && Array.isArray(data.details)) {
        const fieldErrors = data.details
          .map((d: any) => d.message)
          .join('\n');
        if (fieldErrors) message = fieldErrors;
      }
      showAlert('Registration Failed', message);
    } finally {
      setLoading(false);
    }
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
        {/* Show restricted access message if no invite code */}
        {!hasInviteFromUrl && inviteValid !== true ? (
          <View style={styles.restrictedContainer}>
            <View style={styles.crest}>
              <Ionicons name="lock-closed" size={32} color={Colors.highlight} />
            </View>
            <Text style={styles.logo}>Registration Restricted</Text>
            <Text style={styles.tagline}>
              Account creation requires an invite link from a super admin.
              If you've received one, please use the link provided in your email.
            </Text>

            {/* Manual invite code entry */}
            <View style={[styles.formCard, { width: '100%', marginTop: Spacing.lg }]}>
              <Text style={styles.inviteLabel}>Have an invite code?</Text>
              <Input
                label="INVITE CODE"
                placeholder="Enter your invite code"
                value={inviteCode}
                onChangeText={(text) => {
                  setInviteCode(text.toUpperCase());
                  if (text.length >= 8) validateInviteCode(text);
                }}
                icon="key-outline"
                autoCapitalize="characters"
              />
              {inviteChecking && (
                <View style={styles.inviteStatus}>
                  <ActivityIndicator size="small" color={Colors.highlight} />
                  <Text style={styles.inviteStatusText}>Verifying...</Text>
                </View>
              )}
              {inviteValid === false && !inviteChecking && inviteCode.length > 0 && (
                <View style={styles.inviteStatus}>
                  <Ionicons name="close-circle" size={16} color={Colors.error} />
                  <Text style={[styles.inviteStatusText, { color: Colors.error }]}>
                    Invalid or expired invite code
                  </Text>
                </View>
              )}
              <Button
                title="Verify & Continue"
                onPress={() => validateInviteCode(inviteCode)}
                disabled={!inviteCode.trim() || inviteChecking}
                variant="primary"
                fullWidth
                style={{ marginTop: Spacing.sm }}
              />
            </View>

            <TouchableOpacity onPress={() => router.push('/(auth)/login')} style={styles.footerLink}>
              <Text style={styles.footerText}>
                Already have an account?{' '}
                <Text style={styles.footerBold}>Sign In</Text>
              </Text>
            </TouchableOpacity>
            <PoweredByFooter />
          </View>
        ) : (
          <>
            {/* Brand */}
            <View style={styles.brand}>
              <View style={styles.crest}>
                <Ionicons name="person-add" size={32} color={Colors.highlight} />
              </View>
              <Text style={styles.logo}>Create Account</Text>
              <Text style={styles.tagline}>Join OrgsLedger today</Text>
              {inviteInfo?.organizationName && (
                <View style={styles.orgBadge}>
                  <Ionicons name="business" size={14} color={Colors.highlight} />
                  <Text style={styles.orgBadgeText}>Joining: {inviteInfo.organizationName}</Text>
                </View>
              )}
            </View>

            {/* Registration Form */}
            <View style={[styles.formCard, responsive.isPhone && styles.formCardPhone]}>
              {/* Invite Code Field (read-only if from URL) */}
              <View style={styles.inviteCodeSection}>
                <Input
                  label="INVITE CODE"
                  placeholder="Your invite code"
                  value={inviteCode}
                  onChangeText={(text) => {
                    setInviteCode(text.toUpperCase());
                  }}
                  icon="key-outline"
                  autoCapitalize="characters"
                  editable={!hasInviteFromUrl}
                />
                {inviteValid === true && (
                  <View style={styles.inviteValidBadge}>
                    <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                    <Text style={styles.inviteValidText}>Valid invite</Text>
                  </View>
                )}
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
            placeholder="you@example.com"
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
            title="Create Account"
            onPress={handleRegister}
            loading={loading}
            icon="person-add-outline"
            fullWidth
            size="lg"
            style={{ marginTop: Spacing.sm }}
          />
        </View>

        {/* Footer */}
        <TouchableOpacity onPress={() => router.push('/(auth)/login')} style={styles.footerLink}>
          <Text style={styles.footerText}>
            Already have an account?{' '}
            <Text style={styles.footerBold}>Sign In</Text>
          </Text>
        </TouchableOpacity>

        <PoweredByFooter />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: Spacing.lg },
  scrollPhone: { padding: Spacing.md },
  restrictedContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxl,
    gap: Spacing.md,
  },
  inviteLabel: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  inviteStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  inviteStatusText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  inviteCodeSection: {
    marginBottom: Spacing.xs,
  },
  inviteValidBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  inviteValidText: {
    fontSize: FontSize.xs,
    color: Colors.success,
    fontWeight: FontWeight.medium,
  },
  orgBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.highlightSubtle,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
    marginTop: Spacing.xs,
  },
  orgBadgeText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.highlight,
  },
  brand: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  crest: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.highlight,
    marginBottom: Spacing.sm,
  },
  logo: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  tagline: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  formCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xl,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    ...Shadow.md,
    gap: Spacing.xs,
  },
  formCardPhone: {
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
  },
  nameRow: {
    flexDirection: 'row' as const,
    gap: Spacing.sm,
  },
  nameRowPhone: {
    flexDirection: 'column' as const,
    gap: Spacing.xs,
  },
  eyeBtn: {
    position: 'absolute',
    right: Spacing.md,
    top: 34,
    padding: Spacing.xs,
  },
  rulesList: {
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  ruleText: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
  },
  footerLink: {
    alignItems: 'center',
    marginTop: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  footerText: {
    color: Colors.textSecondary,
    fontSize: FontSize.md,
  },
  footerBold: {
    color: Colors.highlight,
    fontWeight: FontWeight.bold,
  },
});
