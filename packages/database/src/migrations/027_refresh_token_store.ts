// ============================================================
// Migration 027 — Refresh Token Store
// Stores refresh tokens in DB for rotation and revocation.
// ============================================================

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('refresh_tokens'))) {
    await knex.schema.createTable('refresh_tokens', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw("gen_random_uuid()"));
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      table.text('token_hash').notNullable().unique();
      table.string('user_agent', 512).nullable();
      table.string('ip_address', 45).nullable();
      table.timestamp('expires_at').notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.index(['user_id']);
      table.index(['expires_at']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('refresh_tokens');
}
