// ============================================================
// OrgsLedger Mobile — Member Management Screen (Admin)
// ============================================================

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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Card, Badge, Avatar, SearchBar, EmptyState, SectionHeader, PoweredByFooter } from '../../src/components/ui';
import { useResponsive } from '../../src/hooks/useResponsive';
import { showAlert } from '../../src/utils/alert';

const ROLES = ['member', 'executive', 'org_admin', 'super_admin'] as const;
const ROLE_LABELS: Record<string, string> = {
  member: 'Member',
  executive: 'Executive',
  org_admin: 'Admin',
  super_admin: 'Super Admin',
};
const ROLE_COLORS: Record<string, 'neutral' | 'info' | 'gold' | 'danger'> = {
  member: 'neutral',
  executive: 'info',
  org_admin: 'gold',
  super_admin: 'danger',
};

interface Member {
  id: string;
  user_id: string;
  role: string;
  status: string;
  first_name: string;
  last_name: string;
  email: string;
  joined_at: string;
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
  const { columns, isDesktop } = useResponsive();

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
    setRefreshing(false);
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
    const options = ROLES.map((r) => ROLE_LABELS[r]);
    const currentIndex = ROLES.indexOf(member.role as any);

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: `Change role for ${member.first_name} ${member.last_name}`,
          options: ['Cancel', ...options],
          cancelButtonIndex: 0,
          destructiveButtonIndex: undefined,
        },
        async (idx) => {
          if (idx > 0) await updateRole(member.user_id, ROLES[idx - 1]);
        },
      );
    } else {
      showAlert(
        'Change Role',
        `Select new role for ${member.first_name} ${member.last_name}`,
        [
          ...ROLES.map((r) => ({
            text: `${ROLE_LABELS[r]}${r === member.role ? ' (current)' : ''}`,
            onPress: () => updateRole(member.user_id, r),
          })),
          { text: 'Cancel', style: 'cancel' as const },
        ],
      );
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
    showAlert(
      'Remove Member',
      `Are you sure you want to remove ${member.first_name} ${member.last_name} from this organization?`,
      [
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
      ],
    );
  };

  const renderMember = ({ item }: { item: Member }) => {
    const isCurrentUser = item.user_id === userId;
    const isLoading = actionLoading === item.user_id;
    const fullName = `${item.first_name || ''} ${item.last_name || ''}`.trim() || 'Unknown';

    return (
      <Card style={styles.memberCard} variant="default">
        <View style={styles.memberRow}>
          <Avatar name={fullName} size={48} color={isCurrentUser ? Colors.highlight : Colors.primaryMid} />
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
                <TouchableOpacity style={styles.actionBtn} onPress={() => handleChangeRole(item)}>
                  <Ionicons name="shield-outline" size={16} color={Colors.highlight} />
                  <Text style={styles.actionText}>Role</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.dangerAction]}
                  onPress={() => handleRemoveMember(item)}
                >
                  <Ionicons name="person-remove-outline" size={16} color={Colors.danger} />
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

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: `Members (${members.length})` }} />

      {/* Stats Row */}
      <View style={styles.statsRow}>
        <View style={styles.statChip}>
          <Text style={styles.statCount}>{members.length}</Text>
          <Text style={styles.statChipLabel}>Total</Text>
        </View>
        <View style={styles.statChip}>
          <Text style={styles.statCount}>
            {members.filter((m) => ['org_admin', 'super_admin'].includes(m.role)).length}
          </Text>
          <Text style={styles.statChipLabel}>Admins</Text>
        </View>
        <View style={styles.statChip}>
          <Text style={styles.statCount}>
            {members.filter((m) => m.role === 'executive').length}
          </Text>
          <Text style={styles.statChipLabel}>Executives</Text>
        </View>
        <View style={styles.statChip}>
          <Text style={styles.statCount}>
            {members.filter((m) => m.role === 'member').length}
          </Text>
          <Text style={styles.statChipLabel}>Members</Text>
        </View>
      </View>

      <SearchBar
        value={search}
        onChangeText={setSearch}
        placeholder="Search by name or email..."
        style={{ margin: Spacing.md, marginTop: 0 }}
      />

      {/* Add Member FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowAddModal(true)}
        activeOpacity={0.8}
      >
        <Ionicons name="person-add" size={22} color={Colors.textWhite} />
      </TouchableOpacity>

      {/* Add Member Modal */}
      <Modal visible={showAddModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Member</Text>
              <TouchableOpacity onPress={() => { setShowAddModal(false); setAddEmail(''); setAddRole('member'); }}>
                <Ionicons name="close" size={24} color={Colors.textLight} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalHint}>The user must have registered first. Enter their email to add them.</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Enter email address"
              placeholderTextColor={Colors.textLight}
              value={addEmail}
              onChangeText={setAddEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.modalLabel}>Role</Text>
            <View style={styles.roleRow}>
              {(['member', 'executive', 'org_admin'] as const).map((r) => (
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
                <ActivityIndicator size="small" color={Colors.textWhite} />
              ) : (
                <Text style={styles.addBtnText}>Add Member</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.user_id || item.id}
        renderItem={renderMember}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.highlight} />}
        contentContainerStyle={{ paddingHorizontal: Spacing.md, paddingBottom: Spacing.xxl }}
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title="No members found"
            subtitle={search ? 'Try a different search term' : 'This organization has no members yet'}
          />
        }
        ListFooterComponent={<PoweredByFooter />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  statChip: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  statCount: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.highlight,
  },
  statChipLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  memberCard: {
    marginBottom: Spacing.sm,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  memberInfo: { flex: 1 },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  memberName: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
  },
  youBadge: {
    fontSize: FontSize.xs,
    color: Colors.highlight,
    fontWeight: FontWeight.bold,
    backgroundColor: Colors.highlightSubtle,
    paddingHorizontal: Spacing.xs,
    paddingVertical: 1,
    borderRadius: BorderRadius.xs,
    overflow: 'hidden',
  },
  memberEmail: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  memberMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  joinDate: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
  },
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
    gap: Spacing.xxs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.highlightSubtle,
  },
  dangerAction: {
    backgroundColor: Colors.dangerSubtle,
  },
  actionText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.medium,
    color: Colors.highlight,
  },
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    width: '100%',
    maxWidth: 400,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  modalTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  modalHint: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
  },
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
  modalLabel: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  roleRow: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginBottom: Spacing.lg,
    flexWrap: 'wrap',
  },
  roleChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  roleChipActive: {
    backgroundColor: Colors.highlightSubtle,
    borderColor: Colors.highlight,
  },
  roleChipText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  roleChipTextActive: {
    color: Colors.highlight,
    fontWeight: FontWeight.semibold,
  },
  addBtn: {
    backgroundColor: Colors.highlight,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  addBtnText: {
    color: Colors.textWhite,
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
  },
});
