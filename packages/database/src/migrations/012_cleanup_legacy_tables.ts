// ============================================================
// Migration 012 — Database Cleanup: Remove legacy tables, fix nullables
//
// CHANGES:
//   1. Drop legacy ai_credits + ai_credit_transactions (superseded by ai_wallet)
//   2. Drop licenses table (superseded by subscription_plans + subscriptions)
//   3. Drop organizations.license_id column (no longer needed)
//   4. Make organizations.billing_currency NOT NULL with default
//   5. Make organizations.subscription_status NOT NULL with default
// ============================================================

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── 1. Drop legacy ai_credits tables ──────────────────────
  // The SaaS ai_wallet + ai_wallet_transactions replaces these fully.
  await knex.schema.dropTableIfExists('ai_credit_transactions');
  await knex.schema.dropTableIfExists('ai_credits');

  // ── 2. Drop license_id FK from organizations ──────────────
  // First: remove the FK constraint, then the column
  await knex.schema.alterTable('organizations', (t) => {
    t.dropForeign('license_id');
    t.dropColumn('license_id');
  });

  // ── 3. Drop licenses table ────────────────────────────────
  // Fully superseded by subscription_plans + subscriptions
  await knex.schema.dropTableIfExists('licenses');

  // ── 4. Fix nullable columns on organizations ─────────────
  // billing_currency: every org should have one
  await knex('organizations')
    .whereNull('billing_currency')
    .update({ billing_currency: 'USD' });
  await knex.raw(`ALTER TABLE organizations ALTER COLUMN billing_currency SET NOT NULL`);
  await knex.raw(`ALTER TABLE organizations ALTER COLUMN billing_currency SET DEFAULT 'USD'`);

  // subscription_status: every org should have one
  await knex('organizations')
    .whereNull('subscription_status')
    .update({ subscription_status: 'active' });
  await knex.raw(`ALTER TABLE organizations ALTER COLUMN subscription_status SET NOT NULL`);
  await knex.raw(`ALTER TABLE organizations ALTER COLUMN subscription_status SET DEFAULT 'active'`);
}

export async function down(knex: Knex): Promise<void> {
  // Re-create licenses table
  await knex.schema.createTable('licenses', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.string('type').notNullable().defaultTo('free');
    t.integer('max_members').notNullable().defaultTo(50);
    t.jsonb('features').notNullable().defaultTo('{}');
    t.integer('ai_credits_included').notNullable().defaultTo(0);
    t.decimal('price_monthly', 10, 2).notNullable().defaultTo(0);
    t.timestamp('valid_from').notNullable().defaultTo(knex.fn.now());
    t.timestamp('valid_until').nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.uuid('reseller_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
  });

  // Re-add license_id to organizations
  await knex.schema.alterTable('organizations', (t) => {
    t.uuid('license_id').nullable().references('id').inTable('licenses').onDelete('SET NULL');
  });

  // Make columns nullable again
  await knex.raw(`ALTER TABLE organizations ALTER COLUMN billing_currency DROP NOT NULL`);
  await knex.raw(`ALTER TABLE organizations ALTER COLUMN subscription_status DROP NOT NULL`);

  // Re-create legacy ai_credits
  await knex.schema.createTable('ai_credits', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.decimal('total_credits', 10, 2).notNullable().defaultTo(0);
    t.decimal('used_credits', 10, 2).notNullable().defaultTo(0);
    t.decimal('price_per_credit_hour', 10, 2).notNullable().defaultTo(5);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('ai_credit_transactions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.string('type').notNullable();
    t.decimal('amount', 10, 2).notNullable();
    t.uuid('meeting_id').nullable().references('id').inTable('meetings');
    t.uuid('transaction_id').nullable().references('id').inTable('transactions');
    t.text('description').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}
