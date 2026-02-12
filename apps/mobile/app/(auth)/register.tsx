// ============================================================
// OrgsLedger Mobile — Register Screen (Royal Design)
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
} from 'react-native';
import { showAlert } from '../../src/utils/alert';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Input, Button, PoweredByFooter } from '../../src/components/ui';
import { useResponsive } from '../../src/hooks/useResponsive';

export default function RegisterScreen() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const register = useAuthStore((s) => s.register);
  const responsive = useResponsive();

  const handleRegister = async () => {
    console.log('[Register] Starting registration...');
    if (!firstName || !lastName || !email || !password) {
      showAlert('Error', 'Please fill in all fields');
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
      console.log('[Register] Calling auth register...');
      await register({
        email: email.trim().toLowerCase(),
        password,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
      });
      console.log('[Register] Registration successful, navigating to home...');
      // Use setTimeout to ensure state update completes before navigation
      setTimeout(() => {
        router.replace('/(tabs)/home');
      }, 100);
    } catch (err: any) {
      console.error('[Register] Registration failed:', err);
      showAlert(
        'Registration Failed',
        err.response?.data?.error || 'Something went wrong'
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
          { maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Brand */}
        <View style={styles.brand}>
          <View style={styles.crest}>
            <Ionicons name="person-add" size={32} color={Colors.highlight} />
          </View>
          <Text style={styles.logo}>Create Account</Text>
          <Text style={styles.tagline}>Join OrgsLedger today</Text>
        </View>

        {/* Registration Form */}
        <View style={styles.formCard}>
          <View style={styles.nameRow}>
            <View style={{ flex: 1 }}>
              <Input
                label="FIRST NAME"
                placeholder="John"
                value={firstName}
                onChangeText={setFirstName}
                icon="person-outline"
              />
            </View>
            <View style={{ flex: 1 }}>
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
        <TouchableOpacity onPress={() => router.back()} style={styles.footerLink}>
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
  nameRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
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
