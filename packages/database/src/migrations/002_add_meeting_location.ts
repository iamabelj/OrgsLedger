// ============================================================
// OrgsLedger — Migration: Add location column to meetings
// ============================================================

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('meetings', (t) => {
    t.string('location').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('meetings', (t) => {
    t.dropColumn('location');
  });
}
