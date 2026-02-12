// ============================================================
// OrgsLedger — Hamburger Menu Button
// ============================================================

import React from 'react';
import { TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDrawer } from '../contexts/DrawerContext';
import { Colors, Spacing } from '../theme';

export function HamburgerButton() {
  const { toggle } = useDrawer();

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
