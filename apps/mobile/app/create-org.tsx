// ============================================================
// OrgsLedger — Create Organization Screen
// ============================================================

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import { api } from '../src/api/client';
import { useAuthStore } from '../src/stores/auth.store';
import {
  Colors, Spacing, FontSize, FontWeight, BorderRadius,
} from '../src/theme';
import { Card, Button, Input, SectionHeader, Divider, ResponsiveScrollView } from '../src/components/ui';
import { showAlert } from '../src/utils/alert';

const COUNTRY_OPTIONS = [
  { label: 'Nigeria', value: 'NG' },
  { label: 'United States', value: 'US' },
  { label: 'United Kingdom', value: 'GB' },
  { label: 'Ghana', value: 'GH' },
  { label: 'South Africa', value: 'ZA' },
  { label: 'Kenya', value: 'KE' },
  { label: 'Canada', value: 'CA' },
];

export default function CreateOrgScreen() {
  const loadUser = useAuthStore((s) => s.loadUser);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [country, setCountry] = useState('');
  const [currency, setCurrency] = useState('');
  const [creating, setCreating] = useState(false);

  // Auto-generate slug from name
  const handleNameChange = (val: string) => {
    setName(val);
    if (!slug || slug === generateSlug(name)) {
      setSlug(generateSlug(val));
    }
  };

  const generateSlug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 50);

  const handleCountryChange = (code: string) => {
    setCountry(code);
    // Auto-set currency
    const currencyMap: Record<string, string> = { NG: 'NGN', US: 'USD', GB: 'GBP', GH: 'GHS', ZA: 'ZAR', KE: 'KES', CA: 'CAD' };
    setCurrency(currencyMap[code] || 'USD');
  };

  const handleCreate = async () => {
    if (!name.trim()) { showAlert('Error', 'Organization name is required'); return; }
    if (!slug.trim()) { showAlert('Error', 'URL slug is required'); return; }
    if (slug.length < 3) { showAlert('Error', 'Slug must be at least 3 characters'); return; }

    setCreating(true);
    try {
      const res = await api.orgs.create({
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
        country: country || undefined,
        currency: currency || undefined,
      });
      showAlert('Success', `"${name}" has been created. You are now the admin.`);
      // Reload user to pick up new membership
      await loadUser();
      router.replace('/(tabs)/home');
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to create organization');
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Create Organization', headerStyle: { backgroundColor: Colors.primary }, headerTintColor: Colors.textWhite }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ResponsiveScrollView maxWidth={700} style={styles.container}>
          {/* Header illustration */}
          <View style={styles.hero}>
            <View style={styles.iconWrap}>
              <Ionicons name="business" size={56} color={Colors.highlight} />
            </View>
            <Text style={styles.heroTitle}>Create Your Organization</Text>
            <Text style={styles.heroSub}>Set up your organization on OrgsLedger to manage members, finances, meetings, and more.</Text>
          </View>

          {/* Form */}
          <Card style={styles.formCard}>
            <SectionHeader title="Organization Details" />

            <Input
              label="Organization Name *"
              placeholder="e.g. Lagos Alumni Association"
              value={name}
              onChangeText={handleNameChange}
              icon="business-outline"
            />

            <Input
              label="URL Slug *"
              placeholder="e.g. lagos-alumni"
              value={slug}
              onChangeText={(val) => setSlug(generateSlug(val))}
              icon="link-outline"
              autoCapitalize="none"
            />
            <Text style={styles.slugHint}>
              app.orgsledger.com/org/{slug || 'your-slug'}
            </Text>

            <Input
              label="Description"
              placeholder="What does your organization do?"
              value={description}
              onChangeText={setDescription}
              icon="document-text-outline"
              multiline
              numberOfLines={3}
            />

            <Divider />
            <SectionHeader title="Location & Currency" />

            <Text style={styles.fieldLabel}>Country</Text>
            <View style={styles.optionRow}>
              {COUNTRY_OPTIONS.map((opt) => (
                <CountryChip
                  key={opt.value}
                  label={opt.label}
                  selected={country === opt.value}
                  onPress={() => handleCountryChange(opt.value)}
                />
              ))}
            </View>

            {currency ? (
              <View style={styles.currencyBadge}>
                <Ionicons name="cash-outline" size={16} color={Colors.highlight} />
                <Text style={styles.currencyText}>Currency: {currency}</Text>
              </View>
            ) : null}

            <View style={{ height: Spacing.md }} />
            <Button
              title={creating ? 'Creating...' : 'Create Organization'}
              onPress={handleCreate}
              variant="primary"
              disabled={creating || !name.trim()}
            />
          </Card>

          {/* Info */}
          <Card style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Ionicons name="information-circle" size={20} color={Colors.info} />
              <Text style={styles.infoText}>
                As the creator, you'll be the organization admin. You can invite members and configure settings after creation.
              </Text>
            </View>
          </Card>

          <View style={{ height: Spacing.xxl * 2 }} />
        </ResponsiveScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function CountryChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <View style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]} onPress={onPress}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  hero: { alignItems: 'center', paddingVertical: Spacing.xl, paddingHorizontal: Spacing.lg },
  iconWrap: { width: 100, height: 100, borderRadius: 50, backgroundColor: Colors.highlightSubtle, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  heroTitle: { fontSize: FontSize.title, fontWeight: FontWeight.bold as any, color: Colors.textPrimary, textAlign: 'center' },
  heroSub: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.xs, lineHeight: 22 },
  formCard: { marginHorizontal: Spacing.md, padding: Spacing.lg, gap: Spacing.sm },
  slugHint: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: -4, marginLeft: Spacing.xs },
  fieldLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.medium as any, color: Colors.textSecondary, marginBottom: Spacing.xs },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs + 2, borderRadius: BorderRadius.full, borderWidth: 1, borderColor: Colors.accent, backgroundColor: Colors.surface },
  chipSelected: { borderColor: Colors.highlight, backgroundColor: Colors.highlightSubtle },
  chipText: { fontSize: FontSize.sm, color: Colors.textLight },
  chipTextSelected: { color: Colors.highlight, fontWeight: FontWeight.semibold as any },
  currencyBadge: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.xs, paddingHorizontal: Spacing.sm, paddingVertical: 4, backgroundColor: Colors.highlightSubtle, borderRadius: BorderRadius.full, alignSelf: 'flex-start' },
  currencyText: { fontSize: FontSize.sm, color: Colors.highlight, fontWeight: FontWeight.medium as any },
  infoCard: { marginHorizontal: Spacing.md, marginTop: Spacing.md, padding: Spacing.md },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  infoText: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
});
