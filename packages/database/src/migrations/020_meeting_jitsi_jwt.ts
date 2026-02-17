// ============================================================
// Migration 020 — Meeting System: JWT-based Jitsi Integration
// Adds meeting_type, moderator tracking, join logs, and
// security columns for enterprise-grade meeting infrastructure.
// ============================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── 1. Add meeting_type + moderator columns to meetings ──
  await knex.schema.alterTable('meetings', (t) => {
    // Meeting type: video or audio (default video for backward compat)
    t.string('meeting_type', 10).notNullable().defaultTo('video');
    // Max participants (0 = unlimited, enforced at join time)
    t.integer('max_participants').notNullable().defaultTo(0);
    // Meeting duration limit in minutes (0 = unlimited)
    t.integer('duration_limit_minutes').notNullable().defaultTo(0);
    // Enable waiting room / lobby (premium feature)
    t.boolean('lobby_enabled').notNullable().defaultTo(false);
    // Index for meeting_type filtering
    t.index(['organization_id', 'meeting_type'], 'idx_meetings_org_type');
  });

  // ── 2. Meeting join logs — audit trail for every join event ──
  await knex.schema.createTable('meeting_join_logs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('meeting_id').notNullable().references('id').inTable('meetings').onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.string('join_type', 10).notNullable(); // 'video' or 'audio'
    t.boolean('is_moderator').notNullable().defaultTo(false);
    t.string('ip_address', 45).nullable();
    t.string('user_agent', 500).nullable();
    t.timestamp('joined_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('left_at').nullable();
    // Indexes for analytics and audit queries
    t.index(['meeting_id', 'user_id'], 'idx_mjl_meeting_user');
    t.index(['organization_id', 'joined_at'], 'idx_mjl_org_joined');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('meeting_join_logs');
  await knex.schema.alterTable('meetings', (t) => {
    t.dropIndex(['organization_id', 'meeting_type'], 'idx_meetings_org_type');
    t.dropColumn('meeting_type');
    t.dropColumn('max_participants');
    t.dropColumn('duration_limit_minutes');
    t.dropColumn('lobby_enabled');
  });
}
