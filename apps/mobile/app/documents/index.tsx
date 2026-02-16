// ============================================================
// OrgsLedger Mobile — Document Repository Screen
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Linking,
  Platform,
} from 'react-native';
import { showAlert } from '../../src/utils/alert';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Card, Button, Input } from '../../src/components/ui';
import { useResponsive } from '../../src/hooks/useResponsive';

const FILE_ICONS: Record<string, { icon: string; color: string }> = {
  'application/pdf': { icon: 'document-text', color: '#EF4444' },
  'image/': { icon: 'image', color: '#3B82F6' },
  'application/vnd': { icon: 'grid', color: '#10B981' },
  'text/': { icon: 'code-slash', color: '#8B5CF6' },
  default: { icon: 'document', color: Colors.textLight },
};

function getFileIcon(mimeType: string) {
  for (const [key, val] of Object.entries(FILE_ICONS)) {
    if (key !== 'default' && mimeType?.startsWith(key)) return val;
  }
  return FILE_ICONS.default;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsScreen() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const memberships = useAuthStore((s) => s.memberships);
  const globalRole = useAuthStore((s) => s.user?.globalRole);
  const membership = memberships.find((m) => m.organization_id === currentOrgId);
  const isAdmin = globalRole === 'super_admin' || globalRole === 'developer' || membership?.role === 'org_admin' || membership?.role === 'executive';
  const responsive = useResponsive();

  const loadDocuments = useCallback(async () => {
    if (!currentOrgId) return;
    setError(null);
    try {
      const params: any = {};
      if (searchQuery) params.search = searchQuery;
      const res = await api.documents.list(currentOrgId, params);
      setDocuments(res.data.data || []);
    } catch (err) {
      setError('Failed to load documents');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentOrgId, searchQuery]);

  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  const handleOpenDocument = (doc: any) => {
    const url = `${__DEV__ ? 'http://localhost:3000' : 'https://app.orgsledger.com'}${doc.file_path}`;
    Linking.openURL(url).catch(() => {
      showAlert('Error', 'Cannot open this file');
    });
  };

  const handleDelete = (docId: string) => {
    showAlert('Delete Document', 'Are you sure?', [
      { text: 'Cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.documents.delete(currentOrgId!, docId);
            loadDocuments();
          } catch {}
        },
      },
    ]);
  };

  const renderDocument = ({ item }: { item: any }) => {
    const iconInfo = getFileIcon(item.mime_type || '');
    return (
      <Card style={styles.docCard} onPress={() => handleOpenDocument(item)}>
        <View style={styles.docRow}>
          <View style={[styles.fileIcon, { backgroundColor: iconInfo.color + '15' }]}>
            <Ionicons name={iconInfo.icon as any} size={24} color={iconInfo.color} />
          </View>
          <View style={styles.docInfo}>
            <Text style={styles.docTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.docMeta}>
              {formatSize(item.file_size)} • {item.category} • {new Date(item.created_at).toLocaleDateString()}
            </Text>
            <Text style={styles.docUploader}>
              By {item.uploader_first_name} {item.uploader_last_name}
            </Text>
          </View>
          {isAdmin && (
            <TouchableOpacity onPress={() => handleDelete(item.id)} style={styles.deleteBtn}>
              <Ionicons name="trash-outline" size={18} color={Colors.error} />
            </TouchableOpacity>
          )}
        </View>
      </Card>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' }]}>
        <Text style={styles.screenTitle}>Documents</Text>
      </View>

      {/* Search */}
      <View style={[styles.searchRow, { maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' }]}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color={Colors.textLight} />
          <Input
            placeholder="Search documents..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={() => loadDocuments()}
            style={styles.searchInput}
          />
        </View>
      </View>

      <FlatList
        data={documents}
        renderItem={renderDocument}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadDocuments(); }} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="folder-open-outline" size={48} color={Colors.textLight} />
            <Text style={styles.emptyText}>No documents found</Text>
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
  searchRow: { paddingHorizontal: Spacing.md, marginBottom: Spacing.sm },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  searchInput: { flex: 1, borderWidth: 0, marginBottom: 0 },
  list: { padding: Spacing.md, paddingTop: 0 },
  docCard: { marginBottom: Spacing.sm },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  fileIcon: { width: 48, height: 48, borderRadius: BorderRadius.md, alignItems: 'center', justifyContent: 'center' },
  docInfo: { flex: 1 },
  docTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold as any, color: Colors.textPrimary },
  docMeta: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 2 },
  docUploader: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 1 },
  deleteBtn: { padding: Spacing.xs },
  empty: { alignItems: 'center', padding: Spacing.xxl },
  emptyText: { fontSize: FontSize.md, color: Colors.textLight, marginTop: Spacing.md },
});
