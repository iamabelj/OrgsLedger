// ============================================================
// OrgsLedger Mobile — Polls Screen
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
import { showAlert } from '../../src/utils/alert';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Card, Button, Input } from '../../src/components/ui';
import { useResponsive } from '../../src/hooks/useResponsive';

export default function PollsScreen() {
  const [polls, setPolls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [creating, setCreating] = useState(false);

  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const memberships = useAuthStore((s) => s.memberships);
  const membership = memberships.find((m) => m.organization_id === currentOrgId);
  const isAdmin = membership?.role === 'org_admin' || membership?.role === 'executive';
  const responsive = useResponsive();

  const loadPolls = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const res = await api.polls.list(currentOrgId);
      setPolls(res.data.data || []);
    } catch (err) {
      console.error('Failed to load polls', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentOrgId]);

  useEffect(() => { loadPolls(); }, [loadPolls]);

  const handleCreate = async () => {
    const validOptions = options.filter((o) => o.trim());
    if (!title.trim()) {
      showAlert('Error', 'Title is required');
      return;
    }
    if (validOptions.length < 2) {
      showAlert('Error', 'At least 2 options are required');
      return;
    }
    setCreating(true);
    try {
      await api.polls.create(currentOrgId!, {
        title,
        description,
        options: validOptions,
      });
      showAlert('Success', 'Poll created');
      setShowCreate(false);
      setTitle('');
      setDescription('');
      setOptions(['', '']);
      loadPolls();
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to create poll');
    } finally {
      setCreating(false);
    }
  };

  const handleVote = async (pollId: string, optionId: string) => {
    try {
      await api.polls.vote(currentOrgId!, pollId, { optionId });
      showAlert('Done', 'Vote recorded!');
      loadPolls();
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to vote');
    }
  };

  const addOption = () => setOptions([...options, '']);
  const updateOption = (index: number, value: string) => {
    const updated = [...options];
    updated[index] = value;
    setOptions(updated);
  };
  const removeOption = (index: number) => {
    if (options.length <= 2) return;
    setOptions(options.filter((_, i) => i !== index));
  };

  const renderPoll = ({ item }: { item: any }) => {
    const isActive = item.status === 'active';
    const totalVotes = item.totalVotes || 0;

    return (
      <Card style={styles.pollCard}>
        <View style={styles.pollHeader}>
          <View style={[styles.statusBadge, { backgroundColor: isActive ? Colors.success + '20' : Colors.textLight + '20' }]}>
            <Text style={[styles.statusText, { color: isActive ? Colors.success : Colors.textLight }]}>
              {isActive ? 'Active' : 'Closed'}
            </Text>
          </View>
          {isAdmin && isActive && (
            <TouchableOpacity onPress={async () => {
              try {
                await api.polls.close(currentOrgId!, item.id);
                loadPolls();
              } catch {}
            }}>
              <Ionicons name="close-circle-outline" size={20} color={Colors.textLight} />
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.pollTitle}>{item.title}</Text>
        {item.description && <Text style={styles.pollDesc}>{item.description}</Text>}

        <View style={styles.optionsList}>
          {item.options?.map((opt: any) => {
            const pct = totalVotes > 0 ? Math.round((opt.voteCount / totalVotes) * 100) : 0;
            return (
              <TouchableOpacity
                key={opt.id}
                style={styles.optionRow}
                onPress={() => isActive && !item.userVoted && handleVote(item.id, opt.id)}
                disabled={!isActive || item.userVoted}
              >
                <View style={styles.optionBarBg}>
                  <View style={[styles.optionBarFill, { width: `${pct}%` }]} />
                </View>
                <View style={styles.optionContent}>
                  <Text style={styles.optionLabel}>{opt.label}</Text>
                  <Text style={styles.optionPct}>{pct}% ({opt.voteCount})</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.pollFooter}>
          <Text style={styles.totalVotes}>{totalVotes} vote{totalVotes !== 1 ? 's' : ''}</Text>
          {item.userVoted && <Text style={styles.votedText}>✓ You voted</Text>}
        </View>
      </Card>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' }]}>
        <Text style={styles.screenTitle}>Polls</Text>
        {isAdmin && (
          <Button title="Create Poll" onPress={() => setShowCreate(true)} icon="bar-chart-outline" size="sm" />
        )}
      </View>

      <FlatList
        data={polls}
        renderItem={renderPoll}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadPolls(); }} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="bar-chart-outline" size={48} color={Colors.textLight} />
            <Text style={styles.emptyText}>No polls yet</Text>
          </View>
        }
      />

      {/* Create Poll Modal */}
      <Modal visible={showCreate} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: responsive.contentMaxWidth }]}>
            <ScrollView>
              <Text style={styles.modalTitle}>Create Poll</Text>

              <Input label="QUESTION" placeholder="What would you like to ask?" value={title} onChangeText={setTitle} />
              <Input label="DESCRIPTION (optional)" placeholder="More context..." value={description} onChangeText={setDescription} multiline />

              <Text style={styles.fieldLabel}>OPTIONS</Text>
              {options.map((opt, idx) => (
                <View key={idx} style={styles.optionInputRow}>
                  <Input
                    placeholder={`Option ${idx + 1}`}
                    value={opt}
                    onChangeText={(v) => updateOption(idx, v)}
                    style={{ flex: 1 }}
                  />
                  {options.length > 2 && (
                    <TouchableOpacity onPress={() => removeOption(idx)} style={styles.removeOption}>
                      <Ionicons name="close-circle" size={22} color={Colors.error} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}

              <TouchableOpacity style={styles.addOptionBtn} onPress={addOption}>
                <Ionicons name="add-circle-outline" size={20} color={Colors.primary} />
                <Text style={styles.addOptionText}>Add Option</Text>
              </TouchableOpacity>

              <View style={styles.modalActions}>
                <Button title="Cancel" onPress={() => setShowCreate(false)} variant="outline" style={{ flex: 1, marginRight: Spacing.sm }} />
                <Button title="Create" onPress={handleCreate} loading={creating} icon="checkmark-outline" style={{ flex: 1 }} />
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.md, paddingTop: Spacing.lg },
  screenTitle: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold as any, color: Colors.textPrimary },
  list: { padding: Spacing.md, paddingTop: 0 },
  pollCard: { marginBottom: Spacing.md },
  pollHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  statusBadge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.sm },
  statusText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold as any },
  pollTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold as any, color: Colors.textPrimary },
  pollDesc: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.xs },
  optionsList: { marginTop: Spacing.md, gap: Spacing.sm },
  optionRow: { position: 'relative', borderRadius: BorderRadius.md, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  optionBarBg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  optionBarFill: { height: '100%', backgroundColor: Colors.primary + '15', borderRadius: BorderRadius.md },
  optionContent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.sm, paddingHorizontal: Spacing.md },
  optionLabel: { fontSize: FontSize.md, color: Colors.textPrimary, fontWeight: FontWeight.medium as any },
  optionPct: { fontSize: FontSize.sm, color: Colors.textLight },
  pollFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border },
  totalVotes: { fontSize: FontSize.sm, color: Colors.textLight },
  votedText: { fontSize: FontSize.sm, color: Colors.success, fontWeight: FontWeight.medium as any },
  empty: { alignItems: 'center', padding: Spacing.xxl },
  emptyText: { fontSize: FontSize.md, color: Colors.textLight, marginTop: Spacing.md },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: Spacing.md },
  modalContent: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, alignSelf: 'center', width: '100%', maxHeight: '85%' },
  modalTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold as any, color: Colors.textPrimary, marginBottom: Spacing.lg },
  fieldLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold as any, color: Colors.textSecondary, letterSpacing: 1, marginBottom: Spacing.xs, marginTop: Spacing.md },
  optionInputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  removeOption: { paddingTop: Spacing.md },
  addOptionBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, padding: Spacing.sm, marginTop: Spacing.xs },
  addOptionText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: FontWeight.medium as any },
  modalActions: { flexDirection: 'row', marginTop: Spacing.lg },
});
