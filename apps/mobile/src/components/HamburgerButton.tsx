// ============================================================
// OrgsLedger — Hamburger Menu Button
// ============================================================

import React from 'react';
import { TouchableOpacity, StyleSheet, Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDrawer } from '../contexts/DrawerContext';
import { useAuthStore } from '../stores/auth.store';
import { Colors, Spacing } from '../theme';

export function HamburgerButton() {
  const { toggle } = useDrawer();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Don't show hamburger on auth screens (login, register, etc.)
  if (!isAuthenticated) {
    return <View style={styles.button} />;
  }

  return (
    <TouchableOpacity
      style={styles.button}
      onPress={toggle}
      activeOpacity={0.7}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <Ionicons name="menu" size={28} color={Colors.textWhite} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: Spacing.sm,
    marginLeft: Spacing.xs,
  },
});
