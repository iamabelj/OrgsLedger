// ============================================================
// OrgsLedger Mobile — Forgot Password Screen
// ============================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { showAlert } from '../../src/utils/alert';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Input, Button } from '../../src/components/ui';
import { useResponsive } from '../../src/hooks/useResponsive';

export default function ForgotPasswordScreen() {
  const [step, setStep] = useState<'email' | 'code' | 'done'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const responsive = useResponsive();

  const handleSendCode = async () => {
    if (!email) {
      showAlert('Error', 'Please enter your email address');
      return;
    }
    setLoading(true);
    try {
      await api.auth.forgotPassword({ email: email.trim().toLowerCase() });
      showAlert('Code Sent', 'If an account exists with that email, a reset code has been sent.');
      setStep('code');
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to send reset code');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!code || code.length !== 6) {
      showAlert('Error', 'Please enter the 6-digit code');
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      showAlert('Error', 'Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      showAlert('Error', 'Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await api.auth.resetPassword({
        email: email.trim().toLowerCase(),
        code,
        newPassword,
      });
      showAlert('Success', 'Your password has been reset. You can now log in.');
      setStep('done');
      setTimeout(() => router.replace('/login'), 1500);
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to reset password');
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
          { maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Ionicons name="lock-closed" size={48} color={Colors.highlight} />
          <Text style={styles.title}>Reset Password</Text>
          <Text style={styles.subtitle}>
            {step === 'email'
              ? 'Enter your email to receive a reset code'
              : step === 'code'
              ? 'Enter the code sent to your email'
              : 'Password reset successful!'}
          </Text>
        </View>

        <View style={styles.formCard}>
          {step === 'email' && (
            <>
              <Input
                label="EMAIL ADDRESS"
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <Button
                title="Send Reset Code"
                onPress={handleSendCode}
                loading={loading}
                icon="mail-outline"
                fullWidth
                size="lg"
                style={{ marginTop: Spacing.md }}
              />
            </>
          )}

          {step === 'code' && (
            <>
              <Input
                label="RESET CODE"
                placeholder="123456"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
              />
              <Input
                label="NEW PASSWORD"
                placeholder="Min 8 characters"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
              />
              <Input
                label="CONFIRM PASSWORD"
                placeholder="Re-enter password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
              />
              <Button
                title="Reset Password"
                onPress={handleResetPassword}
                loading={loading}
                icon="checkmark-circle-outline"
                fullWidth
                size="lg"
                style={{ marginTop: Spacing.md }}
              />
            </>
          )}

          {step === 'done' && (
            <View style={styles.successBox}>
              <Ionicons name="checkmark-circle" size={64} color={Colors.success} />
              <Text style={styles.successText}>Password reset successfully!</Text>
              <Text style={styles.successSubtext}>Redirecting to login...</Text>
            </View>
          )}

          <Button
            title="Back to Login"
            onPress={() => router.push('/login')}
            variant="ghost"
            fullWidth
            style={{ marginTop: Spacing.md }}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  header: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold as any,
    color: Colors.textPrimary,
    marginTop: Spacing.md,
  },
  subtitle: {
    fontSize: FontSize.md,
    color: Colors.textLight,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  formCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    ...Shadow.md,
  },
  successBox: {
    alignItems: 'center',
    padding: Spacing.xl,
  },
  successText: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold as any,
    color: Colors.success,
    marginTop: Spacing.md,
  },
  successSubtext: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
    marginTop: Spacing.xs,
  },
});
