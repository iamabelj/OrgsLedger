// ============================================================
// OrgsLedger Mobile — AI Meeting Insights Dashboard
// Comprehensive analytics for AI-powered meeting minutes
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Card, SectionHeader, StatCard, LoadingScreen, PoweredByFooter, Badge } from '../../src/components/ui';
import { useResponsive } from '../../src/hooks/useResponsive';

interface IMeetingInsights {
  overview: {
    totalMeetings: number;
    meetingsWithAI: number;
    minutesGenerated: number;
    totalAiCreditsUsed: number;
    avgAttendance: number;
    avgDuration: string;
    maxDuration: string;
    minDuration: string;
  };
  decisions: {
    totalDecisions: number;
    totalActionItems: number;
    actionItemsByPriority: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
    totalMotions: number;
    avgDecisionsPerMeeting: string;
    avgActionItemsPerMeeting: string;
  };
  contributors: Array<{
    name: string;
    speakingTimeMinutes: number;
  }>;
  trends: {
    meetingFrequency: Array<{
      month: string;
      count: number;
    }>;
    minutesTrend: Array<{
      month: string;
      count: number;
      creditsUsed: number;
    }>;
  };
  recent: {
    meetingsLast30Days: number;
    minutesLast30Days: number;
  };
}

export default function MeetingInsightsScreen() {
  const [insights, setInsights] = useState<IMeetingInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<'overview' | 'trends' | 'contributors'>('overview');

  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const memberships = useAuthStore((s) => s.memberships);
  const currentOrg = memberships.find((m) => m.organization_id === currentOrgId);
  const responsive = useResponsive();

  const loadInsights = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      setError(null);
      const res = await api.analytics.meetingInsights(currentOrgId);
      setInsights(res.data.data);
    } catch (err) {
      setError('Failed to load meeting insights');
      console.error('Meeting insights error:', err);
    }

    setLoading(false);
    setRefreshing(false);
  }, [currentOrgId]);

  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadInsights();
  }, [loadInsights]);

  if (loading) return <LoadingScreen />;

  if (error || !insights) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Meeting Insights' }} />
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={64} color={Colors.error} />
          <Text style={styles.errorText}>{error || 'No data available'}</Text>
          <TouchableOpacity onPress={onRefresh} style={styles.retryButton}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const data = insights;
  const aiAdoptionRate = data.overview.totalMeetings > 0
    ? ((data.overview.meetingsWithAI / data.overview.totalMeetings) * 100).toFixed(0)
    : '0';
  
  const minutesGenerationRate = data.overview.meetingsWithAI > 0
    ? ((data.overview.minutesGenerated / data.overview.meetingsWithAI) * 100).toFixed(0)
    : '0';

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.highlight} />
      }
      contentContainerStyle={{ maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' }}
    >
      <Stack.Screen options={{ title: 'AI Meeting Insights' }} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Ionicons name="analytics" size={28} color={Colors.highlight} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>AI Meeting Insights</Text>
          <Text style={styles.headerSubtitle}>{currentOrg?.organizationName || 'Organization'}</Text>
        </View>
      </View>

      {/* Tab Navigation */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, selectedTab === 'overview' && styles.tabActive]}
          onPress={() => setSelectedTab('overview')}
        >
          <Ionicons
            name="stats-chart"
            size={18}
            color={selectedTab === 'overview' ? Colors.highlight : Colors.textLight}
          />
          <Text style={[styles.tabText, selectedTab === 'overview' && styles.tabTextActive]}>
            Overview
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, selectedTab === 'trends' && styles.tabActive]}
          onPress={() => setSelectedTab('trends')}
        >
          <Ionicons
            name="trending-up"
            size={18}
            color={selectedTab === 'trends' ? Colors.highlight : Colors.textLight}
          />
          <Text style={[styles.tabText, selectedTab === 'trends' && styles.tabTextActive]}>
            Trends
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, selectedTab === 'contributors' && styles.tabActive]}
          onPress={() => setSelectedTab('contributors')}
        >
          <Ionicons
            name="people"
            size={18}
            color={selectedTab === 'contributors' ? Colors.highlight : Colors.textLight}
          />
          <Text style={[styles.tabText, selectedTab === 'contributors' && styles.tabTextActive]}>
            Contributors
          </Text>
        </TouchableOpacity>
      </View>

      {/* Overview Tab */}
      {selectedTab === 'overview' && (
        <>
          {/* Key Metrics */}
          <View style={styles.section}>
            <SectionHeader title="Key Metrics" />
            <View style={styles.statsGrid}>
              <StatCard
                label="Total Meetings"
                value={data.overview.totalMeetings.toString()}
                icon="videocam"
              />
              <StatCard
                label="AI-Enabled"
                value={data.overview.meetingsWithAI.toString()}
                icon="flash"
              />
            </View>
            <View style={styles.statsGrid}>
              <StatCard
                label="Minutes Generated"
                value={data.overview.minutesGenerated.toString()}
                icon="document-text"
              />
              <StatCard
                label="AI Adoption"
                value={`${aiAdoptionRate}%`}
                icon="trending-up"
              />
            </View>
          </View>

          {/* Meeting Statistics */}
          <View style={styles.section}>
            <SectionHeader title="Meeting Statistics" />
            <Card style={styles.statsCard}>
              <View style={styles.statRow}>
                <View style={styles.statItem}>
                  <Ionicons name="time" size={24} color={Colors.info} />
                  <Text style={styles.statLabel}>Avg Duration</Text>
                  <Text style={styles.statValue}>{parseFloat(data.overview.avgDuration).toFixed(0)} min</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.statItem}>
                  <Ionicons name="people" size={24} color={Colors.success} />
                  <Text style={styles.statLabel}>Avg Attendance</Text>
                  <Text style={styles.statValue}>{data.overview.avgAttendance}</Text>
                </View>
              </View>
            </Card>

            <Card style={styles.statsCard}>
              <View style={styles.statRow}>
                <View style={styles.statItem}>
                  <Ionicons name="hourglass" size={24} color={Colors.warning} />
                  <Text style={styles.statLabel}>Longest</Text>
                  <Text style={styles.statValue}>{parseFloat(data.overview.maxDuration).toFixed(0)} min</Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.statItem}>
                  <Ionicons name="speedometer" size={24} color={Colors.highlight} />
                  <Text style={styles.statLabel}>Shortest</Text>
                  <Text style={styles.statValue}>{parseFloat(data.overview.minDuration).toFixed(0)} min</Text>
                </View>
              </View>
            </Card>
          </View>

          {/* Decisions & Actions */}
          <View style={styles.section}>
            <SectionHeader title="Decisions & Action Items" />
            <View style={styles.statsGrid}>
              <StatCard
                label="Total Decisions"
                value={data.decisions.totalDecisions.toString()}
                icon="checkmark-done"
              />
              <StatCard
                label="Action Items"
                value={data.decisions.totalActionItems.toString()}
                icon="list"
              />
            </View>
            <View style={styles.statsGrid}>
              <StatCard
                label="Motions Recorded"
                value={data.decisions.totalMotions.toString()}
                icon="megaphone"
              />
              <StatCard
                label="Avg Decisions/Meeting"
                value={data.decisions.avgDecisionsPerMeeting}
                icon="podium"
              />
            </View>

            {/* Action Items Priority Breakdown */}
            <SectionHeader title="Action Items by Priority" />
            <Card style={styles.priorityCard}>
              <View style={styles.priorityRow}>
                <View style={styles.priorityItem}>
                  <View style={[styles.priorityBadge, { backgroundColor: '#DC2626' }]} />
                  <View>
                    <Text style={styles.priorityLabel}>Critical</Text>
                    <Text style={styles.priorityCount}>{data.decisions.actionItemsByPriority.critical}</Text>
                  </View>
                </View>
                <View style={styles.priorityItem}>
                  <View style={[styles.priorityBadge, { backgroundColor: '#EA580C' }]} />
                  <View>
                    <Text style={styles.priorityLabel}>High</Text>
                    <Text style={styles.priorityCount}>{data.decisions.actionItemsByPriority.high}</Text>
                  </View>
                </View>
                <View style={styles.priorityItem}>
                  <View style={[styles.priorityBadge, { backgroundColor: '#F59E0B' }]} />
                  <View>
                    <Text style={styles.priorityLabel}>Medium</Text>
                    <Text style={styles.priorityCount}>{data.decisions.actionItemsByPriority.medium}</Text>
                  </View>
                </View>
                <View style={styles.priorityItem}>
                  <View style={[styles.priorityBadge, { backgroundColor: '#10B981' }]} />
                  <View>
                    <Text style={styles.priorityLabel}>Low</Text>
                    <Text style={styles.priorityCount}>{data.decisions.actionItemsByPriority.low}</Text>
                  </View>
                </View>
              </View>
            </Card>
          </View>

          {/* AI Usage */}
          <View style={styles.section}>
            <SectionHeader title="AI Credits Usage" />
            <Card style={styles.aiUsageCard}>
              <View style={styles.aiUsageHeader}>
                <Ionicons name="flash" size={32} color={Colors.highlight} />
                <View style={{ flex: 1, marginLeft: Spacing.md }}>
                  <Text style={styles.aiUsageLabel}>Total AI Credits Used</Text>
                  <Text style={styles.aiUsageValue}>
                    {(data.overview.totalAiCreditsUsed / 60).toFixed(1)} hours
                  </Text>
                  <Text style={styles.aiUsageMinutes}>
                    {data.overview.totalAiCreditsUsed.toFixed(0)} minutes
                  </Text>
                </View>
              </View>
              <View style={styles.aiUsageBar}>
                <View style={styles.aiUsageBarFill} />
              </View>
              <Text style={styles.aiUsageHint}>
                Minutes generated: {data.overview.minutesGenerated} ({minutesGenerationRate}% success rate)
              </Text>
            </Card>
          </View>

          {/* Recent Activity */}
          <View style={styles.section}>
            <SectionHeader title="Last 30 Days" />
            <Card style={styles.recentCard}>
              <View style={styles.recentRow}>
                <Ionicons name="calendar" size={20} color={Colors.info} />
                <Text style={styles.recentLabel}>Meetings Held</Text>
                <Badge variant="info" label={data.recent.meetingsLast30Days.toString()} />
              </View>
              <View style={styles.recentRow}>
                <Ionicons name="document-text" size={20} color={Colors.success} />
                <Text style={styles.recentLabel}>Minutes Generated</Text>
                <Badge variant="success" label={data.recent.minutesLast30Days.toString()} />
              </View>
            </Card>
          </View>
        </>
      )}

      {/* Trends Tab */}
      {selectedTab === 'trends' && (
        <>
          <View style={styles.section}>
            <SectionHeader title="Meeting Frequency (Last 6 Months)" />
            <Card style={styles.chartCard}>
              {data.trends.meetingFrequency.length > 0 ? (
                data.trends.meetingFrequency.map((item: any, index: number) => {
                  const maxCount = Math.max(...data.trends.meetingFrequency.map((m: any) => m.count));
                  const percentage = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
                  const monthLabel = new Date(item.month + '-01').toLocaleDateString('en-US', {
                    month: 'short',
                    year: '2-digit',
                  });

                  return (
                    <View key={index} style={styles.chartRow}>
                      <Text style={styles.chartLabel}>{monthLabel}</Text>
                      <View style={styles.chartBarContainer}>
                        <View style={[styles.chartBar, { width: `${percentage}%` }]} />
                      </View>
                      <Text style={styles.chartValue}>{item.count}</Text>
                    </View>
                  );
                })
              ) : (
                <Text style={styles.emptyText}>No meeting data available</Text>
              )}
            </Card>
          </View>

          <View style={styles.section}>
            <SectionHeader title="AI Minutes Generation (Last 6 Months)" />
            <Card style={styles.chartCard}>
              {data.trends.minutesTrend.length > 0 ? (
                data.trends.minutesTrend.map((item: any, index: number) => {
                  const maxCount = Math.max(...data.trends.minutesTrend.map((m: any) => m.count));
                  const percentage = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
                  const monthLabel = new Date(item.month + '-01').toLocaleDateString('en-US', {
                    month: 'short',
                    year: '2-digit',
                  });

                  return (
                    <View key={index} style={styles.chartRow}>
                      <Text style={styles.chartLabel}>{monthLabel}</Text>
                      <View style={styles.chartBarContainer}>
                        <View style={[styles.chartBar, { width: `${percentage}%`, backgroundColor: Colors.highlight }]} />
                      </View>
                      <Text style={styles.chartValue}>{item.count}</Text>
                      <Text style={styles.chartCredits}>{(item.creditsUsed / 60).toFixed(1)}h</Text>
                    </View>
                  );
                })
              ) : (
                <Text style={styles.emptyText}>No AI minutes data available</Text>
              )}
            </Card>
          </View>
        </>
      )}

      {/* Contributors Tab */}
      {selectedTab === 'contributors' && (
        <View style={styles.section}>
          <SectionHeader title="Top Contributors by Speaking Time" />
          {data.contributors.length > 0 ? (
            <Card style={styles.contributorsCard}>
              {data.contributors.map((contributor: any, index: number) => {
                const maxMinutes = Math.max(...data.contributors.map((c: any) => c.speakingTimeMinutes));
                const percentage = maxMinutes > 0 ? (contributor.speakingTimeMinutes / maxMinutes) * 100 : 0;
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';

                return (
                  <View key={index} style={styles.contributorRow}>
                    <View style={styles.contributorRank}>
                      <Text style={styles.contributorRankText}>{medal || `${index + 1}`}</Text>
                    </View>
                    <View style={styles.contributorInfo}>
                      <Text style={styles.contributorName}>{contributor.name}</Text>
                      <View style={styles.contributorBarContainer}>
                        <View style={[styles.contributorBar, { width: `${percentage}%` }]} />
                      </View>
                    </View>
                    <View style={styles.contributorTime}>
                      <Text style={styles.contributorTimeValue}>{contributor.speakingTimeMinutes}</Text>
                      <Text style={styles.contributorTimeLabel}>min</Text>
                    </View>
                  </View>
                );
              })}
            </Card>
          ) : (
            <Card style={styles.emptyCard}>
              <Ionicons name="people-outline" size={48} color={Colors.textLight} />
              <Text style={styles.emptyText}>No contributor data available yet</Text>
              <Text style={styles.emptyHint}>
                Speaking time is tracked when AI minutes are generated from meetings
              </Text>
            </Card>
          )}
        </View>
      )}

      {/* Footer */}
      <PoweredByFooter />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    gap: Spacing.md,
    ...Shadow.sm,
  },
  headerIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
    marginTop: 2,
  },
  section: {
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  statsCard: {
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  statLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  statValue: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  divider: {
    width: 1,
    height: 60,
    backgroundColor: Colors.border,
  },
  aiUsageCard: {
    padding: Spacing.lg,
  },
  aiUsageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  aiUsageLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  aiUsageValue: {
    fontSize: FontSize.xxl,
    fontWeight: FontWeight.bold,
    color: Colors.highlight,
    marginTop: Spacing.xs,
  },
  aiUsageMinutes: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    marginTop: 2,
  },
  aiUsageBar: {
    height: 8,
    backgroundColor: Colors.border,
    borderRadius: 4,
    marginTop: Spacing.md,
    overflow: 'hidden',
  },
  aiUsageBarFill: {
    height: '100%',
    width: '75%',
    backgroundColor: Colors.highlight,
  },
  aiUsageHint: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
  recentCard: {
    padding: Spacing.md,
    gap: Spacing.md,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  recentLabel: {
    flex: 1,
    fontSize: FontSize.md,
    color: Colors.textPrimary,
  },
  chartCard: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  chartLabel: {
    width: 60,
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  chartBarContainer: {
    flex: 1,
    height: 24,
    backgroundColor: Colors.border,
    borderRadius: BorderRadius.sm,
    overflow: 'hidden',
  },
  chartBar: {
    height: '100%',
    backgroundColor: Colors.success,
    borderRadius: BorderRadius.sm,
  },
  chartValue: {
    width: 32,
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semibold,
    color: Colors.textPrimary,
    textAlign: 'right',
  },
  chartCredits: {
    width: 40,
    fontSize: FontSize.xs,
    color: Colors.textLight,
    textAlign: 'right',
  },
  contributorsCard: {
    padding: Spacing.md,
    gap: Spacing.md,
  },
  contributorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  contributorRank: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contributorRankText: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: Colors.highlight,
  },
  contributorInfo: {
    flex: 1,
  },
  contributorName: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.medium,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  contributorBarContainer: {
    height: 6,
    backgroundColor: Colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  contributorBar: {
    height: '100%',
    backgroundColor: Colors.highlight,
    borderRadius: 3,
  },
  contributorTime: {
    alignItems: 'flex-end',
  },
  contributorTimeValue: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  contributorTimeLabel: {
    fontSize: FontSize.xs,
    color: Colors.textLight,
  },
  emptyCard: {
    padding: Spacing.xxl,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  emptyText: {
    fontSize: FontSize.md,
    color: Colors.textLight,
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxl,
  },
  errorText: {
    fontSize: FontSize.lg,
    color: Colors.error,
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.highlight,
    borderRadius: BorderRadius.md,
  },
  retryText: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold,
    color: '#FFF',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.xs,
    gap: Spacing.xs,
    ...Shadow.sm,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
  },
  tabActive: {
    backgroundColor: Colors.highlightSubtle,
  },
  tabText: {
    fontSize: FontSize.sm,
    color: Colors.textLight,
    fontWeight: FontWeight.medium,
  },
  tabTextActive: {
    color: Colors.highlight,
    fontWeight: FontWeight.semibold,
  },
  priorityCard: {
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  priorityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  priorityItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  priorityBadge: {
    width: 8,
    height: 32,
    borderRadius: 4,
  },
  priorityLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  priorityCount: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
});
