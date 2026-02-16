"use strict";
// ============================================================
// Migration 007 — Wallet Balance Constraints
// Adds CHECK constraints to prevent negative wallet balances
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // CHECK constraints require raw SQL — Knex DSL does not support them.
    // Use DO $$ blocks for idempotency (skip if constraint already exists).
    await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ai_wallet_balance_non_negative'
      ) THEN
        ALTER TABLE ai_wallet
        ADD CONSTRAINT ai_wallet_balance_non_negative
        CHECK (balance_minutes >= 0);
      END IF;
    END $$
  `);
    await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'translation_wallet_balance_non_negative'
      ) THEN
        ALTER TABLE translation_wallet
        ADD CONSTRAINT translation_wallet_balance_non_negative
        CHECK (balance_minutes >= 0);
      END IF;
    END $$
  `);
}
async function down(knex) {
    await knex.raw('ALTER TABLE ai_wallet DROP CONSTRAINT IF EXISTS ai_wallet_balance_non_negative');
    await knex.raw('ALTER TABLE translation_wallet DROP CONSTRAINT IF EXISTS translation_wallet_balance_non_negative');
}
//# sourceMappingURL=007_wallet_constraints.js.map