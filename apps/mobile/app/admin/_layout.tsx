// ============================================================
// OrgsLedger Mobile — Admin Stack Layout
// ============================================================

import React from 'react';
import { Stack } from 'expo-router';
import { Colors, FontWeight } from '../../src/theme';
import { HamburgerButton } from '../../src/components/HamburgerButton';

export default function AdminLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.primary },
        headerTintColor: Colors.textPrimary,
        headerTitleStyle: { fontWeight: FontWeight.semibold },
        headerShadowVisible: false,
        headerLeft: () => <HamburgerButton />,
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <Stack.Screen name="members" options={{ title: 'Member Management' }} />
      <Stack.Screen name="create-due" options={{ title: 'Create Due' }} />
      <Stack.Screen name="create-fine" options={{ title: 'Issue Fine' }} />
      <Stack.Screen name="create-campaign" options={{ title: 'New Campaign' }} />
      <Stack.Screen name="expenses" options={{ title: 'Expense Management' }} />
      <Stack.Screen name="committees" options={{ title: 'Committees' }} />
      <Stack.Screen name="reports" options={{ title: 'Financial Reports' }} />
      <Stack.Screen name="settings" options={{ title: 'Organization Settings' }} />
      <Stack.Screen name="plans" options={{ title: 'Subscription Plans' }} />
      <Stack.Screen name="analytics" options={{ title: 'Analytics' }} />
      <Stack.Screen name="member-detail/[userId]" options={{ title: 'Member Details' }} />
      <Stack.Screen name="bank-transfers" options={{ title: 'Bank Transfers' }} />
      <Stack.Screen name="payment-methods" options={{ title: 'Payment Methods' }} />
    </Stack>
  );
}
