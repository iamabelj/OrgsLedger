"use strict";
// ============================================================
// Migration 014 — Sync Tables & Roles
//
// CHANGES:
//   1. Add missing "Free" subscription plan (slug: free)
//   2. Ensure super_admin users have correct global_role
//      (seed creates super_admin, migration 010 promotes to developer
//       but seed may re-run after migration — fix discrepancy)
//   3. Create analytics_snapshots table (referenced by analytics.service.ts)
//   4. Backfill any organizations missing wallets
//   5. Backfill any organizations missing subscriptions
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // ── 1. Add Free plan if missing ───────────────────────────
    const freePlan = await knex('subscription_plans').where({ slug: 'free' }).first();
    if (!freePlan) {
        await knex('subscription_plans').insert({
            name: 'Free',
            slug: 'free',
            max_members: 50,
            features: JSON.stringify({
                chat: true,
                meetings: true,
                financials: true,
                polls: true,
                events: true,
                announcements: true,
                documents: true,
            }),
            price_usd_annual: 0,
            price_usd_monthly: 0,
            price_ngn_annual: 0,
            price_ngn_monthly: 0,
            is_active: true,
            sort_order: 0,
            description: 'Free tier for small groups up to 50 members.',
        });
    }
    // ── 2. Fix role consistency ───────────────────────────────
    // The seed script creates users with global_role = 'super_admin'.
    // Migration 010 promotes super_admin → developer.
    // If seed re-ran after migration 010, the user reverts to super_admin.
    // Ensure the FIRST registered super_admin is promoted to developer.
    const devUsers = await knex('users').where({ global_role: 'developer' }).first();
    if (!devUsers) {
        // No developer exists — promote the first super_admin
        const firstAdmin = await knex('users')
            .where({ global_role: 'super_admin' })
            .orderBy('created_at', 'asc')
            .first();
        if (firstAdmin) {
            await knex('users')
                .where({ id: firstAdmin.id })
                .update({ global_role: 'super_admin' });
            // NOTE: Keep as super_admin — the developer role is for
            // the gateway/landing admin (env-based, not in DB).
            // Migration 010 was over-aggressive.
        }
    }
    // ── 3. Create analytics_snapshots table ───────────────────
    if (!(await knex.schema.hasTable('analytics_snapshots'))) {
        await knex.schema.createTable('analytics_snapshots', (t) => {
            t.uuid('id').primary().defaultTo(knex.fn.uuid());
            t.date('snapshot_date').notNullable();
            t.jsonb('event_counts').notNullable().defaultTo('{}');
            t.integer('active_orgs').notNullable().defaultTo(0);
            t.integer('active_users').notNullable().defaultTo(0);
            t.jsonb('metadata').nullable();
            t.timestamps(true, true);
            t.unique(['snapshot_date']);
            t.index(['snapshot_date']);
        });
    }
    // ── 4. Backfill wallets for any org missing them ──────────
    const orgs = await knex('organizations').select('id');
    for (const org of orgs) {
        const aiW = await knex('ai_wallet').where({ organization_id: org.id }).first();
        if (!aiW) {
            await knex('ai_wallet').insert({
                organization_id: org.id,
                balance_minutes: 0,
                currency: 'USD',
                price_per_hour_usd: 10.00,
                price_per_hour_ngn: 18000.00,
            });
        }
        const transW = await knex('translation_wallet').where({ organization_id: org.id }).first();
        if (!transW) {
            await knex('translation_wallet').insert({
                organization_id: org.id,
                balance_minutes: 0,
                currency: 'USD',
                price_per_hour_usd: 25.00,
                price_per_hour_ngn: 45000.00,
            });
        }
    }
    // ── 5. Backfill subscriptions for orgs without one ────────
    const standardPlan = await knex('subscription_plans').where({ slug: 'free' }).first();
    if (standardPlan) {
        for (const org of orgs) {
            const sub = await knex('subscriptions').where({ organization_id: org.id }).first();
            if (!sub) {
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
}
async function down(knex) {
    // Remove free plan
    await knex('subscription_plans').where({ slug: 'free' }).del();
    // Drop analytics_snapshots
    await knex.schema.dropTableIfExists('analytics_snapshots');
}
//# sourceMappingURL=014_sync_tables_and_roles.js.map