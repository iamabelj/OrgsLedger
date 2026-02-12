// ============================================================
// OrgsLedger Mobile — Create Meeting Screen (Royal Design)
// ============================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, router } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth.store';
import { api } from '../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius, Shadow } from '../../src/theme';
import { Card, Button, Input, SectionHeader, CrossPlatformDateTimePicker } from '../../src/components/ui';
import { showAlert } from '../../src/utils/alert';

export default function CreateMeetingScreen() {
  const currentOrgId = useAuthStore((s) => s.currentOrgId);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedTime, setSelectedTime] = useState<Date>(new Date());
  const [dateChosen, setDateChosen] = useState(false);
  const [timeChosen, setTimeChosen] = useState(false);
  const [agendaItems, setAgendaItems] = useState<{ title: string; duration: string }[]>([
    { title: '', duration: '10' },
  ]);
  const [loading, setLoading] = useState(false);
  const [recurringPattern, setRecurringPattern] = useState<string>('none');
  const [aiEnabled, setAiEnabled] = useState(false);

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
    if (!currentOrgId) return;

    setLoading(true);
    try {
      const combined = new Date(selectedDate);
      combined.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
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
        scheduledStart: scheduledStart,
        recurringPattern,
        aiEnabled,
        agendaItems: filteredAgenda.length > 0 ? filteredAgenda : undefined,
      });

      const createdMeeting = res.data?.data || res.data;
      showAlert('Success', 'Meeting created', [
        { text: 'OK', onPress: () => router.replace(`/meetings/${createdMeeting?.id}` as any) },
      ]);
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to create meeting');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'New Meeting',
          headerStyle: { backgroundColor: Colors.surface },
          headerTintColor: Colors.highlight,
          headerTitleStyle: { fontWeight: FontWeight.semibold as any, color: Colors.textWhite },
          headerShadowVisible: false,
        }}
      />

      <Card style={styles.formCard}>
        <SectionHeader title="Meeting Details" />
        <Input label="Title *" value={title} onChangeText={setTitle} placeholder="Meeting title" icon="text-outline" />
        <Input label="Description" value={description} onChangeText={setDescription} placeholder="Optional description..." icon="document-text-outline" multiline numberOfLines={3} />
        <Input label="Location" value={location} onChangeText={setLocation} placeholder="Meeting room, Zoom link, etc." icon="location-outline" />

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
            <Input value={item.title} onChangeText={(v: string) => updateAgenda(idx, 'title', v)} placeholder={`Item ${idx + 1}`} style={{ flex: 1 }} />
            <Input value={item.duration} onChangeText={(v: string) => updateAgenda(idx, 'duration', v)} placeholder="min" keyboardType="number-pad" style={{ width: 60 }} />
            {agendaItems.length > 1 && (
              <TouchableOpacity onPress={() => removeAgenda(idx)} style={styles.removeAgendaBtn}>
                <Ionicons name="close-circle" size={20} color={Colors.error} />
              </TouchableOpacity>
            )}
          </View>
        ))}

        {/* AI Meeting Minutes */}
        <SectionHeader title="AI Minutes" />
        <View style={styles.aiRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.aiLabel}>Enable AI Minutes</Text>
            <Text style={styles.aiHint}>
              Auto-generate meeting summary, decisions, and action items using AI.
              Uses 1 credit per hour of meeting time.
            </Text>
          </View>
          <Switch
            value={aiEnabled}
            onValueChange={setAiEnabled}
            trackColor={{ false: Colors.accent, true: Colors.highlight }}
            thumbColor={Colors.textWhite}
          />
        </View>

        <Button title={loading ? 'Creating...' : 'Create Meeting'} onPress={handleCreate} disabled={loading} variant="primary" />
        <View style={{ height: Spacing.xxl }} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  formCard: { margin: Spacing.md, padding: Spacing.md, gap: Spacing.xs },
  row: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
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
    color: Colors.text,
  },
  aiHint: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
});
