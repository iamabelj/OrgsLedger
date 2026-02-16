"use strict";
// ============================================================
// Migration 015 — Update Subscription Plans
//
// CHANGES:
//   1. Remove the "Free" plan (slug: free) — not a real tier
//   2. Add "Enterprise Pro" plan (slug: enterprise_pro)
//      - 500+ members, customized plan, contact sales
//   3. Update Enterprise description (cap at 500 members)
//   4. Reassign any subscriptions on the Free plan → Standard
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // ── 1. Reassign any orgs on Free plan to Standard ─────────
    const freePlan = await knex('subscription_plans').where({ slug: 'free' }).first();
    if (freePlan) {
        const standardPlan = await knex('subscription_plans').where({ slug: 'standard' }).first();
        if (standardPlan) {
            await knex('subscriptions')
                .where({ plan_id: freePlan.id })
                .update({ plan_id: standardPlan.id });
        }
        // Delete the Free plan
        await knex('subscription_plans').where({ slug: 'free' }).del();
    }
    // ── 2. Update Enterprise description ──────────────────────
    await knex('subscription_plans')
        .where({ slug: 'enterprise' })
        .update({
        description: 'For large organizations up to 500 members.',
    });
    // ── 3. Add Enterprise Pro plan ────────────────────────────
    const enterpriseProExists = await knex('subscription_plans')
        .where({ slug: 'enterprise_pro' })
        .first();
    if (!enterpriseProExists) {
        await knex('subscription_plans').insert({
            name: 'Enterprise Pro',
            slug: 'enterprise_pro',
            max_members: 10000,
            features: JSON.stringify({
                chat: true,
                meetings: true,
                financials: true,
                polls: true,
                events: true,
                announcements: true,
                documents: true,
                committees: true,
                analytics: true,
                export: true,
                customBranding: true,
                prioritySupport: true,
                dedicatedAccount: true,
                api: true,
                customIntegrations: true,
                unlimitedStorage: true,
                sla: true,
            }),
            price_usd_annual: 5000,
            price_usd_monthly: 520.83,
            price_ngn_annual: 7000000,
            price_ngn_monthly: 729167,
            is_active: true,
            sort_order: 4,
            description: 'Customized plan for organizations with 500+ members. Contact sales for tailored pricing.',
        });
    }
}
async function down(knex) {
    // Remove Enterprise Pro
    await knex('subscription_plans').where({ slug: 'enterprise_pro' }).del();
    // Restore Enterprise description
    await knex('subscription_plans')
        .where({ slug: 'enterprise' })
        .update({
        description: 'For large organizations with 500+ members.',
    });
    // Re-add Free plan
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
//# sourceMappingURL=015_update_subscription_plans.js.map