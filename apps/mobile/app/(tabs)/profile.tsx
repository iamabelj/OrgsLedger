// ============================================================
// OrgsLedger Mobile — Premium Profile & Settings Screen
// ============================================================
// Features: Profile photo upload for facial recognition,
//           premium card-based layout, responsive design.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Platform,
  Image,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import {
  Colors, Spacing, FontSize, FontWeight,
  BorderRadius, Shadow,
} from '../../src/theme';
import {
  Card, Badge, Input, Button,
  Divider, SectionHeader, ResponsiveScrollView,
} from '../../src/components/ui';
import { showAlert } from '../../src/utils/alert';
import { useResponsive } from '../../src/hooks/useResponsive';
import { ALL_LANGUAGES, getLanguage, isTtsSupported } from '../../src/utils/languages';

const API_BASE = __DEV__ ? 'http://localhost:3000' : 'https://app.orgsledger.com';

const ROLE_CONFIG: Record<string, { color: string; bg: string; label: string; icon: string }> = {
  developer:    { color: '#C9A84C', bg: 'rgba(201,168,76,0.12)', label: 'Developer', icon: 'code-slash' },
  org_admin:    { color: '#C9A84C', bg: 'rgba(201,168,76,0.12)', label: 'Admin', icon: 'shield-checkmark' },
  super_admin:  { color: '#C9A84C', bg: 'rgba(201,168,76,0.12)', label: 'Super Admin', icon: 'diamond' },
  executive:    { color: '#2980B9', bg: 'rgba(41,128,185,0.12)', label: 'Executive', icon: 'briefcase' },
  treasurer:    { color: '#2ECC71', bg: 'rgba(46,204,113,0.12)', label: 'Treasurer', icon: 'cash' },
  secretary:    { color: '#E67E22', bg: 'rgba(230,126,34,0.12)', label: 'Secretary', icon: 'document-text' },
  member:       { color: '#8E99A9', bg: 'rgba(142,153,169,0.12)', label: 'Member', icon: 'person' },
  guest:        { color: '#5A6A7E', bg: 'rgba(90,106,126,0.12)', label: 'Guest', icon: 'eye' },
};

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const memberships = useAuthStore((s) => s.memberships);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const setCurrentOrg = useAuthStore((s) => s.setCurrentOrg);
  const loadUser = useAuthStore((s) => s.loadUser);
  const logout = useAuthStore((s) => s.logout);
  const responsive = useResponsive();

  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  // ── Language Preference ───────────────────────────────
  const [nativeLanguage, setNativeLanguage] = useState('en');
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [langSearch, setLangSearch] = useState('');
  const [savingLang, setSavingLang] = useState(false);

  const filteredLangs = useMemo(() => {
    if (!langSearch.trim()) return ALL_LANGUAGES;
    const q = langSearch.toLowerCase().trim();
    return ALL_LANGUAGES.filter(
      (l) => l.name.toLowerCase().includes(q) || l.nativeName.toLowerCase().includes(q) || l.code.includes(q)
    );
  }, [langSearch]);

  const currentLangInfo = useMemo(() => getLanguage(nativeLanguage), [nativeLanguage]);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({
    email_meetings: true,
    email_finances: true,
    email_announcements: true,
    push_meetings: true,
    push_finances: true,
    push_announcements: true,
    push_chat: true,
  });

  useEffect(() => {
    if (!currentOrgId) return;
    api.notifications.getPreferences().then((res: any) => {
      if (res.data?.data) setNotifPrefs((prev) => ({ ...prev, ...res.data.data }));
    }).catch(() => {});
    // Load saved language preference
    api.auth.getLanguagePreference(currentOrgId).then((res: any) => {
      if (res.data?.data?.language) setNativeLanguage(res.data.data.language);
    }).catch(() => {});
  }, [currentOrgId]);

  const updateNotifPref = useCallback(async (key: string, value: boolean) => {
    const updated = { ...notifPrefs, [key]: value };
    setNotifPrefs(updated);
    if (!currentOrgId) return;
    try { await api.notifications.updatePreferences(updated); } catch {}
  }, [notifPrefs, currentOrgId]);

  const handleSelectLanguage = useCallback(async (code: string) => {
    if (!currentOrgId) return;
    setNativeLanguage(code);
    setShowLangPicker(false);
    setLangSearch('');
    setSavingLang(true);
    try {
      await api.auth.setLanguagePreference(currentOrgId, { language: code });
      showAlert('Language Saved', `Your native language has been set to ${getLanguage(code)?.name || code}. This will be used in all meetings.`);
    } catch (err: any) {
      showAlert('Error', err?.response?.data?.error || 'Failed to save language preference');
    } finally {
      setSavingLang(false);
    }
  }, [currentOrgId]);

  const currentMembership = memberships.find((m) => m.organization_id === currentOrgId);
  const roleConfig = ROLE_CONFIG[currentMembership?.role || 'member'] || ROLE_CONFIG.member;

  useEffect(() => {
    if (Platform.OS !== 'web') {
      try {
        const Notifications = require('expo-notifications');
        Notifications.getPermissionsAsync().then(({ status }: any) => {
          setNotificationsEnabled(status === 'granted');
        });
      } catch {}
    }
  }, []);

  const toggleNotifications = async (enabled: boolean) => {
    setNotificationsEnabled(enabled);
    if (Platform.OS === 'web') return;
    try {
      const Notifications = require('expo-notifications');
      if (enabled) {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') {
          showAlert('Permission Denied', 'Enable notifications from your device settings.');
          setNotificationsEnabled(false);
          return;
        }
        try {
          const token = await Notifications.getExpoPushTokenAsync();
          await api.auth.updatePushToken({ fcmToken: token.data });
        } catch {}
      } else {
        try { await api.auth.updatePushToken({ fcmToken: '' }); } catch {}
      }
    } catch {}
  };

  // ── Avatar Upload ─────────────────────────────────────
  const handleAvatarUpload = async () => {
    try {
      // Web: always use native file input (expo-image-picker URI objects
      // don't serialise correctly into browser FormData)
      if (Platform.OS === 'web') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async (e: any) => {
          const file = e.target.files[0];
          if (!file) return;
          setUploadingAvatar(true);
          try {
            await api.auth.uploadAvatar(file);
            await loadUser();
            showAlert('Success', 'Profile photo updated!');
          } catch (err: any) {
            showAlert('Error', err?.response?.data?.error || 'Failed to upload photo');
          } finally {
            setUploadingAvatar(false);
          }
        };
        input.click();
        return;
      }

      // Native: use expo-image-picker
      const ImagePicker = require('expo-image-picker');

      const permResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permResult.status !== 'granted') {
        showAlert('Permission Denied', 'Camera roll access is needed to upload a photo.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      setUploadingAvatar(true);

      await api.auth.uploadAvatar({
        uri: asset.uri,
        name: asset.fileName || 'avatar.jpg',
        mimeType: asset.mimeType || 'image/jpeg',
      });

      await loadUser();
      showAlert('Success', 'Profile photo updated for facial recognition!');
    } catch (err: any) {
      showAlert('Error', err?.response?.data?.error || 'Failed to upload photo');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.auth.updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
      });
      await loadUser();
      showAlert('Success', 'Profile updated');
      setEditing(false);
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    showAlert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/login');
        },
      },
    ]);
  };

  const initials = `${(user?.firstName?.[0] || '?').toUpperCase()}${(user?.lastName?.[0] || '').toUpperCase()}`;

  const avatarUrl = user?.avatarUrl
    ? (user.avatarUrl.startsWith('http') ? user.avatarUrl : `${API_BASE}${user.avatarUrl}`)
    : null;

  const isWide = responsive.isDesktop || responsive.isTablet;

  return (
    <ResponsiveScrollView style={styles.container}>
      {/* ══════════════════════════════════════════════════ */}
      {/* PROFILE HERO SECTION                              */}
      {/* ══════════════════════════════════════════════════ */}
      <View style={styles.heroSection}>
        <View style={styles.heroGradient} />
        <View style={styles.heroContent}>
          {/* Avatar with Upload */}
          <TouchableOpacity
            style={styles.avatarOuter}
            onPress={handleAvatarUpload}
            activeOpacity={0.8}
            disabled={uploadingAvatar}
          >
            <View style={styles.avatarRing}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarInitials}>
                  <Text style={styles.avatarInitialsText}>{initials}</Text>
                </View>
              )}
            </View>
            <View style={styles.avatarBadge}>
              {uploadingAvatar ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Ionicons name="camera" size={14} color="#FFF" />
              )}
            </View>
          </TouchableOpacity>

          <Text style={styles.heroName}>{user?.firstName} {user?.lastName}</Text>
          <Text style={styles.heroEmail}>{user?.email}</Text>

          {/* Role Badge */}
          {currentMembership && (
            <View style={[styles.heroBadge, { backgroundColor: roleConfig.bg, borderColor: roleConfig.color + '30' }]}>
              <Ionicons name={roleConfig.icon as any} size={13} color={roleConfig.color} />
              <Text style={[styles.heroBadgeText, { color: roleConfig.color }]}>{roleConfig.label}</Text>
            </View>
          )}

          {/* Upload hint */}
          <TouchableOpacity style={styles.uploadHint} onPress={handleAvatarUpload}>
            <Ionicons name="scan-outline" size={14} color={Colors.highlight} />
            <Text style={styles.uploadHintText}>
              {avatarUrl ? 'Update photo for facial recognition' : 'Upload photo for facial recognition'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Quick Stats Row */}
        <View style={[styles.statsRow, isWide && styles.statsRowWide]}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{memberships.length}</Text>
            <Text style={styles.statLabel}>{memberships.length === 1 ? 'Organization' : 'Organizations'}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { textTransform: 'capitalize' }]}>{currentMembership?.role?.replace(/_/g, ' ') || 'N/A'}</Text>
            <Text style={styles.statLabel}>Current Role</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCard}>
            <View style={[styles.statusDot, { backgroundColor: Colors.success }]} />
            <Text style={styles.statLabel}>Active</Text>
          </View>
        </View>
      </View>

      {/* ══════════════════════════════════════════════════ */}
      {/* CONTENT GRID                                      */}
      {/* ══════════════════════════════════════════════════ */}
      <View style={[styles.contentGrid, isWide && styles.contentGridWide]}>
        {/* ── Left Column ──────────────────────────────── */}
        <View style={[styles.column, isWide && styles.columnLeft]}>
          {/* Organization Selector */}
          {memberships.length > 1 && (
            <Card style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardIconWrap}>
                  <Ionicons name="business" size={18} color={Colors.highlight} />
                </View>
                <Text style={styles.cardTitle}>Organizations</Text>
              </View>
              {memberships.map((m, idx) => {
                const active = m.organization_id === currentOrgId;
                return (
                  <TouchableOpacity
                    key={m.organization_id}
                    style={[styles.orgItem, active && styles.orgItemActive, idx < memberships.length - 1 && styles.orgItemBorder]}
                    onPress={() => setCurrentOrg(m.organization_id)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.orgDot, active && styles.orgDotActive]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.orgName, active && styles.orgNameActive]}>{m.organizationName || m.organization_id}</Text>
                      <Text style={styles.orgRole}>{m.role.replace(/_/g, ' ')}</Text>
                    </View>
                    {active && <Ionicons name="checkmark-circle" size={20} color={Colors.highlight} />}
                  </TouchableOpacity>
                );
              })}
            </Card>
          )}

          {/* Native Language — prominent position for discoverability */}
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={[styles.cardIconWrap, { backgroundColor: 'rgba(16,185,129,0.12)' }]}>
                <Ionicons name="language" size={18} color="#10B981" />
              </View>
              <Text style={styles.cardTitle}>Native Language</Text>
              {savingLang && <ActivityIndicator size="small" color={Colors.highlight} />}
            </View>

            <Text style={{ fontSize: FontSize.sm, color: Colors.textLight, marginBottom: Spacing.md, lineHeight: 18 }}>
              Your preferred language for meeting translations. All meetings will automatically translate to this language.
            </Text>

            <TouchableOpacity
              style={langCardStyles.currentLangRow}
              onPress={() => setShowLangPicker(true)}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: 24 }}>{currentLangInfo?.flag || '🌐'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={langCardStyles.currentLangName}>{currentLangInfo?.name || nativeLanguage}</Text>
                {currentLangInfo && currentLangInfo.nativeName !== currentLangInfo.name && (
                  <Text style={langCardStyles.currentLangNative}>{currentLangInfo.nativeName}</Text>
                )}
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textLight} />
            </TouchableOpacity>
          </Card>

          {/* Profile Details */}
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardIconWrap}>
                <Ionicons name="person" size={18} color={Colors.highlight} />
              </View>
              <Text style={styles.cardTitle}>Profile Details</Text>
              <TouchableOpacity
                style={[styles.editPill, editing && styles.editPillCancel]}
                onPress={() => {
                  setEditing(!editing);
                  if (editing) {
                    setFirstName(user?.firstName || '');
                    setLastName(user?.lastName || '');
                    setPhone(user?.phone || '');
                  }
                }}
              >
                <Ionicons name={editing ? 'close' : 'create-outline'} size={14} color={editing ? Colors.error : Colors.highlight} />
                <Text style={[styles.editPillText, editing && { color: Colors.error }]}>{editing ? 'Cancel' : 'Edit'}</Text>
              </TouchableOpacity>
            </View>

            {editing ? (
              <View style={styles.editForm}>
                <Input label="First Name" value={firstName} onChangeText={setFirstName} icon="person-outline" />
                <Input label="Last Name" value={lastName} onChangeText={setLastName} icon="person-outline" />
                <Input label="Phone" value={phone} onChangeText={setPhone} icon="call-outline" keyboardType="phone-pad" placeholder="Optional" />
                <View style={styles.readonlyField}>
                  <Ionicons name="mail-outline" size={16} color={Colors.textLight} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.readonlyLabel}>Email (cannot be changed)</Text>
                    <Text style={styles.readonlyValue}>{user?.email}</Text>
                  </View>
                </View>
                <Button title={saving ? 'Saving...' : 'Save Changes'} onPress={handleSave} disabled={saving} variant="primary" fullWidth />
              </View>
            ) : (
              <View>
                <InfoRow icon="person" label="First Name" value={user?.firstName || 'Not set'} />
                <InfoRow icon="person" label="Last Name" value={user?.lastName || 'Not set'} />
                <InfoRow icon="call" label="Phone" value={user?.phone || 'Not set'} />
                <InfoRow icon="mail" label="Email" value={user?.email || 'Not set'} last />
              </View>
            )}
          </Card>
        </View>

        {/* ── Right Column ─────────────────────────────── */}
        <View style={[styles.column, isWide && styles.columnRight]}>
          {/* Notification Settings */}
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={[styles.cardIconWrap, { backgroundColor: Colors.infoSubtle }]}>
                <Ionicons name="notifications" size={18} color={Colors.info} />
              </View>
              <Text style={styles.cardTitle}>Notifications</Text>
            </View>

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Push Notifications</Text>
              <Switch value={notificationsEnabled} onValueChange={toggleNotifications} trackColor={{ false: Colors.accent, true: Colors.highlight }} thumbColor="#FFF" />
            </View>

            <View style={styles.prefsDivider} />
            <Text style={styles.prefsGroupLabel}>Email Notifications</Text>
            <PrefToggle label="Meeting reminders" value={notifPrefs.email_meetings} onToggle={(v) => updateNotifPref('email_meetings', v)} />
            <PrefToggle label="Financial updates" value={notifPrefs.email_finances} onToggle={(v) => updateNotifPref('email_finances', v)} />
            <PrefToggle label="Announcements" value={notifPrefs.email_announcements} onToggle={(v) => updateNotifPref('email_announcements', v)} />

            <View style={styles.prefsDivider} />
            <Text style={styles.prefsGroupLabel}>Push Notifications</Text>
            <PrefToggle label="Meeting reminders" value={notifPrefs.push_meetings} onToggle={(v) => updateNotifPref('push_meetings', v)} />
            <PrefToggle label="Financial updates" value={notifPrefs.push_finances} onToggle={(v) => updateNotifPref('push_finances', v)} />
            <PrefToggle label="Announcements" value={notifPrefs.push_announcements} onToggle={(v) => updateNotifPref('push_announcements', v)} />
            <PrefToggle label="Chat messages" value={notifPrefs.push_chat} onToggle={(v) => updateNotifPref('push_chat', v)} />
          </Card>

          {/* Quick Actions */}
          <Card style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={[styles.cardIconWrap, { backgroundColor: Colors.highlightSubtle }]}>
                <Ionicons name="flash" size={18} color={Colors.highlight} />
              </View>
              <Text style={styles.cardTitle}>Quick Actions</Text>
            </View>

            <QuickAction icon="lock-closed" color={Colors.highlight} bg={Colors.highlightSubtle} label="Change Password" onPress={() => router.push('/change-password')} />
            <QuickAction icon="shield-checkmark" color={Colors.success} bg={Colors.successSubtle} label="Privacy Policy" onPress={() => router.push('/legal/privacy')} />
            <QuickAction icon="document-text" color={Colors.warning} bg={Colors.warningSubtle} label="Terms of Service" onPress={() => router.push('/legal/terms')} />
            <QuickAction icon="help-circle" color={Colors.info} bg={Colors.infoSubtle} label="Help & Support" onPress={() => router.push('/help')} />
            <QuickAction icon="information-circle" color={Colors.textLight} bg={Colors.accent} label="About OrgsLedger" onPress={() => showAlert('OrgsLedger', 'Version 1.0.0\n\nOrganization management platform.\n\n© 2026 OrgsLedger')} />
          </Card>

          {/* Sign Out */}
          <Card style={[styles.card, styles.dangerCard]}>
            <TouchableOpacity style={styles.signOutRow} onPress={handleLogout} activeOpacity={0.7}>
              <View style={styles.signOutIcon}>
                <Ionicons name="log-out" size={18} color={Colors.error} />
              </View>
              <Text style={styles.signOutText}>Sign Out</Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.error} />
            </TouchableOpacity>
          </Card>
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Ionicons name="shield-checkmark" size={12} color={Colors.textLight} />
        <Text style={styles.footerText}>OrgsLedger v1.0.0</Text>
      </View>
      <View style={{ height: Spacing.xxl }} />

      {/* ═══ LANGUAGE PICKER MODAL ═══════════════════════════ */}
      <Modal
        visible={showLangPicker}
        transparent
        animationType="fade"
        onRequestClose={() => { setShowLangPicker(false); setLangSearch(''); }}
      >
        <View style={langCardStyles.overlay}>
          <View style={langCardStyles.card}>
            <View style={langCardStyles.header}>
              <Ionicons name="language" size={18} color="#10B981" />
              <Text style={langCardStyles.headerTitle}>Select Native Language</Text>
              <TouchableOpacity onPress={() => { setShowLangPicker(false); setLangSearch(''); }}>
                <Ionicons name="close" size={22} color={Colors.textLight} />
              </TouchableOpacity>
            </View>

            <Text style={{ fontSize: FontSize.xs, color: Colors.textLight, marginBottom: Spacing.sm, paddingHorizontal: Spacing.md }}>
              This language will be used for all meeting translations.
            </Text>

            <View style={langCardStyles.searchWrap}>
              <Ionicons name="search" size={14} color={Colors.textLight} />
              <TextInput
                style={langCardStyles.searchInput}
                placeholder="Search language..."
                placeholderTextColor={Colors.textLight}
                value={langSearch}
                onChangeText={setLangSearch}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {langSearch.length > 0 && (
                <TouchableOpacity onPress={() => setLangSearch('')}>
                  <Ionicons name="close-circle" size={14} color={Colors.textLight} />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView style={langCardStyles.list} keyboardShouldPersistTaps="handled">
              {filteredLangs.length === 0 && (
                <Text style={langCardStyles.noResults}>No languages match "{langSearch}"</Text>
              )}
              {filteredLangs.map((lang) => {
                const isCurrent = nativeLanguage === lang.code;
                return (
                  <TouchableOpacity
                    key={lang.code}
                    style={[langCardStyles.langItem, isCurrent && langCardStyles.langItemActive]}
                    onPress={() => handleSelectLanguage(lang.code)}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 18 }}>{lang.flag || '🌐'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[langCardStyles.langName, isCurrent && { color: '#10B981' }]}>
                        {lang.name}
                      </Text>
                      {lang.nativeName !== lang.name && (
                        <Text style={langCardStyles.langNative}>{lang.nativeName}</Text>
                      )}
                    </View>
                    {isTtsSupported(lang.code) && (
                      <Ionicons name="volume-medium-outline" size={12} color={Colors.textLight} />
                    )}
                    {isCurrent && <Ionicons name="checkmark-circle" size={18} color="#10B981" />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ResponsiveScrollView>
  );
}

// ── Helper Components ───────────────────────────────────
function InfoRow({ icon, label, value, last }: { icon: string; label: string; value: string; last?: boolean }) {
  return (
    <View style={[infoStyles.row, !last && infoStyles.border]}>
      <View style={infoStyles.iconWrap}>
        <Ionicons name={icon as any} size={14} color={Colors.textLight} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={infoStyles.label}>{label}</Text>
        <Text style={infoStyles.value}>{value}</Text>
      </View>
    </View>
  );
}

function QuickAction({ icon, color, bg, label, onPress }: { icon: string; color: string; bg: string; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={qaStyles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[qaStyles.icon, { backgroundColor: bg }]}>
        <Ionicons name={icon as any} size={16} color={color} />
      </View>
      <Text style={qaStyles.label}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={Colors.textLight} />
    </TouchableOpacity>
  );
}

function PrefToggle({ label, value, onToggle }: { label: string; value: boolean; onToggle: (v: boolean) => void }) {
  return (
    <View style={prefStyles.row}>
      <Text style={prefStyles.label}>{label}</Text>
      <Switch value={value} onValueChange={onToggle} trackColor={{ false: Colors.accent, true: Colors.highlight }} thumbColor="#FFF" />
    </View>
  );
}

// ── SubStyles ───────────────────────────────────────────
const infoStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: Spacing.sm },
  border: { borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  iconWrap: { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: FontSize.xs, color: Colors.textLight, letterSpacing: 0.3 },
  value: { fontSize: FontSize.md, color: Colors.textPrimary, fontWeight: FontWeight.medium as any, marginTop: 1, flexShrink: 1 },
});

const qaStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  icon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontSize: FontSize.md, color: Colors.textPrimary, fontWeight: FontWeight.medium as any },
});

const prefStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  label: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary },
});

// ── Main Styles ─────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Hero
  heroSection: {
    backgroundColor: Colors.surface,
    borderBottomLeftRadius: BorderRadius.xl,
    borderBottomRightRadius: BorderRadius.xl,
    overflow: 'hidden',
    marginBottom: Spacing.md,
  },
  heroGradient: {
    height: 4,
    backgroundColor: Colors.highlight,
  },
  heroContent: {
    alignItems: 'center',
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  avatarOuter: {
    position: 'relative',
  },
  avatarRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 3,
    borderColor: Colors.highlight,
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 43,
  },
  avatarInitials: {
    width: '100%',
    height: '100%',
    borderRadius: 43,
    backgroundColor: Colors.primaryMid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitialsText: {
    fontSize: FontSize.title,
    fontWeight: FontWeight.bold as any,
    color: Colors.highlight,
  },
  avatarBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.highlight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  heroName: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold as any,
    color: Colors.textPrimary,
    marginTop: Spacing.md,
  },
  heroEmail: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    marginTop: Spacing.sm,
  },
  heroBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold as any,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  uploadHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.highlightSubtle,
  },
  uploadHintText: {
    fontSize: FontSize.xs,
    color: Colors.highlight,
    fontWeight: FontWeight.medium as any,
  },

  // Stats Row
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.lg,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  statsRowWide: {
    marginHorizontal: Spacing.xl,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold as any,
    color: Colors.textPrimary,
  },
  statLabel: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.border,
    marginHorizontal: Spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: 4,
  },

  // Content Grid
  contentGrid: {
    paddingHorizontal: Spacing.md,
  },
  contentGridWide: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  column: {
    flex: 1,
  },
  columnLeft: {
    flex: 1,
  },
  columnRight: {
    flex: 1,
  },

  // Cards
  card: {
    marginBottom: Spacing.md,
    padding: Spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  cardIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    flex: 1,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold as any,
    color: Colors.textPrimary,
  },

  // Edit
  editPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.highlightSubtle,
  },
  editPillCancel: {
    backgroundColor: Colors.errorSubtle,
  },
  editPillText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.medium as any,
    color: Colors.highlight,
  },
  editForm: {
    gap: Spacing.sm,
  },
  readonlyField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryLight,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  readonlyLabel: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
  },
  readonlyValue: {
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    fontWeight: FontWeight.medium as any,
    flexShrink: 1,
  },

  // Org Selector
  orgItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  orgItemActive: {
    backgroundColor: Colors.highlightSubtle,
  },
  orgItemBorder: {
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  orgDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.textLight,
  },
  orgDotActive: {
    backgroundColor: Colors.highlight,
  },
  orgName: {
    fontSize: FontSize.md,
    color: Colors.textPrimary,
    fontWeight: FontWeight.medium as any,
  },
  orgNameActive: {
    color: Colors.highlight,
  },
  orgRole: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    textTransform: 'capitalize',
    marginTop: 1,
  },

  // Notifications
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.xs,
  },
  toggleLabel: {
    flex: 1,
    fontSize: FontSize.md,
    color: Colors.textPrimary,
    fontWeight: FontWeight.medium as any,
  },
  prefsDivider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginVertical: Spacing.sm,
  },
  prefsGroupLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold as any,
    color: Colors.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },

  // Danger Zone
  dangerCard: {
    borderWidth: 1,
    borderColor: Colors.errorSubtle,
  },
  signOutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  signOutIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Colors.errorSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: {
    flex: 1,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold as any,
    color: Colors.error,
  },

  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: Spacing.md,
  },
  footerText: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
  },
});

// ── Language Card Styles ────────────────────────────────
const langCardStyles = StyleSheet.create({
  currentLangRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.2)',
  },
  currentLangName: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold as any,
    color: Colors.textPrimary,
  },
  currentLangNative: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    marginTop: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    width: '100%',
    maxWidth: 440,
    maxHeight: '80%',
    ...Shadow.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  headerTitle: {
    flex: 1,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold as any,
    color: Colors.textPrimary,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.sm,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    gap: 6,
    height: 36,
  },
  searchInput: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}),
  },
  list: {
    maxHeight: 360,
    paddingHorizontal: Spacing.sm,
  },
  noResults: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
    textAlign: 'center',
    padding: Spacing.lg,
  },
  langItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  langItemActive: {
    backgroundColor: 'rgba(16,185,129,0.08)',
  },
  langName: {
    fontSize: FontSize.md,
    color: Colors.textPrimary,
    fontWeight: FontWeight.medium as any,
  },
  langNative: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    marginTop: 1,
  },
});
