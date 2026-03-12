// ============================================================
// OrgsLedger — Legacy Activation (Removed)
// Redirects to login — no more license keys in SaaS model
// ============================================================

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Colors, FontSize, FontWeight, Spacing } from '../src/theme';

export default function ActivateScreen() {
  useEffect(() => {
    router.replace('/login');
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Redirecting...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.primary },
  text: { fontSize: FontSize.md, color: Colors.textSecondary },
});
