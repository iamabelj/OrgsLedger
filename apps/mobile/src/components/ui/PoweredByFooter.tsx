// ============================================================
// OrgsLedger Mobile — Powered By Footer Component
// ============================================================

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Colors, Spacing, FontSize, FontWeight } from '../../theme';

const GLOBULL_URL = 'https://globull.dev';
const currentYear = new Date().getFullYear();

export function PoweredByFooter() {
  const handlePress = async () => {
    try {
      await Linking.openURL(GLOBULL_URL);
    } catch {
      // Silent fail
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.copyright}>
        © {currentYear} OrgsLedger. All rights reserved.
      </Text>
      <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
        <Text style={styles.poweredBy}>
          Powered by <Text style={styles.globull}>Globull</Text>
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
    gap: Spacing.xs,
  },
  copyright: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    textAlign: 'center',
  },
  poweredBy: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  globull: {
    color: Colors.highlight,
    fontWeight: FontWeight.bold as any,
    textDecorationLine: 'underline',
  },
});
