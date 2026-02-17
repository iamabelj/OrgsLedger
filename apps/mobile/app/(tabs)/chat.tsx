// ============================================================
// OrgsLedger Mobile — Chat (Channel List) Screen (Royal Design)
// ============================================================

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { useChatStore } from '../../src/stores/chat.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { SearchBar, EmptyState, Avatar, Badge, useContentStyle } from '../../src/components/ui';

const CHANNEL_TYPES = [
  { value: 'general', label: 'General', icon: 'chatbubble-ellipses' as const },
  { value: 'announcement', label: 'Announcement', icon: 'megaphone' as const },
  { value: 'committee', label: 'Committee', icon: 'people-circle' as const },
];

export default function ChatScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const userRole = useAuthStore((s) => s.user?.globalRole);
  const memberRole = useAuthStore((s) => {
    const m = s.memberships.find((m) => m.organization_id === s.currentOrgId);
    return m?.role;
  });
  const channels = useChatStore((s) => s.channels);
  const loadChannels = useChatStore((s) => s.loadChannels);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const contentStyle = useContentStyle({ paddingBottom: Spacing.xxl });

  // Create channel state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [channelForm, setChannelForm] = useState({
    name: '',
    type: 'general' as string,
    description: '',
  });

  // Can this user create channels? (super_admin, developer, org_admin, executive)
  const canCreate = userRole === 'super_admin' || userRole === 'developer' || memberRole === 'org_admin' || memberRole === 'executive';

  useEffect(() => {
    if (currentOrgId) loadChannels(currentOrgId);
  }, [currentOrgId]);

  const onRefresh = async () => {
    if (!currentOrgId) return;
    setRefreshing(true);
    await loadChannels(currentOrgId);
    setRefreshing(false);
  };

  const handleCreateChannel = async () => {
    if (!currentOrgId || !channelForm.name.trim()) return;
    setCreating(true);
    try {
      await api.chat.createChannel(currentOrgId, {
        name: channelForm.name.trim(),
        type: channelForm.type,
        description: channelForm.description.trim() || undefined,
      });
      setShowCreateModal(false);
      setChannelForm({ name: '', type: 'general', description: '' });
      await loadChannels(currentOrgId);
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Failed to create channel';
      if (Platform.OS === 'web') {
        window.alert(msg);
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setCreating(false);
    }
  };

  const filtered = channels.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (activeFilter === 'All') return true;
    return c.type.toLowerCase() === activeFilter.toLowerCase();
  });

  const channelIcon = (type: string): React.ComponentProps<typeof Ionicons>['name'] => {
    switch (type) {
      case 'announcement': return 'megaphone';
      case 'direct': return 'person';
      case 'committee': return 'people-circle';
      default: return 'chatbubble-ellipses';
    }
  };

  const channelColor = (type: string): string => {
    switch (type) {
      case 'announcement': return Colors.warning;
      case 'direct': return Colors.info;
      case 'committee': return Colors.success;
      default: return Colors.highlight;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchWrapper}>
        <SearchBar
          placeholder="Search channels..."
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Channel type filters */}
      <View style={styles.filterRow}>
        {['All', 'General', 'Announcement', 'Committee', 'Direct'].map((label) => {
          const isActive = activeFilter === label;
          return (
            <TouchableOpacity
              key={label}
              style={[styles.filterChip, isActive && styles.filterChipActive]}
              onPress={() => setActiveFilter(label)}
            >
              <Text style={[styles.filterText, isActive && styles.filterTextActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.highlight} />
        }
        contentContainerStyle={contentStyle}
        ListEmptyComponent={
          <EmptyState
            icon="chatbubbles-outline"
            title="No Channels Yet"
            subtitle="Channels will appear here once your organization creates them"
          />
        }
        renderItem={({ item }) => {
          const color = channelColor(item.type);
          return (
            <TouchableOpacity
              style={styles.channelRow}
              onPress={() => {
                useChatStore.getState().setActiveChannel(item.id);
                router.push(`/chat/${item.id}`);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.channelIcon, { backgroundColor: color + '20' }]}>
                <Ionicons name={channelIcon(item.type)} size={20} color={color} />
              </View>
              <View style={styles.channelInfo}>
                <View style={styles.channelNameRow}>
                  <Text style={styles.channelName}>
                    {item.type === 'direct' ? '' : '# '}
                    {item.name}
                  </Text>
                  <Badge label={item.type} variant="neutral" size="sm" />
                </View>
                {item.description ? (
                  <Text style={styles.channelDesc} numberOfLines={1}>
                    {item.description}
                  </Text>
                ) : null}
              </View>
              {(item.unreadCount || 0) > 0 ? (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadText}>
                    {item.unreadCount > 99 ? '99+' : item.unreadCount}
                  </Text>
                </View>
              ) : (
                <Ionicons name="chevron-forward" size={16} color={Colors.textLight} />
              )}
            </TouchableOpacity>
          );
        }}
      />

      {/* Floating Action Button — Create Channel */}
      {canCreate && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => setShowCreateModal(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={28} color="#FFF" />
        </TouchableOpacity>
      )}

      {/* Create Channel Modal */}
      <Modal
        visible={showCreateModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Channel</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                <Ionicons name="close" size={24} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Channel Name */}
            <Text style={styles.inputLabel}>Channel Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Announcements"
              placeholderTextColor={Colors.textLight}
              value={channelForm.name}
              onChangeText={(t) => setChannelForm((f) => ({ ...f, name: t }))}
              maxLength={100}
            />

            {/* Channel Type */}
            <Text style={styles.inputLabel}>Type</Text>
            <View style={styles.typeRow}>
              {CHANNEL_TYPES.map((ct) => {
                const isActive = channelForm.type === ct.value;
                return (
                  <TouchableOpacity
                    key={ct.value}
                    style={[styles.typeChip, isActive && styles.typeChipActive]}
                    onPress={() => setChannelForm((f) => ({ ...f, type: ct.value }))}
                  >
                    <Ionicons name={ct.icon} size={16} color={isActive ? '#FFF' : Colors.textSecondary} />
                    <Text style={[styles.typeChipText, isActive && styles.typeChipTextActive]}>{ct.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Description */}
            <Text style={styles.inputLabel}>Description (optional)</Text>
            <TextInput
              style={[styles.input, { height: 72, textAlignVertical: 'top' }]}
              placeholder="What's this channel about?"
              placeholderTextColor={Colors.textLight}
              value={channelForm.description}
              onChangeText={(t) => setChannelForm((f) => ({ ...f, description: t }))}
              multiline
              maxLength={500}
            />

            {/* Actions */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowCreateModal(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.createBtn, (!channelForm.name.trim() || creating) && { opacity: 0.5 }]}
                onPress={handleCreateChannel}
                disabled={!channelForm.name.trim() || creating}
              >
                {creating ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.createBtnText}>Create Channel</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  searchWrapper: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    gap: Spacing.xs,
  },
  filterChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },
  filterTextActive: {
    color: '#FFF',
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    gap: Spacing.sm,
  },
  channelIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelInfo: {
    flex: 1,
  },
  channelNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  channelName: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
  },
  channelDesc: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
    marginTop: 2,
  },
  unreadBadge: {
    backgroundColor: Colors.highlight,
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: {
    color: '#FFF',
    fontSize: FontSize.xs,
    fontWeight: FontWeight.bold as any,
  },
  // ── FAB ──────────────────────────────────────────────────
  fab: {
    position: 'absolute',
    right: Spacing.md,
    bottom: Spacing.lg + 60,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.md,
    zIndex: 10,
  },
  // ── Modal ────────────────────────────────────────────────
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
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  inputLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: 4,
    marginTop: Spacing.sm,
  },
  input: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 10,
    fontSize: FontSize.md,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: 4,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  typeChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  typeChipText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  typeChipTextActive: {
    color: '#FFF',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  cancelBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  cancelBtnText: {
    color: Colors.textSecondary,
    fontWeight: FontWeight.medium,
  },
  createBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary,
  },
  createBtnText: {
    color: '#FFF',
    fontWeight: FontWeight.semibold,
  },
});
