// ============================================================
// OrgsLedger — Legacy Activation (Removed)
// Redirects to login — no more license keys in SaaS model
// ============================================================

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { Colors, FontSize, FontWeight, Spacing } from '../src/theme';

export default function ActivateScreen() {
  return <Redirect href="/login" />;
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.primary },
  text: { fontSize: FontSize.md, color: Colors.textSecondary },
});
