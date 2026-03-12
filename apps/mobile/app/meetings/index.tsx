import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../src/api/client';
import { Button, Card, Input, LoadingScreen, ResponsiveScrollView, Badge } from '../../src/components/ui';
import { useAuthStore } from '../../src/stores/auth.store';
import { showAlert } from '../../src/utils/alert';
import { BorderRadius, Colors, FontSize, FontWeight, Shadow, Spacing } from '../../src/theme';

type MeetingStatus = 'scheduled' | 'active' | 'ended' | 'cancelled';

interface MeetingParticipant {
  userId: string;
  role: string;
  joinedAt: string;
  leftAt?: string;
  displayName?: string;
}

interface MeetingRecord {
  id: string;
  organizationId: string;
  hostId: string;
  title?: string;
  description?: string;
  status: MeetingStatus;
  participants: MeetingParticipant[];
  createdAt: string;
  scheduledAt?: string;
  startedAt?: string;
  endedAt?: string;
  participantCount?: number;
}

const STATUS_VARIANTS: Record<MeetingStatus, 'gold' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  scheduled: 'warning',
  active: 'success',
  ended: 'neutral',
  cancelled: 'danger',
};

export default function MeetingsScreen() {
  const currentOrgId = useAuthStore((state) => state.currentOrgId);
  const memberships = useAuthStore((state) => state.memberships);
  const user = useAuthStore((state) => state.user);
  const membership = memberships.find((item) => item.organization_id === currentOrgId);
  const memberRole = membership?.role || 'member';

  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [maxParticipants, setMaxParticipants] = useState('25');

  const displayName = useMemo(() => {
    const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
    return fullName || user?.email || 'Meeting Tester';
  }, [user]);

  const loadMeetings = useCallback(async () => {
    if (!currentOrgId) {
      setMeetings([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const response = await api.meetings.list(currentOrgId);
      setMeetings(response.data?.data || []);
    } catch (error: any) {
      showAlert('Error', error?.response?.data?.error || 'Failed to load meetings');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentOrgId]);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  const resetCreateForm = () => {
    setTitle('');
    setDescription('');
    setMaxParticipants('25');
  };

  const handleCreateMeeting = async () => {
    if (!currentOrgId) {
      showAlert('No Organization', 'Select an organization before creating a meeting.');
      return;
    }

    if (!title.trim()) {
      showAlert('Missing Title', 'Enter a meeting title to continue.');
      return;
    }

    setSubmitting(true);
    try {
      await api.meetings.create({
        organizationId: currentOrgId,
        title: title.trim(),
        description: description.trim() || undefined,
        settings: {
          maxParticipants: Math.max(parseInt(maxParticipants || '25', 10) || 25, 2),
        },
      });
      setShowCreate(false);
      resetCreateForm();
      showAlert('Meeting Created', 'Your meeting is ready to start and test.');
      await loadMeetings();
    } catch (error: any) {
      showAlert('Create Failed', error?.response?.data?.error || 'Unable to create meeting right now.');
    } finally {
      setSubmitting(false);
    }
  };

  const performMeetingAction = async (action: () => Promise<any>, successMessage: string) => {
    try {
      await action();
      showAlert('Done', successMessage);
      await loadMeetings();
    } catch (error: any) {
      showAlert('Action Failed', error?.response?.data?.error || 'Unable to complete that meeting action.');
    }
  };

  const handleShowMinutes = async (meetingId: string) => {
    try {
      const response = await api.meetings.getMinutes(meetingId);
      const payload = response.data?.data;
      if (!payload) {
        showAlert('Minutes Pending', 'Minutes are not available yet for this meeting.');
        return;
      }

      const summary = payload.summary || payload.message || 'Minutes have been generated, but no summary text was returned.';
      showAlert('Meeting Minutes', summary);
    } catch (error: any) {
      showAlert('Minutes', error?.response?.data?.error || 'Minutes are not available yet.');
    }
  };

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <>
      <ResponsiveScrollView
        style={styles.container}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          loadMeetings();
        }}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroHeader}>
            <View style={styles.heroTitleWrap}>
              <View style={styles.heroIconWrap}>
                <Ionicons name="videocam" size={22} color={Colors.highlight} />
              </View>
              <View style={styles.heroContent}>
                <Text style={styles.heroTitle}>Meetings</Text>
                <Text style={styles.heroSubtitle}>Create, start, join, and end meetings from one place.</Text>
              </View>
            </View>
            <Button title="New Meeting" onPress={() => setShowCreate(true)} icon="add-outline" size="sm" disabled={!currentOrgId} />
          </View>

          <View style={styles.heroStats}>
            <View style={styles.heroStatCard}>
              <Text style={styles.heroStatValue}>{meetings.filter((meeting) => meeting.status === 'active').length}</Text>
              <Text style={styles.heroStatLabel}>Active</Text>
            </View>
            <View style={styles.heroStatCard}>
              <Text style={styles.heroStatValue}>{meetings.filter((meeting) => meeting.status === 'scheduled').length}</Text>
              <Text style={styles.heroStatLabel}>Scheduled</Text>
            </View>
            <View style={styles.heroStatCard}>
              <Text style={styles.heroStatValue}>{memberRole.replace(/_/g, ' ')}</Text>
              <Text style={styles.heroStatLabel}>Role</Text>
            </View>
          </View>
        </View>

        {meetings.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Ionicons name="videocam-outline" size={40} color={Colors.textLight} />
            <Text style={styles.emptyTitle}>No meetings yet</Text>
            <Text style={styles.emptyText}>Create one now so you can test the full meeting flow directly from the organization app.</Text>
          </Card>
        ) : (
          meetings.map((meeting) => {
            const isHost = meeting.hostId === user?.id;
            const hasJoined = meeting.participants?.some((participant) => participant.userId === user?.id && !participant.leftAt);
            const participantCount = meeting.participantCount || meeting.participants?.filter((participant) => !participant.leftAt).length || 0;

            return (
              <Card key={meeting.id} variant="elevated" style={styles.meetingCard}>
                <View style={styles.meetingHeader}>
                  <View style={styles.meetingHeaderContent}>
                    <View style={styles.meetingTitleRow}>
                      <Text style={styles.meetingTitle}>{meeting.title || 'Untitled Meeting'}</Text>
                      <Badge label={meeting.status} variant={STATUS_VARIANTS[meeting.status]} />
                    </View>
                    {meeting.description ? <Text style={styles.meetingDescription}>{meeting.description}</Text> : null}
                  </View>
                </View>

                <View style={styles.metaRow}>
                  <View style={styles.metaItem}>
                    <Ionicons name="people-outline" size={15} color={Colors.textLight} />
                    <Text style={styles.metaText}>{participantCount} participants</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Ionicons name="person-circle-outline" size={15} color={Colors.textLight} />
                    <Text style={styles.metaText}>{isHost ? 'You are host' : 'Hosted by another member'}</Text>
                  </View>
                </View>

                <View style={styles.metaRow}>
                  <View style={styles.metaItem}>
                    <Ionicons name="calendar-outline" size={15} color={Colors.textLight} />
                    <Text style={styles.metaText}>Created {new Date(meeting.createdAt).toLocaleString()}</Text>
                  </View>
                </View>

                <View style={styles.actionGrid}>
                  {meeting.status === 'scheduled' && isHost ? (
                    <Button
                      title="Start"
                      onPress={() => performMeetingAction(() => api.meetings.start(meeting.id), 'Meeting started.')}
                      icon="play"
                      size="sm"
                      style={styles.actionButton}
                    />
                  ) : null}
                  {meeting.status === 'active' && !hasJoined ? (
                    <Button
                      title="Join"
                      onPress={() => performMeetingAction(() => api.meetings.join(meeting.id, displayName), 'You joined the meeting.')}
                      icon="enter-outline"
                      size="sm"
                      variant="secondary"
                      style={styles.actionButton}
                    />
                  ) : null}
                  {meeting.status === 'active' && hasJoined ? (
                    <Button
                      title="Leave"
                      onPress={() => performMeetingAction(() => api.meetings.leave(meeting.id), 'You left the meeting.')}
                      icon="exit-outline"
                      size="sm"
                      variant="outline"
                      style={styles.actionButton}
                    />
                  ) : null}
                  {meeting.status === 'active' && isHost ? (
                    <Button
                      title="End"
                      onPress={() => performMeetingAction(() => api.meetings.end(meeting.id), 'Meeting ended.')}
                      icon="stop"
                      size="sm"
                      variant="danger"
                      style={styles.actionButton}
                    />
                  ) : null}
                  {meeting.status === 'scheduled' && isHost ? (
                    <Button
                      title="Cancel"
                      onPress={() => performMeetingAction(() => api.meetings.cancel(meeting.id), 'Meeting cancelled.')}
                      icon="close-outline"
                      size="sm"
                      variant="ghost"
                      style={styles.actionButton}
                    />
                  ) : null}
                  {meeting.status === 'ended' ? (
                    <Button
                      title="Minutes"
                      onPress={() => handleShowMinutes(meeting.id)}
                      icon="document-text-outline"
                      size="sm"
                      variant="outline"
                      style={styles.actionButton}
                    />
                  ) : null}
                </View>
              </Card>
            );
          })
        )}

        <View style={styles.bottomSpacer} />
      </ResponsiveScrollView>

      <Modal visible={showCreate} transparent animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Create Meeting</Text>
                <TouchableOpacity onPress={() => setShowCreate(false)}>
                  <Ionicons name="close" size={22} color={Colors.textLight} />
                </TouchableOpacity>
              </View>

              <Input label="TITLE" value={title} onChangeText={setTitle} placeholder="Weekly coordination" />
              <Input
                label="DESCRIPTION"
                value={description}
                onChangeText={setDescription}
                placeholder="What is this meeting for?"
                multiline
                numberOfLines={3}
                style={{ minHeight: 88, textAlignVertical: 'top' } as any}
              />
              <Input
                label="MAX PARTICIPANTS"
                value={maxParticipants}
                onChangeText={setMaxParticipants}
                keyboardType="numeric"
                placeholder="25"
              />

              <View style={styles.modalInfoBox}>
                <Ionicons name="flask-outline" size={16} color={Colors.highlight} />
                <Text style={styles.modalInfoText}>Create an instant meeting here, then use Start, Join, Leave, and End to test the full meeting UX directly from mobile.</Text>
              </View>

              <View style={styles.modalActions}>
                <Button title="Cancel" onPress={() => setShowCreate(false)} variant="ghost" style={styles.modalActionButton} />
                <Button title="Create Meeting" onPress={handleCreateMeeting} loading={submitting} icon="add-outline" style={styles.modalActionButton} />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  heroCard: {
    margin: Spacing.lg,
    padding: Spacing.lg,
    borderRadius: BorderRadius.xl,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.highlightSubtle,
    ...Shadow.md,
  },
  heroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  heroTitleWrap: {
    flexDirection: 'row',
    gap: Spacing.md,
    flex: 1,
  },
  heroIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.highlightSubtle,
  },
  heroContent: {
    flex: 1,
  },
  heroTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  heroSubtitle: {
    marginTop: 4,
    color: Colors.textLight,
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  heroStats: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    flexWrap: 'wrap',
  },
  heroStatCard: {
    flexGrow: 1,
    minWidth: 110,
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
  },
  heroStatValue: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
    textTransform: 'capitalize',
  },
  heroStatLabel: {
    marginTop: 4,
    fontSize: FontSize.xs,
    color: Colors.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  emptyCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  emptyTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  emptyText: {
    textAlign: 'center',
    color: Colors.textLight,
    lineHeight: 20,
  },
  meetingCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    padding: Spacing.lg,
  },
  meetingHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  meetingHeaderContent: {
    flex: 1,
  },
  meetingTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  meetingTitle: {
    flex: 1,
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  meetingDescription: {
    marginTop: Spacing.xs,
    fontSize: FontSize.sm,
    color: Colors.textLight,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    flexWrap: 'wrap',
    marginTop: Spacing.md,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
  },
  actionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  actionButton: {
    minWidth: 120,
  },
  bottomSpacer: {
    height: Spacing.xxl,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: Spacing.lg,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  modalTitle: {
    fontSize: FontSize.xl,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  modalInfoBox: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.highlightSubtle,
    marginTop: Spacing.sm,
  },
  modalInfoText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: FontSize.sm,
    lineHeight: 20,
  },
  modalActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  modalActionButton: {
    flex: 1,
  },
});