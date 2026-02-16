// ============================================================
// OrgsLedger Mobile — Announcements Screen
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
  ScrollView,
} from 'react-native';
import { showAlert } from '../src/utils/alert';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../src/stores/auth.store';
import { api } from '../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../src/theme';
import { Card, Button, Input, Badge } from '../src/components/ui';
import { useResponsive } from '../src/hooks/useResponsive';

const PRIORITY_CONFIG: Record<string, { color: string; icon: string }> = {
  low: { color: Colors.textLight, icon: 'information-circle-outline' },
  normal: { color: Colors.primary, icon: 'megaphone-outline' },
  high: { color: Colors.warning || '#F59E0B', icon: 'alert-circle-outline' },
  urgent: { color: Colors.error, icon: 'warning-outline' },
};

export default function AnnouncementsScreen() {
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<string>('normal');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const memberships = useAuthStore((s) => s.memberships);
  const globalRole = useAuthStore((s) => s.user?.globalRole);
  const membership = memberships.find((m) => m.organization_id === currentOrgId);
  const isAdmin = globalRole === 'super_admin' || globalRole === 'developer' || membership?.role === 'org_admin' || membership?.role === 'executive';
  const responsive = useResponsive();

  const loadAnnouncements = useCallback(async () => {
    if (!currentOrgId) return;
    setError(null);
    try {
      const res = await api.announcements.list(currentOrgId);
      setAnnouncements(res.data.data || []);
    } catch (err) {
      setError('Failed to load announcements');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentOrgId]);

  useEffect(() => { loadAnnouncements(); }, [loadAnnouncements]);

  const handleCreate = async () => {
    if (!title.trim() || !body.trim()) {
      showAlert('Error', 'Title and body are required');
      return;
    }
    setCreating(true);
    try {
      await api.announcements.create(currentOrgId!, { title, body, priority });
      showAlert('Success', 'Announcement published');
      setShowCreate(false);
      setTitle('');
      setBody('');
      setPriority('normal');
      loadAnnouncements();
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to create');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = (id: string) => {
    showAlert('Delete', 'Are you sure?', [
      { text: 'Cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.announcements.delete(currentOrgId!, id);
            loadAnnouncements();
          } catch {}
        },
      },
    ]);
  };

  const renderAnnouncement = ({ item }: { item: any }) => {
    const cfg = PRIORITY_CONFIG[item.priority] || PRIORITY_CONFIG.normal;
    return (
      <Card style={[styles.announcementCard, item.pinned && styles.pinnedCard]}>
        <View style={styles.announcementHeader}>
          <View style={styles.priorityRow}>
            <Ionicons name={cfg.icon as any} size={20} color={cfg.color} />
            {item.pinned && (
              <View style={styles.pinBadge}>
                <Ionicons name="pin" size={12} color={Colors.highlight} />
                <Text style={styles.pinText}>Pinned</Text>
              </View>
            )}
          </View>
          {isAdmin && (
            <TouchableOpacity onPress={() => handleDelete(item.id)}>
              <Ionicons name="trash-outline" size={18} color={Colors.error} />
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.announcementTitle}>{item.title}</Text>
        <Text style={styles.announcementBody}>{item.body}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>
            {item.author_first_name} {item.author_last_name}
          </Text>
          <Text style={styles.metaText}>
            {new Date(item.created_at).toLocaleDateString()}
          </Text>
        </View>
      </Card>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' }]}>
        <Text style={styles.screenTitle}>Announcements</Text>
        {isAdmin && (
          <Button
            title="New"
            onPress={() => setShowCreate(true)}
            icon="add-outline"
            size="sm"
          />
        )}
      </View>

      <FlatList
        data={announcements}
        renderItem={renderAnnouncement}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.list,
          { maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAnnouncements(); }} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="megaphone-outline" size={48} color={Colors.textLight} />
            <Text style={styles.emptyText}>No announcements yet</Text>
          </View>
        }
      />

      {/* Create Modal */}
      <Modal visible={showCreate} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: responsive.contentMaxWidth }]}>
            <ScrollView>
              <Text style={styles.modalTitle}>New Announcement</Text>

              <Input
                label="TITLE"
                placeholder="Announcement title"
                value={title}
                onChangeText={setTitle}
              />

              <Input
                label="BODY"
                placeholder="Write your announcement..."
                value={body}
                onChangeText={setBody}
                multiline
                numberOfLines={5}
                style={{ minHeight: 120, textAlignVertical: 'top' }}
              />

              <Text style={styles.fieldLabel}>PRIORITY</Text>
              <View style={styles.priorityPicker}>
                {['low', 'normal', 'high', 'urgent'].map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={[styles.priorityOption, priority === p && styles.priorityOptionActive]}
                    onPress={() => setPriority(p)}
                  >
                    <Ionicons
                      name={PRIORITY_CONFIG[p].icon as any}
                      size={16}
                      color={priority === p ? '#FFF' : PRIORITY_CONFIG[p].color}
                    />
                    <Text style={[styles.priorityLabel, priority === p && { color: '#FFF' }]}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.modalActions}>
                <Button
                  title="Cancel"
                  onPress={() => setShowCreate(false)}
                  variant="outline"
                  style={{ flex: 1, marginRight: Spacing.sm }}
                />
                <Button
                  title="Publish"
                  onPress={handleCreate}
                  loading={creating}
                  icon="send-outline"
                  style={{ flex: 1 }}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.md,
    paddingTop: Spacing.lg,
  },
  screenTitle: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold as any, color: Colors.textPrimary },
  list: { padding: Spacing.md, paddingTop: 0 },
  announcementCard: { marginBottom: Spacing.md },
  pinnedCard: { borderLeftWidth: 3, borderLeftColor: Colors.highlight },
  announcementHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.xs },
  priorityRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  pinBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  pinText: { fontSize: FontSize.xs, color: Colors.highlight, fontWeight: FontWeight.medium as any },
  announcementTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold as any, color: Colors.textPrimary, marginBottom: Spacing.xs },
  announcementBody: { fontSize: FontSize.md, color: Colors.textSecondary, lineHeight: 22 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.sm },
  metaText: { fontSize: FontSize.xs, color: Colors.textLight },
  empty: { alignItems: 'center', padding: Spacing.xxl },
  emptyText: { fontSize: FontSize.md, color: Colors.textLight, marginTop: Spacing.md },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: Spacing.md },
  modalContent: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, alignSelf: 'center', width: '100%', maxHeight: '85%' },
  modalTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold as any, color: Colors.textPrimary, marginBottom: Spacing.lg },
  fieldLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold as any, color: Colors.textSecondary, letterSpacing: 1, marginBottom: Spacing.xs, marginTop: Spacing.sm },
  priorityPicker: { flexDirection: 'row', gap: Spacing.xs },
  priorityOption: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, padding: Spacing.sm, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border },
  priorityOptionActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  priorityLabel: { fontSize: FontSize.xs, color: Colors.textPrimary },
  modalActions: { flexDirection: 'row', marginTop: Spacing.lg },
});
