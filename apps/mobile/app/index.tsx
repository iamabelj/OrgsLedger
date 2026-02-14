// ============================================================
// OrgsLedger Mobile — Root Index (Auth Gate)
// SaaS — no license gate, direct auth routing
// ============================================================

import React, { useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, View, Text, StyleSheet, Image } from 'react-native';
import { useAuthStore } from '../src/stores/auth.store';
import { Colors, FontSize, FontWeight, Spacing } from '../src/theme';

export default function Index() {
  const { isAuthenticated, isLoading } = useAuthStore();
  const hasNavigated = useRef(false);

  useEffect(() => {
    if (isLoading || hasNavigated.current) return;

    hasNavigated.current = true;
    if (isAuthenticated) {
      router.replace('/(tabs)/home');
    } else {
      router.replace('/(auth)/login');
    }
  }, [isLoading, isAuthenticated]);

  return (
    <View style={styles.splash}>
      <Image
        source={require('../assets/logo-no-bg.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <Text style={styles.brand}>OrgsLedger</Text>
      <Text style={styles.tagline}>Cross-Border Organizational Infrastructure</Text>
      <ActivityIndicator size="large" color={Colors.highlight} style={{ marginTop: Spacing.lg }} />
    </View>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.primary },
  logo: { width: 80, height: 80, marginBottom: Spacing.sm },
  brand: { fontSize: FontSize.header, fontWeight: FontWeight.bold as any, color: Colors.highlight, letterSpacing: 1 },
  tagline: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.xs, textAlign: 'center', paddingHorizontal: Spacing.xl },
});
