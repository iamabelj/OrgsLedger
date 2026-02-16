// ============================================================
// Migration 016 — Add wallet_id to wallet transaction tables
// The production DB already has these NOT NULL columns.
// This migration adds them to the schema so dev/staging match.
// ============================================================

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── ai_wallet_transactions ──────────────────────────────
  const hasAiWalletId = await knex.schema.hasColumn('ai_wallet_transactions', 'wallet_id');
  if (!hasAiWalletId) {
    await knex.schema.alterTable('ai_wallet_transactions', (t) => {
      t.uuid('wallet_id').nullable().references('id').inTable('ai_wallet').onDelete('CASCADE');
    });

    // Backfill existing rows
    await knex.raw(`
      UPDATE ai_wallet_transactions t
      SET wallet_id = w.id
      FROM ai_wallet w
      WHERE w.organization_id = t.organization_id
        AND t.wallet_id IS NULL
    `);

    // Now make it NOT NULL
    await knex.raw('ALTER TABLE ai_wallet_transactions ALTER COLUMN wallet_id SET NOT NULL');
  }

  // ── translation_wallet_transactions ─────────────────────
  const hasTransWalletId = await knex.schema.hasColumn('translation_wallet_transactions', 'wallet_id');
  if (!hasTransWalletId) {
    await knex.schema.alterTable('translation_wallet_transactions', (t) => {
      t.uuid('wallet_id').nullable().references('id').inTable('translation_wallet').onDelete('CASCADE');
    });

    // Backfill existing rows
    await knex.raw(`
      UPDATE translation_wallet_transactions t
      SET wallet_id = w.id
      FROM translation_wallet w
      WHERE w.organization_id = t.organization_id
        AND t.wallet_id IS NULL
    `);

    // Now make it NOT NULL
    await knex.raw('ALTER TABLE translation_wallet_transactions ALTER COLUMN wallet_id SET NOT NULL');
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasAiWalletId = await knex.schema.hasColumn('ai_wallet_transactions', 'wallet_id');
  if (hasAiWalletId) {
    await knex.schema.alterTable('ai_wallet_transactions', (t) => {
      t.dropColumn('wallet_id');
    });
  }

  const hasTransWalletId = await knex.schema.hasColumn('translation_wallet_transactions', 'wallet_id');
  if (hasTransWalletId) {
    await knex.schema.alterTable('translation_wallet_transactions', (t) => {
      t.dropColumn('wallet_id');
    });
  }
}
