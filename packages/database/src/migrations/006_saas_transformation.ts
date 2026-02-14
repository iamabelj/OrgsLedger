// ============================================================
// Migration 006 — SaaS Transformation
// NOTE: This migration has ALREADY been applied to the production database.
// This file is kept for documentation and rollback reference only.
// ============================================================

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── Subscription Plans ──────────────────────────────────
  await knex.schema.createTable('subscription_plans', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.string('name').notNullable();
    t.string('slug').unique().notNullable();
    t.integer('max_members').notNullable().defaultTo(100);
    t.jsonb('features').defaultTo('{}');
    t.decimal('price_usd_annual', 12, 2).notNullable();
    t.decimal('price_usd_monthly', 12, 2).nullable();
    t.decimal('price_ngn_annual', 14, 2).notNullable();
    t.decimal('price_ngn_monthly', 14, 2).nullable();
    t.boolean('is_active').defaultTo(true);
    t.integer('sort_order').defaultTo(0);
    t.text('description').nullable();
    t.timestamps(true, true);
  });

  // ── Subscriptions ───────────────────────────────────────
  await knex.schema.createTable('subscriptions', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.uuid('plan_id').notNullable().references('id').inTable('subscription_plans');
    t.string('status').notNullable().defaultTo('active'); // active, grace_period, expired, suspended, cancelled
    t.string('billing_cycle').notNullable().defaultTo('annual'); // annual, monthly
    t.string('currency', 5).notNullable().defaultTo('USD');
    t.string('billing_country', 5).nullable();
    t.decimal('amount_paid', 14, 2).defaultTo(0);
    t.timestamp('current_period_start').notNullable();
    t.timestamp('current_period_end').notNullable();
    t.timestamp('grace_period_end').notNullable();
    t.string('payment_gateway').nullable(); // stripe, paystack, flutterwave
    t.string('gateway_subscription_id').nullable();
    t.string('gateway_customer_id').nullable();
    t.boolean('auto_renew').defaultTo(true);
    t.uuid('created_by').nullable().references('id').inTable('users');
    t.timestamps(true, true);
  });

  // ── Subscription History ────────────────────────────────
  await knex.schema.createTable('subscription_history', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('subscription_id').notNullable().references('id').inTable('subscriptions').onDelete('CASCADE');
    t.uuid('organization_id').notNullable().references('id').inTable('organizations');
    t.string('action').notNullable(); // created, renewed, upgraded, downgraded, cancelled, expired, admin_override
    t.jsonb('metadata').nullable();
    t.timestamps(true, true);
  });

  // ── AI Wallet ───────────────────────────────────────────
  await knex.schema.createTable('ai_wallet', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('organization_id').notNullable().unique().references('id').inTable('organizations').onDelete('CASCADE');
    t.decimal('balance_minutes', 14, 2).notNullable().defaultTo(0);
    t.string('currency', 5).defaultTo('USD');
    t.decimal('price_per_hour_usd', 10, 2).defaultTo(10.00);
    t.decimal('price_per_hour_ngn', 14, 2).defaultTo(18000.00);
    t.timestamps(true, true);
  });

  // ── AI Wallet Transactions ──────────────────────────────
  await knex.schema.createTable('ai_wallet_transactions', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('organization_id').notNullable().references('id').inTable('organizations');
    t.string('type').notNullable(); // topup, usage, refund, bonus, admin_adjustment
    t.decimal('amount_minutes', 14, 2).notNullable();
    t.decimal('cost', 14, 2).defaultTo(0);
    t.string('currency', 5).nullable();
    t.string('payment_ref').nullable();
    t.string('payment_gateway').nullable();
    t.text('description').nullable();
    t.timestamps(true, true);
  });

  // ── Translation Wallet ──────────────────────────────────
  await knex.schema.createTable('translation_wallet', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('organization_id').notNullable().unique().references('id').inTable('organizations').onDelete('CASCADE');
    t.decimal('balance_minutes', 14, 2).notNullable().defaultTo(0);
    t.string('currency', 5).defaultTo('USD');
    t.decimal('price_per_hour_usd', 10, 2).defaultTo(25.00);
    t.decimal('price_per_hour_ngn', 14, 2).defaultTo(45000.00);
    t.timestamps(true, true);
  });

  // ── Translation Wallet Transactions ─────────────────────
  await knex.schema.createTable('translation_wallet_transactions', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('organization_id').notNullable().references('id').inTable('organizations');
    t.string('type').notNullable(); // topup, usage, refund, bonus, admin_adjustment
    t.decimal('amount_minutes', 14, 2).notNullable();
    t.decimal('cost', 14, 2).defaultTo(0);
    t.string('currency', 5).nullable();
    t.string('payment_ref').nullable();
    t.string('payment_gateway').nullable();
    t.text('description').nullable();
    t.timestamps(true, true);
  });

  // ── Usage Records (metering) ────────────────────────────
  await knex.schema.createTable('usage_records', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('organization_id').notNullable().references('id').inTable('organizations');
    t.string('service_type').notNullable(); // ai, translation
    t.uuid('meeting_id').nullable().references('id').inTable('meetings');
    t.uuid('user_id').nullable().references('id').inTable('users');
    t.decimal('duration_minutes', 10, 2).defaultTo(0);
    t.decimal('cost', 14, 2).defaultTo(0);
    t.string('currency', 5).nullable();
    t.string('status').defaultTo('active'); // active, completed
    t.timestamp('started_at').defaultTo(knex.fn.now());
    t.timestamp('completed_at').nullable();
    t.timestamps(true, true);
  });

  // ── Invite Links ────────────────────────────────────────
  await knex.schema.createTable('invite_links', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.string('code', 20).unique().notNullable();
    t.string('role').defaultTo('member');
    t.integer('max_uses').nullable();
    t.integer('use_count').defaultTo(0);
    t.timestamp('expires_at').nullable();
    t.boolean('is_active').defaultTo(true);
    t.uuid('created_by').nullable().references('id').inTable('users');
    t.timestamps(true, true);
  });

  // ── New columns on organizations ────────────────────────
  await knex.schema.alterTable('organizations', (t) => {
    t.string('billing_country', 5).nullable();
    t.string('billing_currency', 5).nullable().defaultTo('USD');
    t.string('subscription_status').nullable().defaultTo('active');
  });

  // ── Seed default plans ──────────────────────────────────
  await knex('subscription_plans').insert([
    {
      name: 'Standard',
      slug: 'standard',
      max_members: 100,
      features: JSON.stringify({ chat: true, meetings: true, financials: true, polls: true, events: true, announcements: true, documents: true, committees: true }),
      price_usd_annual: 300,
      price_usd_monthly: 31.25,
      price_ngn_annual: 500000,
      price_ngn_monthly: 52083,
      sort_order: 1,
      description: 'For small organizations up to 100 members.',
    },
    {
      name: 'Professional',
      slug: 'professional',
      max_members: 300,
      features: JSON.stringify({ chat: true, meetings: true, financials: true, polls: true, events: true, announcements: true, documents: true, committees: true, analytics: true, export: true, customBranding: true }),
      price_usd_annual: 800,
      price_usd_monthly: 83.33,
      price_ngn_annual: 1200000,
      price_ngn_monthly: 125000,
      sort_order: 2,
      description: 'For growing organizations up to 300 members.',
    },
    {
      name: 'Enterprise',
      slug: 'enterprise',
      max_members: 500,
      features: JSON.stringify({ chat: true, meetings: true, financials: true, polls: true, events: true, announcements: true, documents: true, committees: true, analytics: true, export: true, customBranding: true, prioritySupport: true, dedicatedAccount: true, api: true }),
      price_usd_annual: 2500,
      price_usd_monthly: 260.42,
      price_ngn_annual: 3500000,
      price_ngn_monthly: 364583,
      sort_order: 3,
      description: 'For large organizations with 500+ members.',
    },
  ]);

  // ── Provision existing orgs ─────────────────────────────
  const orgs = await knex('organizations').select('id');
  const standardPlan = await knex('subscription_plans').where({ slug: 'standard' }).first();

  for (const org of orgs) {
    // AI Wallet
    const existingAiWallet = await knex('ai_wallet').where({ organization_id: org.id }).first();
    if (!existingAiWallet) {
      await knex('ai_wallet').insert({ organization_id: org.id, balance_minutes: 0, currency: 'USD' });
    }
    // Translation Wallet
    const existingTransWallet = await knex('translation_wallet').where({ organization_id: org.id }).first();
    if (!existingTransWallet) {
      await knex('translation_wallet').insert({ organization_id: org.id, balance_minutes: 0, currency: 'USD' });
    }
    // Subscription
    const existingSub = await knex('subscriptions').where({ organization_id: org.id }).first();
    if (!existingSub) {
      const now = new Date();
      const oneYear = new Date(now);
      oneYear.setFullYear(oneYear.getFullYear() + 1);
      const grace = new Date(oneYear);
      grace.setDate(grace.getDate() + 7);
      await knex('subscriptions').insert({
        organization_id: org.id,
        plan_id: standardPlan.id,
        status: 'active',
        billing_cycle: 'annual',
        currency: 'USD',
        amount_paid: 0,
        current_period_start: now.toISOString(),
        current_period_end: oneYear.toISOString(),
        grace_period_end: grace.toISOString(),
      });
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('organizations', (t) => {
    t.dropColumn('billing_country');
    t.dropColumn('billing_currency');
    t.dropColumn('subscription_status');
  });
  await knex.schema.dropTableIfExists('invite_links');
  await knex.schema.dropTableIfExists('usage_records');
  await knex.schema.dropTableIfExists('translation_wallet_transactions');
  await knex.schema.dropTableIfExists('translation_wallet');
  await knex.schema.dropTableIfExists('ai_wallet_transactions');
  await knex.schema.dropTableIfExists('ai_wallet');
  await knex.schema.dropTableIfExists('subscription_history');
  await knex.schema.dropTableIfExists('subscriptions');
  await knex.schema.dropTableIfExists('subscription_plans');
}
