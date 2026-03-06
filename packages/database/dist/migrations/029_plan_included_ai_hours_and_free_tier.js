"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
function parseFeatures(raw) {
    if (!raw)
        return {};
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw);
        }
        catch {
            return {};
        }
    }
    return raw;
}
function withIncludedAiHours(features, hours) {
    const next = { ...features };
    if (typeof hours === 'number') {
        next.includedAiHours = hours;
        next.included_ai_hours = hours;
    }
    else {
        delete next.includedAiHours;
        delete next.included_ai_hours;
    }
    return next;
}
async function upsertPlan(knex, seed) {
    const existing = await knex('subscription_plans').where({ slug: seed.slug }).first();
    const mergedFeatures = withIncludedAiHours({ ...(parseFeatures(existing?.features)), ...(seed.baseFeatures || {}) }, seed.includedAiHours);
    const payload = {
        name: seed.name,
        slug: seed.slug,
        max_members: seed.max_members,
        features: JSON.stringify(mergedFeatures),
        price_usd_annual: seed.price_usd_annual,
        price_usd_monthly: seed.price_usd_monthly,
        price_ngn_annual: seed.price_ngn_annual,
        price_ngn_monthly: seed.price_ngn_monthly,
        is_active: true,
        sort_order: seed.sort_order,
        description: seed.description,
    };
    if (existing) {
        await knex('subscription_plans').where({ slug: seed.slug }).update(payload);
    }
    else {
        await knex('subscription_plans').insert(payload);
    }
}
async function removeIncludedHoursFromPlan(knex, slug) {
    const plan = await knex('subscription_plans').where({ slug }).first();
    if (!plan)
        return;
    const features = withIncludedAiHours(parseFeatures(plan.features), undefined);
    await knex('subscription_plans').where({ slug }).update({
        features: JSON.stringify(features),
    });
}
async function up(knex) {
    await upsertPlan(knex, {
        name: 'Free',
        slug: 'free',
        max_members: 5,
        price_usd_annual: 0,
        price_usd_monthly: 0,
        price_ngn_annual: 0,
        price_ngn_monthly: 0,
        sort_order: 0,
        description: 'Free tier for micro groups with up to 5 members.',
        includedAiHours: 0,
        baseFeatures: {
            chat: true,
            meetings: true,
            polls: true,
            events: true,
            announcements: true,
            documents: true,
        },
    });
    await upsertPlan(knex, {
        name: 'Starter',
        slug: 'starter',
        max_members: 50,
        price_usd_annual: 200,
        price_usd_monthly: 20,
        price_ngn_annual: 300000,
        price_ngn_monthly: 30000,
        sort_order: 1,
        description: 'For small organizations with 6-50 members.',
        includedAiHours: 4,
        baseFeatures: {
            chat: true,
            meetings: true,
            financials: true,
            polls: true,
            events: true,
            announcements: true,
            documents: true,
            committees: true,
        },
    });
    await upsertPlan(knex, {
        name: 'Standard',
        slug: 'standard',
        max_members: 100,
        price_usd_annual: 300,
        price_usd_monthly: 31.25,
        price_ngn_annual: 500000,
        price_ngn_monthly: 52083,
        sort_order: 2,
        description: 'For small organizations up to 100 members.',
        includedAiHours: 10,
    });
    await upsertPlan(knex, {
        name: 'Professional',
        slug: 'professional',
        max_members: 300,
        price_usd_annual: 800,
        price_usd_monthly: 83.33,
        price_ngn_annual: 1200000,
        price_ngn_monthly: 125000,
        sort_order: 3,
        description: 'For growing organizations up to 300 members.',
        includedAiHours: 30,
    });
    await upsertPlan(knex, {
        name: 'Enterprise',
        slug: 'enterprise',
        max_members: 500,
        price_usd_annual: 2500,
        price_usd_monthly: 260.42,
        price_ngn_annual: 3500000,
        price_ngn_monthly: 364583,
        sort_order: 4,
        description: 'For large organizations up to 500 members.',
        includedAiHours: 150,
    });
}
async function down(knex) {
    await removeIncludedHoursFromPlan(knex, 'free');
    await removeIncludedHoursFromPlan(knex, 'starter');
    await removeIncludedHoursFromPlan(knex, 'standard');
    await removeIncludedHoursFromPlan(knex, 'professional');
    await removeIncludedHoursFromPlan(knex, 'enterprise');
    await knex('subscription_plans')
        .where({ slug: 'free' })
        .update({
        max_members: 50,
        description: 'Free tier for small groups up to 50 members.',
    });
}
//# sourceMappingURL=029_plan_included_ai_hours_and_free_tier.js.map