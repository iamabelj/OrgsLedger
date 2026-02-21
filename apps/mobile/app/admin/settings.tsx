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
  PoweredByFooter,
  ResponsiveScrollView,
} from '../../src/components/ui';
import { showAlert } from '../../src/utils/alert';
import { CURRENCIES } from '../../src/utils/currency';
import { useOrgCurrencyStore } from '../../src/hooks/useOrgCurrency';
import { ALL_LANGUAGES, getLanguage } from '../../src/utils/languages';

const PAYMENT_GATEWAYS = [
  { id: 'stripe', name: 'Stripe', icon: 'card-outline' as const, available: true },
  { id: 'paystack', name: 'Paystack', icon: 'wallet-outline' as const, available: true },
  { id: 'flutterwave', name: 'Flutterwave', icon: 'flash-outline' as const, available: true },
  { id: 'bank_transfer', name: 'Bank Transfer', icon: 'business-outline' as const, available: true },
];

// Credential field definitions per gateway
const GATEWAY_CREDENTIALS: Record<string, { key: string; label: string; placeholder: string; secure?: boolean }[]> = {
  stripe: [
    { key: 'stripePublicKey', label: 'Publishable Key', placeholder: 'pk_live_...' },
    { key: 'stripeSecretKey', label: 'Secret Key', placeholder: 'sk_live_...', secure: true },
  ],
  paystack: [
    { key: 'paystackPublicKey', label: 'Public Key', placeholder: 'pk_live_...' },
    { key: 'paystackSecretKey', label: 'Secret Key', placeholder: 'sk_live_...', secure: true },
  ],
  flutterwave: [
    { key: 'flutterwavePublicKey', label: 'Public Key', placeholder: 'FLWPUBK-...' },
    { key: 'flutterwaveSecretKey', label: 'Secret Key', placeholder: 'FLWSECK-...', secure: true },
  ],
  bank_transfer: [
    { key: 'bankName', label: 'Bank Name', placeholder: 'e.g. First National Bank' },
    { key: 'bankAccountName', label: 'Account Name', placeholder: 'e.g. My Organization Ltd' },
    { key: 'bankAccountNumber', label: 'Account Number', placeholder: 'e.g. 1234567890' },
    { key: 'bankRoutingCode', label: 'Routing / Sort Code', placeholder: 'e.g. 012345' },
  ],
};

