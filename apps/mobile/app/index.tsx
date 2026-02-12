// ============================================================
// OrgsLedger Mobile — Root Index (Auth Gate)
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../src/stores/auth.store';
import { Colors, FontSize, FontWeight, Spacing } from '../src/theme';
import storage from '../src/utils/storage';

export default function Index() {
  const { isAuthenticated, isLoading } = useAuthStore();
  const hasNavigated = useRef(false);
  const [licenseChecked, setLicenseChecked] = useState(false);
  const [hasLicense, setHasLicense] = useState(false);

  // Check license key on mount
  useEffect(() => {
    (async () => {
      const licenseKey = await storage.getItemAsync('licenseKey');
      setHasLicense(!!licenseKey);
      setLicenseChecked(true);
    })();
  }, []);

  useEffect(() => {
    if (!licenseChecked) return;
    console.log('[Index] State changed:', { isLoading, isAuthenticated, hasLicense, hasNavigated: hasNavigated.current });

    if (!hasLicense && !hasNavigated.current) {
      hasNavigated.current = true;
      console.log('[Index] No license key — navigating to activate...');
      router.replace('/activate');
      return;
    }

    if (!isLoading && !hasNavigated.current) {
      hasNavigated.current = true;
      if (isAuthenticated) {
        console.log('[Index] Navigating to home...');
        router.replace('/(tabs)/home');
      } else {
        console.log('[Index] Navigating to login...');
        router.replace('/(auth)/login');
      }
    }
  }, [isLoading, isAuthenticated, licenseChecked, hasLicense]);

  return (
    <View style={styles.splash}>
      <Ionicons name="shield-checkmark" size={48} color={Colors.highlight} />
      <Text style={styles.brand}>OrgsLedger</Text>
      <ActivityIndicator size="large" color={Colors.highlight} style={{ marginTop: Spacing.lg }} />
    </View>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.primary },
  brand: { fontSize: FontSize.header, fontWeight: FontWeight.bold as any, color: Colors.highlight, marginTop: Spacing.md, letterSpacing: 1 },
});
