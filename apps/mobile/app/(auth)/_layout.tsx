// ============================================================
// OrgsLedger Mobile — Auth Layout
// ============================================================

import React from 'react';
import { Stack } from 'expo-router';

import { Colors } from '../../src/theme';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="forgot-password" />
    </Stack>
  );
}
