// ============================================================
// OrgsLedger — Invite Link Management
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../src/theme';
import { ResponsiveScrollView } from '../../src/components/ui';

type InviteLink = {
  id: string;
  code: string;
  role: string;
  max_uses: number | null;
  use_count: number;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
};

export default function InvitesScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const [invites, setInvites] = useState<InviteLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const res = await api.subscriptions.getInvites(currentOrgId);
      setInvites(res.data.data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
    setRefreshing(false);
  }, [currentOrgId]);

  useEffect(() => { load(); }, [load]);

  const doAlert = (t: string, m: string) => Platform.OS === 'web' ? window.alert(`${t}: ${m}`) : Alert.alert(t, m);

  const createInvite = async () => {
    if (!currentOrgId) return;
    setCreating(true);
    try {
      const res = await api.subscriptions.createInvite(currentOrgId, { role: 'member', maxUses: 50 });
      doAlert('Success', `Invite link created: ${res.data.data.inviteUrl}`);
      load();
    } catch (e: any) {
      doAlert('Error', e.response?.data?.error || 'Failed to create invite');
    }
    setCreating(false);
  };

  const deactivateInvite = async (id: string) => {
    if (!currentOrgId) return;
    try {
      await api.subscriptions.deleteInvite(currentOrgId, id);
      doAlert('Done', 'Invite link deactivated');
      load();
    } catch (e: any) {
      doAlert('Error', e.response?.data?.error || 'Failed');
    }
  };

  const shareInvite = async (code: string) => {
    const url = `${Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : 'https://app.orgsledger.com'}/join/${code}`;
    if (Platform.OS === 'web') {
      try { await navigator.clipboard.writeText(url); doAlert('Copied', 'Invite URL copied to clipboard'); } catch { doAlert('Link', url); }
    } else {
      Share.share({ message: `Join our organization on OrgsLedger: ${url}` });
    }
  };

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color={Colors.highlight} /></View>;

  return (
    <ResponsiveScrollView style={s.root} refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
      <View style={s.header}>
        <Text style={s.title}>Invite Links</Text>
        <TouchableOpacity style={s.createBtn} onPress={createInvite} disabled={creating}>
          {creating ? <ActivityIndicator size="small" color={Colors.primary} /> : (
            <><Ionicons name="add" size={18} color={Colors.primary} /><Text style={s.createTxt}>New Invite</Text></>
          )}
        </TouchableOpacity>
      </View>

      <Text style={s.desc}>Share invite links with members to join your organization. Each link can have a usage limit.</Text>

      {invites.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="link-outline" size={40} color={Colors.textLight} />
          <Text style={s.emptyTxt}>No invite links yet</Text>
          <Text style={s.emptySub}>Create one to start inviting members</Text>
        </View>
      ) : (
        invites.map(inv => (
          <View key={inv.id} style={[s.card, !inv.is_active && s.cardInactive]}>
            <View style={s.cardHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.code}>{inv.code}</Text>
                <Text style={s.meta}>
                  Role: {inv.role} · Used: {inv.use_count}{inv.max_uses ? `/${inv.max_uses}` : ''} times
                </Text>
                {inv.expires_at && (
                  <Text style={s.meta}>Expires: {new Date(inv.expires_at).toLocaleDateString()}</Text>
                )}
              </View>
              <View style={[s.statusBadge, { backgroundColor: inv.is_active ? Colors.success + '22' : Colors.error + '22' }]}>
                <Text style={[s.statusTxt, { color: inv.is_active ? Colors.success : Colors.error }]}>
                  {inv.is_active ? 'Active' : 'Inactive'}
                </Text>
              </View>
            </View>

            {inv.is_active && (
              <View style={s.actions}>
                <TouchableOpacity style={s.actionBtn} onPress={() => shareInvite(inv.code)}>
                  <Ionicons name="share-outline" size={14} color={Colors.highlight} />
                  <Text style={s.actionTxt}>Share</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.actionBtn, { borderColor: Colors.error }]} onPress={() => deactivateInvite(inv.id)}>
                  <Ionicons name="close-circle-outline" size={14} color={Colors.error} />
                  <Text style={[s.actionTxt, { color: Colors.error }]}>Deactivate</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))
      )}

      <View style={{ height: 40 }} />
    </ResponsiveScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.md },
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold as any, color: Colors.textPrimary },
  createBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.highlight, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md },
  createTxt: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold as any, color: Colors.primary },
  desc: { fontSize: FontSize.sm, color: Colors.textSecondary, paddingHorizontal: Spacing.md, marginBottom: Spacing.md },
  empty: { alignItems: 'center', paddingVertical: Spacing.xxl, gap: Spacing.sm },
  emptyTxt: { fontSize: FontSize.md, color: Colors.textSecondary, fontWeight: FontWeight.medium as any },
  emptySub: { fontSize: FontSize.sm, color: Colors.textLight },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.md, marginHorizontal: Spacing.md, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  cardInactive: { opacity: 0.6 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  code: { fontSize: FontSize.lg, fontWeight: FontWeight.bold as any, color: Colors.highlight, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  meta: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 4 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  statusTxt: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold as any },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.highlight },
  actionTxt: { fontSize: FontSize.xs, color: Colors.highlight, fontWeight: FontWeight.medium as any },
});
