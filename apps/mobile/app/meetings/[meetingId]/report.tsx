// ============================================================
// OrgsLedger Mobile — Meeting Report Page
// /meetings/[meetingId]/report
// Full transcript, AI summary, action items, decisions,
// attendance list, and download options (PDF, TXT).
// ============================================================

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { useAuthStore } from '../../../src/stores/auth.store';
import { api } from '../../../src/api/client';
import { Colors, Spacing, FontSize, FontWeight, BorderRadius } from '../../../src/theme';
import { Card, Badge, Button, Avatar, LoadingScreen, ResponsiveScrollView } from '../../../src/components/ui';
import { getLanguageFlag } from '../../../src/utils/languages';
import { showAlert } from '../../../src/utils/alert';

export default function MeetingReportScreen() {
  const { meetingId } = useLocalSearchParams<{ meetingId: string }>();
  const currentOrgId = useAuthStore((s) => s.currentOrgId);
  const userId = useAuthStore((s) => s.user?.id);

  const [meeting, setMeeting] = useState<any>(null);
  const [transcripts, setTranscripts] = useState<any[]>([]);
  const [minutes, setMinutes] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [transcriptsLoading, setTranscriptsLoading] = useState(false);
  const [minutesLoading, setMinutesLoading] = useState(false);

  // ── Load Meeting ────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!currentOrgId || !meetingId) return;
    try {
      const [meetingRes, transcriptRes, minutesRes] = await Promise.allSettled([
        api.meetings.get(currentOrgId, meetingId),
        api.meetings.getTranscripts(currentOrgId, meetingId),
        api.meetings.getMinutes(currentOrgId, meetingId),
      ]);

      if (meetingRes.status === 'fulfilled') {
        setMeeting(meetingRes.value.data.data);
      }
      if (transcriptRes.status === 'fulfilled') {
        setTranscripts(transcriptRes.value.data.data || []);
      }
      if (minutesRes.status === 'fulfilled') {
        setMinutes(minutesRes.value.data.data);
      }
    } catch {
      showAlert('Error', 'Failed to load meeting report');
    } finally {
      setLoading(false);
    }
  }, [currentOrgId, meetingId]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Download Minutes ────────────────────────────────────
  const handleDownload = async (format: 'txt' | 'json') => {
    if (!currentOrgId || !meetingId) return;
    try {
      const res = await api.meetings.downloadMinutes(currentOrgId, meetingId, format);
      if (Platform.OS === 'web') {
        const blob = new Blob([res.data], { type: format === 'json' ? 'application/json' : 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${meeting?.title || 'meeting'}_report.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        showAlert('Downloaded', 'Report has been downloaded.');
      }
    } catch (err: any) {
      showAlert('Error', err.response?.data?.error || 'Failed to download report');
    }
  };

  if (loading) return <LoadingScreen />;
  if (!meeting) {
    return (
      <View style={s.center}>
        <Ionicons name="alert-circle-outline" size={48} color={Colors.textLight} />
        <Text style={s.errorText}>Meeting not found</Text>
        <Button title="Go Back" onPress={() => router.back()} variant="outline" />
      </View>
    );
  }

  return (
    <ResponsiveScrollView style={s.container}>
      <Stack.Screen options={{ title: 'Meeting Report', headerShown: true }} />

      {/* Header */}
      <Card style={s.section}>
        <Text style={s.title}>{meeting.title}</Text>
        <Text style={s.meta}>
          {new Date(meeting.scheduled_start).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          {' at '}
          {new Date(meeting.scheduled_start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </Text>
        {meeting.description && <Text style={s.description}>{meeting.description}</Text>}

        <View style={s.badgeRow}>
          <Badge variant={(meeting.status === 'ended' ? 'neutral' : 'success') as any} label={meeting.status === 'ended' ? 'Completed' : meeting.status} />
          {meeting.meeting_type && <Badge variant="info" label={meeting.meeting_type === 'audio' ? 'Audio' : 'Video'} />}
          {meeting.ai_enabled && <Badge variant="warning" label="AI Minutes" />}
        </View>
      </Card>

      {/* Attendance */}
      {meeting.attendance && meeting.attendance.length > 0 && (
        <Card style={s.section}>
          <Text style={s.sectionTitle}>Attendance ({meeting.attendance.length})</Text>
          {meeting.attendance.map((a: any) => {
            const initials = `${(a.first_name?.[0] || '?').toUpperCase()}${(a.last_name?.[0] || '').toUpperCase()}`;
            return (
              <View key={a.id || a.user_id} style={s.attendeeRow}>
                <Avatar name={initials} size={32} imageUrl={a.avatar_url} />
                <Text style={s.attendeeName}>{a.first_name || a.user_id} {a.last_name || ''}</Text>
                <Badge variant={a.status === 'present' ? 'success' : 'warning'} label={a.status === 'present' ? 'Present' : a.status} />
              </View>
            );
          })}
        </Card>
      )}

      {/* AI Summary */}
      {minutes?.status === 'completed' && (
        <>
          {minutes.summary && (
            <Card style={s.section}>
              <Text style={s.sectionTitle}>Executive Summary</Text>
              <Text style={s.content}>{minutes.summary}</Text>
            </Card>
          )}

          {/* Decisions */}
          {minutes.decisions?.length > 0 && (
            <Card style={s.section}>
              <Text style={s.sectionTitle}>Key Decisions</Text>
              {minutes.decisions.map((d: string, i: number) => (
                <View key={i} style={s.bulletRow}>
                  <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
                  <Text style={s.bulletText}>{d}</Text>
                </View>
              ))}
            </Card>
          )}

          {/* Action Items */}
          {minutes.action_items?.length > 0 && (
            <Card style={s.section}>
              <Text style={s.sectionTitle}>Action Items</Text>
              {minutes.action_items.map((a: any, i: number) => (
                <View key={i} style={s.bulletRow}>
                  <Ionicons name="arrow-forward-circle" size={14} color={Colors.highlight} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.bulletText}>
                      {typeof a === 'string' ? a : a.description || a.task}
                    </Text>
                    {typeof a !== 'string' && (a.assigneeName || a.assignee) && (
                      <Text style={s.bulletMeta}>
                        Assigned to: {a.assigneeName || a.assignee}
                        {a.dueDate ? ` — Due: ${a.dueDate}` : ''}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </Card>
          )}

          {/* Motions */}
          {minutes.motions?.length > 0 && (
            <Card style={s.section}>
              <Text style={s.sectionTitle}>Motions</Text>
              {minutes.motions.map((m: any, i: number) => (
                <View key={i} style={s.bulletRow}>
                  <Ionicons name="megaphone" size={14} color={Colors.warning} />
                  <Text style={s.bulletText}>
                    {typeof m === 'string' ? m : `${m.text}${m.movedBy ? ` — Moved by ${m.movedBy}` : ''}${m.result ? ` (${m.result})` : ''}`}
                  </Text>
                </View>
              ))}
            </Card>
          )}
        </>
      )}

      {minutes?.status === 'processing' && (
        <Card style={s.section}>
          <View style={{ alignItems: 'center', paddingVertical: Spacing.xl }}>
            <ActivityIndicator size="large" color={Colors.highlight} />
            <Text style={{ color: Colors.highlight, fontSize: FontSize.lg, fontWeight: FontWeight.semibold as any, marginTop: Spacing.md }}>
              Generating Minutes...
            </Text>
            <Text style={{ color: Colors.textLight, fontSize: FontSize.sm, marginTop: Spacing.xs, textAlign: 'center' }}>
              AI is analyzing the meeting transcript. This may take a few moments.
            </Text>
          </View>
        </Card>
      )}

      {!minutes && (
        <Card style={s.section}>
          <View style={{ alignItems: 'center', paddingVertical: Spacing.xl }}>
            <Ionicons name="document-text-outline" size={40} color={Colors.textLight} />
            <Text style={{ color: Colors.textLight, fontSize: FontSize.md, marginTop: Spacing.sm, textAlign: 'center' }}>
              No AI minutes generated for this meeting.
            </Text>
          </View>
        </Card>
      )}

      {/* Full Transcript */}
      <Card style={s.section}>
        <Text style={s.sectionTitle}>Full Transcript ({transcripts.length} segments)</Text>
        {transcripts.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: Spacing.lg }}>
            <Ionicons name="chatbubbles-outline" size={32} color={Colors.textLight} />
            <Text style={{ color: Colors.textLight, fontSize: FontSize.sm, marginTop: Spacing.sm, textAlign: 'center' }}>
              No transcript available for this meeting.
            </Text>
          </View>
        ) : (
          <ScrollView style={{ maxHeight: 600 }} showsVerticalScrollIndicator>
            {transcripts.map((t: any, idx: number) => {
              const time = new Date(parseInt(t.spoken_at)).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              const isSelf = t.speaker_id === userId;
              return (
                <View key={t.id || idx} style={[s.transcriptRow, isSelf && s.transcriptRowSelf]}>
                  <View style={s.transcriptHeader}>
                    <Text style={s.transcriptSpeaker}>
                      {getLanguageFlag(t.source_lang)} {isSelf ? 'You' : t.speaker_name}
                    </Text>
                    <Text style={s.transcriptTime}>{time}</Text>
                  </View>
                  <Text style={s.transcriptText}>{t.original_text}</Text>
                  {t.translations && Object.keys(typeof t.translations === 'string' ? JSON.parse(t.translations) : t.translations).length > 0 && (
                    <View style={s.translationBlock}>
                      {Object.entries(typeof t.translations === 'string' ? JSON.parse(t.translations) : t.translations).map(([lang, text]) => (
                        <Text key={lang} style={s.translationText}>
                          {getLanguageFlag(lang)} {text as string}
                        </Text>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}
      </Card>

      {/* Download Options */}
      <Card style={s.section}>
        <Text style={s.sectionTitle}>Download Report</Text>
        <View style={s.downloadRow}>
          <TouchableOpacity style={s.downloadBtn} onPress={() => handleDownload('txt')} activeOpacity={0.7}>
            <Ionicons name="document-outline" size={20} color={Colors.highlight} />
            <Text style={s.downloadBtnText}>Download TXT</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.downloadBtn} onPress={() => handleDownload('json')} activeOpacity={0.7}>
            <Ionicons name="code-slash" size={20} color={Colors.highlight} />
            <Text style={s.downloadBtnText}>Download JSON</Text>
          </TouchableOpacity>
        </View>
      </Card>

      <View style={{ height: Spacing.xxl * 2 }} />
    </ResponsiveScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background, gap: Spacing.md },
  errorText: { color: Colors.textLight, fontSize: FontSize.lg },
  section: { marginHorizontal: Spacing.sm, marginBottom: Spacing.sm, padding: Spacing.md },
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold as any, color: Colors.textWhite, marginBottom: Spacing.xs },
  meta: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.xs },
  description: { fontSize: FontSize.md, color: Colors.textLight, marginTop: Spacing.xs, lineHeight: 22 },
  badgeRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.semibold as any, color: Colors.highlight, marginBottom: Spacing.md },
  content: { fontSize: FontSize.md, color: Colors.textWhite, lineHeight: 24 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: Spacing.sm },
  bulletText: { fontSize: FontSize.sm, color: Colors.textWhite, flex: 1, lineHeight: 20 },
  bulletMeta: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 2 },
  attendeeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs + 2, borderBottomWidth: 0.5, borderBottomColor: Colors.accent },
  attendeeName: { color: Colors.textWhite, fontSize: FontSize.md, flex: 1, fontWeight: FontWeight.medium as any },
  transcriptRow: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.sm, borderBottomWidth: 0.5, borderBottomColor: Colors.accent },
  transcriptRowSelf: { backgroundColor: 'rgba(129, 140, 248, 0.06)' },
  transcriptHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
  transcriptSpeaker: { fontSize: FontSize.sm, fontWeight: FontWeight.semibold as any, color: Colors.highlight },
  transcriptTime: { fontSize: FontSize.xs, color: Colors.textLight },
  transcriptText: { fontSize: FontSize.md, color: Colors.textWhite, lineHeight: 22 },
  translationBlock: { marginTop: Spacing.xs, paddingTop: Spacing.xs, borderTopWidth: 0.5, borderTopColor: Colors.accent },
  translationText: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20, marginTop: 2 },
  downloadRow: { flexDirection: 'row', gap: Spacing.sm },
  downloadBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs, paddingVertical: Spacing.md, borderRadius: BorderRadius.md, backgroundColor: Colors.primaryLight, borderWidth: 1, borderColor: Colors.accent },
  downloadBtnText: { fontSize: FontSize.sm, color: Colors.highlight, fontWeight: FontWeight.medium as any },
});
