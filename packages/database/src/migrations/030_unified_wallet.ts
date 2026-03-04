// ============================================================
// Migration 030 — Unified Wallet System
// Consolidates ai_wallet and translation_wallet into a single
// wallet table with service_type differentiation.
// ============================================================

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  console.log('[Migration 030] Creating unified wallet tables...');

  // ── Create Unified Wallet Table ──────────────────────────
  await knex.schema.createTable('wallet', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.string('service_type').notNullable(); // 'ai' or 'translation'
    t.decimal('balance_minutes', 14, 2).notNullable().defaultTo(0);
    t.string('currency', 5).defaultTo('USD');
    t.decimal('price_per_hour_usd', 10, 2).defaultTo(10.00);
    t.decimal('price_per_hour_ngn', 14, 2).defaultTo(18000.00);
    t.decimal('total_topped_up', 14, 2).defaultTo(0);
    t.timestamps(true, true);

    // Each org can have one AI wallet and one translation wallet
    t.unique(['organization_id', 'service_type']);
    t.index('organization_id');
    t.index('service_type');
  });

  console.log('[Migration 030] Wallet table created');

  // ── Create Unified Wallet Transactions Table ─────────────
  await knex.schema.createTable('wallet_transactions', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('wallet_id').notNullable().references('id').inTable('wallet').onDelete('CASCADE');
    t.uuid('organization_id').notNullable().references('id').inTable('organizations');
    t.string('service_type').notNullable(); // 'ai' or 'translation'
    t.string('type').notNullable(); // topup, usage, refund, bonus, admin_adjustment
    t.decimal('amount_minutes', 14, 2).notNullable();
    t.decimal('balance_after', 14, 2).defaultTo(0);
    t.decimal('cost', 14, 2).defaultTo(0);
    t.string('currency', 5).nullable();
    t.string('payment_ref').nullable();
    t.string('payment_gateway').nullable();
    t.text('description').nullable();
    t.timestamps(true, true);

    t.index('wallet_id');
    t.index('organization_id');
    t.index(['organization_id', 'service_type']);
    t.index('created_at');
  });

  console.log('[Migration 030] Wallet transactions table created');

  // ── Migrate AI Wallets ────────────────────────────────────
  const aiWallets = await knex('ai_wallet').select('*');
  console.log(`[Migration 030] Migrating ${aiWallets.length} AI wallets...`);

  for (const oldWallet of aiWallets) {
    await knex('wallet').insert({
      id: oldWallet.id,
      organization_id: oldWallet.organization_id,
      service_type: 'ai',
      balance_minutes: oldWallet.balance_minutes || 0,
      currency: oldWallet.currency || 'USD',
      price_per_hour_usd: oldWallet.price_per_hour_usd || 10.00,
      price_per_hour_ngn: oldWallet.price_per_hour_ngn || 18000.00,
      total_topped_up: oldWallet.total_topped_up || 0,
      created_at: oldWallet.created_at,
      updated_at: oldWallet.updated_at,
    });
  }

  console.log('[Migration 030] AI wallets migrated');

  // ── Migrate Translation Wallets ───────────────────────────
  const translationWallets = await knex('translation_wallet').select('*');
  console.log(`[Migration 030] Migrating ${translationWallets.length} translation wallets...`);

  for (const oldWallet of translationWallets) {
    await knex('wallet').insert({
      id: oldWallet.id,
      organization_id: oldWallet.organization_id,
      service_type: 'translation',
      balance_minutes: oldWallet.balance_minutes || 0,
      currency: oldWallet.currency || 'USD',
      price_per_hour_usd: oldWallet.price_per_hour_usd || 25.00,
      price_per_hour_ngn: oldWallet.price_per_hour_ngn || 45000.00,
      total_topped_up: oldWallet.total_topped_up || 0,
      created_at: oldWallet.created_at,
      updated_at: oldWallet.updated_at,
    });
  }

  console.log('[Migration 030] Translation wallets migrated');

  // ── Migrate AI Wallet Transactions ────────────────────────
  const aiTransactions = await knex('ai_wallet_transactions').select('*');
  console.log(`[Migration 030] Migrating ${aiTransactions.length} AI transactions...`);

  for (const oldTx of aiTransactions) {
    await knex('wallet_transactions').insert({
      id: oldTx.id,
      wallet_id: oldTx.wallet_id,
      organization_id: oldTx.organization_id,
      service_type: 'ai',
      type: oldTx.type,
      amount_minutes: oldTx.amount_minutes,
      balance_after: oldTx.balance_after || 0,
      cost: oldTx.cost || 0,
      currency: oldTx.currency,
      payment_ref: oldTx.payment_ref,
      payment_gateway: oldTx.payment_gateway,
      description: oldTx.description,
      created_at: oldTx.created_at,
      updated_at: oldTx.updated_at,
    });
  }

  console.log('[Migration 030] AI transactions migrated');

  // ── Migrate Translation Wallet Transactions ───────────────
  const translationTransactions = await knex('translation_wallet_transactions').select('*');
  console.log(`[Migration 030] Migrating ${translationTransactions.length} translation transactions...`);

  for (const oldTx of translationTransactions) {
    await knex('wallet_transactions').insert({
      id: oldTx.id,
      wallet_id: oldTx.wallet_id,
      organization_id: oldTx.organization_id,
      service_type: 'translation',
      type: oldTx.type,
      amount_minutes: oldTx.amount_minutes,
      balance_after: oldTx.balance_after || 0,
      cost: oldTx.cost || 0,
      currency: oldTx.currency,
      payment_ref: oldTx.payment_ref,
      payment_gateway: oldTx.payment_gateway,
      description: oldTx.description,
      created_at: oldTx.created_at,
      updated_at: oldTx.updated_at,
    });
  }

  console.log('[Migration 030] Translation transactions migrated');
  console.log('[Migration 030] ✅ Unified wallet migration complete');
  console.log('[Migration 030] NOTE: Old wallet tables (ai_wallet, translation_wallet) are kept for rollback safety');
}

export async function down(knex: Knex): Promise<void> {
  console.log('[Migration 030 Rollback] Dropping unified wallet tables...');

  await knex.schema.dropTableIfExists('wallet_transactions');
  await knex.schema.dropTableIfExists('wallet');

  console.log('[Migration 030 Rollback] ✅ Unified wallet tables dropped');
  console.log('[Migration 030 Rollback] NOTE: Original wallet tables (ai_wallet, translation_wallet) are still intact');
}
