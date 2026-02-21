// ============================================================
// OrgsLedger Mobile — Member Management Screen (Admin)
// ============================================================
// Premium redesign with invite link management, responsive
// layout, and industry-standard UI/UX.

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActionSheetIOS,
  Platform,
  ActivityIndicator,
  Modal,
  TextInput,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Card, Badge, Avatar, SearchBar, EmptyState, SectionHeader, PoweredByFooter } from '../../src/components/ui';
import { useResponsive } from '../../src/hooks/useResponsive';
import { showAlert } from '../../src/utils/alert';

const ASSIGNABLE_ROLES = ['member', 'executive', 'org_admin'] as const;
const ROLE_LABELS: Record<string, string> = {
  member: 'Member',
  executive: 'Executive',
  org_admin: 'Admin',
  super_admin: 'Super Admin',
  developer: 'Developer',
};
const ROLE_COLORS: Record<string, 'neutral' | 'info' | 'gold' | 'danger'> = {
  member: 'neutral',
  executive: 'info',
  org_admin: 'gold',
  super_admin: 'danger',
  developer: 'danger',
};

const INVITE_ROLES = [
  { label: 'Member', value: 'member' },
  { label: 'Executive', value: 'executive' },
  { label: 'Admin', value: 'org_admin' },
];

interface Member {
  id: string;
  user_id: string;
  role: string;
  status: string;
  first_name: string;
  last_name: string;
  email: string;
  joined_at: string;
  avatar_url?: string;
}

