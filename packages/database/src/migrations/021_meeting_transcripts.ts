// ============================================================
// Migration 021 — Meeting Transcripts: Persistent Storage
// Stores live translation transcripts per meeting for
// replay, download, and AI minutes auto-generation from
// live speech (not just uploaded audio).
// ============================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── 1. Meeting transcripts — one row per speech segment ──
  await knex.schema.createTable('meeting_transcripts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('meeting_id').notNullable().references('id').inTable('meetings').onDelete('CASCADE');
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.uuid('speaker_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('speaker_name', 200).notNullable();
    t.text('original_text').notNullable();
    t.string('source_lang', 10).notNullable().defaultTo('en');
    t.jsonb('translations').notNullable().defaultTo('{}'); // { "fr": "Bonjour", "es": "Hola" }
    t.bigInteger('spoken_at').notNullable(); // epoch ms from client
    t.timestamps(true, true);

    // Indexes for fast retrieval
    t.index(['meeting_id', 'spoken_at'], 'idx_mt_meeting_spoken');
    t.index(['organization_id'], 'idx_mt_org');
  });

  // ── 2. Add download_formats to meeting_minutes ──
  const hasFormats = await knex.schema.hasColumn('meeting_minutes', 'download_formats');
  if (!hasFormats) {
    await knex.schema.alterTable('meeting_minutes', (t) => {
      // Cached generated files: { "pdf": "/uploads/...", "txt": "/uploads/..." }
      t.jsonb('download_formats').notNullable().defaultTo('{}');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('meeting_transcripts');
  const hasFormats = await knex.schema.hasColumn('meeting_minutes', 'download_formats');
  if (hasFormats) {
    await knex.schema.alterTable('meeting_minutes', (t) => {
      t.dropColumn('download_formats');
    });
  }
}
