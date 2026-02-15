// ============================================================
// OrgsLedger Mobile — Join Organization (Royal Design)
// ============================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import { useAuthStore } from '../src/stores/auth.store';
import { api } from '../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../src/theme';
import { Card, Button, Input, SectionHeader, PoweredByFooter, ResponsiveScrollView } from '../src/components/ui';
import { showAlert } from '../src/utils/alert';

export default function OrganizationScreen() {
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);

  const setCurrentOrg = useAuthStore((s) => s.setCurrentOrg);
  const loadUser = useAuthStore((s) => s.loadUser);

  const handleJoinOrg = async () => {
    if (!inviteCode.trim()) {
      showAlert('Error', 'Please enter an invite code or organization slug');
      return;
    }

    setLoading(true);
    try {
      // Look up org by slug
      const lookupRes = await api.orgs.lookupBySlug(inviteCode.trim().toLowerCase());
      const org = lookupRes.data.data;

      if (org) {
        // Join the organization
        await api.orgs.join(org.id);
        await loadUser(); // Refresh memberships
        setCurrentOrg(org.id);
        showAlert('Joined', `You are now part of "${org.name}"`, [
          { text: 'OK', onPress: () => router.replace('/(tabs)/home') },
        ]);
      } else {
        showAlert('Not Found', 'No organization found with that slug.');
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Failed to join organization';
      showAlert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Join Organization',
          headerStyle: { backgroundColor: Colors.surface },
          headerTintColor: Colors.highlight,
          headerTitleStyle: { fontWeight: FontWeight.semibold as any, color: Colors.textWhite },
          headerShadowVisible: false,
        }}
      />

      <ResponsiveScrollView maxWidth={700} style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
        <View style={styles.heroSection}>
          <View style={styles.heroIcon}>
            <Ionicons name="key" size={48} color={Colors.highlight} />
          </View>
          <Text style={styles.heroTitle}>Join an Organization</Text>
          <Text style={styles.heroSubtitle}>
            Enter the organization slug or invite code provided by your admin to join.
          </Text>
        </View>

        <Card style={styles.formCard}>
          <SectionHeader title="Organization Details" />
          <Input
            label="Organization Slug or Invite Code"
            value={inviteCode}
            onChangeText={setInviteCode}
            placeholder="e.g. sunrise-community-club"
            icon="key-outline"
          />
          <Button
            title={loading ? 'Joining...' : 'Join Organization'}
            onPress={handleJoinOrg}
            disabled={loading}
            variant="primary"
          />
        </Card>

        <PoweredByFooter />
      </ResponsiveScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  heroSection: {
    alignItems: 'center',
    paddingTop: Spacing.xxl * 2,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  heroIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: FontSize.header,
    fontWeight: FontWeight.bold as any,
    color: Colors.textWhite,
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: FontSize.md,
    color: Colors.textLight,
    textAlign: 'center',
    lineHeight: 22,
  },
  formCard: { margin: Spacing.md, padding: Spacing.md, gap: Spacing.sm },
});
