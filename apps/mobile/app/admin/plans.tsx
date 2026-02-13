// ============================================================
// OrgsLedger — Subscription Plans Screen (Free + Premium AI)
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../src/theme';
import { Card, SectionHeader, Button } from '../../src/components/ui';
import { showAlert } from '../../src/utils/alert';

const AI_PRICE_PER_HOUR = 7;

export default function PlansScreen() {
  const user = useAuthStore((s) => s.user);
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const memberships = useAuthStore((s) => s.memberships);
  const currentMembership = memberships.find((m) => m.organization_id === currentOrgId);

  const [loading, setLoading] = useState(true);
  const [credits, setCredits] = useState({ total: 0, used: 0, remaining: 0, pricePerHour: AI_PRICE_PER_HOUR });
  const [purchaseHours, setPurchaseHours] = useState('1');
  const [purchasing, setPurchasing] = useState(false);

  const globalRole = useAuthStore((s) => s.user?.globalRole);
  const isOwner = globalRole === 'super_admin' || currentMembership?.role === 'org_admin';

  useEffect(() => {
    loadCredits();
  }, []);

  const loadCredits = async () => {
    if (!currentOrgId) return;
    try {
      setLoading(true);
      const res = await api.aiCredits.get(currentOrgId);
      const d = res.data?.data;
      if (d) {
        setCredits({
          total: d.totalCredits || 0,
          used: d.usedCredits || 0,
          remaining: d.remainingCredits || 0,
          pricePerHour: d.pricePerCreditHour || AI_PRICE_PER_HOUR,
        });
      }
    } catch {
      // Default state is fine
    } finally {
      setLoading(false);
    }
  };

  const handlePurchase = async () => {
    if (!isOwner) {
      showAlert('Permission Denied', 'Only organization admins can purchase AI credits.');
      return;
    }
    const hours = parseInt(purchaseHours, 10);
    if (!hours || hours < 1) {
      showAlert('Invalid', 'Enter at least 1 hour.');
      return;
    }
    const totalCost = hours * credits.pricePerHour;
    showAlert(
      'Purchase AI Credits',
      `Buy ${hours} hour${hours > 1 ? 's' : ''} of AI processing for $${totalCost.toFixed(2)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Purchase',
          onPress: async () => {
            try {
              setPurchasing(true);
              await api.aiCredits.purchase(currentOrgId!, { credits: hours });
              showAlert('Success', `${hours} AI credit${hours > 1 ? 's' : ''} added!`);
              await loadCredits();
            } catch (err: any) {
              showAlert('Error', err?.response?.data?.error || 'Purchase failed');
            } finally {
              setPurchasing(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={Colors.highlight} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <SectionHeader title="AI Credits" />
        <Text style={styles.subtitle}>
          Pay-as-you-go AI-powered services for your organization.
        </Text>
      </View>

      {/* Premium AI Card */}
      <Card style={styles.planCard}>
        <View style={styles.aiBadge}>
          <Ionicons name="sparkles" size={16} color={Colors.highlight} />
          <Text style={styles.aiText}>AI Premium</Text>
        </View>
        <Text style={styles.planName}>AI Credits</Text>
        <Text style={styles.planDescription}>
          Pay-as-you-go AI meeting transcription, summaries & insights
        </Text>
        <View style={styles.priceContainer}>
          <Text style={styles.price}>${credits.pricePerHour}</Text>
          <Text style={styles.priceInterval}>/hour</Text>
        </View>

        <View style={styles.features}>
          {[
            'AI meeting transcription',
            'Automatic meeting summaries',
            'Action item extraction',
            'Financial insights',
            '1 credit = 1 hour of processing',
          ].map((f, i) => (
            <View key={i} style={styles.featureRow}>
              <Ionicons name="sparkles-outline" size={18} color={Colors.highlight} />
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>

        {/* Credits Balance */}
        <View style={styles.creditsSection}>
          <Text style={styles.creditsLabel}>Your AI Credits</Text>
          <View style={styles.creditsRow}>
            <View style={styles.creditStat}>
              <Text style={styles.creditNumber}>{credits.remaining}</Text>
              <Text style={styles.creditDesc}>Available</Text>
            </View>
            <View style={styles.creditStat}>
              <Text style={styles.creditNumber}>{credits.used}</Text>
              <Text style={styles.creditDesc}>Used</Text>
            </View>
            <View style={styles.creditStat}>
              <Text style={styles.creditNumber}>{credits.total}</Text>
              <Text style={styles.creditDesc}>Total</Text>
            </View>
          </View>
        </View>

        {/* Purchase Section */}
        {isOwner && (
          <View style={styles.purchaseSection}>
            <Text style={styles.purchaseLabel}>Buy AI Credits</Text>
            <View style={styles.purchaseRow}>
              <TextInput
                style={styles.hoursInput}
                value={purchaseHours}
                onChangeText={setPurchaseHours}
                keyboardType="number-pad"
                placeholder="Hours"
                placeholderTextColor={Colors.textLight}
              />
              <Text style={styles.purchaseCost}>
                = ${(parseInt(purchaseHours, 10) || 0) * credits.pricePerHour}
              </Text>
              <Button
                title={purchasing ? 'Buying...' : 'Buy'}
                onPress={handlePurchase}
                variant="primary"
                disabled={purchasing}
              />
            </View>
          </View>
        )}
        {!isOwner && (
          <Text style={styles.permissionNote}>Only admins can purchase credits</Text>
        )}
      </Card>

      <View style={{ height: Spacing.xxl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    padding: Spacing.lg,
  },
  subtitle: {
    fontSize: FontSize.md,
    color: Colors.textLight,
    marginTop: Spacing.sm,
  },
  planCard: {
    margin: Spacing.md,
    padding: Spacing.lg,
    position: 'relative',
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    backgroundColor: Colors.highlightSubtle,
    borderRadius: BorderRadius.full,
    marginBottom: Spacing.sm,
  },
  aiText: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold as any,
    color: Colors.highlight,
  },
  planName: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold as any,
    color: Colors.textWhite,
    marginBottom: Spacing.xs,
  },
  planDescription: {
    fontSize: FontSize.md,
    color: Colors.textLight,
    marginBottom: Spacing.md,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: Spacing.lg,
  },
  price: {
    fontSize: 48,
    fontWeight: FontWeight.bold as any,
    color: Colors.highlight,
  },
  priceInterval: {
    fontSize: FontSize.md,
    color: Colors.textLight,
    marginLeft: Spacing.xs,
  },
  features: {
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  featureText: {
    fontSize: FontSize.md,
    color: Colors.textLight,
    flex: 1,
  },
  creditsSection: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.md,
    marginBottom: Spacing.md,
  },
  creditsLabel: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semibold as any,
    color: Colors.textWhite,
    marginBottom: Spacing.sm,
  },
  creditsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  creditStat: {
    alignItems: 'center',
  },
  creditNumber: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold as any,
    color: Colors.highlight,
  },
  creditDesc: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
  },
  purchaseSection: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.md,
  },
  purchaseLabel: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold as any,
    color: Colors.textWhite,
    marginBottom: Spacing.sm,
  },
  purchaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  hoursInput: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    color: Colors.textWhite,
    fontSize: FontSize.md,
    width: 70,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  purchaseCost: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold as any,
    color: Colors.highlight,
    flex: 1,
  },
  permissionNote: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
    textAlign: 'center',
    marginTop: Spacing.sm,
    fontStyle: 'italic',
  },
});
