// ============================================================
// Migration 026 — Account Lockout
// Adds failed_login_attempts and locked_until to users table
// for brute-force protection.
// ============================================================

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasAttempts = await knex.schema.hasColumn('users', 'failed_login_attempts');
  const hasLocked = await knex.schema.hasColumn('users', 'locked_until');

  await knex.schema.alterTable('users', (table) => {
    if (!hasAttempts) {
      table.integer('failed_login_attempts').notNullable().defaultTo(0);
    }
    if (!hasLocked) {
      table.timestamp('locked_until').nullable();
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  const hasAttempts = await knex.schema.hasColumn('users', 'failed_login_attempts');
  const hasLocked = await knex.schema.hasColumn('users', 'locked_until');

  await knex.schema.alterTable('users', (table) => {
    if (hasAttempts) table.dropColumn('failed_login_attempts');
    if (hasLocked) table.dropColumn('locked_until');
  });
}
