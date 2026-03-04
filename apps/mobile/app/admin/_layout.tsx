// ============================================================
// OrgsLedger Mobile — Admin Stack Layout
// Guards admin screens: only org_admin and executive can access
// ============================================================

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { Colors, FontWeight, FontSize, Spacing } from '../../src/theme';
import { SmartHeaderLeft } from '../../src/components/SmartHeaderLeft';
import { Ionicons } from '@expo/vector-icons';

/**
 * Admin Stack Layout
 * Guards admin screens: only org_admin and executive can access.
 * IMPORTANT: expo-router requires layouts to ALWAYS render a navigator
 * (Stack / Slot). If we conditionally return a plain View the child
 * route can't resolve and we get "Attempted to navigate before
 * mounting the Root Layout component" on web.
 * Solution: always render the Stack; overlay the "denied" UI on top.
 */
export default function AdminLayout() {
  const memberships = useAuthStore((s) => s.memberships);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const currentMembership = memberships.find((m) => m.organization_id === currentOrgId);
  const globalRole = useAuthStore((s) => s.user?.globalRole);
  const userRole = currentMembership?.role || 'member';
  const isSuperAdmin = globalRole === 'super_admin' || globalRole === 'developer';
  const isAdmin = isSuperAdmin || userRole === 'org_admin' || userRole === 'executive';

  return (
    <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: Colors.primary },
          headerTintColor: Colors.textPrimary,
          headerTitleStyle: { fontWeight: FontWeight.semibold },
          headerShadowVisible: false,
          headerLeft: () => <SmartHeaderLeft />,
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
        <Stack.Screen name="wallets" options={{ title: 'Wallets' }} />
        <Stack.Screen name="invites" options={{ title: 'Invite Links' }} />
        <Stack.Screen name="signup-invites" options={{ title: 'Signup Invites' }} />
        <Stack.Screen name="saas-dashboard" options={{ title: 'SaaS Dashboard' }} />
        <Stack.Screen name="analytics" options={{ title: 'Analytics' }} />
        <Stack.Screen name="meeting-insights" options={{ title: 'Meeting Insights' }} />
        <Stack.Screen name="member-detail/[userId]" options={{ title: 'Member Details' }} />
        <Stack.Screen name="bank-transfers" options={{ title: 'Bank Transfers' }} />
        <Stack.Screen name="payment-methods" options={{ title: 'Payment Methods' }} />
        <Stack.Screen name="subscription" options={{ title: 'Subscription' }} />
        <Stack.Screen name="compliance" options={{ title: 'Compliance' }} />
        <Stack.Screen name="developer-console" options={{ title: 'Developer Console' }} />
      </Stack>

      {/* Access-denied overlay — covers content but Stack stays mounted */}
      {!isAdmin && (
        <View style={styles.denied} pointerEvents="box-only">
          <Ionicons name="lock-closed" size={48} color={Colors.textLight} />
          <Text style={styles.deniedTitle}>Access Restricted</Text>
          <Text style={styles.deniedText}>
            This area is available to administrators and executives only.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  denied: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  deniedTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  deniedText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
});
