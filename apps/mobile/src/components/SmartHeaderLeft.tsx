// ============================================================
// OrgsLedger — Smart Header Left Button
// Shows back arrow + hamburger on sub-pages,
// hamburger only on top-level screens.
// ============================================================

import React from 'react';
import { TouchableOpacity, StyleSheet, View, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useDrawer } from '../contexts/DrawerContext';
import { useAuthStore } from '../stores/auth.store';
import { Colors, Spacing } from '../theme';

export function SmartHeaderLeft() {
  const { toggle } = useDrawer();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const canGoBack = router.canGoBack();

  // On auth screens, show empty placeholder (no hamburger, no back)
  if (!isAuthenticated) {
    return <View style={styles.placeholder} />;
  }

  return (
    <View style={styles.container}>
      {canGoBack && (
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Ionicons
            name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'}
            size={24}
            color={Colors.textWhite}
          />
        </TouchableOpacity>
      )}
      <TouchableOpacity
        style={styles.menuButton}
        onPress={toggle}
        activeOpacity={0.7}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityLabel="Open menu"
        accessibilityRole="button"
      >
        <Ionicons name="menu" size={26} color={Colors.textWhite} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: Spacing.xs,
    gap: Platform.OS === 'web' ? 4 : 2,
  },
  backButton: {
    padding: Spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuButton: {
    padding: Spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholder: {
    padding: Spacing.sm,
    marginLeft: Spacing.xs,
  },
});
