// ============================================================
// OrgsLedger — Join Organization via Invite Code
// If authenticated: show Accept & Join button.
// If NOT authenticated: show inline member signup form
// that registers + joins + auto-logs in — zero friction.
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator,
  TouchableOpacity, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { api } from '../../src/api/client';
import { useAuthStore } from '../../src/stores/auth.store';
import {
  Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow,
} from '../../src/theme';
import { Card, Button, Input, PoweredByFooter } from '../../src/components/ui';
import { showAlert } from '../../src/utils/alert';
import { useResponsive } from '../../src/hooks/useResponsive';
import storage from '../../src/utils/storage';
import { socketClient } from '../../src/api/socket';

export default function InviteJoinScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const loadUser = useAuthStore((s) => s.loadUser);
  const responsive = useResponsive();

  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [invite, setInvite] = useState<any>(null);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(false);

  // ── Member Signup Form Fields ─────────────────────────
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [showLoginForm, setShowLoginForm] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  useEffect(() => {
    if (!code) { setError('No invite code provided'); setLoading(false); return; }
    fetchInvite();
  }, [code]);

  const fetchInvite = async () => {
    setLoading(true);
    try {
      const res = await api.subscriptions.validateInvite(code!);
      setInvite(res.data?.data || res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invalid or expired invite code');
    } finally {
      setLoading(false);
    }
  };

  // ── Authenticated user: direct join ───────────────────
  const handleJoin = async () => {
    if (!isAuthenticated) return;
    setJoining(true);
    try {
      await api.subscriptions.joinViaInvite(code!);
      setJoined(true);
      await loadUser();
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to join organization');
    } finally {
      setJoining(false);
    }
  };

  // ── New user: register + join + auto-login (one step) ─
  const handleRegisterAndJoin = async () => {
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedFirst || !trimmedLast || !trimmedEmail || !password) {
      showAlert('Error', 'Please fill in all required fields');
      return;
    }
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

    setRegistering(true);
    try {
      // Use the register-with-invite API that creates account + joins org in one step
      const res = await api.auth.registerWithInvite({
        email: trimmedEmail,
        password,
        firstName: trimmedFirst,
        lastName: trimmedLast,
        phone: phone.trim() || undefined,
        inviteCode: code!,
      });

      const result = res.data?.data || res.data;

      // Auto-login: store tokens and set auth state
      if (result.accessToken) {
        await storage.setItemAsync('accessToken', result.accessToken);
        await storage.setItemAsync('refreshToken', result.refreshToken);

        const memberships = (result.memberships || []).map((m: any) => ({
          ...m,
          organization_id: m.organization_id || m.organizationId,
          organizationId: m.organizationId || m.organization_id,
        }));

        useAuthStore.setState({
          user: result.user,
          memberships,
          isAuthenticated: true,
          currentOrgId: memberships[0]?.organization_id || null,
        });

        // Connect socket in background
        socketClient.connect().catch(() => {});

        setJoined(true);
      }
    } catch (err: any) {
      const data = err.response?.data;
      let message = data?.error || 'Something went wrong';
      if (data?.details && Array.isArray(data.details)) {
        const fieldErrors = data.details.map((d: any) => d.message).join('\n');
        if (fieldErrors) message = fieldErrors;
      }
      showAlert('Registration Failed', message);
    } finally {
      setRegistering(false);
    }
  };

  // ── Existing user: login + join ───────────────────────
  const handleLoginAndJoin = async () => {
    const trimmedEmail = loginEmail.trim().toLowerCase();
    if (!trimmedEmail || !loginPassword) {
      showAlert('Error', 'Please enter your email and password');
      return;
    }

    setRegistering(true);
    try {
      await useAuthStore.getState().login(trimmedEmail, loginPassword);
      // Now join the org
      await api.subscriptions.joinViaInvite(code!);
      await loadUser();
      setJoined(true);
    } catch (err: any) {
      const data = err.response?.data;
      showAlert('Error', data?.error || 'Login failed. Please check your credentials.');
    } finally {
      setRegistering(false);
    }
  };

  const goHome = () => router.replace('/(tabs)/home');

  return (
    <>
      <Stack.Screen options={{
        title: 'Join Organization',
        headerStyle: { backgroundColor: Colors.primary },
        headerTintColor: Colors.textWhite,
      }} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={Colors.highlight} />
              <Text style={styles.loadingText}>Verifying invite...</Text>
            </View>
          ) : error ? (
            <Card style={styles.card}>
              <View style={styles.iconWrap}>
                <Ionicons name="alert-circle" size={64} color={Colors.error} />
              </View>
              <Text style={styles.title}>Invalid Invite</Text>
              <Text style={styles.subtitle}>{error}</Text>
              <Button title="Go Home" onPress={goHome} variant="primary" />
            </Card>
          ) : joined ? (
            <Card style={styles.card}>
              <View style={styles.iconWrap}>
                <Ionicons name="checkmark-circle" size={64} color={Colors.success} />
              </View>
              <Text style={styles.title}>Welcome!</Text>
              <Text style={styles.subtitle}>
                You've successfully joined {invite?.organizationName || 'the organization'}.
              </Text>
              <Button title="Go to Dashboard" onPress={goHome} variant="primary" />
            </Card>
          ) : isAuthenticated ? (
            /* ── Authenticated: simple join card ──────────── */
            <Card style={styles.card}>
              <View style={styles.iconWrap}>
                <Ionicons name="people" size={64} color={Colors.highlight} />
              </View>
              <Text style={styles.title}>You're Invited!</Text>

              {invite?.organizationName && (
                <View style={styles.orgBadge}>
                  <Ionicons name="business" size={18} color={Colors.highlight} />
                  <Text style={styles.orgName}>{invite.organizationName}</Text>
                </View>
              )}

              <Text style={styles.subtitle}>
                You've been invited to join this organization on OrgsLedger.
              </Text>

              {invite?.role && (
                <View style={styles.roleRow}>
                  <Ionicons name="shield-checkmark" size={14} color={Colors.info} />
                  <Text style={styles.roleText}>Role: {invite.role.replace('_', ' ')}</Text>
                </View>
              )}

              <Button
                title={joining ? 'Joining...' : 'Accept Invite & Join'}
                onPress={handleJoin}
                variant="primary"
                disabled={joining}
              />
            </Card>
          ) : (
            /* ── Not Authenticated: inline signup form ────── */
            <>
              {/* Invite Header */}
              <View style={styles.inviteHeader}>
                <View style={styles.iconWrap}>
                  <Ionicons name="people" size={48} color={Colors.highlight} />
                </View>
                <Text style={styles.title}>You're Invited!</Text>
                {invite?.organizationName && (
                  <View style={styles.orgBadge}>
                    <Ionicons name="business" size={16} color={Colors.highlight} />
                    <Text style={styles.orgName}>{invite.organizationName}</Text>
                  </View>
                )}
                {invite?.role && (
                  <View style={styles.roleRow}>
                    <Ionicons name="shield-checkmark" size={14} color={Colors.info} />
                    <Text style={styles.roleText}>Role: {invite.role.replace('_', ' ')}</Text>
                  </View>
                )}
              </View>

              {/* Toggle: Sign Up / Sign In */}
              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[styles.toggleBtn, !showLoginForm && styles.toggleBtnActive]}
                  onPress={() => setShowLoginForm(false)}
                >
                  <Text style={[styles.toggleText, !showLoginForm && styles.toggleTextActive]}>
                    Create Account
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleBtn, showLoginForm && styles.toggleBtnActive]}
                  onPress={() => setShowLoginForm(true)}
                >
                  <Text style={[styles.toggleText, showLoginForm && styles.toggleTextActive]}>
                    Sign In
                  </Text>
                </TouchableOpacity>
              </View>

              {showLoginForm ? (
                /* ── Existing user login form ──────────────── */
                <View style={[styles.formCard, responsive.isPhone && styles.formCardPhone]}>
                  <Text style={styles.formTitle}>Sign in to join</Text>
                  <Text style={styles.formSubtitle}>
                    Already have an account? Sign in and join instantly.
                  </Text>

                  <Input
                    label="EMAIL ADDRESS"
                    placeholder="you@example.com"
                    value={loginEmail}
                    onChangeText={setLoginEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    icon="mail-outline"
                  />

                  <Input
                    label="PASSWORD"
                    placeholder="Enter your password"
                    value={loginPassword}
                    onChangeText={setLoginPassword}
                    secureTextEntry
                    icon="lock-closed-outline"
                  />

                  <Button
                    title={registering ? 'Signing In...' : 'Sign In & Join'}
                    onPress={handleLoginAndJoin}
                    loading={registering}
                    icon="log-in-outline"
                    fullWidth
                    size="lg"
                    style={{ marginTop: Spacing.sm }}
                  />
                </View>
              ) : (
                /* ── New member signup form ────────────────── */
                <View style={[styles.formCard, responsive.isPhone && styles.formCardPhone]}>
                  <Text style={styles.formTitle}>Create your account</Text>
                  <Text style={styles.formSubtitle}>
                    Sign up and join {invite?.organizationName || 'the organization'} instantly.
                  </Text>

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
                      <View key={i} style={styles.ruleRow2}>
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
                    title={registering ? 'Creating Account...' : 'Create Account & Join'}
                    onPress={handleRegisterAndJoin}
                    loading={registering}
                    icon="person-add-outline"
                    fullWidth
                    size="lg"
                    style={{ marginTop: Spacing.sm }}
                  />
                </View>
              )}

              <PoweredByFooter />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: Spacing.lg },
  center: { alignItems: 'center', gap: Spacing.md },
  loadingText: { color: Colors.textSecondary, fontSize: FontSize.md },
  card: { padding: Spacing.xl, alignItems: 'center', gap: Spacing.md },
  iconWrap: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center', justifyContent: 'center',
  },
  title: {
    fontSize: FontSize.title, fontWeight: FontWeight.bold as any,
    color: Colors.textPrimary, textAlign: 'center',
  },
  subtitle: {
    fontSize: FontSize.md, color: Colors.textSecondary,
    textAlign: 'center', lineHeight: 22,
  },
  orgBadge: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: Colors.highlightSubtle,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  orgName: {
    fontSize: FontSize.lg, fontWeight: FontWeight.semibold as any,
    color: Colors.highlight,
  },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  roleText: {
    fontSize: FontSize.sm, color: Colors.info, textTransform: 'capitalize',
  },
  inviteHeader: {
    alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.lg,
  },
  toggleRow: {
    flexDirection: 'row', gap: Spacing.xs, marginBottom: Spacing.md,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg,
    padding: Spacing.xs,
  },
  toggleBtn: {
    flex: 1, paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md, alignItems: 'center',
  },
  toggleBtnActive: { backgroundColor: Colors.highlightSubtle },
  toggleText: {
    fontSize: FontSize.md, color: Colors.textSecondary,
    fontWeight: FontWeight.medium as any,
  },
  toggleTextActive: { color: Colors.highlight, fontWeight: FontWeight.bold as any },
  formCard: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.xl,
    padding: Spacing.xl, borderWidth: 1,
    borderColor: Colors.borderLight, ...Shadow.md,
    gap: Spacing.xs,
  },
  formCardPhone: { padding: Spacing.md, borderRadius: BorderRadius.lg },
  formTitle: {
    fontSize: FontSize.xl, fontWeight: FontWeight.bold as any,
    color: Colors.textPrimary,
  },
  formSubtitle: {
    fontSize: FontSize.sm, color: Colors.textSecondary,
    marginBottom: Spacing.sm,
  },
  nameRow: { flexDirection: 'row' as const, gap: Spacing.sm },
  nameRowPhone: { flexDirection: 'column' as const, gap: Spacing.xs },
  eyeBtn: {
    position: 'absolute', right: Spacing.md, top: 34, padding: Spacing.xs,
  },
  rulesList: { gap: Spacing.xs, marginTop: Spacing.xs },
  ruleRow2: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  ruleText: { fontSize: FontSize.sm, color: Colors.textLight },
});
