// ============================================================
// OrgsLedger Mobile — Root Index (Auth Gate)
// ============================================================

import React, { useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../src/stores/auth.store';
import { Colors, FontSize, FontWeight, Spacing } from '../src/theme';

export default function Index() {
  const { isAuthenticated, isLoading } = useAuthStore();
  const hasNavigated = useRef(false);

  useEffect(() => {
    console.log('[Index] State changed:', { isLoading, isAuthenticated, hasNavigated: hasNavigated.current });
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
  }, [isLoading, isAuthenticated]);

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
