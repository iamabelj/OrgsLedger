// ============================================================
// OrgsLedger Mobile — Profile & Settings Screen (Royal Design)
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Platform,
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
  Card, Badge, Input, Button, Avatar,
  Divider, SectionHeader, ResponsiveScrollView,
} from '../../src/components/ui';
import { showAlert } from '../../src/utils/alert';

const ROLE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  developer:    { color: Colors.highlight, bg: Colors.highlightSubtle, label: 'Developer' },
  org_admin:    { color: Colors.highlight, bg: Colors.highlightSubtle, label: 'Admin' },
  super_admin:  { color: Colors.highlight, bg: Colors.highlightSubtle, label: 'Super Admin' },
  executive:    { color: Colors.info, bg: Colors.infoSubtle, label: 'Executive' },
  treasurer:    { color: Colors.success, bg: Colors.successSubtle, label: 'Treasurer' },
  secretary:    { color: Colors.warning, bg: Colors.warningSubtle, label: 'Secretary' },
  member:       { color: Colors.textLight, bg: Colors.accent, label: 'Member' },
};

export default function ProfileScreen() {
  const user = useAuthStore((s) => s.user);
  const memberships = useAuthStore((s) => s.memberships);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const setCurrentOrg = useAuthStore((s) => s.setCurrentOrg);
  const logout = useAuthStore((s) => s.logout);

  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [saving, setSaving] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({
    email_meetings: true,
    email_finances: true,
    email_announcements: true,
    push_meetings: true,
    push_finances: true,
    push_announcements: true,
    push_chat: true,
  });
  const [prefsLoading, setPrefsLoading] = useState(false);

  // Load notification preferences from server
  useEffect(() => {
    if (!currentOrgId) return;
    api.notifications.getPreferences().then((res: any) => {
      if (res.data?.preferences) setNotifPrefs((prev: Record<string, boolean>) => ({ ...prev, ...res.data.preferences }));
    }).catch(() => {});
  }, [currentOrgId]);

  const updateNotifPref = useCallback(async (key: string, value: boolean) => {
    const updated = { ...notifPrefs, [key]: value };
    setNotifPrefs(updated);
    if (!currentOrgId) return;
    try {
      await api.notifications.updatePreferences(updated);
    } catch {}
  }, [notifPrefs, currentOrgId]);

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
          Alert.alert('Permission Denied', 'Enable notifications from your device settings.');
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

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.auth.updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
      });
      Alert.alert('Success', 'Profile updated');
      setEditing(false);
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const initials = `${(user?.firstName?.[0] || '?').toUpperCase()}${(user?.lastName?.[0] || '').toUpperCase()}`;

  return (
    <ResponsiveScrollView style={styles.container}>
      {/* Profile Header */}
      <View style={styles.profileHeader}>
        <View style={styles.headerAccent} />
        <View style={styles.avatarContainer}>
          <View style={styles.avatarRing}>
            <Avatar name={initials} size={80} />
          </View>
        </View>
        <Text style={styles.userName}>{user?.firstName} {user?.lastName}</Text>
        <Text style={styles.userEmail}>{user?.email}</Text>
        {currentMembership && (
          <View style={[styles.roleBadge, { backgroundColor: roleConfig.bg }]}>
            <Ionicons name="shield-checkmark" size={12} color={roleConfig.color} />
            <Text style={[styles.roleText, { color: roleConfig.color }]}>{roleConfig.label}</Text>
          </View>
        )}
        <View style={styles.quickStats}>
          <View style={styles.quickStat}>
            <Text style={styles.quickStatValue}>{memberships.length}</Text>
            <Text style={styles.quickStatLabel}>{memberships.length === 1 ? 'Organization' : 'Organizations'}</Text>
          </View>
          <View style={styles.quickStatDivider} />
          <View style={styles.quickStat}>
            <Text style={styles.quickStatValue}>{currentMembership?.role?.replace('_', ' ') || 'N/A'}</Text>
            <Text style={styles.quickStatLabel}>Current Role</Text>
          </View>
        </View>
      </View>

      {/* Organization Selector */}
      {memberships.length > 1 && (
        <Card style={styles.section}>
          <SectionHeader title="Organizations" />
          {memberships.map((m) => {
            const active = m.organization_id === currentOrgId;
            return (
              <TouchableOpacity key={m.organization_id} style={styles.orgRow} onPress={() => setCurrentOrg(m.organization_id)} activeOpacity={0.7}>
                <View style={[styles.orgIcon, active && { backgroundColor: Colors.highlightSubtle }]}>
                  <Ionicons name={active ? 'business' : 'business-outline'} size={20} color={active ? Colors.highlight : Colors.textLight} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.orgName, active && { color: Colors.highlight }]}>{m.organizationName || m.organization_id}</Text>
                  <Text style={styles.orgRole}>{m.role.replace('_', ' ')}</Text>
                </View>
                {active && <Ionicons name="checkmark-circle" size={22} color={Colors.highlight} />}
              </TouchableOpacity>
            );
          })}
        </Card>
      )}

      {/* Edit Profile */}
      <Card style={styles.section}>
        <View style={styles.sectionHeader}>
          <SectionHeader title="Profile Details" />
          <TouchableOpacity style={[styles.editBtn, editing && styles.editBtnCancel]} onPress={() => { setEditing(!editing); if (editing) { setFirstName(user?.firstName || ''); setLastName(user?.lastName || ''); setPhone(user?.phone || ''); } }}>
            <Ionicons name={editing ? 'close' : 'create-outline'} size={16} color={editing ? Colors.error : Colors.highlight} />
            <Text style={[styles.editBtnText, editing && { color: Colors.error }]}>{editing ? 'Cancel' : 'Edit'}</Text>
          </TouchableOpacity>
        </View>
        {editing ? (
          <View style={styles.editForm}>
            <Input label="First Name" value={firstName} onChangeText={setFirstName} icon="person-outline" />
            <Input label="Last Name" value={lastName} onChangeText={setLastName} icon="person-outline" />
            <Input label="Phone" value={phone} onChangeText={setPhone} icon="call-outline" keyboardType="phone-pad" placeholder="Optional" />
            <View style={styles.emailReadonly}>
              <Ionicons name="mail-outline" size={18} color={Colors.textLight} />
              <View><Text style={styles.readonlyLabel}>Email (cannot be changed)</Text><Text style={styles.readonlyValue}>{user?.email}</Text></View>
            </View>
            <Button title={saving ? 'Saving...' : 'Save Changes'} onPress={handleSave} disabled={saving} variant="primary" />
          </View>
        ) : (
          <View style={styles.fieldList}>
            <ProfileField icon="person" label="First Name" value={user?.firstName || 'Not set'} />
            <ProfileField icon="person" label="Last Name" value={user?.lastName || 'Not set'} />
            <ProfileField icon="call" label="Phone" value={user?.phone || 'Not set'} />
            <ProfileField icon="mail" label="Email" value={user?.email || 'Not set'} last />
          </View>
        )}
      </Card>

      {/* Settings */}
      <Card style={styles.section}>
        <SectionHeader title="Settings" />
        <View style={styles.settingRow}>
          <View style={[styles.settingIcon, { backgroundColor: Colors.infoSubtle }]}><Ionicons name="notifications" size={18} color={Colors.info} /></View>
          <Text style={styles.settingLabel}>Push Notifications</Text>
          <Switch value={notificationsEnabled} onValueChange={toggleNotifications} trackColor={{ false: Colors.accent, true: Colors.highlight }} thumbColor={Colors.textWhite} />
        </View>

        <Divider />
        <Text style={styles.prefGroupTitle}>Notification Preferences</Text>
        <NotifPref label="Meeting reminders (email)" value={notifPrefs.email_meetings} onToggle={(v) => updateNotifPref('email_meetings', v)} />
        <NotifPref label="Meeting reminders (push)" value={notifPrefs.push_meetings} onToggle={(v) => updateNotifPref('push_meetings', v)} />
        <NotifPref label="Financial updates (email)" value={notifPrefs.email_finances} onToggle={(v) => updateNotifPref('email_finances', v)} />
        <NotifPref label="Financial updates (push)" value={notifPrefs.push_finances} onToggle={(v) => updateNotifPref('push_finances', v)} />
        <NotifPref label="Announcements (email)" value={notifPrefs.email_announcements} onToggle={(v) => updateNotifPref('email_announcements', v)} />
        <NotifPref label="Announcements (push)" value={notifPrefs.push_announcements} onToggle={(v) => updateNotifPref('push_announcements', v)} />
        <NotifPref label="Chat messages (push)" value={notifPrefs.push_chat} onToggle={(v) => updateNotifPref('push_chat', v)} last />

        <Divider />
        <SettingLink icon="lock-closed" color={Colors.highlight} bg={Colors.highlightSubtle} label="Change Password" onPress={() => router.push('/change-password')} />
        <SettingLink icon="shield-checkmark" color={Colors.success} bg={Colors.successSubtle} label="Privacy Policy" onPress={() => router.push('/legal/privacy')} />
        <SettingLink icon="document-text" color={Colors.warning} bg={Colors.warningSubtle} label="Terms of Service" onPress={() => router.push('/legal/terms')} />
        <SettingLink icon="hand-left" color={Colors.info} bg={Colors.infoSubtle} label="Acceptable Use Policy" onPress={() => router.push('/legal/acceptable-use')} />
        <SettingLink icon="briefcase" color={Colors.textLight} bg={Colors.accent} label="Data Processing Agreement" onPress={() => router.push('/legal/dpa')} />
        <SettingLink icon="help-circle" color={Colors.highlight} bg={Colors.highlightSubtle} label="Help & Support" onPress={() => router.push('/help')} />
        <SettingLink icon="information-circle" color={Colors.highlight} bg={Colors.highlightSubtle} label="About OrgsLedger" onPress={() => showAlert('OrgsLedger', 'Version 1.0.0\n\nOrganization management platform.\n\n\u00a9 2026 OrgsLedger')} last />
      </Card>

      {/* Danger Zone */}
      <Card style={[styles.section, styles.dangerSection]}>
        <TouchableOpacity style={styles.logoutRow} onPress={handleLogout} activeOpacity={0.7}>
          <View style={[styles.settingIcon, { backgroundColor: Colors.errorSubtle }]}><Ionicons name="log-out" size={18} color={Colors.error} /></View>
          <Text style={styles.logoutText}>Sign Out</Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.error} />
        </TouchableOpacity>
      </Card>

      <View style={styles.footer}>
        <Ionicons name="shield-checkmark" size={14} color={Colors.textLight} />
        <Text style={styles.version}>OrgsLedger v1.0.0</Text>
      </View>
      <View style={{ height: Spacing.xxl * 2 }} />
    </ResponsiveScrollView>
  );
}

