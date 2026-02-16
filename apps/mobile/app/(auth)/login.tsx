// ============================================================
// OrgsLedger Mobile — Login Screen (Royal Design)
// ============================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Dimensions,
} from 'react-native';
import { showAlert } from '../../src/utils/alert';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Input, Button, PoweredByFooter } from '../../src/components/ui';
import { useResponsive } from '../../src/hooks/useResponsive';

const { width } = Dimensions.get('window');

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
      // Use setTimeout to ensure state update completes before navigation
      setTimeout(() => {
        router.replace('/(tabs)/home');
      }, 100);
    } catch (err: any) {
      showAlert(
        'Login Failed',
        err.response?.data?.error || 'Invalid credentials'
      );
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
        {/* Royal Crest/Brand Section */}
        <View style={styles.brand}>
          <View style={styles.crest}>
            <View style={styles.crestInner}>
              <Ionicons name="shield-checkmark" size={42} color={Colors.highlight} />
            </View>
          </View>
          <Text style={styles.logo}>OrgsLedger</Text>
          <Text style={styles.tagline}>Your organization's operational hub</Text>
          <View style={styles.ornament}>
            <View style={styles.ornamentLine} />
            <Ionicons name="diamond" size={10} color={Colors.highlight} />
            <View style={styles.ornamentLine} />
          </View>
        </View>

        {/* Login Form */}
        <View style={[styles.formCard, responsive.isPhone && styles.formCardPhone]}>
          <Text style={styles.formTitle}>Welcome Back</Text>
          <Text style={styles.formSubtitle}>Sign in to your account</Text>

          <View style={styles.formFields}>
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

            <TouchableOpacity style={styles.forgotBtn} onPress={() => router.push('/(auth)/forgot-password')}>
              <Text style={styles.forgotText}>Forgot Password?</Text>
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
        </View>

        {/* Footer — signup is invite-only, show info text */}
        <View style={styles.footerLink}>
          <Text style={styles.footerText}>
            Need an account? Contact your organization admin for an invite link.
          </Text>
        </View>

        <PoweredByFooter />
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
  scrollPhone: {
    padding: Spacing.md,
  },
  brand: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  crest: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.highlight,
    ...Shadow.lg,
    marginBottom: Spacing.md,
  },
  crestInner: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    fontSize: 32,
    fontWeight: FontWeight.extrabold,
    color: Colors.textPrimary,
    letterSpacing: 1.5,
  },
  tagline: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    marginTop: Spacing.xs,
  },
  ornament: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  ornamentLine: {
    width: 40,
    height: 1,
    backgroundColor: Colors.highlight,
    opacity: 0.5,
  },
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
  footerLink: {
    alignItems: 'center',
    marginTop: Spacing.xl,
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
