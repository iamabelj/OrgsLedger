// ============================================================
// OrgsLedger Mobile — Main Content Layout (formerly Tabs)
// ============================================================
// Now using drawer navigation instead of bottom tabs

import React from 'react';
import { Stack } from 'expo-router';
import { Colors, FontWeight, FontSize } from '../../src/theme';
import { HamburgerButton } from '../../src/components/HamburgerButton';

export default function TabLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.primary },
        headerTintColor: Colors.textPrimary,
        headerTitleStyle: {
          fontWeight: FontWeight.bold,
          fontSize: FontSize.lg,
          color: Colors.textPrimary,
          letterSpacing: 0.3,
        },
        headerLeft: () => <HamburgerButton />,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <Stack.Screen name="home" options={{ title: 'Home' }} />
      <Stack.Screen name="chat" options={{ title: 'Chat' }} />
      <Stack.Screen name="meetings" options={{ title: 'Meetings' }} />
      <Stack.Screen name="financials" options={{ title: 'Financials' }} />
      <Stack.Screen name="profile" options={{ title: 'Profile' }} />
    </Stack>
  );
}