function ProfileField({ icon, label, value, last }: { icon: string; label: string; value: string; last?: boolean }) {
  return (
    <View style={[pfStyles.row, !last && pfStyles.border]}>
      <View style={pfStyles.iconWrap}><Ionicons name={icon as any} size={16} color={Colors.textLight} /></View>
      <View style={{ flex: 1 }}><Text style={pfStyles.label}>{label}</Text><Text style={pfStyles.value}>{value}</Text></View>
    </View>
  );
}

function SettingLink({ icon, color, bg, label, onPress, last }: { icon: string; color: string; bg: string; label: string; onPress: () => void; last?: boolean }) {
  return (
    <TouchableOpacity style={[styles.settingRow, !last && { borderBottomWidth: 0.5, borderBottomColor: Colors.accent }]} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.settingIcon, { backgroundColor: bg }]}><Ionicons name={icon as any} size={18} color={color} /></View>
      <Text style={styles.settingLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={Colors.textLight} />
    </TouchableOpacity>
  );
}

function NotifPref({ label, value, onToggle, last }: { label: string; value: boolean; onToggle: (v: boolean) => void; last?: boolean }) {
  return (
    <View style={[styles.settingRow, !last && { borderBottomWidth: 0.5, borderBottomColor: Colors.accent }]}>
      <Text style={[styles.settingLabel, { fontSize: FontSize.sm }]}>{label}</Text>
      <Switch value={value} onValueChange={onToggle} trackColor={{ false: Colors.accent, true: Colors.highlight }} thumbColor={Colors.textWhite} />
    </View>
  );
}

const pfStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm + 2, gap: Spacing.sm },
  border: { borderBottomWidth: 0.5, borderBottomColor: Colors.accent },
  iconWrap: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: FontSize.xs, color: Colors.textLight },
  value: { fontSize: FontSize.md, color: Colors.textWhite, fontWeight: FontWeight.medium as any, marginTop: 1 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  profileHeader: { alignItems: 'center', paddingBottom: Spacing.xl, backgroundColor: Colors.surface, marginBottom: Spacing.md, borderBottomLeftRadius: BorderRadius.xl, borderBottomRightRadius: BorderRadius.xl, overflow: 'hidden' },
  headerAccent: { width: '100%', height: 4, backgroundColor: Colors.highlight },
  avatarContainer: { marginTop: Spacing.xl },
  avatarRing: { padding: 3, borderRadius: 46, borderWidth: 2, borderColor: Colors.highlight },
  userName: { fontSize: FontSize.xl, fontWeight: FontWeight.bold as any, color: Colors.textWhite, marginTop: Spacing.md },
  userEmail: { fontSize: FontSize.md, color: Colors.textLight, marginTop: 2 },
  roleBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.md, paddingVertical: 4, borderRadius: BorderRadius.full, marginTop: Spacing.sm },
  roleText: { fontSize: FontSize.xs, fontWeight: FontWeight.bold as any, letterSpacing: 0.5, textTransform: 'uppercase' },
  quickStats: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.lg, paddingHorizontal: Spacing.xxl },
  quickStat: { flex: 1, alignItems: 'center' },
  quickStatValue: { fontSize: FontSize.lg, fontWeight: FontWeight.bold as any, color: Colors.textWhite, textTransform: 'capitalize' },
  quickStatLabel: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 2 },
  quickStatDivider: { width: 1, height: 30, backgroundColor: Colors.accent, marginHorizontal: Spacing.md },
  section: { marginHorizontal: Spacing.md, marginBottom: Spacing.md, padding: Spacing.md },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: BorderRadius.full, backgroundColor: Colors.highlightSubtle },
  editBtnCancel: { backgroundColor: Colors.errorSubtle },
  editBtnText: { color: Colors.highlight, fontSize: FontSize.sm, fontWeight: FontWeight.medium as any },
  editForm: { gap: Spacing.sm, marginTop: Spacing.sm },
  emailReadonly: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.accent, padding: Spacing.md, borderRadius: BorderRadius.md },
  readonlyLabel: { fontSize: FontSize.xs, color: Colors.textLight },
  readonlyValue: { fontSize: FontSize.md, color: Colors.textWhite, fontWeight: FontWeight.medium as any },
  fieldList: { marginTop: Spacing.xs },
  orgRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm + 2, borderBottomWidth: 0.5, borderBottomColor: Colors.accent },
  orgIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  orgName: { color: Colors.textWhite, fontSize: FontSize.md, fontWeight: FontWeight.medium as any },
  orgRole: { color: Colors.textLight, fontSize: FontSize.xs, textTransform: 'capitalize', marginTop: 1 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm + 2 },
  settingIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  settingLabel: { flex: 1, color: Colors.textWhite, fontSize: FontSize.md, fontWeight: FontWeight.medium as any },
  prefGroupTitle: { color: Colors.textLight, fontSize: FontSize.xs, fontWeight: FontWeight.bold as any, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: Spacing.sm, marginBottom: Spacing.xs },
  dangerSection: { borderWidth: 1, borderColor: Colors.errorSubtle },
  logoutRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
  logoutText: { flex: 1, color: Colors.error, fontSize: FontSize.md, fontWeight: FontWeight.semibold as any },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: Spacing.md },
  version: { color: Colors.textLight, fontSize: FontSize.xs },
});
