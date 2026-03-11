// ============================================================
// OrgsLedger API — Migration: Add Unique Constraint to Meeting Minutes
// Ensures only one minutes document per meeting (idempotency)
// ============================================================

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add unique constraint on meeting_id for idempotency
  // This ensures that if a minutes generation job runs twice,
  // the second insert will fail gracefully
  await knex.schema.alterTable('meeting_minutes', (table) => {
    table.unique(['meeting_id'], { indexName: 'meeting_minutes_meeting_id_unique' });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('meeting_minutes', (table) => {
    table.dropUnique(['meeting_id'], 'meeting_minutes_meeting_id_unique');
  });
}
