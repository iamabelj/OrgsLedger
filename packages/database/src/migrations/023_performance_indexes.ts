import { Knex } from 'knex';

/**
 * Migration 023 — Performance Indexes
 *
 * Adds high-value missing indexes identified during the LiveKit migration
 * performance audit. All are CREATE INDEX IF NOT EXISTS to be idempotent.
 */

export async function up(knex: Knex): Promise<void> {
  // ── HIGH priority ──────────────────────────────────────

  // meeting_attendance: standalone user_id index for "my attendance" queries
  if (!(await knex.schema.hasTable('meeting_attendance'))) return;
  await knex.schema.alterTable('meeting_attendance', (t) => {
    t.index(['user_id'], 'idx_meeting_attendance_user_id');
    t.index(['meeting_id'], 'idx_meeting_attendance_meeting_id');
  });

  // ── MEDIUM priority ────────────────────────────────────

  // meeting_transcripts: speaker lookup
  if (await knex.schema.hasTable('meeting_transcripts')) {
    await knex.schema.alterTable('meeting_transcripts', (t) => {
      t.index(['speaker_id'], 'idx_meeting_transcripts_speaker_id');
    });
  }

  // announcements: pinned + created_at sort optimization
  if (await knex.schema.hasTable('announcements')) {
    await knex.schema.alterTable('announcements', (t) => {
      t.index(
        ['organization_id', 'pinned', 'created_at'],
        'idx_announcements_org_pinned_created'
      );
    });
  }

  // ── LOW priority ───────────────────────────────────────

  // donations: user_id lookup for member detail page
  if (await knex.schema.hasTable('donations')) {
    await knex.schema.alterTable('donations', (t) => {
      t.index(['user_id'], 'idx_donations_user_id');
    });
  }

  // event_rsvps: standalone event_id index for batch RSVP counts
  if (await knex.schema.hasTable('event_rsvps')) {
    await knex.schema.alterTable('event_rsvps', (t) => {
      t.index(['event_id'], 'idx_event_rsvps_event_id');
    });
  }

  // meeting_join_logs: standalone user_id index for per-user audit
  if (await knex.schema.hasTable('meeting_join_logs')) {
    await knex.schema.alterTable('meeting_join_logs', (t) => {
      t.index(['user_id'], 'idx_meeting_join_logs_user_id');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const drops: Array<[string, string]> = [
    ['meeting_attendance', 'idx_meeting_attendance_user_id'],
    ['meeting_attendance', 'idx_meeting_attendance_meeting_id'],
    ['meeting_transcripts', 'idx_meeting_transcripts_speaker_id'],
    ['announcements', 'idx_announcements_org_pinned_created'],
    ['donations', 'idx_donations_user_id'],
    ['event_rsvps', 'idx_event_rsvps_event_id'],
    ['meeting_join_logs', 'idx_meeting_join_logs_user_id'],
  ];

  for (const [table, idx] of drops) {
    if (await knex.schema.hasTable(table)) {
      await knex.schema.alterTable(table, (t) => {
        t.dropIndex([], idx);
      });
    }
  }
}
