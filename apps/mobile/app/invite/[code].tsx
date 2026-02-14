// ============================================================
// OrgsLedger — Join Organization via Invite Code
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { api } from '../../src/api/client';
import { useAuthStore } from '../../src/stores/auth.store';
import {
  Colors, Spacing, FontSize, FontWeight, BorderRadius,
} from '../../src/theme';
import { Card, Button } from '../../src/components/ui';
import { showAlert } from '../../src/utils/alert';

export default function InviteJoinScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const loadUser = useAuthStore((s) => s.loadUser);

  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [invite, setInvite] = useState<any>(null);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    if (!code) { setError('No invite code provided'); setLoading(false); return; }
    fetchInvite();
  }, [code]);

  const fetchInvite = async () => {
    setLoading(true);
    try {
      const res = await api.subscriptions.validateInvite(code!);
      setInvite(res.data?.data || res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invalid or expired invite code');
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!isAuthenticated) {
      // Redirect to login with return path
      router.push(`/(auth)/login?redirect=/invite/${code}`);
      return;
    }
    setJoining(true);
    try {
      await api.subscriptions.joinViaInvite(code!);
      setJoined(true);
      await loadUser();
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to join organization');
    } finally {
      setJoining(false);
    }
  };

  const goHome = () => router.replace('/(tabs)/home');
  const goLogin = () => router.push(`/(auth)/login?redirect=/invite/${code}`);

  return (
    <>
      <Stack.Screen options={{ title: 'Join Organization', headerStyle: { backgroundColor: Colors.primary }, headerTintColor: Colors.textWhite }} />
      <View style={styles.container}>
        <View style={styles.content}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={Colors.highlight} />
              <Text style={styles.loadingText}>Verifying invite...</Text>
            </View>
          ) : error ? (
            <Card style={styles.card}>
              <View style={styles.iconWrap}>
                <Ionicons name="alert-circle" size={64} color={Colors.error} />
              </View>
              <Text style={styles.title}>Invalid Invite</Text>
              <Text style={styles.subtitle}>{error}</Text>
              <Button title="Go Home" onPress={goHome} variant="primary" />
            </Card>
          ) : joined ? (
            <Card style={styles.card}>
              <View style={styles.iconWrap}>
                <Ionicons name="checkmark-circle" size={64} color={Colors.success} />
              </View>
              <Text style={styles.title}>Welcome!</Text>
              <Text style={styles.subtitle}>
                You've successfully joined {invite?.organizationName || 'the organization'}.
              </Text>
              <Button title="Go to Dashboard" onPress={goHome} variant="primary" />
            </Card>
          ) : (
            <Card style={styles.card}>
              <View style={styles.iconWrap}>
                <Ionicons name="people" size={64} color={Colors.highlight} />
              </View>
              <Text style={styles.title}>You're Invited!</Text>

              {invite?.organizationName && (
                <View style={styles.orgBadge}>
                  <Ionicons name="business" size={18} color={Colors.highlight} />
                  <Text style={styles.orgName}>{invite.organizationName}</Text>
                </View>
              )}

              <Text style={styles.subtitle}>
                You've been invited to join this organization on OrgsLedger. Once you join, you'll have access to the organization's dashboard, meetings, finances, and more.
              </Text>

              {invite?.role && (
                <View style={styles.roleRow}>
                  <Ionicons name="shield-checkmark" size={14} color={Colors.info} />
                  <Text style={styles.roleText}>Role: {invite.role.replace('_', ' ')}</Text>
                </View>
              )}

              {isAuthenticated ? (
                <Button
                  title={joining ? 'Joining...' : 'Accept Invite & Join'}
                  onPress={handleJoin}
                  variant="primary"
                  disabled={joining}
                />
              ) : (
                <View style={styles.authActions}>
                  <Text style={styles.authHint}>You need an account to join this organization.</Text>
                  <Button title="Sign In" onPress={goLogin} variant="primary" />
                  <Button title="Create Account" onPress={() => router.push('/(auth)/register')} variant="outline" />
                </View>
              )}
            </Card>
          )}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1, justifyContent: 'center', padding: Spacing.lg, maxWidth: 460, alignSelf: 'center', width: '100%' },
  center: { alignItems: 'center', gap: Spacing.md },
  loadingText: { color: Colors.textSecondary, fontSize: FontSize.md },
  card: { padding: Spacing.xl, alignItems: 'center', gap: Spacing.md },
  iconWrap: { width: 100, height: 100, borderRadius: 50, backgroundColor: Colors.highlightSubtle, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: FontSize.title, fontWeight: FontWeight.bold as any, color: Colors.textPrimary, textAlign: 'center' },
  subtitle: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  orgBadge: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, backgroundColor: Colors.highlightSubtle, paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: BorderRadius.full },
  orgName: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold as any, color: Colors.highlight },
  roleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  roleText: { fontSize: FontSize.sm, color: Colors.info, textTransform: 'capitalize' },
  authActions: { width: '100%', gap: Spacing.sm, alignItems: 'center' },
  authHint: { fontSize: FontSize.sm, color: Colors.textLight, textAlign: 'center', marginBottom: Spacing.xs },
});
