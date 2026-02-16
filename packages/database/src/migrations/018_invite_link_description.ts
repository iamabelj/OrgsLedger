// ============================================================
// Migration 018 — Invite Link Description
// Adds an optional description column to invite_links so org
// admins can include a welcome message / context on the invite.
// ============================================================

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasCol = await knex.schema.hasColumn('invite_links', 'description');
  if (!hasCol) {
    await knex.schema.alterTable('invite_links', (t) => {
      t.text('description').nullable(); // optional welcome / context message
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn('invite_links', 'description')) {
    await knex.schema.alterTable('invite_links', (t) => {
      t.dropColumn('description');
    });
  }
}
