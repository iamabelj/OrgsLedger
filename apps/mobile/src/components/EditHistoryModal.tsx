// ============================================================
// EditHistoryModal — Shows edit history for any entity
// Visible to ALL members regardless of role
// ============================================================

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api/client';
import { useAuthStore } from '../stores/auth.store';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../theme';

interface EditHistoryModalProps {
  visible: boolean;
  onClose: () => void;
  entityType: string;
  entityId?: string;
  entityLabel?: string;
}

interface EditRecord {
  id: string;
  editedBy: string;
  previous_value: Record<string, any>;
  new_value: Record<string, any>;
  created_at: string;
}

// Human-readable field labels
const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  body: 'Body',
  description: 'Description',
  priority: 'Priority',
  pinned: 'Pinned',
  location: 'Location',
  start_date: 'Start Date',
  end_date: 'End Date',
  all_day: 'All Day',
  category: 'Category',
  max_attendees: 'Max Attendees',
  rsvp_required: 'RSVP Required',
  expires_at: 'Expires At',
  amount: 'Amount',
  due_date: 'Due Date',
  late_fee_amount: 'Late Fee Amount',
  late_fee_grace_days: 'Late Fee Grace Days',
  reason: 'Reason',
  status: 'Status',
  goal_amount: 'Goal Amount',
  is_active: 'Active',
};

function formatValue(val: any): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (typeof val === 'string') {
    // Try to parse as date
    const d = new Date(val);
    if (!isNaN(d.getTime()) && val.includes('T')) {
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    return val;
  }
  return String(val);
}

export default function EditHistoryModal({
  visible,
  onClose,
  entityType,
  entityId,
  entityLabel,
}: EditHistoryModalProps) {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const [records, setRecords] = useState<EditRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (visible && currentOrgId) {
      setRecords([]);
      setPage(1);
      setHasMore(true);
      loadHistory(1);
    }
  }, [visible, currentOrgId, entityType, entityId]);

  const loadHistory = async (p: number) => {
    if (!currentOrgId) return;
    setLoading(true);
    try {
      const params: any = { page: p, limit: 20, entityType };
      if (entityId) params.entityId = entityId;
      const res = await api.orgs.getEditHistory(currentOrgId, params);
      const data = res.data.data || [];
      if (p === 1) {
        setRecords(data);
      } else {
        setRecords((prev) => [...prev, ...data]);
      }
      setHasMore(data.length === 20);
    } catch (err) {
      console.warn('Failed to load edit history:', err);
    } finally {
      setLoading(false);
    }
  };

  const renderChange = (prev: Record<string, any>, next: Record<string, any>) => {
    const fields = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
    return Array.from(fields).map((field) => (
      <View key={field} style={styles.changeRow}>
        <Text style={styles.fieldName}>{FIELD_LABELS[field] || field}</Text>
        <View style={styles.changeValues}>
          <View style={styles.oldValue}>
            <Text style={styles.changeLabel}>Before:</Text>
            <Text style={styles.changeText} numberOfLines={3}>{formatValue(prev?.[field])}</Text>
          </View>
          <Ionicons name="arrow-forward" size={14} color={Colors.textLight} style={{ marginHorizontal: 4 }} />
          <View style={styles.newValue}>
            <Text style={styles.changeLabel}>After:</Text>
            <Text style={styles.changeText} numberOfLines={3}>{formatValue(next?.[field])}</Text>
          </View>
        </View>
      </View>
    ));
  };

  const renderRecord = ({ item }: { item: EditRecord }) => {
    const date = new Date(item.created_at);
    return (
      <View style={styles.recordCard}>
        <View style={styles.recordHeader}>
          <View style={styles.editorRow}>
            <View style={styles.editorAvatar}>
              <Ionicons name="person" size={14} color={Colors.primary} />
            </View>
            <Text style={styles.editorName}>{item.editedBy}</Text>
          </View>
          <Text style={styles.recordDate}>
            {date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            {' '}
            {date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
        <View style={styles.changesContainer}>
          {renderChange(item.previous_value, item.new_value)}
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Edit History</Text>
              {entityLabel && (
                <Text style={styles.subtitle}>{entityLabel}</Text>
              )}
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <FlatList
            data={records}
            renderItem={renderRecord}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            onEndReached={() => {
              if (hasMore && !loading) {
                const next = page + 1;
                setPage(next);
                loadHistory(next);
              }
            }}
            onEndReachedThreshold={0.3}
            ListEmptyComponent={
              loading ? null : (
                <View style={styles.empty}>
                  <Ionicons name="document-text-outline" size={48} color={Colors.textLight} />
                  <Text style={styles.emptyText}>No edit history</Text>
                  <Text style={styles.emptySubtext}>Changes to this item will be logged here</Text>
                </View>
              )
            }
            ListFooterComponent={
              loading ? (
                <View style={styles.loadingFooter}>
                  <ActivityIndicator size="small" color={Colors.primary} />
                </View>
              ) : null
            }
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.xl,
    borderTopRightRadius: BorderRadius.xl,
    maxHeight: '85%',
    minHeight: '50%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold as any,
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
    marginTop: 2,
  },
  closeBtn: {
    padding: Spacing.xs,
  },
  list: {
    padding: Spacing.md,
  },
  recordCard: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  recordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  editorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  editorAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editorName: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold as any,
    color: Colors.textPrimary,
  },
  recordDate: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
  },
  changesContainer: {
    gap: Spacing.sm,
  },
  changeRow: {
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
  },
  fieldName: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold as any,
    color: Colors.highlight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  changeValues: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  oldValue: {
    flex: 1,
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderRadius: BorderRadius.sm,
    padding: Spacing.xs,
  },
  newValue: {
    flex: 1,
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderRadius: BorderRadius.sm,
    padding: Spacing.xs,
  },
  changeLabel: {
    fontSize: 10,
    fontWeight: FontWeight.semibold as any,
    color: Colors.textLight,
    marginBottom: 2,
  },
  changeText: {
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
  },
  empty: {
    alignItems: 'center',
    padding: Spacing.xxl,
  },
  emptyText: {
    fontSize: FontSize.md,
    color: Colors.textLight,
    fontWeight: FontWeight.medium as any,
    marginTop: Spacing.md,
  },
  emptySubtext: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
    marginTop: Spacing.xs,
    textAlign: 'center',
  },
  loadingFooter: {
    padding: Spacing.md,
    alignItems: 'center',
  },
});
