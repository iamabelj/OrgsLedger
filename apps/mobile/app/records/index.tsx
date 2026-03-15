// ============================================================
// OrgsLedger Mobile — Member Records Screen
// Historical records viewing and admin import
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Platform,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Modal,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { showAlert } from '../../src/utils/alert';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Card, Button, Input, LoadingScreen, Badge } from '../../src/components/ui';
import { useResponsive } from '../../src/hooks/useResponsive';

// Record type icons and colors
const RECORD_TYPE_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  payment: { icon: 'card', color: '#10B981', label: 'Payment' },
  dues: { icon: 'cash', color: '#3B82F6', label: 'Dues' },
  attendance: { icon: 'people', color: '#8B5CF6', label: 'Attendance' },
  contribution: { icon: 'heart', color: '#EC4899', label: 'Contribution' },
  note: { icon: 'document-text', color: '#F59E0B', label: 'Note' },
  other: { icon: 'folder', color: Colors.textLight, label: 'Other' },
};

function getRecordConfig(type: string) {
  return RECORD_TYPE_CONFIG[type] || RECORD_TYPE_CONFIG.other;
}

function formatCurrency(amount: number | null | undefined, currency: string = 'USD') {
  if (amount == null) return '';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

type TabKey = 'all' | 'mine';

export default function RecordsScreen() {
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  // Create record form state
  const [newRecordTitle, setNewRecordTitle] = useState('');
  const [newRecordType, setNewRecordType] = useState('other');
  const [newRecordAmount, setNewRecordAmount] = useState('');
  const [newRecordDate, setNewRecordDate] = useState('');
  const [newRecordDescription, setNewRecordDescription] = useState('');
  const [newRecordCategory, setNewRecordCategory] = useState('');
  const [creating, setCreating] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [totalRecords, setTotalRecords] = useState(0);

  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const memberships = useAuthStore((s) => s.memberships);
  const globalRole = useAuthStore((s) => s.user?.globalRole);
  const membership = memberships.find((m) => m.organization_id === currentOrgId);
  const isAdmin = globalRole === 'super_admin' || globalRole === 'developer' || membership?.role === 'org_admin' || membership?.role === 'executive';
  const responsive = useResponsive();

  const loadRecords = useCallback(async (reset: boolean = false) => {
    if (!currentOrgId) return;
    const currentPage = reset ? 1 : page;
    if (reset) setPage(1);

    try {
      const params: any = { page: currentPage, limit: 30 };
      if (searchQuery) params.search = searchQuery;
      if (selectedType) params.recordType = selectedType;

      let res;
      if (activeTab === 'mine') {
        res = await api.records.myRecords(currentOrgId, params);
      } else {
        res = await api.records.list(currentOrgId, params);
      }

      const data = res.data?.data || [];
      const pagination = res.data?.pagination || {};

      if (reset) {
        setRecords(data);
      } else {
        setRecords((prev) => [...prev, ...data]);
      }
      setTotalRecords(pagination.total || 0);
      setHasMore(currentPage < (pagination.totalPages || 1));
    } catch {
      showAlert('Error', 'Failed to load records');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentOrgId, searchQuery, selectedType, activeTab, page]);

  useEffect(() => {
    setLoading(true);
    loadRecords(true);
  }, [currentOrgId, searchQuery, selectedType, activeTab]);

  const handleLoadMore = () => {
    if (hasMore && !loading) {
      setPage((p) => p + 1);
      loadRecords();
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadRecords(true);
  };

  const handleDeleteRecord = (recordId: string) => {
    showAlert('Delete Record', 'Are you sure you want to delete this record?', [
      { text: 'Cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.records.delete(currentOrgId!, recordId);
            setRecords((prev) => prev.filter((r) => r.id !== recordId));
            showAlert('Success', 'Record deleted');
          } catch {
            showAlert('Error', 'Failed to delete record');
          }
        },
      },
    ]);
  };

  const handleImportCSV = async () => {
    try {
      let file: any;

      if (Platform.OS === 'web') {
        // Web: use native file input
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv,text/csv';
        
        const filePromise = new Promise<File | null>((resolve) => {
          input.onchange = (e: any) => {
            const webFile = e.target.files?.[0] as File | undefined;
            resolve(webFile || null);
          };
          input.click();
        });

        const webFile = await filePromise;
        if (!webFile) return;
        file = webFile;
      } else {
        // Native: use document picker
        const result = await DocumentPicker.getDocumentAsync({
          type: ['text/csv', 'text/plain'],
          copyToCacheDirectory: true,
        });
        if (result.canceled || !result.assets?.length) return;
        file = result.assets[0];
      }

      setUploading(true);
      const formData = new FormData();

      if (Platform.OS === 'web') {
        formData.append('file', file, file.name);
      } else {
        formData.append('file', {
          uri: file.uri,
          name: file.name,
          type: 'text/csv',
        } as any);
      }

      const res = await api.records.import(currentOrgId!, formData);
      const result = res.data?.data;
      setImportResult(result);
      setShowImportModal(true);
      loadRecords(true);
    } catch (err: any) {
      showAlert('Import Failed', err?.response?.data?.error || 'Failed to import CSV file.');
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      // Open template URL in browser
      const baseUrl = __DEV__ ? 'http://localhost:3000' : 'https://app.orgsledger.com';
      window.open(`${baseUrl}/api/records/${currentOrgId}/template`, '_blank');
    } catch {
      showAlert('Error', 'Failed to download template');
    }
  };

  const handleCreateRecord = async () => {
    if (!newRecordTitle.trim()) {
      showAlert('Missing Title', 'Please enter a record title.');
      return;
    }
    if (!newRecordDate.trim()) {
      showAlert('Missing Date', 'Please enter a record date.');
      return;
    }

    setCreating(true);
    try {
      await api.records.create(currentOrgId!, {
        recordType: newRecordType,
        title: newRecordTitle.trim(),
        description: newRecordDescription.trim() || undefined,
        amount: newRecordAmount ? parseFloat(newRecordAmount) : undefined,
        recordDate: newRecordDate,
        category: newRecordCategory.trim() || undefined,
      });

      setShowCreateModal(false);
      resetCreateForm();
      loadRecords(true);
      showAlert('Success', 'Record created successfully.');
    } catch (err: any) {
      showAlert('Error', err?.response?.data?.error || 'Failed to create record.');
    } finally {
      setCreating(false);
    }
  };

  const resetCreateForm = () => {
    setNewRecordTitle('');
    setNewRecordType('other');
    setNewRecordAmount('');
    setNewRecordDate('');
    setNewRecordDescription('');
    setNewRecordCategory('');
  };

  // Stats
  const stats = useMemo(() => {
    const total = records.reduce((sum, r) => sum + (r.amount || 0), 0);
    const types = new Set(records.map((r) => r.record_type)).size;
    return { total, types, count: totalRecords };
  }, [records, totalRecords]);

  if (loading && !refreshing && records.length === 0) return <LoadingScreen />;

  const renderRecord = ({ item }: { item: any }) => {
    const config = getRecordConfig(item.record_type);
    const memberName = item.member_first_name
      ? `${item.member_first_name} ${item.member_last_name || ''}`
      : 'Organization';

    return (
      <Card style={styles.recordCard}>
        <View style={styles.recordRow}>
          <View style={[styles.recordIcon, { backgroundColor: config.color + '15' }]}>
            <Ionicons name={config.icon as any} size={22} color={config.color} />
          </View>
          <View style={styles.recordInfo}>
            <Text style={styles.recordTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.recordMeta}>
              {formatDate(item.record_date)} • {config.label}
              {item.category ? ` • ${item.category}` : ''}
            </Text>
            <Text style={styles.recordMember}>{memberName}</Text>
          </View>
          <View style={styles.recordRight}>
            {item.amount != null && (
              <Text style={[styles.recordAmount, { color: config.color }]}>
                {formatCurrency(item.amount, item.currency || 'USD')}
              </Text>
            )}
            {isAdmin && (
              <TouchableOpacity
                onPress={() => handleDeleteRecord(item.id)}
                style={styles.deleteBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="trash-outline" size={16} color={Colors.error} />
              </TouchableOpacity>
            )}
          </View>
        </View>
        {item.description && (
          <Text style={styles.recordDescription} numberOfLines={2}>{item.description}</Text>
        )}
      </Card>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' }]}>
        <View style={styles.headerTop}>
          <View style={styles.headerIcon}>
            <Ionicons name="folder-open" size={24} color={Colors.highlight} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>Records</Text>
            <Text style={styles.headerSubtitle}>
              {stats.count} records{stats.total > 0 ? ` • ${formatCurrency(stats.total)}` : ''}
            </Text>
          </View>
          {isAdmin && (
            <View style={styles.headerActions}>
              <TouchableOpacity style={styles.iconBtn} onPress={() => setShowCreateModal(true)}>
                <Ionicons name="add" size={22} color={Colors.highlight} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.iconBtn, uploading && styles.iconBtnDisabled]}
                onPress={handleImportCSV}
                disabled={uploading}
              >
                {uploading ? (
                  <ActivityIndicator size="small" color={Colors.highlight} />
                ) : (
                  <Ionicons name="cloud-upload" size={20} color={Colors.highlight} />
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'all' && styles.tabActive]}
            onPress={() => setActiveTab('all')}
          >
            <Text style={[styles.tabText, activeTab === 'all' && styles.tabTextActive]}>All Records</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'mine' && styles.tabActive]}
            onPress={() => setActiveTab('mine')}
          >
            <Text style={[styles.tabText, activeTab === 'mine' && styles.tabTextActive]}>My Records</Text>
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={Colors.textLight} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search records..."
            placeholderTextColor={Colors.textLight}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={Colors.textLight} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Type Filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, !selectedType && styles.filterChipActive]}
            onPress={() => setSelectedType(null)}
          >
            <Text style={[styles.filterChipText, !selectedType && styles.filterChipTextActive]}>All</Text>
          </TouchableOpacity>
          {Object.entries(RECORD_TYPE_CONFIG).map(([key, cfg]) => (
            <TouchableOpacity
              key={key}
              style={[styles.filterChip, selectedType === key && styles.filterChipActive]}
              onPress={() => setSelectedType(selectedType === key ? null : key)}
            >
              <Ionicons name={cfg.icon as any} size={14} color={selectedType === key ? '#fff' : cfg.color} style={{ marginRight: 4 }} />
              <Text style={[styles.filterChipText, selectedType === key && styles.filterChipTextActive]}>{cfg.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Records List */}
      <FlatList
        data={records}
        renderItem={renderRecord}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, { maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.highlight} />}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="folder-open-outline" size={48} color={Colors.textLight} />
            <Text style={styles.emptyTitle}>No Records</Text>
            <Text style={styles.emptyText}>
              {isAdmin ? 'Import historical records using CSV or add them manually.' : 'No records available for your account.'}
            </Text>
            {isAdmin && (
              <View style={styles.emptyActions}>
                <Button title="Import CSV" onPress={handleImportCSV} icon="cloud-upload" size="sm" />
                <Button title="Download Template" onPress={handleDownloadTemplate} variant="ghost" icon="download" size="sm" />
              </View>
            )}
          </View>
        }
        ListFooterComponent={
          hasMore && records.length > 0 ? (
            <View style={styles.loadingMore}>
              <ActivityIndicator size="small" color={Colors.highlight} />
            </View>
          ) : null
        }
      />

      {/* Create Record Modal */}
      <Modal visible={showCreateModal} transparent animationType="slide" onRequestClose={() => setShowCreateModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Record</Text>
              <TouchableOpacity onPress={() => setShowCreateModal(false)}>
                <Ionicons name="close" size={24} color={Colors.textLight} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Input
                label="TITLE"
                value={newRecordTitle}
                onChangeText={setNewRecordTitle}
                placeholder="Record title"
              />

              <Text style={styles.fieldLabel}>TYPE</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeRow}>
                {Object.entries(RECORD_TYPE_CONFIG).map(([key, cfg]) => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.typeChip, newRecordType === key && { backgroundColor: cfg.color }]}
                    onPress={() => setNewRecordType(key)}
                  >
                    <Ionicons name={cfg.icon as any} size={16} color={newRecordType === key ? '#fff' : cfg.color} />
                    <Text style={[styles.typeChipText, newRecordType === key && { color: '#fff' }]}>{cfg.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Input
                    label="AMOUNT"
                    value={newRecordAmount}
                    onChangeText={setNewRecordAmount}
                    placeholder="0.00"
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                  <Input
                    label="DATE"
                    value={newRecordDate}
                    onChangeText={setNewRecordDate}
                    placeholder="YYYY-MM-DD"
                  />
                </View>
              </View>

              <Input
                label="CATEGORY"
                value={newRecordCategory}
                onChangeText={setNewRecordCategory}
                placeholder="e.g. Monthly, Annual"
              />

              <Input
                label="DESCRIPTION"
                value={newRecordDescription}
                onChangeText={setNewRecordDescription}
                placeholder="Additional details..."
                multiline
                numberOfLines={3}
              />

              <View style={styles.modalActions}>
                <Button title="Cancel" onPress={() => setShowCreateModal(false)} variant="ghost" style={{ flex: 1 }} />
                <Button title="Create" onPress={handleCreateRecord} loading={creating} style={{ flex: 1 }} />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Import Result Modal */}
      <Modal visible={showImportModal} transparent animationType="fade" onRequestClose={() => setShowImportModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Import Complete</Text>
              <TouchableOpacity onPress={() => setShowImportModal(false)}>
                <Ionicons name="close" size={24} color={Colors.textLight} />
              </TouchableOpacity>
            </View>
            {importResult && (
              <View style={styles.importResult}>
                <View style={styles.importStat}>
                  <Text style={styles.importStatValue}>{importResult.totalRows}</Text>
                  <Text style={styles.importStatLabel}>Total Rows</Text>
                </View>
                <View style={styles.importStat}>
                  <Text style={[styles.importStatValue, { color: Colors.success }]}>{importResult.imported}</Text>
                  <Text style={styles.importStatLabel}>Imported</Text>
                </View>
                <View style={styles.importStat}>
                  <Text style={[styles.importStatValue, { color: Colors.error }]}>{importResult.errors?.length || 0}</Text>
                  <Text style={styles.importStatLabel}>Errors</Text>
                </View>
              </View>
            )}
            {importResult?.errors?.length > 0 && (
              <View style={styles.importErrors}>
                <Text style={styles.importErrorsTitle}>Errors:</Text>
                {importResult.errors.slice(0, 10).map((err: any, i: number) => (
                  <Text key={i} style={styles.importErrorItem}>Row {err.row}: {err.error}</Text>
                ))}
                {importResult.errors.length > 10 && (
                  <Text style={styles.importErrorItem}>... and {importResult.errors.length - 10} more</Text>
                )}
              </View>
            )}
            <Button title="Done" onPress={() => setShowImportModal(false)} style={{ marginTop: Spacing.md }} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { padding: Spacing.md },
  headerTop: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.highlightSubtle,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  headerText: { flex: 1 },
  headerTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  headerSubtitle: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: Spacing.xs },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.highlightSubtle,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconBtnDisabled: { opacity: 0.5 },

  tabs: { flexDirection: 'row', marginBottom: Spacing.sm },
  tab: {
    flex: 1,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: Colors.highlight },
  tabText: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: FontWeight.medium },
  tabTextActive: { color: Colors.highlight },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.textPrimary,
  },

  filterRow: { marginBottom: Spacing.sm },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.primaryLight,
    marginRight: Spacing.xs,
  },
  filterChipActive: { backgroundColor: Colors.highlight },
  filterChipText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  filterChipTextActive: { color: '#fff', fontWeight: FontWeight.semibold },

  listContent: { padding: Spacing.md, paddingTop: 0 },

  recordCard: { marginBottom: Spacing.sm, padding: Spacing.md },
  recordRow: { flexDirection: 'row', alignItems: 'center' },
  recordIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Spacing.md,
  },
  recordInfo: { flex: 1 },
  recordTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semibold, color: Colors.textPrimary },
  recordMeta: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 2 },
  recordMember: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  recordRight: { alignItems: 'flex-end' },
  recordAmount: { fontSize: FontSize.md, fontWeight: FontWeight.bold },
  recordDescription: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  deleteBtn: { marginTop: Spacing.xs, padding: 4 },

  emptyState: { alignItems: 'center', paddingVertical: Spacing.xxl },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold, color: Colors.textPrimary, marginTop: Spacing.md },
  emptyText: { fontSize: FontSize.sm, color: Colors.textLight, textAlign: 'center', marginTop: Spacing.xs, maxWidth: 280 },
  emptyActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },

  loadingMore: { paddingVertical: Spacing.lg, alignItems: 'center' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', alignItems: 'center' },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xxl,
    padding: Spacing.lg,
    maxHeight: '85%',
    width: '90%',
    maxWidth: 480,
    ...Shadow.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  modalTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  modalActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },

  fieldLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textLight,
    textTransform: 'uppercase',
    marginBottom: Spacing.xs,
    marginTop: Spacing.sm,
  },
  typeRow: { marginBottom: Spacing.sm },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.primaryLight,
    marginRight: Spacing.xs,
  },
  typeChipText: { fontSize: FontSize.sm, color: Colors.textSecondary, marginLeft: 4 },
  row: { flexDirection: 'row' },

  // Import result
  importResult: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: Spacing.lg },
  importStat: { alignItems: 'center' },
  importStatValue: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  importStatLabel: { fontSize: FontSize.sm, color: Colors.textLight },
  importErrors: {
    backgroundColor: Colors.error + '15',
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    maxHeight: 150,
  },
  importErrorsTitle: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold, color: Colors.error, marginBottom: Spacing.xs },
  importErrorItem: { fontSize: FontSize.xs, color: Colors.error, marginBottom: 2 },
});