export default function MembersScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const userId = useAuthStore((s) => s.user?.id);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState<string>('member');
  const [addLoading, setAddLoading] = useState(false);
  const responsive = useResponsive();

  // ── Invite Link State ─────────────────────────────────
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [invites, setInvites] = useState<any[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [inviteRole, setInviteRole] = useState('member');
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // ── Active Tab ────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'members' | 'invites'>('members');

  const loadMembers = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const res = await api.orgs.listMembers(currentOrgId);
      setMembers(res.data.data || []);
    } catch (err) {
      console.warn('Failed to load members:', err);
    }
  }, [currentOrgId]);

  useEffect(() => {
    setLoading(true);
    loadMembers().finally(() => setLoading(false));
  }, [loadMembers]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadMembers();
    if (activeTab === 'invites') await loadInvites();
    setRefreshing(false);
  };

  // ── Invite Functions ──────────────────────────────────
  const loadInvites = async () => {
    if (!currentOrgId) return;
    setLoadingInvites(true);
    try {
      const res = await api.subscriptions.getInvites(currentOrgId);
      setInvites(res.data.data || []);
    } catch {
      showAlert('Error', 'Failed to load invites');
    } finally {
      setLoadingInvites(false);
    }
  };

  const handleCreateInvite = async () => {
    if (!currentOrgId) return;
    setCreatingInvite(true);
    try {
      await api.subscriptions.createInvite(currentOrgId, { role: inviteRole, maxUses: 1 });
      await loadInvites();
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Failed to create invite';
      showAlert('Error', msg);
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleDeleteInvite = async (inviteId: string) => {
    if (!currentOrgId) return;
    try {
      await api.subscriptions.deleteInvite(currentOrgId, inviteId);
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    } catch (err: any) {
      showAlert('Error', err?.response?.data?.error || 'Failed to delete invite');
    }
  };

  const getInviteUrl = (code: string) => `https://app.orgsledger.com/invite/${code}`;

  const handleCopyLink = async (invite: any) => {
    const url = getInviteUrl(invite.code);
    try {
      if (Platform.OS === 'web' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      } else if (Platform.OS !== 'web') {
        await Share.share({ message: url });
        return;
      }
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      handleShareLink(invite);
    }
  };

  const handleShareLink = async (invite: any) => {
    const url = getInviteUrl(invite.code);
    try {
      if (Platform.OS === 'web' && navigator.share) {
        await navigator.share({ title: 'Join our organization', text: `Join via this invite link: ${url}`, url });
      } else if (Platform.OS !== 'web') {
        await Share.share({ message: `Join our organization on OrgsLedger: ${url}` });
      } else {
        await navigator.clipboard.writeText(url);
        setCopiedId(invite.id);
        setTimeout(() => setCopiedId(null), 2000);
      }
    } catch {}
  };

  const filtered = members.filter((m) => {
    const q = search.toLowerCase();
    return (
      m.first_name?.toLowerCase().includes(q) ||
      m.last_name?.toLowerCase().includes(q) ||
      m.email?.toLowerCase().includes(q)
    );
  });

  const handleChangeRole = (member: Member) => {
    if (member.user_id === userId) {
      showAlert('Error', 'You cannot change your own role.');
      return;
    }
    const options = ASSIGNABLE_ROLES.map((r) => ROLE_LABELS[r]);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: `Change role for ${member.first_name} ${member.last_name}`,
          options: ['Cancel', ...options],
          cancelButtonIndex: 0,
        },
        async (idx) => {
          if (idx > 0) await updateRole(member.user_id, ASSIGNABLE_ROLES[idx - 1]);
        },
      );
    } else {
      showAlert('Change Role', `Select new role for ${member.first_name} ${member.last_name}`, [
        ...ASSIGNABLE_ROLES.map((r) => ({
          text: `${ROLE_LABELS[r]}${r === member.role ? ' (current)' : ''}`,
          onPress: () => updateRole(member.user_id, r),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  };

  const updateRole = async (memberId: string, role: string) => {
    if (!currentOrgId) return;
    setActionLoading(memberId);
    try {
      await api.orgs.updateMember(currentOrgId, memberId, { role });
      await loadMembers();
      showAlert('Success', 'Role updated successfully');
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to update role');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveMember = (member: Member) => {
    if (member.user_id === userId) {
      showAlert('Error', 'You cannot remove yourself.');
      return;
    }
    showAlert('Remove Member', `Remove ${member.first_name} ${member.last_name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          if (!currentOrgId) return;
          setActionLoading(member.user_id);
          try {
            await api.orgs.removeMember(currentOrgId, member.user_id);
            await loadMembers();
          } catch (err: any) {
            showAlert('Error', err.response?.data?.error || 'Failed to remove member');
          } finally {
            setActionLoading(null);
          }
        },
      },
    ]);
  };

  const handleMessage = async (member: Member) => {
    if (!currentOrgId) return;
    setActionLoading(member.user_id);
    try {
      const res = await api.chat.getOrCreateDM(currentOrgId, member.user_id);
      const channelId = res.data?.data?.id;
      if (channelId) {
        router.push(`/chat/${channelId}`);
      } else {
        showAlert('Error', 'Could not create or find DM channel');
      }
    } catch (err: any) {
      console.error('DM creation error:', err?.response?.data || err);
      showAlert('Error', err.response?.data?.error || 'Failed to start conversation');
    } finally {
      setActionLoading(null);
    }
  };

  const renderMember = ({ item }: { item: Member }) => {
    const isCurrentUser = item.user_id === userId;
    const isLoading = actionLoading === item.user_id;
    const fullName = `${item.first_name || ''} ${item.last_name || ''}`.trim() || 'Unknown';

    return (
      <Card style={styles.memberCard}>
        <View style={styles.memberRow}>
          <Avatar name={fullName} size={44} color={isCurrentUser ? Colors.highlight : Colors.primaryMid} imageUrl={item.avatar_url} />
          <View style={styles.memberInfo}>
            <View style={styles.memberNameRow}>
              <Text style={styles.memberName}>{fullName}</Text>
              {isCurrentUser && <Text style={styles.youBadge}>You</Text>}
            </View>
            <Text style={styles.memberEmail}>{item.email}</Text>
            <View style={styles.memberMeta}>
              <Badge label={ROLE_LABELS[item.role] || item.role} variant={ROLE_COLORS[item.role] || 'neutral'} />
              <Text style={styles.joinDate}>
                Joined {new Date(item.joined_at).toLocaleDateString()}
              </Text>
            </View>
          </View>
        </View>

        {!isCurrentUser && (
          <View style={styles.memberActions}>
            {isLoading ? (
              <ActivityIndicator size="small" color={Colors.highlight} />
            ) : (
              <>
                <TouchableOpacity style={styles.actionBtn} onPress={() => handleMessage(item)}>
                  <Ionicons name="chatbubble-outline" size={14} color={Colors.success} />
                  <Text style={[styles.actionText, { color: Colors.success }]}>Message</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => handleChangeRole(item)}>
                  <Ionicons name="shield-outline" size={14} color={Colors.highlight} />
                  <Text style={styles.actionText}>Role</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, styles.dangerAction]} onPress={() => handleRemoveMember(item)}>
                  <Ionicons name="person-remove-outline" size={14} color={Colors.danger} />
                  <Text style={[styles.actionText, { color: Colors.danger }]}>Remove</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </Card>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Members' }} />
        <ActivityIndicator size="large" color={Colors.highlight} />
      </View>
    );
  }

  const adminCount = members.filter((m) => ['org_admin', 'super_admin'].includes(m.role)).length;
  const execCount = members.filter((m) => m.role === 'executive').length;
  const memberCount = members.filter((m) => m.role === 'member').length;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Members' }} />

      {/* ── Stats Strip ──────────────────────────────── */}
      <View style={styles.statsStrip}>
        {[
          { value: members.length, label: 'Total', color: Colors.highlight },
          { value: adminCount, label: 'Admins', color: Colors.warning },
          { value: execCount, label: 'Executives', color: Colors.info },
          { value: memberCount, label: 'Members', color: Colors.success },
        ].map((stat) => (
          <View style={styles.statItem} key={stat.label}>
            <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
            <Text style={styles.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {/* ── Tab Switcher ─────────────────────────────── */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'members' && styles.tabActive]}
          onPress={() => setActiveTab('members')}
        >
          <Ionicons name="people" size={16} color={activeTab === 'members' ? Colors.highlight : Colors.textLight} />
          <Text style={[styles.tabText, activeTab === 'members' && styles.tabTextActive]}>Members</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'invites' && styles.tabActive]}
          onPress={() => { setActiveTab('invites'); loadInvites(); }}
        >
          <Ionicons name="link" size={16} color={activeTab === 'invites' ? Colors.highlight : Colors.textLight} />
          <Text style={[styles.tabText, activeTab === 'invites' && styles.tabTextActive]}>Invite Links</Text>
        </TouchableOpacity>
      </View>

      {/* ── Members Tab ──────────────────────────────── */}
      {activeTab === 'members' && (
        <>
          <SearchBar
            value={search}
            onChangeText={setSearch}
            placeholder="Search members..."
            style={{ marginHorizontal: Spacing.md, marginBottom: Spacing.sm }}
          />

          <FlatList
            data={filtered}
            keyExtractor={(item) => item.user_id || item.id}
            renderItem={renderMember}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.highlight} />}
            contentContainerStyle={{ paddingHorizontal: Spacing.md, paddingBottom: Spacing.xxl * 2 }}
            ListEmptyComponent={
              <EmptyState
                icon="people-outline"
                title="No members found"
                subtitle={search ? 'Try a different search term' : 'No members yet'}
              />
            }
            ListFooterComponent={<PoweredByFooter />}
          />

          {/* Add Member FAB */}
          <TouchableOpacity style={styles.fab} onPress={() => setShowAddModal(true)} activeOpacity={0.8}>
            <Ionicons name="person-add" size={22} color="#FFF" />
          </TouchableOpacity>
        </>
      )}

      {/* ── Invites Tab ──────────────────────────────── */}
      {activeTab === 'invites' && (
        <FlatList
          data={[{ type: 'create' }, ...invites.filter(i => i.is_active).map(i => ({ type: 'invite', ...i }))] as any[]}
          keyExtractor={(item, idx) => item.id || `create-${idx}`}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.highlight} />}
          contentContainerStyle={{ paddingHorizontal: Spacing.md, paddingBottom: Spacing.xxl * 2 }}
          renderItem={({ item }) => {
            if (item.type === 'create') {
              return (
                <Card style={styles.inviteCreateCard}>
                  <View style={styles.inviteCreateHeader}>
                    <View style={styles.inviteCreateIcon}>
                      <Ionicons name="link" size={20} color={Colors.highlight} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.inviteCreateTitle}>Generate Invite Link</Text>
                      <Text style={styles.inviteCreateSubtitle}>Create a shareable link to invite new members</Text>
                    </View>
                  </View>

                  <Text style={styles.inviteFieldLabel}>Role for new member</Text>
                  <View style={styles.inviteRoleRow}>
                    {INVITE_ROLES.map((r) => {
                      const isActive = inviteRole === r.value;
                      return (
                        <TouchableOpacity
                          key={r.value}
                          style={[styles.inviteRoleChip, isActive && styles.inviteRoleChipActive]}
                          onPress={() => setInviteRole(r.value)}
                        >
                          <Text style={[styles.inviteRoleText, isActive && styles.inviteRoleTextActive]}>{r.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <TouchableOpacity
                    style={[styles.generateBtn, creatingInvite && { opacity: 0.6 }]}
                    onPress={handleCreateInvite}
                    disabled={creatingInvite}
                    activeOpacity={0.8}
                  >
                    {creatingInvite ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <>
                        <Ionicons name="add-circle" size={18} color="#FFF" />
                        <Text style={styles.generateBtnText}>Generate Link</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </Card>
              );
            }

            // Invite item
            return (
              <Card style={styles.inviteCard}>
                <View style={styles.inviteRow}>
                  <View style={styles.inviteIconWrap}>
                    <Ionicons name="link" size={18} color={Colors.highlight} />
                  </View>
                  <View style={styles.inviteInfo}>
                    <Text style={styles.inviteCode}>{item.code}</Text>
                    <Text style={styles.inviteMeta}>
                      Role: {ROLE_LABELS[item.role] || item.role} {' · '} Used: {item.use_count || 0}/{item.max_uses || '∞'}
                    </Text>
                  </View>
                </View>
                <View style={styles.inviteActions}>
                  <TouchableOpacity style={styles.inviteActionBtn} onPress={() => handleCopyLink(item)}>
                    <Ionicons
                      name={copiedId === item.id ? 'checkmark-circle' : 'copy-outline'}
                      size={18}
                      color={copiedId === item.id ? Colors.success : Colors.highlight}
                    />
                    <Text style={[styles.inviteActionText, copiedId === item.id && { color: Colors.success }]}>
                      {copiedId === item.id ? 'Copied!' : 'Copy'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.inviteActionBtn} onPress={() => handleShareLink(item)}>
                    <Ionicons name="share-outline" size={18} color={Colors.info} />
                    <Text style={[styles.inviteActionText, { color: Colors.info }]}>Share</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.inviteActionBtn, styles.inviteDeleteBtn]} onPress={() => handleDeleteInvite(item.id)}>
                    <Ionicons name="trash-outline" size={18} color={Colors.error} />
                  </TouchableOpacity>
                </View>
              </Card>
            );
          }}
          ListEmptyComponent={
            loadingInvites ? (
              <ActivityIndicator style={{ marginTop: Spacing.xl }} color={Colors.highlight} />
            ) : null
          }
        />
      )}

      {/* ── Add Member Modal ─────────────────────────── */}
      <Modal visible={showAddModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Member</Text>
              <TouchableOpacity onPress={() => { setShowAddModal(false); setAddEmail(''); setAddRole('member'); }}>
                <Ionicons name="close" size={22} color={Colors.textLight} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalHint}>Enter the email of a registered user to add them directly.</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Email address"
              placeholderTextColor={Colors.textLight}
              value={addEmail}
              onChangeText={setAddEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.modalFieldLabel}>Role</Text>
            <View style={styles.modalRoleRow}>
              {ASSIGNABLE_ROLES.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[styles.roleChip, addRole === r && styles.roleChipActive]}
                  onPress={() => setAddRole(r)}
                >
                  <Text style={[styles.roleChipText, addRole === r && styles.roleChipTextActive]}>
                    {ROLE_LABELS[r]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.addBtn, addLoading && { opacity: 0.6 }]}
              disabled={addLoading}
              onPress={async () => {
                if (!addEmail.trim()) { showAlert('Error', 'Please enter an email'); return; }
                if (!currentOrgId) return;
                setAddLoading(true);
                try {
                  await api.orgs.addMember(currentOrgId, { email: addEmail.trim().toLowerCase(), role: addRole });
                  showAlert('Success', 'Member added successfully');
                  setShowAddModal(false);
                  setAddEmail('');
                  setAddRole('member');
                  await loadMembers();
                } catch (err: any) {
                  showAlert('Error', err.response?.data?.error || 'Failed to add member');
                } finally {
                  setAddLoading(false);
                }
              }}
            >
              {addLoading ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={styles.addBtnText}>Add Member</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },

  // Stats Strip
  statsStrip: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  statValue: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold as any,
    color: Colors.highlight,
  },
  statLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 1,
  },

  // Tab Switcher
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: 3,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: BorderRadius.sm,
  },
  tabActive: {
    backgroundColor: Colors.highlightSubtle,
  },
  tabText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium as any,
    color: Colors.textLight,
  },
  tabTextActive: {
    color: Colors.highlight,
    fontWeight: FontWeight.semibold as any,
  },

  // Member Cards
  memberCard: { marginBottom: Spacing.sm },
  memberRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  memberInfo: { flex: 1 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  memberName: { fontSize: FontSize.md, fontWeight: FontWeight.semibold as any, color: Colors.textPrimary },
  youBadge: {
    fontSize: FontSize.xs,
    color: Colors.highlight,
    fontWeight: FontWeight.bold as any,
    backgroundColor: Colors.highlightSubtle,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: BorderRadius.xs,
    overflow: 'hidden',
  },
  memberEmail: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 1 },
  memberMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  joinDate: { fontSize: FontSize.xs, color: Colors.textLight },
  memberActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.highlightSubtle,
  },
  dangerAction: { backgroundColor: Colors.dangerSubtle },
  actionText: { fontSize: FontSize.xs, fontWeight: FontWeight.medium as any, color: Colors.highlight },

  // Invite Create Card
  inviteCreateCard: { marginBottom: Spacing.md },
  inviteCreateHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md },
  inviteCreateIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteCreateTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold as any, color: Colors.textPrimary },
  inviteCreateSubtitle: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 1 },
  inviteFieldLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold as any, color: Colors.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  inviteRoleRow: { flexDirection: 'row', gap: Spacing.xs, marginBottom: Spacing.md, flexWrap: 'wrap' },
  inviteRoleChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  inviteRoleChipActive: { backgroundColor: Colors.highlightSubtle, borderColor: Colors.highlight },
  inviteRoleText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  inviteRoleTextActive: { color: Colors.highlight, fontWeight: FontWeight.semibold as any },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.highlight,
    paddingVertical: 12,
    borderRadius: BorderRadius.md,
  },
  generateBtnText: { color: '#FFF', fontWeight: FontWeight.semibold as any, fontSize: FontSize.md },

  // Invite Cards
  inviteCard: { marginBottom: Spacing.sm },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  inviteIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteInfo: { flex: 1 },
  inviteCode: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold as any,
    color: Colors.highlight,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  inviteMeta: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 2 },
  inviteActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  inviteActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.primaryLight,
  },
  inviteActionText: { fontSize: FontSize.xs, fontWeight: FontWeight.medium as any, color: Colors.highlight },
  inviteDeleteBtn: { backgroundColor: Colors.errorSubtle },

  // FAB
  fab: {
    position: 'absolute',
    bottom: Spacing.xl,
    right: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.highlight,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    zIndex: 100,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    width: '100%',
    maxWidth: 420,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  modalTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold as any, color: Colors.textPrimary },
  modalHint: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.md },
  modalInput: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    color: Colors.textPrimary,
    fontSize: FontSize.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: Spacing.md,
  },
  modalFieldLabel: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold as any, color: Colors.textSecondary, marginBottom: Spacing.xs },
  modalRoleRow: { flexDirection: 'row', gap: Spacing.xs, marginBottom: Spacing.lg, flexWrap: 'wrap' },
  roleChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  roleChipActive: { backgroundColor: Colors.highlightSubtle, borderColor: Colors.highlight },
  roleChipText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  roleChipTextActive: { color: Colors.highlight, fontWeight: FontWeight.semibold as any },
  addBtn: {
    backgroundColor: Colors.highlight,
    borderRadius: BorderRadius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addBtnText: { color: '#FFF', fontSize: FontSize.md, fontWeight: FontWeight.semibold as any },
});
