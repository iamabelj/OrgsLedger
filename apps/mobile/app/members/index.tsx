// ============================================================
// OrgsLedger Mobile — Member Directory Screen
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Alert,
  Platform,
  ActivityIndicator,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { showAlert } from '../../src/utils/alert';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Card, Input, LoadingScreen } from '../../src/components/ui';
import { useResponsive } from '../../src/hooks/useResponsive';

const ROLE_BADGES: Record<string, { label: string; color: string }> = {
  org_admin: { label: 'Admin', color: '#EF4444' },
  executive: { label: 'Executive', color: '#8B5CF6' },
  treasurer: { label: 'Treasurer', color: '#10B981' },
  secretary: { label: 'Secretary', color: '#3B82F6' },
  member: { label: 'Member', color: Colors.textLight },
};

const INVITE_ROLES = [
  { value: 'member', label: 'Member' },
  { value: 'executive', label: 'Executive' },
  { value: 'org_admin', label: 'Admin' },
];

export default function MemberDirectoryScreen() {
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Invite state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [invites, setInvites] = useState<any[]>([]);
  const [inviteRole, setInviteRole] = useState('member');
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const userRole = useAuthStore((s) => s.user?.globalRole);
  const memberRole = useAuthStore((s) => {
    const m = s.memberships.find((m) => m.organization_id === s.currentOrgId);
    return m?.role;
  });
  const responsive = useResponsive();

  const canInvite = userRole === 'super_admin' || userRole === 'developer' || memberRole === 'org_admin' || memberRole === 'executive';

  const loadMembers = useCallback(async () => {
    if (!currentOrgId) return;
    setError(null);
    try {
      const res = await api.orgs.listMembers(currentOrgId);
      setMembers(res.data.data || []);
    } catch (err) {
      setError('Failed to load members');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentOrgId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  if (loading && !refreshing) return <LoadingScreen />;

  const loadInvites = async () => {
    if (!currentOrgId) return;
    setLoadingInvites(true);
    try {
      const res = await api.subscriptions.getInvites(currentOrgId);
      setInvites(res.data.data || []);
    } catch (err) {
      showAlert('Error', 'Failed to load invites');
    } finally {
      setLoadingInvites(false);
    }
  };

  const handleCreateInvite = async () => {
    if (!currentOrgId) return;
    setCreatingInvite(true);
    try {
      await api.subscriptions.createInvite(currentOrgId, { role: inviteRole, maxUses: 50 });
      await loadInvites();
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Failed to create invite';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('Error', msg);
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleDeleteInvite = async (inviteId: string) => {
    if (!currentOrgId) return;
    showAlert('Delete Invite', 'This invite link will be permanently deleted. Continue?', [
      { text: 'Cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.subscriptions.deleteInvite(currentOrgId, inviteId);
            setInvites((prev) => prev.filter((i) => i.id !== inviteId));
          } catch (err: any) {
            const msg = err?.response?.data?.error || 'Failed to delete invite';
            showAlert('Error', msg);
          }
        },
      },
    ]);
  };

  const getInviteUrl = (code: string) => `https://app.orgsledger.com/invite/${code}`;

  const handleCopyLink = async (invite: any) => {
    const url = getInviteUrl(invite.code);
    try {
      if (Platform.OS === 'web' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      } else if (Platform.OS !== 'web') {
        // Native: use Share as fallback
        await Share.share({ message: url });
        return;
      }
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback: try Share
      handleShareLink(invite);
    }
  };

  const handleShareLink = async (invite: any) => {
    const url = getInviteUrl(invite.code);
    try {
      if (Platform.OS === 'web') {
        if (navigator.share) {
          await navigator.share({ title: 'Join our organization', text: `Join via this invite link: ${url}`, url });
        } else {
          await navigator.clipboard.writeText(url);
          setCopiedId(invite.id);
          setTimeout(() => setCopiedId(null), 2000);
        }
      } else {
        await Share.share({ message: `Join our organization on OrgsLedger: ${url}` });
      }
    } catch {}
  };

  const openInviteModal = () => {
    setShowInviteModal(true);
    loadInvites();
  };

  const filtered = members.filter((m: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      m.first_name?.toLowerCase().includes(q) ||
      m.last_name?.toLowerCase().includes(q) ||
      m.email?.toLowerCase().includes(q) ||
      m.role?.toLowerCase().includes(q)
    );
  });

  const renderMember = ({ item }: { item: any }) => {
    const roleCfg = ROLE_BADGES[item.role] || ROLE_BADGES.member;
    const initials = `${(item.first_name || '?')[0]}${(item.last_name || '?')[0]}`.toUpperCase();

    return (
      <Card style={styles.memberCard}>
        <View style={styles.memberRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.memberInfo}>
            <Text style={styles.memberName}>{item.first_name} {item.last_name}</Text>
            <Text style={styles.memberEmail}>{item.email}</Text>
            {item.phone && (
              <View style={styles.contactRow}>
                <Ionicons name="call-outline" size={12} color={Colors.textLight} />
                <Text style={styles.memberPhone}>{item.phone}</Text>
              </View>
            )}
          </View>
          <View style={[styles.roleBadge, { backgroundColor: roleCfg.color + '15' }]}>
            <Text style={[styles.roleText, { color: roleCfg.color }]}>{roleCfg.label}</Text>
          </View>
        </View>
      </Card>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' }]}>
        <View>
          <Text style={styles.screenTitle}>Members</Text>
          <Text style={styles.count}>{filtered.length} member{filtered.length !== 1 ? 's' : ''}</Text>
        </View>
        {canInvite && (
          <TouchableOpacity style={styles.inviteBtn} onPress={openInviteModal} activeOpacity={0.8}>
            <Ionicons name="person-add" size={18} color="#FFF" />
            <Text style={styles.inviteBtnText}>Invite</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={[styles.searchRow, { maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' }]}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color={Colors.textLight} />
          <Input
            placeholder="Search members..."
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
          />
        </View>
      </View>

      <FlatList
        data={filtered}
        renderItem={renderMember}
        keyExtractor={(item) => item.user_id || item.id}
        contentContainerStyle={[styles.list, { maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadMembers(); }} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={48} color={Colors.textLight} />
            <Text style={styles.emptyText}>No members found</Text>
          </View>
        }
      />

      {/* ═══════════════════════════════════════════════════ */}
      {/* INVITE MEMBERS MODAL                               */}
      {/* ═══════════════════════════════════════════════════ */}
      <Modal
        visible={showInviteModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowInviteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Invite Members</Text>
              <TouchableOpacity onPress={() => setShowInviteModal(false)}>
                <Ionicons name="close" size={24} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Create new invite */}
            <Text style={styles.sectionLabel}>Create New Invite Link</Text>
            <Text style={styles.helperText}>
              Generate a shareable link that lets people join your organization.
            </Text>

            <Text style={styles.fieldLabel}>Role for new members</Text>
            <View style={styles.roleRow}>
              {INVITE_ROLES.map((r) => {
                const isActive = inviteRole === r.value;
                return (
                  <TouchableOpacity
                    key={r.value}
                    style={[styles.roleChip, isActive && styles.roleChipActive]}
                    onPress={() => setInviteRole(r.value)}
                  >
                    <Text style={[styles.roleChipText, isActive && styles.roleChipTextActive]}>{r.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={[styles.generateBtn, creatingInvite && { opacity: 0.6 }]}
              onPress={handleCreateInvite}
              disabled={creatingInvite}
            >
              {creatingInvite ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="link" size={18} color="#FFF" />
                  <Text style={styles.generateBtnText}>Generate Invite Link</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Existing invites */}
            {loadingInvites ? (
              <ActivityIndicator style={{ marginTop: Spacing.md }} color={Colors.highlight} />
            ) : invites.length > 0 ? (
              <>
                <Text style={[styles.sectionLabel, { marginTop: Spacing.lg }]}>Active Invite Links</Text>
                {invites.filter((i) => i.is_active).map((invite) => (
                  <View key={invite.id} style={styles.inviteRow}>
                    <View style={styles.inviteInfo}>
                      <Text style={styles.inviteCode}>{invite.code}</Text>
                      <Text style={styles.inviteMeta}>
                        Role: {invite.role} • Used: {invite.use_count || 0}/{invite.max_uses || '∞'}
                      </Text>
                    </View>
                    <View style={styles.inviteActions}>
                      <TouchableOpacity
                        style={styles.iconBtn}
                        onPress={() => handleCopyLink(invite)}
                      >
                        <Ionicons
                          name={copiedId === invite.id ? 'checkmark-circle' : 'copy-outline'}
                          size={20}
                          color={copiedId === invite.id ? Colors.success : Colors.primary}
                        />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.iconBtn}
                        onPress={() => handleShareLink(invite)}
                      >
                        <Ionicons name="share-outline" size={20} color={Colors.primary} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.iconBtn}
                        onPress={() => handleDeleteInvite(invite.id)}
                      >
                        <Ionicons name="trash-outline" size={20} color={Colors.error} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </>
            ) : null}

            <TouchableOpacity
              style={styles.closeModalBtn}
              onPress={() => setShowInviteModal(false)}
            >
              <Text style={styles.closeModalBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.md, paddingTop: Spacing.lg },
  screenTitle: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold as any, color: Colors.textPrimary },
  count: { fontSize: FontSize.sm, color: Colors.textLight, marginTop: 2 },
  inviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: BorderRadius.md,
  },
  inviteBtnText: { color: '#FFF', fontWeight: FontWeight.semibold as any, fontSize: FontSize.sm },
  searchRow: { paddingHorizontal: Spacing.md, marginBottom: Spacing.sm },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  searchInput: { flex: 1, borderWidth: 0, marginBottom: 0 },
  list: { padding: Spacing.md, paddingTop: 0 },
  memberCard: { marginBottom: Spacing.sm },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.primary + '20', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: FontSize.md, fontWeight: FontWeight.bold as any, color: Colors.primary },
  memberInfo: { flex: 1 },
  memberName: { fontSize: FontSize.md, fontWeight: FontWeight.semibold as any, color: Colors.textPrimary },
  memberEmail: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 1 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  memberPhone: { fontSize: FontSize.xs, color: Colors.textLight },
  roleBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: BorderRadius.sm },
  roleText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold as any },
  empty: { alignItems: 'center', padding: Spacing.xxl },
  emptyText: { fontSize: FontSize.md, color: Colors.textLight, marginTop: Spacing.md },

  // ── Invite Modal ───────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
  },
  modalContent: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '85%',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    ...Shadow.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  modalTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold as any,
    color: Colors.textPrimary,
  },
  sectionLabel: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold as any,
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  helperText: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
    marginBottom: Spacing.sm,
  },
  fieldLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  roleRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  roleChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  roleChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  roleChipText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  roleChipTextActive: {
    color: '#FFF',
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 12,
    borderRadius: BorderRadius.md,
  },
  generateBtnText: {
    color: '#FFF',
    fontWeight: FontWeight.semibold as any,
    fontSize: FontSize.md,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    marginTop: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  inviteInfo: {
    flex: 1,
  },
  inviteCode: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold as any,
    color: Colors.highlight,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  inviteMeta: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    marginTop: 2,
  },
  inviteActions: {
    flexDirection: 'row',
    gap: 4,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  closeModalBtn: {
    marginTop: Spacing.lg,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  closeModalBtnText: {
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium as any,
  },
});
