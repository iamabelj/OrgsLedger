// ============================================================
// OrgsLedger — Super Admin Signup Invite Management
// Create and manage invite links for user registration
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  TextInput,
  Platform,
  Share,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { showAlert } from '../../src/utils/alert';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Card, Button, Input, SectionHeader, Badge, ResponsiveScrollView, LoadingScreen } from '../../src/components/ui';

type SignupInvite = {
  id: string;
  code: string;
  email: string | null;
  role: string;
  organization_id: string | null;
  organization_name: string | null;
  organization_slug: string | null;
  max_uses: number | null;
  use_count: number;
  expires_at: string | null;
  is_active: boolean;
  note: string | null;
  creator_first_name: string | null;
  creator_last_name: string | null;
  created_at: string;
};

const ROLES = [
  { label: 'Member', value: 'member' },
  { label: 'Executive', value: 'executive' },
  { label: 'Org Admin', value: 'org_admin' },
];

export default function SignupInvitesScreen() {
  const globalRole = useAuthStore((s) => s.user?.globalRole);
  const isSuperAdmin = globalRole === 'super_admin' || globalRole === 'developer';
  const currentOrgId = useAuthStore((s) => s.currentOrgId);

  const [invites, setInvites] = useState<SignupInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [maxUses, setMaxUses] = useState('1');
  const [expiresInDays, setExpiresInDays] = useState('30');
  const [note, setNote] = useState('');
  const [attachOrg, setAttachOrg] = useState(true);
  const [creating, setCreating] = useState(false);

  // Organizations for picker
  const [orgs, setOrgs] = useState<any[]>([]);

  const loadInvites = useCallback(async () => {
    try {
      const [invRes, orgRes] = await Promise.all([
        api.subscriptions.adminSignupInvites({ limit: 200 }),
        api.subscriptions.adminOrganizations(),
      ]);
      setInvites(invRes.data.data || []);
      setOrgs(orgRes.data?.organizations || []);
    } catch (err) {
      showAlert('Error', 'Failed to load signup invites');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (isSuperAdmin) loadInvites();
    else setLoading(false);
  }, [isSuperAdmin, loadInvites]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const data: any = {
        role,
        maxUses: maxUses ? parseInt(maxUses) : 1,
        expiresInDays: expiresInDays ? parseInt(expiresInDays) : undefined,
        note: note.trim() || undefined,
      };
      if (email.trim()) {
        data.email = email.trim().toLowerCase();
      }
      if (attachOrg && currentOrgId) {
        data.organizationId = currentOrgId;
      }

      const res = await api.subscriptions.adminCreateSignupInvite(data);
      const invite = res.data.data;

      showAlert('Invite Created!', `Code: ${invite.code}\n\nInvite URL: ${invite.inviteUrl}${email.trim() ? '\n\nEmail has been sent to ' + email.trim() : ''}`);
      setShowCreate(false);
      resetForm();
      loadInvites();
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to create invite');
    } finally {
      setCreating(false);
    }
  };

  const handleDeactivate = (invite: SignupInvite) => {
    showAlert('Deactivate Invite', `Are you sure you want to deactivate invite code ${invite.code}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Deactivate',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.subscriptions.adminDeleteSignupInvite(invite.id);
            showAlert('Done', 'Invite deactivated');
            loadInvites();
          } catch (err: any) {
            showAlert('Error', err.response?.data?.error || 'Failed');
          }
        },
      },
    ]);
  };

  const handleShare = async (invite: SignupInvite) => {
    const baseUrl = Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.origin
      : 'https://app.orgsledger.com';
    const url = `${baseUrl}/register?invite=${invite.code}`;

    if (Platform.OS === 'web') {
      try {
        await navigator.clipboard.writeText(url);
        showAlert('Copied', 'Invite URL copied to clipboard');
      } catch {
        showAlert('Invite URL', url);
      }
    } else {
      Share.share({
        message: `You're invited to join OrgsLedger! Create your account here: ${url}`,
      });
    }
  };

  const resetForm = () => {
    setEmail('');
    setRole('member');
    setMaxUses('1');
    setExpiresInDays('30');
    setNote('');
    setAttachOrg(true);
  };

  if (!isSuperAdmin) {
    return (
      <View style={styles.denied}>
        <Ionicons name="lock-closed" size={48} color={Colors.textLight} />
        <Text style={styles.deniedTitle}>Access Restricted</Text>
        <Text style={styles.deniedSub}>This feature is for super administrators only.</Text>
      </View>
    );
  }

  if (loading) return <LoadingScreen />;

  const activeInvites = invites.filter((i) => i.is_active);
  const inactiveInvites = invites.filter((i) => !i.is_active);
  const totalUses = invites.reduce((sum, i) => sum + i.use_count, 0);

  return (
    <>
      <Stack.Screen options={{ title: 'Signup Invites' }} />
      <ResponsiveScrollView
        style={styles.container}
        refreshing={refreshing}
        onRefresh={() => { setRefreshing(true); loadInvites(); }}
      >
        {/* Stats Banner */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{activeInvites.length}</Text>
            <Text style={styles.statLabel}>Active</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{totalUses}</Text>
            <Text style={styles.statLabel}>Total Signups</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{invites.length}</Text>
            <Text style={styles.statLabel}>All Invites</Text>
          </View>
        </View>

        {/* Create Button */}
        <View style={styles.headerRow}>
          <SectionHeader title="Signup Invite Links" />
          <TouchableOpacity style={styles.createBtn} onPress={() => setShowCreate(true)}>
            <Ionicons name="add" size={18} color={Colors.primary} />
            <Text style={styles.createBtnText}>New Invite</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.infoText}>
          Send invite links to people you want to grant access to OrgsLedger. Only users with a valid invite code can create an account.
        </Text>

        {/* Active Invites */}
        {activeInvites.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="mail-outline" size={48} color={Colors.textLight} />
            <Text style={styles.emptyTitle}>No Active Invites</Text>
            <Text style={styles.emptySub}>Create an invite to start onboarding users.</Text>
          </View>
        ) : (
          activeInvites.map((inv) => (
            <InviteCard
              key={inv.id}
              invite={inv}
              onShare={() => handleShare(inv)}
              onDeactivate={() => handleDeactivate(inv)}
            />
          ))
        )}

        {/* Inactive / Used Invites */}
        {inactiveInvites.length > 0 && (
          <>
            <SectionHeader title={`Inactive (${inactiveInvites.length})`} style={{ marginTop: Spacing.lg }} />
            {inactiveInvites.map((inv) => (
              <InviteCard key={inv.id} invite={inv} inactive />
            ))}
          </>
        )}

        <View style={{ height: 40 }} />
      </ResponsiveScrollView>

      {/* Create Modal */}
      <Modal visible={showCreate} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Signup Invite</Text>
              <TouchableOpacity onPress={() => { setShowCreate(false); resetForm(); }}>
                <Ionicons name="close" size={24} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Input
                label="EMAIL (OPTIONAL)"
                placeholder="Specific email or leave blank for anyone"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                icon="mail-outline"
              />

              {/* Role Picker */}
              <Text style={styles.fieldLabel}>ROLE ON SIGNUP</Text>
              <View style={styles.roleRow}>
                {ROLES.map((r) => (
                  <TouchableOpacity
                    key={r.value}
                    style={[styles.roleChip, role === r.value && styles.roleChipActive]}
                    onPress={() => setRole(r.value)}
                  >
                    <Text style={[styles.roleChipText, role === r.value && styles.roleChipTextActive]}>
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.rowFields}>
                <View style={{ flex: 1 }}>
                  <Input
                    label="MAX USES (1 = single-use)"
                    placeholder="1"
                    value={maxUses}
                    onChangeText={setMaxUses}
                    keyboardType="numeric"
                    icon="repeat-outline"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Input
                    label="EXPIRES IN (DAYS)"
                    placeholder="30"
                    value={expiresInDays}
                    onChangeText={setExpiresInDays}
                    keyboardType="numeric"
                    icon="time-outline"
                  />
                </View>
              </View>

              {/* Attach to current org toggle */}
              <TouchableOpacity
                style={styles.toggleRow}
                onPress={() => setAttachOrg(!attachOrg)}
              >
                <Ionicons
                  name={attachOrg ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={attachOrg ? Colors.highlight : Colors.textLight}
                />
                <Text style={styles.toggleLabel}>
                  Auto-join current organization on signup
                </Text>
              </TouchableOpacity>

              <Input
                label="NOTE (OPTIONAL)"
                placeholder="Internal note about this invite"
                value={note}
                onChangeText={setNote}
                icon="create-outline"
              />

              <Button
                title={creating ? 'Creating...' : 'Create & Send Invite'}
                onPress={handleCreate}
                disabled={creating}
                variant="primary"
                fullWidth
                icon="send-outline"
                style={{ marginTop: Spacing.md }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

function InviteCard({
  invite,
  onShare,
  onDeactivate,
  inactive,
}: {
  invite: SignupInvite;
  onShare?: () => void;
  onDeactivate?: () => void;
  inactive?: boolean;
}) {
  const isExpired = invite.expires_at && new Date(invite.expires_at) < new Date();
  const isUsedUp = !!(invite.max_uses && invite.use_count >= invite.max_uses);

  return (
    <View style={[styles.card, (inactive || isExpired || isUsedUp) && styles.cardInactive]}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.codeText}>{invite.code}</Text>
          {invite.email && (
            <View style={styles.emailRow}>
              <Ionicons name="mail" size={12} color={Colors.info} />
              <Text style={styles.emailText}>{invite.email}</Text>
            </View>
          )}
          {invite.organization_name && (
            <View style={styles.emailRow}>
              <Ionicons name="business" size={12} color={Colors.highlight} />
              <Text style={styles.emailText}>{invite.organization_name}</Text>
            </View>
          )}
        </View>
        <View style={styles.cardBadges}>
          <Badge
            label={invite.role.replace('_', ' ')}
            variant={invite.role === 'org_admin' ? 'gold' : invite.role === 'executive' ? 'info' : 'neutral'}
            size="sm"
          />
          <Badge
            label={isExpired ? 'Expired' : isUsedUp ? 'Used Up' : invite.is_active ? 'Active' : 'Inactive'}
            variant={isExpired || isUsedUp || !invite.is_active ? 'danger' : 'success'}
            size="sm"
          />
        </View>
      </View>

      <View style={styles.cardMeta}>
        <Text style={styles.metaText}>
          Used: {invite.use_count}{invite.max_uses ? `/${invite.max_uses}` : ' times'}
        </Text>
        {invite.expires_at && (
          <Text style={styles.metaText}>
            Expires: {new Date(invite.expires_at).toLocaleDateString()}
          </Text>
        )}
        {invite.note && (
          <Text style={styles.noteText}>{invite.note}</Text>
        )}
        <Text style={styles.metaText}>
          Created: {new Date(invite.created_at).toLocaleDateString()}
          {invite.creator_first_name && ` by ${invite.creator_first_name} ${invite.creator_last_name || ''}`}
        </Text>
      </View>

      {!inactive && invite.is_active && !isExpired && !isUsedUp && (
        <View style={styles.cardActions}>
          <TouchableOpacity style={styles.actionBtn} onPress={onShare}>
            <Ionicons name="share-outline" size={14} color={Colors.highlight} />
            <Text style={styles.actionText}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.actionBtnDanger]} onPress={onDeactivate}>
            <Ionicons name="close-circle-outline" size={14} color={Colors.error} />
            <Text style={[styles.actionText, { color: Colors.error }]}>Deactivate</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  denied: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background, gap: Spacing.md, padding: Spacing.xl },
  deniedTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold as any, color: Colors.textPrimary },
  deniedSub: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center' },

  // Stats Banner
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', backgroundColor: Colors.surface, marginHorizontal: Spacing.md, marginTop: Spacing.md, borderRadius: BorderRadius.lg, paddingVertical: Spacing.lg, borderWidth: 1, borderColor: Colors.borderLight },
  statBox: { alignItems: 'center', gap: 4 },
  statValue: { fontSize: FontSize.xxl, fontWeight: FontWeight.extrabold as any, color: Colors.highlight },
  statLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  statDivider: { width: 1, height: 32, backgroundColor: Colors.borderLight },

  // Header
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.md, marginTop: Spacing.lg },
  createBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.highlight, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md },
  createBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold as any, color: Colors.primary },
  infoText: { fontSize: FontSize.sm, color: Colors.textSecondary, paddingHorizontal: Spacing.md, marginBottom: Spacing.md, lineHeight: 20 },

  // Empty
  emptyState: { alignItems: 'center', paddingVertical: Spacing.xxl, gap: Spacing.sm },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold as any, color: Colors.textSecondary },
  emptySub: { fontSize: FontSize.sm, color: Colors.textLight },

  // Invite Card
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.md, marginHorizontal: Spacing.md, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.borderLight },
  cardInactive: { opacity: 0.55 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  codeText: { fontSize: FontSize.lg, fontWeight: FontWeight.bold as any, color: Colors.highlight, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', letterSpacing: 2 },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  emailText: { fontSize: FontSize.xs, color: Colors.textSecondary },
  cardBadges: { flexDirection: 'column', alignItems: 'flex-end', gap: 4 },
  cardMeta: { marginTop: Spacing.sm, gap: 2 },
  metaText: { fontSize: FontSize.xs, color: Colors.textLight },
  noteText: { fontSize: FontSize.xs, color: Colors.textSecondary, fontStyle: 'italic', marginTop: 2 },
  cardActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: Spacing.sm },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.highlight },
  actionBtnDanger: { borderColor: Colors.error },
  actionText: { fontSize: FontSize.xs, color: Colors.highlight, fontWeight: FontWeight.medium as any },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: Spacing.md },
  modalContent: { backgroundColor: Colors.surface, borderRadius: BorderRadius.xl, width: '100%', maxWidth: 500, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  modalTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold as any, color: Colors.textPrimary },
  modalBody: { padding: Spacing.lg, gap: Spacing.xs },

  // Form
  fieldLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold as any, color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  roleRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  roleChip: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.full, borderWidth: 1, borderColor: Colors.borderLight },
  roleChipActive: { backgroundColor: Colors.highlight + '20', borderColor: Colors.highlight },
  roleChipText: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: FontWeight.medium as any },
  roleChipTextActive: { color: Colors.highlight },
  rowFields: { flexDirection: 'row', gap: Spacing.sm },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginVertical: Spacing.xs },
  toggleLabel: { fontSize: FontSize.sm, color: Colors.textPrimary, flex: 1 },
});