export default function SettingsScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const syncCurrency = useOrgCurrencyStore((s) => s.setCurrency);
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [orgDescription, setOrgDescription] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [defaultLanguage, setDefaultLanguage] = useState('en');
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);
  const [langSearch, setLangSearch] = useState('');
  const [enabledGateways, setEnabledGateways] = useState<string[]>(['stripe']);
  const [gatewayCredentials, setGatewayCredentials] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(null);
      const res = await api.orgs.get(currentOrgId);
      const org = res.data?.data || res.data;
      setOrgName(org?.name || '');
      setOrgSlug(org?.slug || '');

      // Parse settings from JSON string stored in DB
      let settings: any = {};
      if (org?.settings) {
        try {
          settings = typeof org.settings === 'string' ? JSON.parse(org.settings) : org.settings;
        } catch { settings = {}; }
      }
      // description lives inside settings JSON (no top-level DB column)
      setOrgDescription(org?.description || settings.description || '');
      setCurrency(settings.currency || org?.currency || 'USD');
      setDefaultLanguage(settings.defaultLanguage || 'en');
      setEnabledGateways(settings.enabledGateways || ['stripe']);
      // Load gateway credentials from payment_methods structure (canonical source)
      const creds: Record<string, string> = {};
      const pm = settings.payment_methods || {};
      // Stripe
      if (pm.stripe?.public_key) creds.stripePublicKey = pm.stripe.public_key;
      if (pm.stripe?.secret_key) creds.stripeSecretKey = pm.stripe.secret_key;
      // Paystack
      if (pm.paystack?.public_key) creds.paystackPublicKey = pm.paystack.public_key;
      if (pm.paystack?.secret_key) creds.paystackSecretKey = pm.paystack.secret_key;
      // Flutterwave
      if (pm.flutterwave?.public_key) creds.flutterwavePublicKey = pm.flutterwave.public_key;
      if (pm.flutterwave?.secret_key) creds.flutterwaveSecretKey = pm.flutterwave.secret_key;
      // Bank transfer
      if (pm.bank_transfer?.bank_name) creds.bankName = pm.bank_transfer.bank_name;
      if (pm.bank_transfer?.account_name) creds.bankAccountName = pm.bank_transfer.account_name;
      if (pm.bank_transfer?.account_number) creds.bankAccountNumber = pm.bank_transfer.account_number;
      if (pm.bank_transfer?.sort_code) creds.bankRoutingCode = pm.bank_transfer.sort_code;
      // Fallback: also check flat keys & legacy bankDetails
      for (const fields of Object.values(GATEWAY_CREDENTIALS)) {
        for (const field of fields) {
          if (!creds[field.key] && settings[field.key]) creds[field.key] = settings[field.key];
        }
      }
      if (!creds.bankName && settings.bankDetails?.bankName) creds.bankName = settings.bankDetails.bankName;
      if (!creds.bankAccountName && settings.bankDetails?.accountName) creds.bankAccountName = settings.bankDetails.accountName;
      if (!creds.bankAccountNumber && settings.bankDetails?.accountNumber) creds.bankAccountNumber = settings.bankDetails.accountNumber;
      if (!creds.bankRoutingCode && settings.bankDetails?.routingCode) creds.bankRoutingCode = settings.bankDetails.routingCode;
      setGatewayCredentials(creds);
      if (settings.notifications) {
        setEmailNotifications(settings.notifications.emailNotifications !== false);
        setPushNotifications(settings.notifications.pushNotifications !== false);
        setDueReminders(settings.notifications.dueReminders !== false);
        setMeetingReminders(settings.notifications.meetingReminders !== false);
      }
    } catch (err) {
      setError('Failed to load settings');
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
          defaultLanguage,
          enabledGateways,
          // Canonical payment_methods structure — used by the API when
          // processing payments so each org's credentials are isolated.
          payment_methods: {
            stripe: {
              enabled: enabledGateways.includes('stripe'),
              label: 'Pay with Card (Stripe)',
              public_key: gatewayCredentials.stripePublicKey || '',
              secret_key: gatewayCredentials.stripeSecretKey || '',
            },
            paystack: {
              enabled: enabledGateways.includes('paystack'),
              label: 'Pay with Paystack',
              public_key: gatewayCredentials.paystackPublicKey || '',
              secret_key: gatewayCredentials.paystackSecretKey || '',
            },
            flutterwave: {
              enabled: enabledGateways.includes('flutterwave'),
              label: 'Pay with Flutterwave',
              public_key: gatewayCredentials.flutterwavePublicKey || '',
              secret_key: gatewayCredentials.flutterwaveSecretKey || '',
            },
            bank_transfer: {
              enabled: enabledGateways.includes('bank_transfer'),
              label: 'Bank Transfer',
              bank_name: gatewayCredentials.bankName || '',
              account_name: gatewayCredentials.bankAccountName || '',
              account_number: gatewayCredentials.bankAccountNumber || '',
              sort_code: gatewayCredentials.bankRoutingCode || '',
              instructions: 'Please transfer to the above account and submit proof of payment.',
            },
          },
          // Also keep bankDetails for backward compatibility
          bankDetails: {
            bankName: gatewayCredentials.bankName || '',
            accountName: gatewayCredentials.bankAccountName || '',
            accountNumber: gatewayCredentials.bankAccountNumber || '',
            routingCode: gatewayCredentials.bankRoutingCode || '',
          },
          notifications: {
            emailNotifications,
            pushNotifications,
            dueReminders,
            meetingReminders,
          },
        },
      });
      // Sync currency to global store so all screens reflect the change immediately
      syncCurrency(currency);
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

  const updateCredential = (key: string, value: string) => {
    setGatewayCredentials((prev) => ({ ...prev, [key]: value }));
  };

  const selectedCurrency = CURRENCIES.find((c) => c.code === currency) || CURRENCIES[0];
  const selectedLanguage = getLanguage(defaultLanguage);

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
    <ResponsiveScrollView style={styles.container}>
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

      {/* Default Language */}
      <View style={styles.section}>
        <SectionHeader title="Default Language" />

        <TouchableOpacity
          style={styles.currencySelector}
          onPress={() => { setLangSearch(''); setShowLanguagePicker(true); }}
        >
          <View style={styles.currencyLeft}>
            <Text style={{ fontSize: 24 }}>{selectedLanguage?.flag || '🌐'}</Text>
            <View>
              <Text style={styles.currencyName}>{selectedLanguage?.name || defaultLanguage}</Text>
              <Text style={styles.currencyCode}>
                {selectedLanguage?.nativeName !== selectedLanguage?.name
                  ? selectedLanguage?.nativeName
                  : defaultLanguage.toUpperCase()}
              </Text>
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
          const credentialFields = GATEWAY_CREDENTIALS[gateway.id] || [];
          return (
            <View key={gateway.id} style={{ marginBottom: Spacing.sm }}>
              <View
                style={[styles.gatewayItem, isEnabled && styles.gatewayItemActive, { marginBottom: 0 }]}
              >
                <TouchableOpacity
                  style={styles.gatewayLeft}
                  onPress={() => toggleGateway(gateway.id)}
                  activeOpacity={0.7}
                >
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
                </TouchableOpacity>
                <Switch
                  value={isEnabled}
                  onValueChange={() => toggleGateway(gateway.id)}
                  trackColor={{ false: Colors.accent, true: Colors.highlight }}
                  thumbColor={Colors.textWhite}
                />
              </View>

              {/* Credential fields — shown when gateway is enabled */}
              {isEnabled && credentialFields.length > 0 && (
                <View style={styles.credentialContainer}>
                  {credentialFields.map((field) => (
                    <View key={field.key} style={styles.credentialField}>
                      <Text style={styles.credentialLabel}>{field.label}</Text>
                      <TextInput
                        style={styles.credentialInput}
                        value={gatewayCredentials[field.key] || ''}
                        onChangeText={(v) => updateCredential(field.key, v)}
                        placeholder={field.placeholder}
                        placeholderTextColor={Colors.textLight}
                        secureTextEntry={!!field.secure}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </View>
                  ))}
                </View>
              )}
            </View>
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

      {/* Language Picker Modal */}
      <Modal visible={showLanguagePicker} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHandle} />
            <SectionHeader title="Select Language" />

            <TextInput
              style={styles.langSearchInput}
              placeholder="Search languages…"
              placeholderTextColor={Colors.textLight}
              value={langSearch}
              onChangeText={setLangSearch}
              autoCapitalize="none"
            />

            <ScrollView style={styles.currencyList} keyboardShouldPersistTaps="handled">
              {ALL_LANGUAGES
                .filter((l) => {
                  if (!langSearch) return true;
                  const q = langSearch.toLowerCase();
                  return l.name.toLowerCase().includes(q) || l.nativeName.toLowerCase().includes(q) || l.code.includes(q);
                })
                .map((lang) => (
                <TouchableOpacity
                  key={lang.code}
                  style={[
                    styles.currencyOption,
                    defaultLanguage === lang.code && styles.currencyOptionActive,
                  ]}
                  onPress={() => {
                    setDefaultLanguage(lang.code);
                    setShowLanguagePicker(false);
                  }}
                >
                  <View style={styles.currencyOptionLeft}>
                    <Text style={{ fontSize: 22 }}>{lang.flag}</Text>
                    <View>
                      <Text style={styles.currencyOptionName}>{lang.name}</Text>
                      {lang.nativeName !== lang.name && (
                        <Text style={styles.currencyOptionCode}>{lang.nativeName}</Text>
                      )}
                    </View>
                  </View>
                  {defaultLanguage === lang.code && (
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

      <PoweredByFooter />
    </ResponsiveScrollView>
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

  credentialContainer: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: Colors.borderLight,
    borderBottomLeftRadius: BorderRadius.md,
    borderBottomRightRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  credentialField: {
    marginBottom: Spacing.sm,
  },
  credentialLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  credentialInput: {
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 8,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    backgroundColor: Colors.background,
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
  langSearchInput: {
    borderWidth: 1,
    borderColor: Colors.accent,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    marginBottom: Spacing.sm,
  },
});
