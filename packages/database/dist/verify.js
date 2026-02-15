"use strict";
// ============================================================
// OrgsLedger — Database Verification
// Checks all tables, data, plans, roles, wallets
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const knex_1 = __importDefault(require("knex"));
const knexfile_1 = __importDefault(require("./knexfile"));
async function verify() {
    const db = (0, knex_1.default)(knexfile_1.default);
    try {
        console.log('╔══════════════════════════════════════════════╗');
        console.log('║     OrgsLedger — Database Verification       ║');
        console.log('╚══════════════════════════════════════════════╝\n');
        // 1. List all tables
        const tables = await db.raw(`
      SELECT tablename FROM pg_tables 
      WHERE schemaname = 'public' AND tablename != 'knex_migrations' AND tablename != 'knex_migrations_lock'
      ORDER BY tablename
    `);
        console.log(`═══ TABLES (${tables.rows.length}) ═══`);
        tables.rows.forEach((r) => console.log(`  ✓ ${r.tablename}`));
        // 2. Check subscription plans
        console.log('\n═══ SUBSCRIPTION PLANS ═══');
        const plans = await db('subscription_plans').select('name', 'slug', 'max_members', 'price_usd_annual', 'price_usd_monthly', 'price_ngn_annual', 'is_active', 'sort_order').orderBy('sort_order');
        plans.forEach((p) => {
            console.log(`  ${p.sort_order}. ${p.name} (${p.slug})`);
            console.log(`     Max members: ${p.max_members} | USD: $${p.price_usd_annual}/yr ($${p.price_usd_monthly}/mo) | NGN: ₦${p.price_ngn_annual}/yr | Active: ${p.is_active}`);
        });
        // 3. Check users
        console.log('\n═══ USERS ═══');
        const users = await db('users').select('id', 'email', 'first_name', 'last_name', 'global_role', 'email_verified', 'is_active');
        users.forEach((u) => {
            console.log(`  ${u.email} | Role: ${u.global_role} | Verified: ${u.email_verified} | Active: ${u.is_active}`);
        });
        // 4. Check organizations
        console.log('\n═══ ORGANIZATIONS ═══');
        const orgs = await db('organizations').select('id', 'name', 'slug', 'status', 'subscription_status', 'billing_currency');
        orgs.forEach((o) => {
            console.log(`  ${o.name} (${o.slug}) | Status: ${o.status} | Sub: ${o.subscription_status} | Currency: ${o.billing_currency}`);
        });
        // 5. Check memberships
        console.log('\n═══ MEMBERSHIPS ═══');
        const memberships = await db('memberships')
            .join('users', 'memberships.user_id', 'users.id')
            .join('organizations', 'memberships.organization_id', 'organizations.id')
            .select('users.email', 'organizations.name as org_name', 'memberships.role', 'memberships.is_active');
        memberships.forEach((m) => {
            console.log(`  ${m.email} → ${m.org_name} | Role: ${m.role} | Active: ${m.is_active}`);
        });
        // 6. Check subscriptions
        console.log('\n═══ SUBSCRIPTIONS ═══');
        const subs = await db('subscriptions')
            .join('subscription_plans', 'subscriptions.plan_id', 'subscription_plans.id')
            .join('organizations', 'subscriptions.organization_id', 'organizations.id')
            .select('organizations.name as org_name', 'subscription_plans.name as plan_name', 'subscriptions.status', 'subscriptions.billing_cycle', 'subscriptions.currency', 'subscriptions.current_period_end');
        subs.forEach((s) => {
            console.log(`  ${s.org_name} → ${s.plan_name} | ${s.status} | ${s.billing_cycle} | ${s.currency} | Until: ${s.current_period_end}`);
        });
        // 7. Check wallets
        console.log('\n═══ WALLETS ═══');
        const aiWallets = await db('ai_wallet')
            .join('organizations', 'ai_wallet.organization_id', 'organizations.id')
            .select('organizations.name as org_name', 'ai_wallet.balance_minutes', 'ai_wallet.price_per_hour_usd');
        aiWallets.forEach((w) => {
            console.log(`  AI Wallet: ${w.org_name} | Balance: ${w.balance_minutes} min | $${w.price_per_hour_usd}/hr`);
        });
        const transWallets = await db('translation_wallet')
            .join('organizations', 'translation_wallet.organization_id', 'organizations.id')
            .select('organizations.name as org_name', 'translation_wallet.balance_minutes', 'translation_wallet.price_per_hour_usd');
        transWallets.forEach((w) => {
            console.log(`  Translation Wallet: ${w.org_name} | Balance: ${w.balance_minutes} min | $${w.price_per_hour_usd}/hr`);
        });
        // 8. Check channels
        console.log('\n═══ CHANNELS ═══');
        const channels = await db('channels')
            .join('organizations', 'channels.organization_id', 'organizations.id')
            .select('channels.name', 'channels.type', 'organizations.name as org_name');
        channels.forEach((c) => {
            console.log(`  ${c.name} (${c.type}) → ${c.org_name}`);
        });
        // 9. Check invite links
        console.log('\n═══ INVITE LINKS ═══');
        const invites = await db('invite_links')
            .join('organizations', 'invite_links.organization_id', 'organizations.id')
            .select('invite_links.code', 'invite_links.role', 'invite_links.is_active', 'organizations.name as org_name');
        invites.forEach((i) => {
            console.log(`  Code: ${i.code} | Role: ${i.role} | Active: ${i.is_active} → ${i.org_name}`);
        });
        // 10. Check platform config
        console.log('\n═══ PLATFORM CONFIG ═══');
        const configs = await db('platform_config').select('key', 'value', 'description');
        configs.forEach((c) => {
            console.log(`  ${c.key} = ${c.value}`);
        });
        // 11. Row counts for all tables
        console.log('\n═══ TABLE ROW COUNTS ═══');
        for (const row of tables.rows) {
            const count = await db(row.tablename).count('* as count').first();
            const c = count?.count || 0;
            const marker = Number(c) > 0 ? '●' : '○';
            console.log(`  ${marker} ${row.tablename}: ${c}`);
        }
        // 12. Migrations applied
        console.log('\n═══ MIGRATIONS APPLIED ═══');
        const migrations = await db('knex_migrations').select('name', 'batch').orderBy('id');
        migrations.forEach((m) => {
            console.log(`  Batch ${m.batch}: ${m.name}`);
        });
        console.log('\n╔══════════════════════════════════════════════╗');
        console.log('║     Verification Complete!                    ║');
        console.log('╚══════════════════════════════════════════════╝');
    }
    catch (err) {
        console.error('Verification failed:', err);
        process.exit(1);
    }
    finally {
        await db.destroy();
    }
}
verify();
//# sourceMappingURL=verify.js.map