"use strict";
// ============================================================
// Migration 007 — Wallet Balance Constraints
// Adds CHECK constraints to prevent negative wallet balances
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // Add CHECK constraint to ai_wallet to prevent negative balances
    await knex.raw(`
    ALTER TABLE ai_wallet
    ADD CONSTRAINT ai_wallet_balance_non_negative
    CHECK (balance_minutes >= 0)
  `);
    // Add CHECK constraint to translation_wallet to prevent negative balances
    await knex.raw(`
    ALTER TABLE translation_wallet
    ADD CONSTRAINT translation_wallet_balance_non_negative
    CHECK (balance_minutes >= 0)
  `);
}
async function down(knex) {
    await knex.raw('ALTER TABLE ai_wallet DROP CONSTRAINT IF EXISTS ai_wallet_balance_non_negative');
    await knex.raw('ALTER TABLE translation_wallet DROP CONSTRAINT IF EXISTS translation_wallet_balance_non_negative');
}
//# sourceMappingURL=007_wallet_constraints.js.map