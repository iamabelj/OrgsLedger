// ============================================================
// OrgsLedger — Legal Pages Layout
// ============================================================

import React from 'react';
import { Stack } from 'expo-router';
import { Colors } from '../../src/theme';
import { SmartHeaderLeft } from '../../src/components/SmartHeaderLeft';

export default function LegalLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.primary },
        headerTintColor: Colors.textWhite,
        headerTitleStyle: { fontWeight: '600' },
        headerBackTitleVisible: false,
        headerLeft: () => <SmartHeaderLeft />,
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <Stack.Screen name="terms" options={{ title: 'Terms of Service' }} />
      <Stack.Screen name="privacy" options={{ title: 'Privacy Policy' }} />
      <Stack.Screen name="dpa" options={{ title: 'Data Processing Agreement' }} />
      <Stack.Screen name="acceptable-use" options={{ title: 'Acceptable Use Policy' }} />
    </Stack>
  );
}
