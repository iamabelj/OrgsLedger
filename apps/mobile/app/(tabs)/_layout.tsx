// ============================================================
// OrgsLedger Mobile — Main Content Layout (Tabs → Sidebar)
// ============================================================
// Premium header with hamburger toggle. Desktop sidebar is
// collapsible; mobile uses overlay drawer.

import React from 'react';
import { View, TouchableOpacity, StyleSheet, Platform, Image } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontWeight, FontSize, Spacing, BorderRadius } from '../../src/theme';
import { HamburgerButton } from '../../src/components/HamburgerButton';
import { useDrawer } from '../../src/contexts/DrawerContext';
import { useAuthStore } from '../../src/stores/auth.store';
import { router } from 'expo-router';
import { LOGO } from '../../src/logo';

function HeaderLeft() {
  return (
    <View style={headerStyles.left}>
      <HamburgerButton />
      <Image source={LOGO} style={headerStyles.logoImg} resizeMode="contain" />
    </View>
  );
}

function HeaderRight() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;

  return (
    <View style={headerStyles.right}>
      <TouchableOpacity
        style={headerStyles.iconBtn}
        onPress={() => router.push('/notifications')}
        activeOpacity={0.7}
      >
        <Ionicons name="notifications-outline" size={20} color={Colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

const headerStyles = StyleSheet.create({
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginLeft: Spacing.xs,
  },
  logoImg: {
    width: 28,
    height: 28,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginRight: Spacing.sm,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default function TabLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: {
          backgroundColor: Colors.primary,
        },
        headerTintColor: Colors.textPrimary,
        headerTitleStyle: {
          fontWeight: FontWeight.bold,
          fontSize: FontSize.lg,
          color: Colors.textPrimary,
          letterSpacing: 0.3,
        },
        headerLeft: () => <HeaderLeft />,
        headerRight: () => <HeaderRight />,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: Colors.background },
        ...(Platform.OS === 'web' && {
          animation: 'fade' as const,
        }),
        ...(Platform.OS !== 'web' && {
          animation: 'slide_from_right' as const,
        }),
      }}
    >
      <Stack.Screen name="home" options={{ title: 'Dashboard' }} />
      <Stack.Screen name="chat" options={{ title: 'Chat' }} />
      <Stack.Screen name="financials" options={{ title: 'Financials' }} />
      <Stack.Screen name="profile" options={{ title: 'My Profile' }} />
    </Stack>
  );
}
