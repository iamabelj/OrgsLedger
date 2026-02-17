// ============================================================
// OrgsLedger Mobile — Committees Management Screen (Admin)
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { showAlert } from '../../src/utils/alert';
import {
  Card,
  Button,
  Input,
  Avatar,
  Badge,
  SearchBar,
  SectionHeader,
  EmptyState,
  ScreenWrapper,
  LoadingScreen,
  Divider,
  ResponsiveScrollView,
} from '../../src/components/ui';

interface Committee {
  id: string;
  name: string;
  description?: string;
  memberCount: number;
  chair?: { id: string; first_name: string; last_name: string } | null;
  createdAt: string;
}

interface Member {
  id: string;
  fullName: string;
  email: string;
  role: string;
}

const COMMITTEE_ROLES = ['Chair', 'Vice-Chair', 'Secretary', 'Member'] as const;
type CommitteeRole = typeof COMMITTEE_ROLES[number];

interface SelectedMember {
  userId: string;
  role: CommitteeRole;
}

export default function CommitteesScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const [committees, setCommittees] = useState<Committee[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [selectedCommittee, setSelectedCommittee] = useState<Committee | null>(null);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Members & role assignment for create modal
  const [selectedMembers, setSelectedMembers] = useState<SelectedMember[]>([]);
  const [memberSearch, setMemberSearch] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    if (!currentOrgId) return;
    setLoading(true);
    try {
      setError(null);
      const [comRes, memRes] = await Promise.all([
        api.committees.list(currentOrgId),
        api.orgs.listMembers(currentOrgId),
      ]);
      const raw = comRes.data?.data || comRes.data || [];
      setCommittees(raw);
      const rawMembers = memRes.data?.data || memRes.data || [];
      // Normalize members to { id, fullName, email, role }
      // Must use userId (users.id) not m.id (memberships.id) — committee API validates against user_id
      const normalized = rawMembers.map((m: any) => ({
        id: m.userId || m.user_id || m.id,
        fullName: m.fullName || m.full_name || `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.name || 'Unknown',
        email: m.email || '',
        role: m.role || 'member',
      }));
      setMembers(normalized);
    } catch (err) {
      setError('Failed to load committees');
    } finally {
      setLoading(false);
    }
  };

  // ── Member selection helpers ──────────────────────────────
  const isMemberSelected = (userId: string) =>
    selectedMembers.some((sm) => sm.userId === userId);

  const toggleMember = (userId: string) => {
    if (isMemberSelected(userId)) {
      setSelectedMembers((prev) => prev.filter((sm) => sm.userId !== userId));
    } else {
      setSelectedMembers((prev) => [...prev, { userId, role: 'Member' }]);
    }
  };

  const setMemberRole = (userId: string, role: CommitteeRole) => {
    setSelectedMembers((prev) => {
      // If assigning Chair, remove Chair from anyone else first
      let updated = role === 'Chair'
        ? prev.map((sm) => sm.role === 'Chair' ? { ...sm, role: 'Member' as CommitteeRole } : sm)
        : [...prev];
      return updated.map((sm) => sm.userId === userId ? { ...sm, role } : sm);
    });
  };

  const getSelectedRole = (userId: string): CommitteeRole =>
    selectedMembers.find((sm) => sm.userId === userId)?.role || 'Member';

  const filteredCreateMembers = members.filter((m) =>
    m.fullName.toLowerCase().includes(memberSearch.toLowerCase()) ||
    m.email.toLowerCase().includes(memberSearch.toLowerCase())
  );

  const handleCreateCommittee = async () => {
    if (!newName.trim()) {
      showAlert('Validation', 'Committee name is required');
      return;
    }
    if (!currentOrgId) return;
    setCreating(true);
    try {
      const chairMember = selectedMembers.find((sm) => sm.role === 'Chair');
      const memberIds = selectedMembers.map((sm) => sm.userId);

      await api.committees.create(currentOrgId, {
        name: newName.trim(),
        description: newDesc.trim() || undefined,
        chairUserId: chairMember?.userId || undefined,
        memberIds: memberIds.length > 0 ? memberIds : undefined,
      });
      setShowCreateModal(false);
      setNewName('');
      setNewDesc('');
      setSelectedMembers([]);
      setMemberSearch('');
      loadData();
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to create committee');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteCommittee = (committee: Committee) => {
    showAlert(
      'Delete Committee',
      `Are you sure you want to delete "${committee.name}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              if (!currentOrgId) return;
              await api.committees.remove(currentOrgId, committee.id);
              loadData();
            } catch (err: any) {
              showAlert('Error', err.response?.data?.error || 'Failed to delete committee');
            }
          },
        },
      ]
    );
  };

  const filteredCommittees = committees.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderCommittee = (committee: Committee) => (
    <Card key={committee.id} variant="elevated" style={styles.committeeCard}>
      <View style={styles.committeeHeader}>
        <View style={styles.committeeIcon}>
          <Ionicons name="people" size={22} color={Colors.highlight} />
        </View>
        <View style={styles.committeeInfo}>
          <Text style={styles.committeeName}>{committee.name}</Text>
          {committee.description && (
            <Text style={styles.committeeDesc} numberOfLines={2}>
              {committee.description}
            </Text>
          )}
        </View>
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={() => handleDeleteCommittee(committee)}
        >
          <Ionicons name="trash-outline" size={18} color={Colors.error} />
        </TouchableOpacity>
      </View>

      <Divider />

      <View style={styles.committeeFooter}>
        <View style={styles.memberCountRow}>
          <Ionicons name="people-outline" size={16} color={Colors.textSecondary} />
          <Text style={styles.memberCountText}>
            {committee.memberCount} member{committee.memberCount !== 1 ? 's' : ''}
          </Text>
        </View>
        {committee.chair && (
          <Badge label={`Chair: ${committee.chair.first_name} ${committee.chair.last_name}`} variant="warning" size="sm" />
        )}
        <TouchableOpacity
          style={styles.manageBtn}
          onPress={() => {
            setSelectedCommittee(committee);
            setShowMembersModal(true);
          }}
        >
          <Text style={styles.manageBtnText}>Manage</Text>
          <Ionicons name="chevron-forward" size={14} color={Colors.highlight} />
        </TouchableOpacity>
      </View>
    </Card>
  );

  if (loading) return <LoadingScreen />;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Committees' }} />

      <ResponsiveScrollView contentContainerStyle={styles.content}>
        {/* Stats Row */}
        <View style={styles.statsRow}>
          <Card variant="elevated" style={styles.statCard}>
            <Text style={styles.statNumber}>{committees.length}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </Card>
          <Card variant="elevated" style={styles.statCard}>
            <Text style={styles.statNumber}>
              {committees.reduce((acc, c) => acc + c.memberCount, 0)}
            </Text>
            <Text style={styles.statLabel}>Assignments</Text>
          </Card>
          <Card variant="elevated" style={styles.statCard}>
            <Text style={styles.statNumber}>{members.length}</Text>
            <Text style={styles.statLabel}>Members</Text>
          </Card>
        </View>

        <SearchBar
          placeholder="Search committees..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />

        {filteredCommittees.length === 0 ? (
          <EmptyState
            icon="people-outline"
            title="No Committees Yet"
            subtitle="Create your first committee to organize your members into groups"
          />
        ) : (
          filteredCommittees.map(renderCommittee)
        )}
      </ResponsiveScrollView>

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={() => setShowCreateModal(true)}>
        <Ionicons name="add" size={28} color={Colors.primary} />
      </TouchableOpacity>

      {/* Create Committee Modal */}
      <Modal visible={showCreateModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '90%' }]}>
            <View style={styles.modalHandle} />
            <SectionHeader title="New Committee" />

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: '100%' }}>
              <Input
                label="NAME"
                placeholder="e.g. Finance Committee, Events Team"
                value={newName}
                onChangeText={setNewName}
                icon="people-outline"
              />

              <Input
                label="DESCRIPTION"
                placeholder="What does this committee do?"
                value={newDesc}
                onChangeText={setNewDesc}
                multiline
                icon="document-text-outline"
              />

              {/* ── Add Members Section ─────────────────────── */}
              <View style={styles.sectionDivider}>
                <Text style={styles.sectionTitle}>
                  <Ionicons name="people" size={16} color={Colors.highlight} />{' '}
                  ADD MEMBERS
                </Text>
                <Text style={styles.sectionSubtitle}>
                  {selectedMembers.length} member{selectedMembers.length !== 1 ? 's' : ''} selected
                </Text>
              </View>

              {/* Selected Members with Role Assignment */}
              {selectedMembers.length > 0 && (
                <View style={styles.selectedMembersContainer}>
                  {selectedMembers.map((sm) => {
                    const member = members.find((m) => m.id === sm.userId);
                    if (!member) return null;
                    return (
                      <View key={sm.userId} style={styles.selectedMemberRow}>
                        <Avatar name={member.fullName} size={34} />
                        <View style={styles.selectedMemberInfo}>
                          <Text style={styles.selectedMemberName} numberOfLines={1}>
                            {member.fullName}
                          </Text>
                          {/* Role picker */}
                          <View style={styles.rolePicker}>
                            {COMMITTEE_ROLES.map((role) => (
                              <TouchableOpacity
                                key={role}
                                style={[
                                  styles.roleChip,
                                  sm.role === role && styles.roleChipActive,
                                  role === 'Chair' && sm.role === role && styles.roleChipChair,
                                ]}
                                onPress={() => setMemberRole(sm.userId, role)}
                              >
                                <Text
                                  style={[
                                    styles.roleChipText,
                                    sm.role === role && styles.roleChipTextActive,
                                  ]}
                                >
                                  {role}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </View>
                        <TouchableOpacity
                          style={styles.removeMemberBtn}
                          onPress={() => toggleMember(sm.userId)}
                        >
                          <Ionicons name="close-circle" size={22} color={Colors.danger} />
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Member Search */}
              <SearchBar
                placeholder="Search members to add..."
                value={memberSearch}
                onChangeText={setMemberSearch}
                style={{ marginBottom: Spacing.xs }}
              />

              {/* Available Members List */}
              <View style={styles.availableMembersList}>
                {filteredCreateMembers
                  .filter((m) => !isMemberSelected(m.id))
                  .slice(0, 10)
                  .map((member) => (
                    <TouchableOpacity
                      key={member.id}
                      style={styles.availableMemberItem}
                      activeOpacity={0.7}
                      onPress={() => toggleMember(member.id)}
                    >
                      <Avatar name={member.fullName} size={34} />
                      <View style={styles.memberItemInfo}>
                        <Text style={styles.memberItemName}>{member.fullName}</Text>
                        <Text style={styles.memberItemEmail}>{member.email}</Text>
                      </View>
                      <Ionicons name="add-circle-outline" size={22} color={Colors.highlight} />
                    </TouchableOpacity>
                  ))}
                {filteredCreateMembers.filter((m) => !isMemberSelected(m.id)).length === 0 && (
                  <Text style={styles.noMembersText}>
                    {memberSearch ? 'No matching members found' : 'All members have been added'}
                  </Text>
                )}
              </View>
            </ScrollView>

            <View style={styles.modalActions}>
              <Button
                title="Cancel"
                onPress={() => {
                  setShowCreateModal(false);
                  setNewName('');
                  setNewDesc('');
                  setSelectedMembers([]);
                  setMemberSearch('');
                }}
                variant="outline"
                style={{ flex: 1 }}
              />
              <Button
                title="Create"
                onPress={handleCreateCommittee}
                loading={creating}
                icon="add-circle"
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Members Management Modal */}
      <Modal visible={showMembersModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '80%' }]}>
            <View style={styles.modalHandle} />
            <SectionHeader title={selectedCommittee?.name || 'Committee Members'} />

            <ScrollView style={styles.membersList}>
              {members.map((member) => (
                <TouchableOpacity
                  key={member.id}
                  style={styles.memberItem}
                  activeOpacity={0.7}
                  onPress={async () => {
                    if (!currentOrgId || !selectedCommittee) return;
                    try {
                      await api.committees.addMember(
                        currentOrgId,
                        selectedCommittee.id,
                        { userId: member.id }
                      );
                      showAlert('Added', `${member.fullName} added to committee`);
                      loadData();
                    } catch (err: any) {
                      showAlert(
                        'Info',
                        err.response?.data?.error || 'Member may already be in committee'
                      );
                    }
                  }}
                >
                  <Avatar name={member.fullName} size={38} />
                  <View style={styles.memberItemInfo}>
                    <Text style={styles.memberItemName}>{member.fullName}</Text>
                    <Text style={styles.memberItemEmail}>{member.email}</Text>
                  </View>
                  <Ionicons name="add-circle-outline" size={22} color={Colors.highlight} />
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Button
              title="Done"
              onPress={() => {
                setShowMembersModal(false);
                setSelectedCommittee(null);
              }}
              fullWidth
              style={{ marginTop: Spacing.md }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.md, paddingBottom: 100 },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  statNumber: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.highlight,
  },
  statLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  committeeCard: {
    marginBottom: Spacing.sm,
  },
  committeeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  committeeIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  committeeInfo: {
    flex: 1,
  },
  committeeName: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
  },
  committeeDesc: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 18,
  },
  deleteBtn: {
    padding: Spacing.xs,
  },
  committeeFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  memberCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  memberCountText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  manageBtnText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.highlight,
  },
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    bottom: Spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.highlight,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.lg,
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
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.accent,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  modalActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  membersList: {
    maxHeight: 400,
  },
  memberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  memberItemInfo: {
    flex: 1,
  },
  memberItemName: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
    color: Colors.textPrimary,
  },
  memberItemEmail: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
  },
  // ── Create modal: member & role styles ──────────────
  sectionDivider: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold,
    color: Colors.textSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  sectionSubtitle: {
    fontSize: FontSize.xs,
    color: Colors.highlight,
    fontWeight: FontWeight.semibold,
  },
  selectedMembersContainer: {
    marginBottom: Spacing.sm,
  },
  selectedMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    backgroundColor: Colors.highlightSubtle,
    borderRadius: BorderRadius.md,
    marginBottom: 4,
  },
  selectedMemberInfo: {
    flex: 1,
  },
  selectedMemberName: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  rolePicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  roleChip: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  roleChipActive: {
    borderColor: Colors.highlight,
    backgroundColor: Colors.highlight,
  },
  roleChipChair: {
    borderColor: Colors.warning,
    backgroundColor: Colors.warning,
  },
  roleChipText: {
    fontSize: 10,
    fontWeight: FontWeight.semibold,
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  roleChipTextActive: {
    color: Colors.textWhite,
  },
  removeMemberBtn: {
    padding: 4,
  },
  availableMembersList: {
    maxHeight: 200,
  },
  availableMemberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs + 2,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  noMembersText: {
    textAlign: 'center',
    color: Colors.textLight,
    fontSize: FontSize.sm,
    paddingVertical: Spacing.md,
  },
});
