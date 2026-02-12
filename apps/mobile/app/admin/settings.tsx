// ============================================================
// OrgsLedger Mobile — Organization Settings Screen (Admin)
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Modal,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import {
  Card,
  Button,
  Input,
  Badge,
  SectionHeader,
  Divider,
  ScreenWrapper,
  LoadingScreen,
} from '../../src/components/ui';
import { showAlert } from '../../src/utils/alert';

const CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'NGN', symbol: '₦', name: 'Nigerian Naira' },
  { code: 'GHS', symbol: 'GH₵', name: 'Ghanaian Cedi' },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
];

const PAYMENT_GATEWAYS = [
  { id: 'stripe', name: 'Stripe', icon: 'card-outline' as const, available: true },
  { id: 'paystack', name: 'Paystack', icon: 'wallet-outline' as const, available: true },
  { id: 'flutterwave', name: 'Flutterwave', icon: 'flash-outline' as const, available: true },
];

export default function SettingsScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [orgDescription, setOrgDescription] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [enabledGateways, setEnabledGateways] = useState<string[]>(['stripe']);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Notification settings
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(true);
  const [dueReminders, setDueReminders] = useState(true);
  const [meetingReminders, setMeetingReminders] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    if (!currentOrgId) return;
    setLoading(true);
    try {
      const res = await api.orgs.get(currentOrgId);
      const org = res.data?.data || res.data;
      setOrgName(org?.name || '');
      setOrgSlug(org?.slug || '');
      setOrgDescription(org?.description || '');

      // Parse settings from JSON string stored in DB
      let settings: any = {};
      if (org?.settings) {
        try {
          settings = typeof org.settings === 'string' ? JSON.parse(org.settings) : org.settings;
        } catch { settings = {}; }
      }
      setCurrency(settings.currency || org?.currency || 'USD');
      setEnabledGateways(settings.enabledGateways || ['stripe']);
      if (settings.notifications) {
        setEmailNotifications(settings.notifications.emailNotifications !== false);
        setPushNotifications(settings.notifications.pushNotifications !== false);
        setDueReminders(settings.notifications.dueReminders !== false);
        setMeetingReminders(settings.notifications.meetingReminders !== false);
      }
    } catch (err) {
      console.error('Failed to load settings', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!orgName.trim()) {
      showAlert('Validation', 'Organization name is required');
      return;
    }
    if (!currentOrgId) return;
    setSaving(true);
    try {
      await api.orgs.updateSettings(currentOrgId, {
        name: orgName.trim(),
        settings: {
          slug: orgSlug.trim(),
          description: orgDescription.trim(),
          currency,
          enabledGateways,
          notifications: {
            emailNotifications,
            pushNotifications,
            dueReminders,
            meetingReminders,
          },
        },
      });
      showAlert('Saved', 'Organization settings updated successfully');
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const toggleGateway = (id: string) => {
    setEnabledGateways((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  };

  const selectedCurrency = CURRENCIES.find((c) => c.code === currency) || CURRENCIES[0];

  const handleDangerZone = (action: 'transfer' | 'delete') => {
    if (action === 'transfer') {
      showAlert(
        'Transfer Ownership',
        'This will transfer admin ownership to another member. Select a member from the Members screen, then use "Change Role" to make them admin before removing yourself.'
      );
    } else {
      setDeleteConfirmText('');
      setShowDeleteConfirm(true);
    }
  };

  const handleDeleteOrg = async () => {
    if (deleteConfirmText !== 'DELETE') {
      showAlert('Error', 'Please type DELETE to confirm');
      return;
    }
    if (!currentOrgId) return;
    try {
      // Use the API to soft-delete or deactivate
      await api.orgs.updateSettings(currentOrgId, { settings: { deleted: true } });
      setShowDeleteConfirm(false);
      showAlert('Deleted', 'Organization has been deleted', [
        { text: 'OK', onPress: () => router.replace('/') },
      ]);
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to delete organization');
    }
  };

  if (loading) return <LoadingScreen />;

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Settings' }} />

      {/* Organization Identity */}
      <View style={styles.section}>
        <SectionHeader title="Organization Identity" />

        <Card variant="elevated">
          <View style={styles.orgPreview}>
            <View style={styles.orgAvatar}>
              <Text style={styles.orgAvatarText}>
                {orgName ? orgName.charAt(0).toUpperCase() : 'O'}
              </Text>
            </View>
            <View>
              <Text style={styles.orgPreviewName}>{orgName || 'Organization'}</Text>
              <Text style={styles.orgPreviewSlug}>/{orgSlug || 'slug'}</Text>
            </View>
          </View>
        </Card>

        <Input
          label="ORGANIZATION NAME"
          placeholder="My Organization"
          value={orgName}
          onChangeText={setOrgName}
          icon="business-outline"
        />

        <Input
          label="SLUG (URL-FRIENDLY)"
          placeholder="my-organization"
          value={orgSlug}
          onChangeText={(text) => setOrgSlug(text.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
          icon="link-outline"
        />

        <Input
          label="DESCRIPTION"
          placeholder="Describe your organization..."
          value={orgDescription}
          onChangeText={setOrgDescription}
          multiline
          icon="document-text-outline"
        />
      </View>

      {/* Currency */}
      <View style={styles.section}>
        <SectionHeader title="Currency" />

        <TouchableOpacity
          style={styles.currencySelector}
          onPress={() => setShowCurrencyPicker(true)}
        >
          <View style={styles.currencyLeft}>
            <View style={styles.currencySymbol}>
              <Text style={styles.currencySymbolText}>{selectedCurrency.symbol}</Text>
            </View>
            <View>
              <Text style={styles.currencyName}>{selectedCurrency.name}</Text>
              <Text style={styles.currencyCode}>{selectedCurrency.code}</Text>
            </View>
          </View>
          <Ionicons name="chevron-down" size={20} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Payment Gateways */}
      <View style={styles.section}>
        <SectionHeader title="Payment Gateways" />

        {PAYMENT_GATEWAYS.map((gateway) => {
          const isEnabled = enabledGateways.includes(gateway.id);
          return (
            <TouchableOpacity
              key={gateway.id}
              style={[styles.gatewayItem, isEnabled && styles.gatewayItemActive]}
              onPress={() => toggleGateway(gateway.id)}
              activeOpacity={0.7}
            >
              <View style={styles.gatewayLeft}>
                <View
                  style={[
                    styles.gatewayIcon,
                    isEnabled && styles.gatewayIconActive,
                  ]}
                >
                  <Ionicons
                    name={gateway.icon}
                    size={20}
                    color={isEnabled ? Colors.highlight : Colors.textSecondary}
                  />
                </View>
                <View>
                  <Text style={styles.gatewayName}>{gateway.name}</Text>
                  <Text style={styles.gatewayStatus}>
                    {isEnabled ? 'Enabled' : 'Disabled'}
                  </Text>
                </View>
              </View>
              <Switch
                value={isEnabled}
                onValueChange={() => toggleGateway(gateway.id)}
                trackColor={{ false: Colors.accent, true: Colors.highlight }}
                thumbColor={Colors.textWhite}
              />
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Notifications */}
      <View style={styles.section}>
        <SectionHeader title="Notifications" />

        {[
          { label: 'Email Notifications', hint: 'Send email for important updates', value: emailNotifications, setter: setEmailNotifications },
          { label: 'Push Notifications', hint: 'Mobile push notifications', value: pushNotifications, setter: setPushNotifications },
          { label: 'Due Reminders', hint: 'Remind members before dues are due', value: dueReminders, setter: setDueReminders },
          { label: 'Meeting Reminders', hint: 'Send reminders before meetings', value: meetingReminders, setter: setMeetingReminders },
        ].map((item, idx) => (
          <View key={idx} style={styles.notifRow}>
            <View>
              <Text style={styles.notifLabel}>{item.label}</Text>
              <Text style={styles.notifHint}>{item.hint}</Text>
            </View>
            <Switch
              value={item.value}
              onValueChange={item.setter}
              trackColor={{ false: Colors.accent, true: Colors.highlight }}
              thumbColor={Colors.textWhite}
            />
          </View>
        ))}
      </View>

      {/* Save */}
      <View style={styles.section}>
        <Button
          title="Save Settings"
          onPress={handleSave}
          loading={saving}
          icon="checkmark-circle"
          fullWidth
          size="lg"
        />
      </View>

      {/* Danger Zone */}
      <View style={styles.section}>
        <SectionHeader title="Danger Zone" />

        <Card variant="elevated" style={styles.dangerCard}>
          <TouchableOpacity
            style={styles.dangerItem}
            onPress={() => handleDangerZone('transfer')}
          >
            <View style={styles.dangerLeft}>
              <Ionicons name="swap-horizontal" size={20} color={Colors.warning} />
              <View>
                <Text style={styles.dangerTitle}>Transfer Ownership</Text>
                <Text style={styles.dangerDesc}>Transfer admin rights to another member</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textLight} />
          </TouchableOpacity>

          <Divider spacing="xs" />

          <TouchableOpacity
            style={styles.dangerItem}
            onPress={() => handleDangerZone('delete')}
          >
            <View style={styles.dangerLeft}>
              <Ionicons name="trash" size={20} color={Colors.error} />
              <View>
                <Text style={[styles.dangerTitle, { color: Colors.error }]}>
                  Delete Organization
                </Text>
                <Text style={styles.dangerDesc}>
                  Permanently delete this organization and all data
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textLight} />
          </TouchableOpacity>
        </Card>
      </View>

      <View style={{ height: 60 }} />

      {/* Currency Picker Modal */}
      <Modal visible={showCurrencyPicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <SectionHeader title="Select Currency" />

            <ScrollView style={styles.currencyList}>
              {CURRENCIES.map((c) => (
                <TouchableOpacity
                  key={c.code}
                  style={[
                    styles.currencyOption,
                    currency === c.code && styles.currencyOptionActive,
                  ]}
                  onPress={() => {
                    setCurrency(c.code);
                    setShowCurrencyPicker(false);
                  }}
                >
                  <View style={styles.currencyOptionLeft}>
                    <Text style={styles.currencyOptionSymbol}>{c.symbol}</Text>
                    <View>
                      <Text style={styles.currencyOptionName}>{c.name}</Text>
                      <Text style={styles.currencyOptionCode}>{c.code}</Text>
                    </View>
                  </View>
                  {currency === c.code && (
                    <Ionicons name="checkmark-circle" size={22} color={Colors.highlight} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal visible={showDeleteConfirm} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: 320 }]}>
            <Text style={[styles.dangerTitle, { color: Colors.error, fontSize: FontSize.lg, marginBottom: Spacing.sm }]}>
              Delete Organization
            </Text>
            <Text style={{ color: Colors.textSecondary, marginBottom: Spacing.md }}>
              This will permanently delete "{orgName}" and ALL its data. Type <Text style={{ fontWeight: FontWeight.bold }}>DELETE</Text> to confirm.
            </Text>
            <TextInput
              style={{
                borderWidth: 1,
                borderColor: Colors.error,
                borderRadius: BorderRadius.md,
                padding: Spacing.sm,
                color: Colors.textPrimary,
                marginBottom: Spacing.md,
                fontSize: FontSize.md,
              }}
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder='Type "DELETE"'
              placeholderTextColor={Colors.textLight}
              autoCapitalize="characters"
            />
            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
              <Button
                title="Cancel"
                variant="outline"
                onPress={() => setShowDeleteConfirm(false)}
                style={{ flex: 1 }}
              />
              <Button
                title="Delete Forever"
                variant="primary"
                onPress={handleDeleteOrg}
                disabled={deleteConfirmText !== 'DELETE'}
                style={{ flex: 1, backgroundColor: Colors.error }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  section: { paddingHorizontal: Spacing.md, marginBottom: Spacing.lg },

  orgPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.xs,
  },
  orgAvatar: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.highlight,
  },
  orgAvatarText: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.highlight,
  },
  orgPreviewName: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
  },
  orgPreviewSlug: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
  },

  currencySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  currencyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  currencySymbol: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currencySymbolText: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.highlight,
  },
  currencyName: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
    color: Colors.textPrimary,
  },
  currencyCode: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
  },

  gatewayItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: Spacing.sm,
  },
  gatewayItemActive: {
    borderColor: Colors.highlight,
    backgroundColor: Colors.highlightSubtle,
  },
  gatewayLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  gatewayIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gatewayIconActive: {
    backgroundColor: Colors.highlightSubtle,
  },
  gatewayName: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
    color: Colors.textPrimary,
  },
  gatewayStatus: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
  },

  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  notifLabel: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
    color: Colors.textPrimary,
  },
  notifHint: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    marginTop: 1,
  },

  dangerCard: {
    borderColor: Colors.error,
    borderWidth: 1,
  },
  dangerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
  },
  dangerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
  },
  dangerTitle: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
    color: Colors.textPrimary,
  },
  dangerDesc: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    marginTop: 1,
  },

  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: Colors.overlay,
  },
  modalContent: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    padding: Spacing.lg,
    paddingBottom: 34,
    maxHeight: '70%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.accent,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  currencyList: {
    maxHeight: 400,
  },
  currencyOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.xs,
  },
  currencyOptionActive: {
    backgroundColor: Colors.highlightSubtle,
  },
  currencyOptionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  currencyOptionSymbol: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
    width: 32,
    textAlign: 'center',
  },
  currencyOptionName: {
    fontSize: FontSize.md,
    color: Colors.textPrimary,
  },
  currencyOptionCode: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
  },
});
