import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isTomorrow, parseISO } from 'date-fns';
import { useRouter } from 'expo-router';
import { api } from '../../src/api/client';
import { Button, Card, Input, LoadingScreen, ResponsiveScrollView, Badge } from '../../src/components/ui';
import { useAuthStore } from '../../src/stores/auth.store';
import { showAlert } from '../../src/utils/alert';
import { useResponsive } from '../../src/hooks/useResponsive';
import { BorderRadius, Colors, FontSize, FontWeight, Shadow, Spacing } from '../../src/theme';

type MeetingStatus = 'scheduled' | 'active' | 'ended' | 'cancelled';
type TabKey = 'upcoming' | 'active' | 'past';

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
  settings: { maxParticipants?: number; agenda?: string[]; [key: string]: any };
  createdAt: string;
  scheduledAt?: string;
  startedAt?: string;
  endedAt?: string;
  participantCount?: number;
}

const STATUS_CONFIG: Record<MeetingStatus, { variant: 'gold' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'; icon: string; label: string }> = {
  scheduled: { variant: 'info', icon: 'time-outline', label: 'Scheduled' },
  active: { variant: 'success', icon: 'radio-button-on', label: 'Live' },
  ended: { variant: 'neutral', icon: 'checkmark-circle-outline', label: 'Ended' },
  cancelled: { variant: 'danger', icon: 'close-circle-outline', label: 'Cancelled' },
};

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'upcoming', label: 'Upcoming', icon: 'calendar-outline' },
  { key: 'active', label: 'Live', icon: 'radio-button-on' },
  { key: 'past', label: 'Past', icon: 'time-outline' },
];

function formatMeetingDate(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const d = parseISO(dateStr);
    if (isToday(d)) return `Today, ${format(d, 'h:mm a')}`;
    if (isTomorrow(d)) return `Tomorrow, ${format(d, 'h:mm a')}`;
    return format(d, 'MMM d, yyyy · h:mm a');
  } catch {
    return dateStr;
  }
}

function formatDuration(start?: string, end?: string): string {
  if (!start || !end) return '';
  try {
    const ms = parseISO(end).getTime() - parseISO(start).getTime();
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    const rem = mins % 60;
    return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
  } catch {
    return '';
  }
}

