// ============================================================
// Migration 024 — Rename jitsi_room_id → room_id
// Cleans up the legacy column name from the Jitsi era.
// The column now stores LiveKit room names.
// ============================================================

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('meetings', 'jitsi_room_id');
  if (hasColumn) {
    await knex.schema.alterTable('meetings', (t) => {
      t.renameColumn('jitsi_room_id', 'room_id');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('meetings', 'room_id');
  if (hasColumn) {
    await knex.schema.alterTable('meetings', (t) => {
      t.renameColumn('room_id', 'jitsi_room_id');
    });
  }
}
