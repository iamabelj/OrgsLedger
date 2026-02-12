// ============================================================
// OrgsLedger Mobile — Create or Join Organization (Royal Design)
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
import { Card, Button, Input, SectionHeader } from '../src/components/ui';
import { showAlert } from '../src/utils/alert';

type Mode = 'choose' | 'create' | 'join';

export default function OrganizationScreen() {
  const [mode, setMode] = useState<Mode>('choose');

  // Create org state
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(false);

  // Join org state
  const [inviteCode, setInviteCode] = useState('');

  const setCurrentOrg = useAuthStore((s) => s.setCurrentOrg);
  const loadUser = useAuthStore((s) => s.loadUser);

  const generateSlug = (text: string) => {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 100);
  };

  const handleCreateOrg = async () => {
    if (!name.trim()) {
      showAlert('Error', 'Organization name is required');
      return;
    }
    const orgSlug = slug.trim() || generateSlug(name);
    if (!orgSlug) {
      showAlert('Error', 'Please provide a valid slug');
      return;
    }

    setLoading(true);
    try {
      const res = await api.orgs.create({
        name: name.trim(),
        slug: orgSlug,
        currency: currency.trim() || 'USD',
      });
      const org = res.data.data;
      await loadUser(); // Refresh memberships
      setCurrentOrg(org.id);
      showAlert('Success', `"${org.name}" created!`, [
        { text: 'OK', onPress: () => router.replace('/(tabs)/home') },
      ]);
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to create organization');
    } finally {
      setLoading(false);
    }
  };

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

  if (mode === 'choose') {
    return (
      <View style={styles.container}>
        <Stack.Screen
          options={{
            headerShown: true,
            title: 'Get Started',
            headerStyle: { backgroundColor: Colors.surface },
            headerTintColor: Colors.highlight,
            headerTitleStyle: { fontWeight: FontWeight.semibold as any, color: Colors.textWhite },
            headerShadowVisible: false,
          }}
        />

        <View style={styles.heroSection}>
          <View style={styles.heroIcon}>
            <Ionicons name="business" size={48} color={Colors.highlight} />
          </View>
          <Text style={styles.heroTitle}>Welcome to OrgsLedger</Text>
          <Text style={styles.heroSubtitle}>
            Create your organization or join an existing one to get started.
          </Text>
        </View>

        <View style={styles.buttonGroup}>
          <TouchableOpacity style={styles.bigBtn} onPress={() => setMode('create')} activeOpacity={0.7}>
            <View style={[styles.bigBtnIcon, { backgroundColor: Colors.highlightSubtle }]}>
              <Ionicons name="add-circle" size={24} color={Colors.highlight} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bigBtnTitle}>Create Organization</Text>
              <Text style={styles.bigBtnSub}>Start a new group, club, or society</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textLight} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.bigBtn} onPress={() => setMode('join')} activeOpacity={0.7}>
            <View style={[styles.bigBtnIcon, { backgroundColor: Colors.successSubtle }]}>
              <Ionicons name="enter" size={24} color={Colors.success} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bigBtnTitle}>Join Organization</Text>
              <Text style={styles.bigBtnSub}>Enter with an invite code or slug</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.textLight} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (mode === 'create') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Stack.Screen
          options={{
            headerShown: true,
            title: 'Create Organization',
            headerStyle: { backgroundColor: Colors.surface },
            headerTintColor: Colors.highlight,
            headerTitleStyle: { fontWeight: FontWeight.semibold as any, color: Colors.textWhite },
            headerShadowVisible: false,
            headerLeft: () => (
              <TouchableOpacity onPress={() => setMode('choose')} style={{ marginRight: Spacing.sm }}>
                <Ionicons name="arrow-back" size={24} color={Colors.highlight} />
              </TouchableOpacity>
            ),
          }}
        />

        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Card style={styles.formCard}>
            <SectionHeader title="Organization Info" />
            <Input label="Organization Name *" value={name} onChangeText={(t: string) => { setName(t); if (!slug) setSlug(generateSlug(t)); }} placeholder="e.g. Sunrise Community Club" icon="business-outline" />
            <Input label="Slug (URL-friendly ID)" value={slug} onChangeText={(t: string) => setSlug(generateSlug(t))} placeholder="e.g. sunrise-community-club" icon="link-outline" />
            <Input label="Currency" value={currency} onChangeText={setCurrency} placeholder="USD" icon="cash-outline" maxLength={3} />
            <Button title={loading ? 'Creating...' : 'Create Organization'} onPress={handleCreateOrg} disabled={loading} variant="primary" />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // Join mode
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
          headerLeft: () => (
            <TouchableOpacity onPress={() => setMode('choose')} style={{ marginRight: Spacing.sm }}>
              <Ionicons name="arrow-back" size={24} color={Colors.highlight} />
            </TouchableOpacity>
          ),
        }}
      />

      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.joinHero}>
          <View style={[styles.heroIcon, { backgroundColor: Colors.highlightSubtle }]}>
            <Ionicons name="key" size={36} color={Colors.highlight} />
          </View>
          <Text style={styles.joinText}>
            Enter the organization slug or invite code provided by your admin.
          </Text>
        </View>

        <Card style={styles.formCard}>
          <Input label="Organization Slug or Invite Code" value={inviteCode} onChangeText={setInviteCode} placeholder="e.g. sunrise-community-club" icon="key-outline" />
          <Button title={loading ? 'Joining...' : 'Join Organization'} onPress={handleJoinOrg} disabled={loading} variant="primary" />
        </Card>
      </ScrollView>
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
  buttonGroup: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xxl,
    gap: Spacing.md,
  },
  bigBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    borderWidth: 0.5,
    borderColor: Colors.accent,
    ...Shadow.sm,
  },
  bigBtnIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  bigBtnTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold as any,
    color: Colors.textWhite,
  },
  bigBtnSub: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    marginTop: 2,
  },
  formCard: { margin: Spacing.md, padding: Spacing.md, gap: Spacing.sm },
  joinHero: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
  },
  joinText: {
    fontSize: FontSize.md,
    color: Colors.textLight,
    textAlign: 'center',
    lineHeight: 22,
  },
});
