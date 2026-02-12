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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Card, Input } from '../../src/components/ui';
import { useResponsive } from '../../src/hooks/useResponsive';

const ROLE_BADGES: Record<string, { label: string; color: string }> = {
  org_admin: { label: 'Admin', color: '#EF4444' },
  executive: { label: 'Executive', color: '#8B5CF6' },
  treasurer: { label: 'Treasurer', color: '#10B981' },
  secretary: { label: 'Secretary', color: '#3B82F6' },
  member: { label: 'Member', color: Colors.textLight },
};

export default function MemberDirectoryScreen() {
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const responsive = useResponsive();

  const loadMembers = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const res = await api.orgs.listMembers(currentOrgId);
      setMembers(res.data.data || []);
    } catch (err) {
      console.error('Failed to load members', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentOrgId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

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
        <Text style={styles.screenTitle}>Members</Text>
        <Text style={styles.count}>{filtered.length} member{filtered.length !== 1 ? 's' : ''}</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.md, paddingTop: Spacing.lg },
  screenTitle: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold as any, color: Colors.textPrimary },
  count: { fontSize: FontSize.sm, color: Colors.textLight },
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
});
