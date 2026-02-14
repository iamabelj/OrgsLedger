// ============================================================
// OrgsLedger — Email Verification Screen
// ============================================================

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { api } from '../src/api/client';
import { useAuthStore } from '../src/stores/auth.store';
import {
  Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow,
} from '../src/theme';
import { Button, Card } from '../src/components/ui';
import { showAlert } from '../src/utils/alert';

export default function VerifyEmailScreen() {
  const { email: paramEmail } = useLocalSearchParams<{ email?: string }>();
  const user = useAuthStore((s) => s.user);
  const email = paramEmail || user?.email || '';

  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const inputRefs = useRef<(TextInput | null)[]>([]);

  // Countdown timer for resend button
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendCode = async () => {
    if (!email) {
      showAlert('Error', 'No email address available.');
      return;
    }
    setSending(true);
    try {
      await api.auth.sendVerification();
      setSent(true);
      setCooldown(60);
      showAlert('Code Sent', `A verification code has been sent to ${email}`);
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to send verification code');
    } finally {
      setSending(false);
    }
  };

  const handleCodeInput = (text: string, index: number) => {
    const newCode = [...code];
    // Handle paste of full code
    if (text.length > 1) {
      const chars = text.replace(/\D/g, '').slice(0, 6).split('');
      chars.forEach((c, i) => { if (i < 6) newCode[i] = c; });
      setCode(newCode);
      if (chars.length >= 6) verifyCode(newCode.join(''));
      return;
    }
    newCode[index] = text.replace(/\D/g, '');
    setCode(newCode);
    // Auto-advance
    if (text && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
    // Auto-submit when 6 digits entered
    if (newCode.every(d => d) && newCode.join('').length === 6) {
      verifyCode(newCode.join(''));
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const verifyCode = async (fullCode?: string) => {
    const codeStr = fullCode || code.join('');
    if (codeStr.length !== 6) {
      showAlert('Error', 'Please enter the full 6-digit code');
      return;
    }
    setVerifying(true);
    try {
      await api.auth.verifyEmail({ code: codeStr });
      showAlert('Verified!', 'Your email has been verified successfully.');
      // Reload user to reflect verified status
      await useAuthStore.getState().loadUser();
      router.replace('/(tabs)/home');
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Invalid or expired verification code');
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setVerifying(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Verify Email', headerStyle: { backgroundColor: Colors.primary }, headerTintColor: Colors.textWhite }} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <View style={styles.iconWrap}>
            <Ionicons name="mail-unread" size={64} color={Colors.highlight} />
          </View>
          <Text style={styles.title}>Verify Your Email</Text>
          <Text style={styles.subtitle}>
            {sent
              ? `Enter the 6-digit code sent to ${email}`
              : `We'll send a verification code to ${email}`}
          </Text>

          {sent ? (
            <Card style={styles.codeCard}>
              <View style={styles.codeRow}>
                {code.map((digit, i) => (
                  <TextInput
                    key={i}
                    ref={(ref) => { inputRefs.current[i] = ref; }}
                    style={[styles.codeInput, digit ? styles.codeInputFilled : null]}
                    value={digit}
                    onChangeText={(t) => handleCodeInput(t, i)}
                    onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, i)}
                    keyboardType="number-pad"
                    maxLength={1}
                    selectTextOnFocus
                    autoFocus={i === 0}
                  />
                ))}
              </View>

              <Button
                title={verifying ? 'Verifying...' : 'Verify Code'}
                onPress={() => verifyCode()}
                variant="primary"
                disabled={verifying || code.some(d => !d)}
              />

              <TouchableOpacity
                style={styles.resendRow}
                onPress={sendCode}
                disabled={cooldown > 0 || sending}
              >
                <Ionicons name="refresh" size={16} color={cooldown > 0 ? Colors.textLight : Colors.highlight} />
                <Text style={[styles.resendText, cooldown > 0 && { color: Colors.textLight }]}>
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend Code'}
                </Text>
              </TouchableOpacity>
            </Card>
          ) : (
            <Card style={styles.codeCard}>
              <Button
                title={sending ? 'Sending...' : 'Send Verification Code'}
                onPress={sendCode}
                variant="primary"
                disabled={sending}
              />
            </Card>
          )}
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1, padding: Spacing.xl, justifyContent: 'center', alignItems: 'center', maxWidth: 420, alignSelf: 'center', width: '100%' },
  iconWrap: { width: 120, height: 120, borderRadius: 60, backgroundColor: Colors.highlightSubtle, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.lg },
  title: { fontSize: FontSize.title, fontWeight: FontWeight.bold as any, color: Colors.textPrimary, marginBottom: Spacing.sm, textAlign: 'center' },
  subtitle: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', marginBottom: Spacing.xl, lineHeight: 22 },
  codeCard: { width: '100%', padding: Spacing.lg, gap: Spacing.lg },
  codeRow: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.sm },
  codeInput: {
    width: 48, height: 56, borderRadius: BorderRadius.md,
    borderWidth: 2, borderColor: Colors.accent, backgroundColor: Colors.surface,
    textAlign: 'center', fontSize: FontSize.xl, fontWeight: FontWeight.bold as any,
    color: Colors.textWhite,
  },
  codeInputFilled: { borderColor: Colors.highlight },
  resendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  resendText: { color: Colors.highlight, fontSize: FontSize.sm, fontWeight: FontWeight.medium as any },
});
