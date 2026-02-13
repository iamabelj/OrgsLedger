// ============================================================
// Migration 005 — Add translation_enabled column to meetings
// ============================================================
import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasColumn('meetings', 'translation_enabled');
  if (!exists) {
    await knex.schema.alterTable('meetings', (t) => {
      t.boolean('translation_enabled').notNullable().defaultTo(false);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasColumn('meetings', 'translation_enabled');
  if (exists) {
    await knex.schema.alterTable('meetings', (t) => {
      t.dropColumn('translation_enabled');
    });
  }
}
