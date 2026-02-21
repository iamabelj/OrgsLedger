// ============================================================
// OrgsLedger Mobile — Create Meeting Screen (Royal Design)
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Card, Button, Input, SectionHeader, CrossPlatformDateTimePicker, ResponsiveScrollView } from '../../src/components/ui';
import { showAlert } from '../../src/utils/alert';

export default function CreateMeetingScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);

  // Default to 1 hour from now, rounded to nearest 15 min
  const getDefaultStart = () => {
    const d = new Date();
    d.setHours(d.getHours() + 1);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    return d;
  };

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const defaultStart = getDefaultStart();
  const [selectedDate, setSelectedDate] = useState<Date>(defaultStart);
  const [selectedTime, setSelectedTime] = useState<Date>(defaultStart);
  // On web, always treat as chosen since inputs show real values
  const [dateChosen, setDateChosen] = useState(Platform.OS === 'web');
  const [timeChosen, setTimeChosen] = useState(Platform.OS === 'web');
  const [agendaItems, setAgendaItems] = useState<{ title: string; duration: string }[]>([
    { title: '', duration: '10' },
  ]);
  const [loading, setLoading] = useState(false);
  const [recurringPattern, setRecurringPattern] = useState<string>('none');
  const [meetingType, setMeetingType] = useState<'video' | 'audio'>('video');
  const [aiEnabled] = useState(true);
  const [translationEnabled] = useState(true);

  const addAgendaItem = () => {
    setAgendaItems([...agendaItems, { title: '', duration: '10' }]);
  };

  const updateAgenda = (idx: number, field: 'title' | 'duration', value: string) => {
    const updated = [...agendaItems];
    updated[idx][field] = value;
    setAgendaItems(updated);
  };

  const removeAgenda = (idx: number) => {
    setAgendaItems(agendaItems.filter((_, i) => i !== idx));
  };

  const handleDateChange = (date: Date) => {
    setSelectedDate(date);
    setDateChosen(true);
  };

  const handleTimeChange = (date: Date) => {
    setSelectedTime(date);
    setTimeChosen(true);
  };

  const handleCreate = async () => {
    if (!title.trim()) {
      showAlert('Error', 'Meeting title is required');
      return;
    }
    if (!dateChosen || !timeChosen) {
      showAlert('Error', 'Please select date and time');
      return;
    }
    if (!currentOrgId) {
      showAlert('Error', 'Please select an organization first');
      return;
    }

    setLoading(true);
    try {
      // Combine date + time
      const combined = new Date(selectedDate);
      combined.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);

      // Validate date is not in the past (allow 5 min grace)
      if (combined.getTime() < Date.now() - 5 * 60 * 1000) {
        showAlert('Error', 'Meeting cannot be scheduled in the past');
        setLoading(false);
        return;
      }

      const scheduledStart = combined.toISOString();
      const filteredAgenda = agendaItems
        .filter((a) => a.title.trim())
        .map((a) => ({
          title: a.title.trim(),
          durationMinutes: parseInt(a.duration) || 10,
        }));

      const res = await api.meetings.create(currentOrgId, {
        title: title.trim(),
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        scheduledStart,
        recurringPattern,
        meetingType,
        aiEnabled,
        translationEnabled,
        agendaItems: filteredAgenda.length > 0 ? filteredAgenda : undefined,
      });

      const createdMeeting = res.data?.data || res.data;
      if (createdMeeting?.id) {
        // Navigate directly to the meeting page
        router.replace(`/meetings/${createdMeeting.id}` as any);
      } else {
        showAlert('Success', 'Meeting created successfully!');
        router.back();
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || err.response?.data?.details?.[0]?.message || 'Failed to create meeting';
      showAlert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ResponsiveScrollView maxWidth={700} style={styles.container} keyboardShouldPersistTaps="handled">
      <Stack.Screen
        options={{
          title: 'New Meeting',
        }}
      />

      <Card style={styles.formCard}>
        <SectionHeader title="Meeting Details" />
        <Input label="Title *" value={title} onChangeText={setTitle} placeholder="e.g. Board Meeting, Budget Review" icon="text-outline" />
        <Input label="Description" value={description} onChangeText={setDescription} placeholder="What's this meeting about?" icon="document-text-outline" multiline numberOfLines={3} />
        <Input label="Location" value={location} onChangeText={setLocation} placeholder="Room name, Zoom link, etc." icon="location-outline" />

        {/* Date & Time */}
        <SectionHeader title="Schedule" />
        <View style={styles.row}>
          <CrossPlatformDateTimePicker
            label="Date *"
            value={selectedDate}
            mode="date"
            hasValue={dateChosen}
            onChange={handleDateChange}
            style={{ flex: 1 }}
          />
          <CrossPlatformDateTimePicker
            label="Time *"
            value={selectedTime}
            mode="time"
            hasValue={timeChosen}
            onChange={handleTimeChange}
            style={{ flex: 1 }}
          />
        </View>

        {/* Display scheduled datetime */}
        {dateChosen && timeChosen && (
          <View style={styles.scheduleSummary}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
            <Text style={styles.scheduleSummaryText}>
              {selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              {' at '}
              {selectedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        )}

        {/* Recurring Pattern */}
        <SectionHeader title="Repeat" />
        <View style={styles.recurRow}>
          {(['none', 'daily', 'weekly', 'biweekly', 'monthly'] as const).map((opt) => (
            <TouchableOpacity
              key={opt}
              style={[styles.recurChip, recurringPattern === opt && styles.recurChipActive]}
              onPress={() => setRecurringPattern(opt)}
            >
              <Text style={[styles.recurChipText, recurringPattern === opt && styles.recurChipTextActive]}>
                {opt === 'none' ? 'None' : opt === 'biweekly' ? 'Bi-weekly' : opt.charAt(0).toUpperCase() + opt.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Agenda Items */}
        <View style={styles.agendaHeader}>
          <SectionHeader title="Agenda Items" />
          <TouchableOpacity onPress={addAgendaItem} style={styles.addAgendaBtn}>
            <Ionicons name="add-circle" size={22} color={Colors.highlight} />
          </TouchableOpacity>
        </View>
        {agendaItems.map((item, idx) => (
          <View key={idx} style={styles.agendaRow}>
            <View style={styles.agendaNumBadge}><Text style={styles.agendaNumText}>{idx + 1}</Text></View>
            <Input value={item.title} onChangeText={(v: string) => updateAgenda(idx, 'title', v)} placeholder={`Agenda item ${idx + 1}`} style={{ flex: 1 }} />
            <Input value={item.duration} onChangeText={(v: string) => updateAgenda(idx, 'duration', v)} placeholder="min" keyboardType="number-pad" style={{ width: 60 }} />
            {agendaItems.length > 1 && (
              <TouchableOpacity onPress={() => removeAgenda(idx)} style={styles.removeAgendaBtn}>
                <Ionicons name="close-circle" size={20} color={Colors.error} />
              </TouchableOpacity>
            )}
          </View>
        ))}

        {/* AI Meeting Minutes */}
        <SectionHeader title="AI Services" />
        <View style={styles.aiRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.aiLabel}>AI-Powered Minutes</Text>
            <Text style={styles.aiHint}>
              Auto-generates summary, decisions, and action items when the meeting ends.
            </Text>
          </View>
          <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
        </View>

        {/* Live Translation */}
        <View style={styles.aiRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.aiLabel}>Live Translation</Text>
            <Text style={styles.aiHint}>
              Members speak their language and hear others in theirs. 100+ languages supported.
            </Text>
          </View>
          <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
        </View>

        <View style={{ height: Spacing.md }} />
        <Button title={loading ? 'Creating...' : 'Create Meeting'} onPress={handleCreate} disabled={loading} variant="primary" />
        <View style={{ height: Spacing.xxl }} />
      </Card>
    </ResponsiveScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  formCard: { margin: Spacing.md, padding: Spacing.md, gap: Spacing.xs },
  row: { flexDirection: 'row', gap: Spacing.sm },
  scheduleSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.successSubtle,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    marginBottom: Spacing.xs,
  },
  scheduleSummaryText: { color: Colors.success, fontSize: FontSize.sm, fontWeight: FontWeight.medium as any },
  agendaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
  },
  addAgendaBtn: { padding: 4 },
  agendaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  agendaNumBadge: { width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.highlightSubtle, alignItems: 'center', justifyContent: 'center' },
  agendaNumText: { color: Colors.highlight, fontWeight: FontWeight.bold as any, fontSize: FontSize.xs },
  removeAgendaBtn: { padding: 4 },
  recurRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginBottom: Spacing.sm },
  recurChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  recurChipActive: {
    backgroundColor: Colors.highlightSubtle,
    borderColor: Colors.highlight,
  },
  recurChipText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  recurChipTextActive: { color: Colors.highlight, fontWeight: FontWeight.semibold as any },
  aiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    gap: Spacing.md,
  },
  aiLabel: {
    fontSize: FontSize.md,
    fontWeight: FontWeight.semibold as any,
    color: Colors.textWhite,
  },
  aiHint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  aiNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: Colors.highlightSubtle,
    padding: Spacing.sm,
    borderRadius: BorderRadius.md,
  },
  aiNoteText: { flex: 1, color: Colors.highlight, fontSize: FontSize.xs },
});