export default function MeetingsScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const memberships = useAuthStore((s) => s.memberships);
  const user = useAuthStore((s) => s.user);
  const membership = memberships.find((m) => m.organization_id === currentOrgId);
  const responsive = useResponsive();
  const router = useRouter();

  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('upcoming');

  // Create/Edit modal state
  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editMeetingId, setEditMeetingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [agendaItems, setAgendaItems] = useState<string[]>([]);
  const [newAgendaItem, setNewAgendaItem] = useState('');

  // Member selection state (for new meetings)
  const [orgMembers, setOrgMembers] = useState<{ id: string; firstName?: string; lastName?: string; email: string }[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [selectAllMembers, setSelectAllMembers] = useState(true);
  const [memberSearch, setMemberSearch] = useState('');
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Action loading per meeting
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});

  const displayName = useMemo(() => {
    const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
    return fullName || user?.email || 'Participant';
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
      const data = response.data?.data;
      setMeetings(Array.isArray(data) ? data : []);
    } catch {
      // Silently fail — user sees empty list, pull-to-refresh available
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentOrgId]);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  // Filtered meetings by tab
  const filteredMeetings = useMemo(() => {
    switch (activeTab) {
      case 'upcoming':
        return meetings.filter((m) => m.status === 'scheduled');
      case 'active':
        return meetings.filter((m) => m.status === 'active');
      case 'past':
        return meetings.filter((m) => m.status === 'ended' || m.status === 'cancelled');
      default:
        return meetings;
    }
  }, [meetings, activeTab]);

  const counts = useMemo(() => ({
    upcoming: meetings.filter((m) => m.status === 'scheduled').length,
    active: meetings.filter((m) => m.status === 'active').length,
    past: meetings.filter((m) => m.status === 'ended' || m.status === 'cancelled').length,
  }), [meetings]);

  // ── Form helpers ──────────────────────────────────────

  const loadOrgMembers = useCallback(async () => {
    if (!currentOrgId) return;
    setLoadingMembers(true);
    try {
      const response = await api.organizations.listMembers(currentOrgId, { limit: 500 });
      const data = response.data?.data || [];
      // Transform to simpler format
      const members = data.map((m: any) => ({
        id: m.user_id || m.userId || m.id,
        firstName: m.first_name || m.firstName || '',
        lastName: m.last_name || m.lastName || '',
        email: m.user?.email || m.email || '',
      }));
      setOrgMembers(members);
    } catch {
      // Silent fail - show empty member list
      setOrgMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  }, [currentOrgId]);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setScheduledDate('');
    setScheduledTime('');
    setAgendaItems([]);
    setNewAgendaItem('');
    setEditMeetingId(null);
    setSelectedMembers(new Set());
    setSelectAllMembers(true);
    setMemberSearch('');
  };

  const openCreate = () => {
    resetForm();
    loadOrgMembers();
    setModalMode('create');
  };

  const openEdit = (m: MeetingRecord) => {
    setEditMeetingId(m.id);
    setTitle(m.title || '');
    setDescription(m.description || '');
    if (m.scheduledAt) {
      try {
        const d = parseISO(m.scheduledAt);
        setScheduledDate(format(d, 'yyyy-MM-dd'));
        setScheduledTime(format(d, 'HH:mm'));
      } catch {
        setScheduledDate('');
        setScheduledTime('');
      }
    } else {
      setScheduledDate('');
      setScheduledTime('');
    }
    setAgendaItems(m.settings?.agenda || []);
    setNewAgendaItem('');
    setModalMode('edit');
  };

  const closeModal = () => {
    setModalMode(null);
    resetForm();
  };

  const addAgendaItem = () => {
    const item = newAgendaItem.trim();
    if (!item) return;
    setAgendaItems((prev) => [...prev, item]);
    setNewAgendaItem('');
  };

  const removeAgendaItem = (index: number) => {
    setAgendaItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Filtered members based on search
  const filteredMembers = useMemo(() => {
    if (!memberSearch.trim()) return orgMembers;
    const q = memberSearch.toLowerCase();
    return orgMembers.filter(
      (m) =>
        m.firstName?.toLowerCase().includes(q) ||
        m.lastName?.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q)
    );
  }, [orgMembers, memberSearch]);

  const toggleMember = (memberId: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }
      return next;
    });
    // If manually toggling, turn off "select all"
    setSelectAllMembers(false);
  };

  const handleSelectAll = () => {
    if (selectAllMembers) {
      // Turn off - clear all selections
      setSelectedMembers(new Set());
      setSelectAllMembers(false);
    } else {
      // Turn on - select everyone
      setSelectedMembers(new Set(orgMembers.map((m) => m.id)));
      setSelectAllMembers(true);
    }
  };

  const buildScheduledAt = (): string | undefined => {
    if (!scheduledDate) return undefined;
    const time = scheduledTime || '09:00';
    try {
      const dt = new Date(`${scheduledDate}T${time}:00`);
      if (isNaN(dt.getTime())) return undefined;
      return dt.toISOString();
    } catch {
      return undefined;
    }
  };

  // ── Actions ───────────────────────────────────────────

  const handleCreateMeeting = async () => {
    if (!currentOrgId) {
      showAlert('No Organization', 'Select an organization first.');
      return;
    }
    if (!title.trim()) {
      showAlert('Missing Title', 'Enter a meeting title.');
      return;
    }

    setSubmitting(true);
    try {
      // Determine visibility type based on selection
      const isAllSelected = selectAllMembers || selectedMembers.size === 0 || selectedMembers.size === orgMembers.length;
      
      if (isAllSelected) {
        // All members - use ALL_MEMBERS visibility
        await api.meetings.createWithVisibility({
          organizationId: currentOrgId,
          title: title.trim(),
          description: description.trim() || undefined,
          scheduledAt: buildScheduledAt(),
          settings: {},
          agenda: agendaItems.length > 0 ? agendaItems : undefined,
          visibilityType: 'ALL_MEMBERS',
        });
      } else {
        // Custom selection - use CUSTOM visibility with participant IDs
        await api.meetings.createWithVisibility({
          organizationId: currentOrgId,
          title: title.trim(),
          description: description.trim() || undefined,
          scheduledAt: buildScheduledAt(),
          settings: {},
          agenda: agendaItems.length > 0 ? agendaItems : undefined,
          visibilityType: 'CUSTOM',
          participants: Array.from(selectedMembers),
        });
      }
      
      closeModal();
      showAlert('Meeting Created', 'Your meeting has been scheduled.');
      await loadMeetings();
    } catch (error: any) {
      showAlert('Create Failed', error?.response?.data?.error || 'Unable to create meeting.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateMeeting = async () => {
    if (!editMeetingId) return;
    if (!title.trim()) {
      showAlert('Missing Title', 'Enter a meeting title.');
      return;
    }

    setSubmitting(true);
    try {
      await api.meetings.update(editMeetingId, {
        title: title.trim(),
        description: description.trim() || undefined,
        scheduledAt: buildScheduledAt() || null,
        settings: {},
        agenda: agendaItems,
      });
      closeModal();
      showAlert('Meeting Updated', 'Changes saved successfully.');
      await loadMeetings();
    } catch (error: any) {
      showAlert('Update Failed', error?.response?.data?.error || 'Unable to update meeting.');
    } finally {
      setSubmitting(false);
    }
  };

  const performAction = async (meetingId: string, actionKey: string, action: () => Promise<any>, successMsg: string) => {
    setActionLoading((prev) => ({ ...prev, [meetingId]: actionKey }));
    try {
      await action();
      showAlert('Success', successMsg);
      await loadMeetings();
    } catch (error: any) {
      const msg = error?.response?.data?.error || 'Action failed. Please try again.';
      showAlert('Error', msg);
    } finally {
      setActionLoading((prev) => {
        const next = { ...prev };
        delete next[meetingId];
        return next;
      });
    }
  };

  const handleShowMinutes = async (meetingId: string) => {
    try {
      const response = await api.meetings.getMinutes(meetingId);
      const payload = response.data?.data;
      if (!payload || payload.status === 'pending') {
        showAlert('Minutes Pending', payload?.message || 'Minutes are still being generated.');
        return;
      }
      const summary = payload.summary || 'Minutes generated — no summary text returned.';
      showAlert('Meeting Minutes', summary);
    } catch (error: any) {
      showAlert('Minutes', error?.response?.data?.error || 'Minutes are not available yet.');
    }
  };

  // ── Render ────────────────────────────────────────────

  if (loading) return <LoadingScreen />;

  return (
    <>
      <ResponsiveScrollView
        style={styles.container}
        refreshing={refreshing}
        onRefresh={() => { setRefreshing(true); loadMeetings(); }}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIcon}>
              <Ionicons name="videocam" size={24} color={Colors.highlight} />
            </View>
            <View>
              <Text style={styles.headerTitle}>Meetings</Text>
              <Text style={styles.headerSubtitle}>{meetings.length} total · {counts.active} live</Text>
            </View>
          </View>
          <Button
            title="New Meeting"
            onPress={openCreate}
            icon="add-outline"
            size="sm"
            disabled={!currentOrgId}
          />
        </View>

        {/* Tabs */}
        <View style={styles.tabBar}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const count = counts[tab.key];
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tab, isActive && styles.tabActive]}
                onPress={() => setActiveTab(tab.key)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={tab.icon as any}
                  size={16}
                  color={isActive ? Colors.highlight : Colors.textLight}
                />
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                  {tab.label}
                </Text>
                {count > 0 && (
                  <View style={[styles.tabBadge, isActive && styles.tabBadgeActive]}>
                    <Text style={[styles.tabBadgeText, isActive && styles.tabBadgeTextActive]}>
                      {count}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Meeting list */}
        {filteredMeetings.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons
                name={activeTab === 'active' ? 'radio-outline' : activeTab === 'past' ? 'archive-outline' : 'calendar-outline'}
                size={44}
                color={Colors.textLight}
              />
            </View>
            <Text style={styles.emptyTitle}>
              {activeTab === 'upcoming' ? 'No upcoming meetings' : activeTab === 'active' ? 'No live meetings' : 'No past meetings'}
            </Text>
            <Text style={styles.emptyText}>
              {activeTab === 'upcoming'
                ? 'Schedule a new meeting to get started.'
                : activeTab === 'active'
                ? 'Start a scheduled meeting to see it here.'
                : 'Completed meetings will appear here.'}
            </Text>
            {activeTab === 'upcoming' && currentOrgId && (
              <Button title="Schedule Meeting" onPress={openCreate} icon="add-outline" size="sm" style={{ marginTop: Spacing.md }} />
            )}
          </View>
        ) : (
          filteredMeetings.map((meeting) => (
            <MeetingCard
              key={meeting.id}
              meeting={meeting}
              userId={user?.id}
              displayName={displayName}
              actionLoading={actionLoading[meeting.id]}
              onStart={() => router.push(`/meetings/${meeting.id}`)}
              onJoin={() => router.push(`/meetings/${meeting.id}`)}
              onLeave={() => performAction(meeting.id, 'leave', () => api.meetings.leave(meeting.id), 'You left the meeting.')}
              onEnd={() => performAction(meeting.id, 'end', () => api.meetings.end(meeting.id), 'Meeting ended.')}
              onCancel={() => performAction(meeting.id, 'cancel', () => api.meetings.cancel(meeting.id), 'Meeting cancelled.')}
              onEdit={() => openEdit(meeting)}
              onMinutes={() => handleShowMinutes(meeting.id)}
              onOpen={() => router.push(`/meetings/${meeting.id}`)}
            />
          ))
        )}

        <View style={{ height: Spacing.xxl }} />
      </ResponsiveScrollView>

      {/* Create / Edit Modal */}
      <Modal visible={modalMode !== null} transparent animationType="slide" onRequestClose={closeModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Modal Header */}
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>
                    {modalMode === 'edit' ? 'Edit Meeting' : 'New Meeting'}
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    {modalMode === 'edit' ? 'Update meeting details' : 'Schedule a meeting for your organization'}
                  </Text>
                </View>
                <TouchableOpacity onPress={closeModal} style={styles.modalClose}>
                  <Ionicons name="close" size={22} color={Colors.textLight} />
                </TouchableOpacity>
              </View>

              {/* Title */}
              <Input
                label="MEETING TITLE"
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Weekly standup"
                icon="text-outline"
              />

              {/* Description */}
              <Input
                label="DESCRIPTION"
                value={description}
                onChangeText={setDescription}
                placeholder="What is this meeting about?"
                multiline
                numberOfLines={3}
                style={{ minHeight: 80, textAlignVertical: 'top' } as any}
              />

              {/* Date & Time row */}
              <Text style={styles.fieldLabel}>DATE & TIME</Text>
              <View style={styles.dateTimeRow}>
                <View style={styles.dateField}>
                  <View style={styles.fieldIcon}>
                    <Ionicons name="calendar-outline" size={16} color={Colors.textLight} />
                  </View>
                  {Platform.OS === 'web' ? (
                    <input
                      type="date"
                      value={scheduledDate}
                      onChange={(e: any) => setScheduledDate(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '12px 8px',
                        fontSize: 14,
                        color: Colors.textPrimary,
                        backgroundColor: 'transparent',
                        border: 'none',
                        outline: 'none',
                        fontFamily: 'inherit',
                        colorScheme: 'dark',
                      }}
                    />
                  ) : (
                    <TextInput
                      style={styles.dateInput}
                      value={scheduledDate}
                      onChangeText={setScheduledDate}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={Colors.textLight}
                      maxLength={10}
                    />
                  )}
                </View>
                <View style={styles.timeField}>
                  <View style={styles.fieldIcon}>
                    <Ionicons name="time-outline" size={16} color={Colors.textLight} />
                  </View>
                  {Platform.OS === 'web' ? (
                    <input
                      type="time"
                      value={scheduledTime}
                      onChange={(e: any) => setScheduledTime(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '12px 8px',
                        fontSize: 14,
                        color: Colors.textPrimary,
                        backgroundColor: 'transparent',
                        border: 'none',
                        outline: 'none',
                        fontFamily: 'inherit',
                        colorScheme: 'dark',
                      }}
                    />
                  ) : (
                    <TextInput
                      style={styles.dateInput}
                      value={scheduledTime}
                      onChangeText={setScheduledTime}
                      placeholder="HH:MM"
                      placeholderTextColor={Colors.textLight}
                      maxLength={5}
                    />
                  )}
                </View>
              </View>

              {/* Quick date buttons */}
              <View style={styles.quickDateRow}>
                <TouchableOpacity
                  style={styles.quickDateBtn}
                  onPress={() => {
                    const now = new Date();
                    setScheduledDate(format(now, 'yyyy-MM-dd'));
                    setScheduledTime(format(now, 'HH:mm'));
                  }}
                >
                  <Text style={styles.quickDateText}>Now</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.quickDateBtn}
                  onPress={() => {
                    const today = new Date();
                    setScheduledDate(format(today, 'yyyy-MM-dd'));
                    if (!scheduledTime) setScheduledTime('09:00');
                  }}
                >
                  <Text style={styles.quickDateText}>Today</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.quickDateBtn}
                  onPress={() => {
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    setScheduledDate(format(tomorrow, 'yyyy-MM-dd'));
                    if (!scheduledTime) setScheduledTime('09:00');
                  }}
                >
                  <Text style={styles.quickDateText}>Tomorrow</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.quickDateBtn}
                  onPress={() => {
                    const next = new Date();
                    next.setDate(next.getDate() + 7);
                    setScheduledDate(format(next, 'yyyy-MM-dd'));
                    if (!scheduledTime) setScheduledTime('09:00');
                  }}
                >
                  <Text style={styles.quickDateText}>+1 Week</Text>
                </TouchableOpacity>
              </View>

              {/* Agenda Section */}
              <Text style={styles.fieldLabel}>AGENDA</Text>
              <View style={styles.agendaContainer}>
                {agendaItems.map((item, index) => (
                  <View key={index} style={styles.agendaItem}>
                    <View style={styles.agendaBullet}>
                      <Text style={styles.agendaBulletText}>{index + 1}</Text>
                    </View>
                    <Text style={styles.agendaItemText} numberOfLines={2}>{item}</Text>
                    <TouchableOpacity onPress={() => removeAgendaItem(index)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={18} color={Colors.textLight} />
                    </TouchableOpacity>
                  </View>
                ))}
                <View style={styles.agendaInputRow}>
                  <TextInput
                    style={styles.agendaInput}
                    value={newAgendaItem}
                    onChangeText={setNewAgendaItem}
                    placeholder="Add agenda item..."
                    placeholderTextColor={Colors.textLight}
                    onSubmitEditing={addAgendaItem}
                    returnKeyType="done"
                  />
                  <TouchableOpacity
                    onPress={addAgendaItem}
                    style={[styles.agendaAddBtn, !newAgendaItem.trim() && { opacity: 0.4 }]}
                    disabled={!newAgendaItem.trim()}
                  >
                    <Ionicons name="add-circle" size={26} color={Colors.highlight} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Participants Section - Only for create mode */}
              {modalMode === 'create' && (
                <>
                  <Text style={styles.fieldLabel}>PARTICIPANTS</Text>
                  <View style={styles.participantsContainer}>
                    {/* Select All Toggle */}
                    <TouchableOpacity style={styles.selectAllRow} onPress={handleSelectAll}>
                      <View style={[styles.memberCheckbox, selectAllMembers && styles.memberCheckboxChecked]}>
                        {selectAllMembers && <Ionicons name="checkmark" size={14} color="#fff" />}
                      </View>
                      <Text style={styles.selectAllText}>
                        {selectAllMembers ? 'All Members Selected' : 'Select All Members'}
                      </Text>
                      <Text style={styles.memberCount}>
                        {selectAllMembers ? orgMembers.length : selectedMembers.size} / {orgMembers.length}
                      </Text>
                    </TouchableOpacity>

                    {/* Search Box */}
                    <View style={styles.memberSearchBox}>
                      <Ionicons name="search" size={16} color={Colors.textLight} />
                      <TextInput
                        style={styles.memberSearchInput}
                        value={memberSearch}
                        onChangeText={setMemberSearch}
                        placeholder="Search members..."
                        placeholderTextColor={Colors.textLight}
                      />
                      {memberSearch ? (
                        <TouchableOpacity onPress={() => setMemberSearch('')}>
                          <Ionicons name="close-circle" size={18} color={Colors.textLight} />
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    {/* Member List */}
                    {loadingMembers ? (
                      <View style={styles.memberListLoading}>
                        <ActivityIndicator size="small" color={Colors.highlight} />
                        <Text style={styles.memberListLoadingText}>Loading members...</Text>
                      </View>
                    ) : (
                      <View style={styles.memberList}>
                        {filteredMembers.length === 0 ? (
                          <Text style={styles.noMembersText}>
                            {memberSearch ? 'No members match your search' : 'No members found'}
                          </Text>
                        ) : (
                          filteredMembers.map((member) => {
                            const isChecked = selectAllMembers || selectedMembers.has(member.id);
                            const name = `${member.firstName || ''} ${member.lastName || ''}`.trim() || member.email;
                            return (
                              <TouchableOpacity
                                key={member.id}
                                style={styles.memberRow}
                                onPress={() => toggleMember(member.id)}
                              >
                                <View style={[styles.memberCheckbox, isChecked && styles.memberCheckboxChecked]}>
                                  {isChecked && <Ionicons name="checkmark" size={14} color="#fff" />}
                                </View>
                                <View style={styles.memberInfo}>
                                  <Text style={styles.memberName} numberOfLines={1}>{name}</Text>
                                  {member.email && name !== member.email ? (
                                    <Text style={styles.memberEmail} numberOfLines={1}>{member.email}</Text>
                                  ) : null}
                                </View>
                              </TouchableOpacity>
                            );
                          })
                        )}
                      </View>
                    )}

                    {/* Info note */}
                    <View style={styles.participantNote}>
                      <Ionicons name="information-circle-outline" size={14} color={Colors.textLight} />
                      <Text style={styles.participantNoteText}>
                        Only selected participants will be able to view meeting minutes
                      </Text>
                    </View>
                  </View>
                </>
              )}

              {/* Actions */}
              <View style={styles.modalActions}>
                <Button title="Cancel" onPress={closeModal} variant="ghost" style={styles.modalActionBtn} />
                <Button
                  title={modalMode === 'edit' ? 'Save Changes' : 'Create Meeting'}
                  onPress={modalMode === 'edit' ? handleUpdateMeeting : handleCreateMeeting}
                  loading={submitting}
                  icon={modalMode === 'edit' ? 'checkmark-outline' : 'add-outline'}
                  style={styles.modalActionBtn}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ── Meeting Card Component ──────────────────────────────

interface MeetingCardProps {
  meeting: MeetingRecord;
  userId?: string;
  displayName: string;
  actionLoading?: string;
  onStart: () => void;
  onJoin: () => void;
  onLeave: () => void;
  onEnd: () => void;
  onCancel: () => void;
  onEdit: () => void;
  onMinutes: () => void;
  onOpen: () => void;
}

function MeetingCard({ meeting, userId, actionLoading, onStart, onJoin, onLeave, onEnd, onCancel, onEdit, onMinutes, onOpen }: MeetingCardProps) {
  const isHost = meeting.hostId === userId;
  const hasJoined = meeting.participants?.some((p) => p.userId === userId && !p.leftAt);
  const participantCount = meeting.participantCount ?? meeting.participants?.filter((p) => !p.leftAt).length ?? 0;
  const statusCfg = STATUS_CONFIG[meeting.status];
  const agenda = meeting.settings?.agenda || [];
  const duration = formatDuration(meeting.startedAt, meeting.endedAt);

  return (
    <TouchableOpacity style={styles.card} onPress={onOpen} activeOpacity={0.85}>
      {/* Status strip */}
      <View style={[styles.cardStrip, { backgroundColor: statusCfg.variant === 'success' ? Colors.success : statusCfg.variant === 'info' ? Colors.info : statusCfg.variant === 'danger' ? Colors.error : Colors.textLight }]} />

      <View style={styles.cardBody}>
        {/* Top row: title + status */}
        <View style={styles.cardTopRow}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {meeting.title || 'Untitled Meeting'}
          </Text>
          <Badge label={statusCfg.label} variant={statusCfg.variant} />
        </View>

        {/* Description */}
        {meeting.description ? (
          <Text style={styles.cardDescription} numberOfLines={2}>{meeting.description}</Text>
        ) : null}

        {/* Meta info row */}
        <View style={styles.cardMeta}>
          {meeting.scheduledAt ? (
            <View style={styles.metaChip}>
              <Ionicons name="calendar-outline" size={13} color={Colors.highlight} />
              <Text style={styles.metaChipText}>{formatMeetingDate(meeting.scheduledAt)}</Text>
            </View>
          ) : null}
          {meeting.status === 'active' && meeting.startedAt ? (
            <View style={styles.metaChip}>
              <Ionicons name="radio-button-on" size={13} color={Colors.success} />
              <Text style={styles.metaChipText}>Started {formatMeetingDate(meeting.startedAt)}</Text>
            </View>
          ) : null}
          {duration ? (
            <View style={styles.metaChip}>
              <Ionicons name="hourglass-outline" size={13} color={Colors.textSecondary} />
              <Text style={styles.metaChipText}>{duration}</Text>
            </View>
          ) : null}
          <View style={styles.metaChip}>
            <Ionicons name="people-outline" size={13} color={Colors.textSecondary} />
            <Text style={styles.metaChipText}>{participantCount}</Text>
          </View>
          {isHost ? (
            <View style={styles.metaChip}>
              <Ionicons name="shield-checkmark-outline" size={13} color={Colors.highlight} />
              <Text style={[styles.metaChipText, { color: Colors.highlight }]}>Host</Text>
            </View>
          ) : null}
        </View>

        {/* Agenda preview */}
        {agenda.length > 0 ? (
          <View style={styles.agendaPreview}>
            <Text style={styles.agendaPreviewLabel}>Agenda</Text>
            {agenda.slice(0, 3).map((item, i) => (
              <View key={i} style={styles.agendaPreviewItem}>
                <View style={styles.agendaPreviewDot} />
                <Text style={styles.agendaPreviewText} numberOfLines={1}>{item}</Text>
              </View>
            ))}
            {agenda.length > 3 ? (
              <Text style={styles.agendaPreviewMore}>+{agenda.length - 3} more</Text>
            ) : null}
          </View>
        ) : null}

        {/* Actions */}
        <View style={styles.cardActions}>
          {meeting.status === 'scheduled' && isHost ? (
            <>
              <ActionButton
                label="Start"
                icon="play"
                color={Colors.success}
                onPress={onStart}
                loading={actionLoading === 'start'}
              />
              <ActionButton
                label="Edit"
                icon="create-outline"
                color={Colors.info}
                onPress={onEdit}
              />
              <ActionButton
                label="Cancel"
                icon="close-outline"
                color={Colors.textLight}
                onPress={onCancel}
                loading={actionLoading === 'cancel'}
              />
            </>
          ) : null}
          {meeting.status === 'active' && !hasJoined ? (
            <ActionButton
              label="Join"
              icon="enter-outline"
              color={Colors.highlight}
              onPress={onJoin}
              loading={actionLoading === 'join'}
            />
          ) : null}
          {meeting.status === 'active' && hasJoined ? (
            <ActionButton
              label="Leave"
              icon="exit-outline"
              color={Colors.warning}
              onPress={onLeave}
              loading={actionLoading === 'leave'}
            />
          ) : null}
          {meeting.status === 'active' && isHost ? (
            <ActionButton
              label="End"
              icon="stop-circle-outline"
              color={Colors.error}
              onPress={onEnd}
              loading={actionLoading === 'end'}
            />
          ) : null}
          {meeting.status === 'ended' ? (
            <ActionButton
              label="Minutes"
              icon="document-text-outline"
              color={Colors.info}
              onPress={onMinutes}
            />
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Inline Action Button ────────────────────────────────

function ActionButton({ label, icon, color, onPress, loading }: { label: string; icon: string; color: string; onPress: () => void; loading?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.actionBtn, { borderColor: color + '44' }]}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.7}
    >
      <Ionicons name={icon as any} size={16} color={loading ? Colors.textLight : color} />
      <Text style={[styles.actionBtnText, { color: loading ? Colors.textLight : color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Styles ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: FontSize.xxl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  headerSubtitle: { fontSize: FontSize.sm, color: Colors.textLight, marginTop: 2 },

  // Tabs
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: 4,
    ...Shadow.sm,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.sm + 2,
    borderRadius: BorderRadius.md,
  },
  tabActive: { backgroundColor: Colors.primaryMid },
  tabLabel: { fontSize: FontSize.sm, color: Colors.textLight, fontWeight: FontWeight.medium },
  tabLabelActive: { color: Colors.highlight, fontWeight: FontWeight.semibold },
  tabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 4,
  },
  tabBadgeActive: { backgroundColor: Colors.highlightSubtle },
  tabBadgeText: { fontSize: 10, color: Colors.textLight, fontWeight: FontWeight.bold },
  tabBadgeTextActive: { color: Colors.highlight },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xxxl,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
    ...Shadow.sm,
  },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary, marginBottom: Spacing.xs },
  emptyText: { fontSize: FontSize.sm, color: Colors.textLight, textAlign: 'center', lineHeight: 20 },

  // Meeting Card
  card: {
    flexDirection: 'row',
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.lg,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
    ...Shadow.md,
  },
  cardStrip: { width: 4 },
  cardBody: { flex: 1, padding: Spacing.lg },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  cardTitle: { flex: 1, fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  cardDescription: { marginTop: Spacing.xs, fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },

  // Meta chips
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.sm,
  },
  metaChipText: { fontSize: FontSize.xs, color: Colors.textSecondary },

  // Agenda preview
  agendaPreview: {
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  agendaPreviewLabel: { fontSize: FontSize.xs, color: Colors.textLight, fontWeight: FontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  agendaPreviewItem: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  agendaPreviewDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.highlight },
  agendaPreviewText: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary },
  agendaPreviewMore: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 2 },

  // Card actions
  cardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  actionBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', alignItems: 'center' },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.xxl,
    padding: Spacing.lg,
    maxHeight: '90%',
    width: '100%',
    maxWidth: 560,
    ...Shadow.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.lg,
  },
  modalTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  modalSubtitle: { fontSize: FontSize.sm, color: Colors.textLight, marginTop: 2 },
  modalClose: { padding: 4 },

  // Date/time fields
  fieldLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semibold,
    color: Colors.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
    marginTop: Spacing.sm,
  },
  dateTimeRow: { flexDirection: 'row', gap: Spacing.sm },
  dateField: {
    flex: 1.3,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  timeField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  fieldIcon: { paddingLeft: Spacing.md },
  dateInput: {
    flex: 1,
    paddingVertical: Platform.OS === 'web' ? 12 : Spacing.sm + 2,
    paddingHorizontal: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.textPrimary,
  },

  // Quick date buttons
  quickDateRow: { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.sm, marginBottom: Spacing.xs },
  quickDateBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.highlightSubtle,
  },
  quickDateText: { fontSize: FontSize.xs, color: Colors.highlight, fontWeight: FontWeight.semibold },

  // Agenda in modal
  agendaContainer: {
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  agendaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs + 2,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  agendaBullet: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.highlightSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agendaBulletText: { fontSize: 10, color: Colors.highlight, fontWeight: FontWeight.bold },
  agendaItemText: { flex: 1, fontSize: FontSize.sm, color: Colors.textPrimary },
  agendaInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  agendaInput: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    paddingVertical: Spacing.xs + 2,
  },
  agendaAddBtn: { padding: 2 },

  // Participants selection
  participantsContainer: {
    backgroundColor: Colors.primaryLight,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  selectAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    marginBottom: Spacing.sm,
  },
  selectAllText: { flex: 1, fontSize: FontSize.md, color: Colors.textPrimary, fontWeight: FontWeight.medium },
  memberCount: { fontSize: FontSize.sm, color: Colors.textLight },
  memberSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primaryMid,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  memberSearchInput: {
    flex: 1,
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    paddingVertical: Spacing.sm,
  },
  memberList: { maxHeight: 200 },
  memberListLoading: { alignItems: 'center', padding: Spacing.lg, gap: Spacing.sm },
  memberListLoadingText: { fontSize: FontSize.sm, color: Colors.textLight },
  noMembersText: { fontSize: FontSize.sm, color: Colors.textLight, textAlign: 'center', padding: Spacing.md },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs + 4,
  },
  memberCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberCheckboxChecked: {
    backgroundColor: Colors.highlight,
    borderColor: Colors.highlight,
  },
  memberInfo: { flex: 1 },
  memberName: { fontSize: FontSize.sm, color: Colors.textPrimary },
  memberEmail: { fontSize: FontSize.xs, color: Colors.textLight },
  participantNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  participantNoteText: { flex: 1, fontSize: FontSize.xs, color: Colors.textLight },

  // Modal actions
  modalActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? Spacing.lg : 0,
  },
  modalActionBtn: { flex: 1 },
});