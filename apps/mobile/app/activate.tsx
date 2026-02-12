// ============================================================
// OrgsLedger Mobile — License Activation Screen
// ============================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSize, FontWeight, Spacing, BorderRadius } from '../src/theme';
import storage from '../src/utils/storage';

const GATEWAY_URL = process.env.EXPO_PUBLIC_GATEWAY_URL || 'https://orgsledger.com';

export default function ActivateScreen() {
  const [licenseKey, setLicenseKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const formatLicenseKey = (text: string) => {
    // Auto-format: OLS-XXXX-XXXX-XXXX-XXXX
    const cleaned = text.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    setLicenseKey(cleaned);
  };

  const handleActivate = async () => {
    const key = licenseKey.trim();
    if (!key) {
      setError('Please enter your license key');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${GATEWAY_URL}/api/license/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: key }),
      });

      const data = await res.json();

      if (data.valid) {
        // Save license key and client info
        await storage.setItemAsync('licenseKey', key);
        await storage.setItemAsync('licenseClient', JSON.stringify(data.client));

        // Show success
        if (Platform.OS === 'web') {
          window.alert(`License activated!\n\nWelcome, ${data.client.name}.\nAI Hours: ${data.client.hoursRemaining.toFixed(1)}h remaining`);
        } else {
          Alert.alert(
            'License Activated!',
            `Welcome, ${data.client.name}.\nAI Hours: ${data.client.hoursRemaining.toFixed(1)}h remaining`,
            [{ text: 'Continue', onPress: () => router.replace('/') }]
          );
          return;
        }
        router.replace('/');
      } else {
        setError(data.error || 'Invalid license key');
      }
    } catch (err: any) {
      setError('Could not verify license. Check your internet connection and try again.');
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
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          {/* Logo */}
          <View style={styles.logoContainer}>
            <View style={styles.logoCircle}>
              <Ionicons name="key" size={32} color={Colors.highlight} />
            </View>
            <Text style={styles.brand}>OrgsLedger</Text>
            <Text style={styles.subtitle}>License Activation</Text>
          </View>

          {/* Description */}
          <Text style={styles.description}>
            Enter your license key to activate OrgsLedger. You can get a license key from your administrator or at orgsledger.com.
          </Text>

          {/* License Key Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>LICENSE KEY</Text>
            <TextInput
              style={styles.input}
              value={licenseKey}
              onChangeText={formatLicenseKey}
              placeholder="OLS-XXXX-XXXX-XXXX-XXXX"
              placeholderTextColor={Colors.textLight}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!loading}
            />
          </View>

          {/* Error */}
          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={Colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Activate Button */}
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleActivate}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={Colors.primary} size="small" />
            ) : (
              <>
                <Ionicons name="shield-checkmark" size={18} color={Colors.primary} />
                <Text style={styles.buttonText}>Activate License</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Footer */}
          <Text style={styles.footer}>
            By activating, you agree to the OrgsLedger terms of service.
          </Text>
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
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    maxWidth: 440,
    width: '100%',
    alignSelf: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderGold,
  },
  brand: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold as any,
    color: Colors.highlight,
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  description: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  inputGroup: {
    marginBottom: Spacing.md,
  },
  label: {
    fontSize: 11,
    fontWeight: FontWeight.semibold as any,
    color: Colors.textLight,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  input: {
    backgroundColor: Colors.primaryLight,
    borderWidth: 1,
    borderColor: Colors.accent,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    letterSpacing: 1,
    textAlign: 'center',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.dangerSubtle,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.md,
  },
  errorText: {
    fontSize: FontSize.sm,
    color: Colors.error,
    flex: 1,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.highlight,
    paddingVertical: 14,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold as any,
    color: Colors.primary,
  },
  footer: {
    fontSize: 11,
    color: Colors.textLight,
    textAlign: 'center',
    marginTop: Spacing.lg,
  },
});
