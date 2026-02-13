// ============================================================
// OrgsLedger Mobile — Events / Calendar Screen
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
import CrossPlatformDateTimePicker from '../../src/components/ui/CrossPlatformDateTimePicker';
import { useResponsive } from '../../src/hooks/useResponsive';

const CATEGORY_COLORS: Record<string, string> = {
  social: '#8B5CF6',
  fundraiser: '#10B981',
  community: '#3B82F6',
  workshop: '#F59E0B',
  general: Colors.primary,
};

export default function EventsScreen() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [category, setCategory] = useState('general');
  const [creating, setCreating] = useState(false);

  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const memberships = useAuthStore((s) => s.memberships);
  const globalRole = useAuthStore((s) => s.user?.globalRole);
  const membership = memberships.find((m) => m.organization_id === currentOrgId);
  const isAdmin = globalRole === 'super_admin' || membership?.role === 'org_admin' || membership?.role === 'executive';
  const responsive = useResponsive();

  const loadEvents = useCallback(async () => {
    if (!currentOrgId) return;
    try {
      const res = await api.events.list(currentOrgId, { upcoming: 'true' });
      setEvents(res.data.data || []);
    } catch (err) {
      console.error('Failed to load events', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentOrgId]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const handleCreate = async () => {
    if (!title.trim()) {
      showAlert('Error', 'Title is required');
      return;
    }
    setCreating(true);
    try {
      await api.events.create(currentOrgId!, {
        title,
        description,
        location,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        category,
        rsvpRequired: true,
      });
      showAlert('Success', 'Event created');
      setShowCreate(false);
      setTitle('');
      setDescription('');
      setLocation('');
      loadEvents();
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to create event');
    } finally {
      setCreating(false);
    }
  };

  const handleRSVP = async (eventId: string, status: string) => {
    try {
      await api.events.rsvp(currentOrgId!, eventId, { status });
      showAlert('Done', status === 'attending' ? "You're attending!" : 'RSVP updated');
      loadEvents();
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to RSVP');
    }
  };

  const renderEvent = ({ item }: { item: any }) => {
    const catColor = CATEGORY_COLORS[item.category] || Colors.primary;
    const eventDate = new Date(item.start_date);
    const isPast = eventDate < new Date();

    return (
      <Card style={[styles.eventCard, isPast && { opacity: 0.6 }]}>
        <View style={styles.eventTop}>
          <View style={styles.dateBox}>
            <Text style={styles.dateMonth}>
              {eventDate.toLocaleString('default', { month: 'short' }).toUpperCase()}
            </Text>
            <Text style={styles.dateDay}>{eventDate.getDate()}</Text>
          </View>
          <View style={styles.eventInfo}>
            <View style={[styles.categoryBadge, { backgroundColor: catColor + '20' }]}>
              <Text style={[styles.categoryText, { color: catColor }]}>
                {item.category.charAt(0).toUpperCase() + item.category.slice(1)}
              </Text>
            </View>
            <Text style={styles.eventTitle}>{item.title}</Text>
            {item.location && (
              <View style={styles.locationRow}>
                <Ionicons name="location-outline" size={14} color={Colors.textLight} />
                <Text style={styles.locationText}>{item.location}</Text>
              </View>
            )}
            <View style={styles.locationRow}>
              <Ionicons name="time-outline" size={14} color={Colors.textLight} />
              <Text style={styles.locationText}>
                {eventDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          </View>
        </View>

        {item.description && (
          <Text style={styles.eventDesc} numberOfLines={2}>{item.description}</Text>
        )}

        <View style={styles.eventFooter}>
          <View style={styles.rsvpInfo}>
            <Ionicons name="people-outline" size={16} color={Colors.textLight} />
            <Text style={styles.rsvpCount}>{item.rsvpCount || 0} attending</Text>
          </View>
          {!isPast && (
            <View style={styles.rsvpActions}>
              <TouchableOpacity
                style={[styles.rsvpBtn, styles.rsvpAttend]}
                onPress={() => handleRSVP(item.id, 'attending')}
              >
                <Text style={styles.rsvpBtnText}>Attend</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rsvpBtn, styles.rsvpDecline]}
                onPress={() => handleRSVP(item.id, 'declined')}
              >
                <Text style={[styles.rsvpBtnText, { color: Colors.textSecondary }]}>Decline</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Card>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' }]}>
        <Text style={styles.screenTitle}>Events</Text>
        {isAdmin && (
          <Button title="New Event" onPress={() => setShowCreate(true)} icon="add-outline" size="sm" />
        )}
      </View>

      <FlatList
        data={events}
        renderItem={renderEvent}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.list,
          { maxWidth: responsive.contentMaxWidth, alignSelf: 'center', width: '100%' },
        ]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadEvents(); }} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={48} color={Colors.textLight} />
            <Text style={styles.emptyText}>No upcoming events</Text>
          </View>
        }
      />

      {/* Create Event Modal */}
      <Modal visible={showCreate} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: responsive.contentMaxWidth }]}>
            <ScrollView>
              <Text style={styles.modalTitle}>Create Event</Text>

              <Input label="TITLE" placeholder="Event title" value={title} onChangeText={setTitle} />
              <Input label="DESCRIPTION" placeholder="Describe the event..." value={description} onChangeText={setDescription} multiline numberOfLines={3} />
              <Input label="LOCATION" placeholder="Event location" value={location} onChangeText={setLocation} />

              <CrossPlatformDateTimePicker
                label="START DATE & TIME"
                value={startDate}
                onChange={setStartDate}
                mode="datetime"
              />
              <CrossPlatformDateTimePicker
                label="END DATE & TIME"
                value={endDate}
                onChange={setEndDate}
                mode="datetime"
              />

              <Text style={styles.fieldLabel}>CATEGORY</Text>
              <View style={styles.categoryPicker}>
                {Object.keys(CATEGORY_COLORS).map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.categoryOption,
                      category === cat && { backgroundColor: CATEGORY_COLORS[cat], borderColor: CATEGORY_COLORS[cat] },
                    ]}
                    onPress={() => setCategory(cat)}
                  >
                    <Text style={[styles.categoryOptText, category === cat && { color: '#FFF' }]}>
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.modalActions}>
                <Button title="Cancel" onPress={() => setShowCreate(false)} variant="outline" style={{ flex: 1, marginRight: Spacing.sm }} />
                <Button title="Create" onPress={handleCreate} loading={creating} icon="calendar-outline" style={{ flex: 1 }} />
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
  eventCard: { marginBottom: Spacing.md },
  eventTop: { flexDirection: 'row', gap: Spacing.md },
  dateBox: { width: 56, height: 56, borderRadius: BorderRadius.md, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  dateMonth: { fontSize: 10, fontWeight: FontWeight.bold as any, color: Colors.primary, letterSpacing: 1 },
  dateDay: { fontSize: FontSize.xl, fontWeight: FontWeight.bold as any, color: Colors.primary },
  eventInfo: { flex: 1 },
  categoryBadge: { alignSelf: 'flex-start', paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.sm, marginBottom: 4 },
  categoryText: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold as any },
  eventTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold as any, color: Colors.textPrimary },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  locationText: { fontSize: FontSize.sm, color: Colors.textLight },
  eventDesc: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.sm, lineHeight: 20 },
  eventFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border },
  rsvpInfo: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rsvpCount: { fontSize: FontSize.sm, color: Colors.textLight },
  rsvpActions: { flexDirection: 'row', gap: Spacing.xs },
  rsvpBtn: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: BorderRadius.md },
  rsvpAttend: { backgroundColor: Colors.primary },
  rsvpDecline: { backgroundColor: Colors.border },
  rsvpBtnText: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold as any, color: '#FFF' },
  empty: { alignItems: 'center', padding: Spacing.xxl },
  emptyText: { fontSize: FontSize.md, color: Colors.textLight, marginTop: Spacing.md },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: Spacing.md },
  modalContent: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, alignSelf: 'center', width: '100%', maxHeight: '90%' },
  modalTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold as any, color: Colors.textPrimary, marginBottom: Spacing.lg },
  fieldLabel: { fontSize: FontSize.xs, fontWeight: FontWeight.semibold as any, color: Colors.textSecondary, letterSpacing: 1, marginBottom: Spacing.xs, marginTop: Spacing.sm },
  categoryPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  categoryOption: { paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border },
  categoryOptText: { fontSize: FontSize.xs, color: Colors.textPrimary },
  modalActions: { flexDirection: 'row', marginTop: Spacing.lg },
});
