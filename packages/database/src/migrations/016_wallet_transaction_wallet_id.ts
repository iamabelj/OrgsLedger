// ============================================================
// Migration 016 — Add wallet_id and balance_after to wallet
// transaction tables.
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

    await knex.raw(`
      UPDATE ai_wallet_transactions t
      SET wallet_id = w.id
      FROM ai_wallet w
      WHERE w.organization_id = t.organization_id
        AND t.wallet_id IS NULL
    `);

    await knex.raw('ALTER TABLE ai_wallet_transactions ALTER COLUMN wallet_id SET NOT NULL');
  }

  const hasAiBalanceAfter = await knex.schema.hasColumn('ai_wallet_transactions', 'balance_after');
  if (!hasAiBalanceAfter) {
    await knex.schema.alterTable('ai_wallet_transactions', (t) => {
      t.decimal('balance_after', 14, 2).nullable();
    });

    // Backfill: compute running balance from wallet's current balance
    await knex.raw(`
      UPDATE ai_wallet_transactions t
      SET balance_after = COALESCE(
        (SELECT w.balance_minutes FROM ai_wallet w WHERE w.organization_id = t.organization_id),
        0
      )
      WHERE t.balance_after IS NULL
    `);

    await knex.raw('ALTER TABLE ai_wallet_transactions ALTER COLUMN balance_after SET NOT NULL');
  }

  // ── translation_wallet_transactions ─────────────────────
  const hasTransWalletId = await knex.schema.hasColumn('translation_wallet_transactions', 'wallet_id');
  if (!hasTransWalletId) {
    await knex.schema.alterTable('translation_wallet_transactions', (t) => {
      t.uuid('wallet_id').nullable().references('id').inTable('translation_wallet').onDelete('CASCADE');
    });

    await knex.raw(`
      UPDATE translation_wallet_transactions t
      SET wallet_id = w.id
      FROM translation_wallet w
      WHERE w.organization_id = t.organization_id
        AND t.wallet_id IS NULL
    `);

    await knex.raw('ALTER TABLE translation_wallet_transactions ALTER COLUMN wallet_id SET NOT NULL');
  }

  const hasTransBalanceAfter = await knex.schema.hasColumn('translation_wallet_transactions', 'balance_after');
  if (!hasTransBalanceAfter) {
    await knex.schema.alterTable('translation_wallet_transactions', (t) => {
      t.decimal('balance_after', 14, 2).nullable();
    });

    await knex.raw(`
      UPDATE translation_wallet_transactions t
      SET balance_after = COALESCE(
        (SELECT w.balance_minutes FROM translation_wallet w WHERE w.organization_id = t.organization_id),
        0
      )
      WHERE t.balance_after IS NULL
    `);

    await knex.raw('ALTER TABLE translation_wallet_transactions ALTER COLUMN balance_after SET NOT NULL');
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const table of ['ai_wallet_transactions', 'translation_wallet_transactions']) {
    for (const col of ['wallet_id', 'balance_after']) {
      if (await knex.schema.hasColumn(table, col)) {
        await knex.schema.alterTable(table, (t) => t.dropColumn(col));
      }
    }
  }
}
