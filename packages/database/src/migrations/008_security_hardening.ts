// ============================================================
// Migration 008 — Security Hardening
// - Add password_changed_at to users for token invalidation
// - Add separate refresh token secret support
// ============================================================

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Add password_changed_at column to users table
  const hasColumn = await knex.schema.hasColumn('users', 'password_changed_at');
  if (!hasColumn) {
    await knex.schema.alterTable('users', (table) => {
      table.timestamp('password_changed_at').nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('users', 'password_changed_at');
  if (hasColumn) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('password_changed_at');
    });
  }
}
