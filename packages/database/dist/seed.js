"use strict";
// ============================================================
// OrgsLedger — Database Seeding
//
// IDEMPOTENCY CONTRACT:
//   Every seed function checks for existence before inserting.
//   Running this script multiple times is safe — it will skip
//   rows that already exist and only create missing ones.
//
// CREDENTIALS:
//   Super admin credentials MUST be supplied via environment
//   variables DEFAULT_ADMIN_EMAIL and DEFAULT_ADMIN_PASSWORD.
//   No hardcoded fallbacks.  Set them in your .env or CI config.
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const knex_1 = __importDefault(require("knex"));
const knexfile_1 = __importDefault(require("./knexfile"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const constants_1 = require("./constants");
// ── Credential validation ───────────────────────────────────
function requireEnv(key, description) {
    const value = process.env[key];
    if (!value) {
        console.error(`\n  ✖ Missing required environment variable: ${key}`);
        console.error(`    ${description}\n`);
        console.error('  Set it in your .env file or export it before running seed.\n');
        process.exit(1);
    }
    return value;
}
const SUPER_ADMIN_EMAIL = requireEnv('DEFAULT_ADMIN_EMAIL', 'Email for the platform super admin account');
const SUPER_ADMIN_PASSWORD = requireEnv('DEFAULT_ADMIN_PASSWORD', 'Password for the platform super admin account');
// NOTE: Developer (abel@globull.dev) does NOT have a database account.
// Developer logs in at orgsledger.com/developer/admin using env vars
// (ADMIN_EMAIL + ADMIN_PASSWORD in env.js). That's a separate auth system.
// ── Helpers ─────────────────────────────────────────────────
async function hashPassword(pw) {
    return bcryptjs_1.default.hash(pw, constants_1.DEFAULTS.BCRYPT_ROUNDS);
}
// ── Individual Seed Functions ───────────────────────────────
/**
 * 1. Create the super admin user (highest app role).
 *    Idempotent — skips if email already exists.
 */
async function seedSuperAdmin(db) {
    let user = await db('users').where({ email: SUPER_ADMIN_EMAIL }).first();
    if (!user) {
        [user] = await db('users')
            .insert({
            email: SUPER_ADMIN_EMAIL,
            password_hash: await hashPassword(SUPER_ADMIN_PASSWORD),
            first_name: 'Platform',
            last_name: 'Admin',
            global_role: constants_1.ROLES.SUPER_ADMIN,
            email_verified: true,
        })
            .returning('*');
        console.log(`  ✓ Super admin created (${SUPER_ADMIN_EMAIL})`);
    }
    else {
        console.log('  ✓ Super admin already exists');
    }
    return user;
}
/**
 * 2. Create the demo organization.
 *    Idempotent — skips if slug already exists.
 */
async function seedDemoOrganization(db) {
    let org = await db('organizations').where({ slug: 'demo-org' }).first();
    if (!org) {
        [org] = await db('organizations')
            .insert({
            name: 'Demo Organization',
            slug: 'demo-org',
            status: constants_1.SUB_STATUS.ACTIVE,
            subscription_status: constants_1.SUB_STATUS.ACTIVE,
            billing_currency: constants_1.CURRENCIES.USD,
            settings: JSON.stringify({
                currency: constants_1.CURRENCIES.USD,
                timezone: 'UTC',
                locale: 'en',
                aiEnabled: true,
                features: {
                    chat: true,
                    meetings: true,
                    aiMinutes: true,
                    financials: true,
                    donations: true,
                    voting: true,
                    polls: true,
                    events: true,
                    announcements: true,
                    documents: true,
                    committees: true,
                },
            }),
        })
            .returning('*');
        console.log('  ✓ Demo organization created');
    }
    else {
        console.log('  ✓ Demo organization already exists');
    }
    return org;
}
/**
 * 3. Ensure super admin has org_admin membership in the demo org.
 *    Idempotent — skips if membership already exists.
 */
async function seedMembership(db, userId, orgId) {
    const existing = await db('memberships')
        .where({ user_id: userId, organization_id: orgId })
        .first();
    if (!existing) {
        await db('memberships').insert({
            user_id: userId,
            organization_id: orgId,
            role: constants_1.ROLES.ORG_ADMIN,
        });
        console.log(`  ✓ Super admin membership created (${SUPER_ADMIN_EMAIL} → ${constants_1.ROLES.ORG_ADMIN})`);
    }
    else {
        console.log('  ✓ Super admin membership already exists');
    }
}
/**
 * 4. Create the default "General" channel and add the super admin.
 *    Idempotent — skips if channel already exists.
 */
async function seedDefaultChannel(db, orgId, userId) {
    let channel = await db('channels')
        .where({ organization_id: orgId, name: 'General' })
        .first();
    if (!channel) {
        [channel] = await db('channels')
            .insert({
            organization_id: orgId,
            name: 'General',
            type: 'general',
            description: 'General discussion channel',
        })
            .returning('*');
        await db('channel_members').insert({
            channel_id: channel.id,
            user_id: userId,
        });
        console.log('  ✓ Default channel created with super admin');
    }
    else {
        console.log('  ✓ Default channel already exists');
    }
}
/**
 * 5. Create a standard subscription for the demo org.
 *    Idempotent — skips if a subscription already exists.
 */
async function seedSubscription(db, orgId) {
    const plan = await db('subscription_plans')
        .where({ slug: constants_1.PLAN_SLUGS.STANDARD })
        .first();
    if (!plan) {
        console.log('  ⚠ No subscription plans found (migration 006 may not have run)');
        return;
    }
    const existing = await db('subscriptions').where({ organization_id: orgId }).first();
    if (!existing) {
        const now = new Date();
        const oneYear = new Date(now);
        oneYear.setFullYear(oneYear.getFullYear() + 1);
        const grace = new Date(oneYear);
        grace.setDate(grace.getDate() + constants_1.DEFAULTS.GRACE_PERIOD_DAYS);
        await db('subscriptions').insert({
            organization_id: orgId,
            plan_id: plan.id,
            status: constants_1.SUB_STATUS.ACTIVE,
            billing_cycle: constants_1.DEFAULTS.DEFAULT_BILLING_CYCLE,
            currency: constants_1.DEFAULTS.DEFAULT_CURRENCY,
            amount_paid: 0,
            current_period_start: now.toISOString(),
            current_period_end: oneYear.toISOString(),
            grace_period_end: grace.toISOString(),
        });
        console.log('  ✓ Standard subscription created for demo org');
    }
    else {
        console.log('  ✓ Subscription already exists for demo org');
    }
}
/**
 * 6. Create the AI wallet for the demo org.
 *    Idempotent — skips if wallet already exists.
 */
async function seedAiWallet(db, orgId) {
    const existing = await db('ai_wallet').where({ organization_id: orgId }).first();
    if (!existing) {
        await db('ai_wallet').insert({
            organization_id: orgId,
            balance_minutes: 0,
            currency: constants_1.DEFAULTS.DEFAULT_CURRENCY,
            price_per_hour_usd: constants_1.WALLET_PRICES.AI_PER_HOUR_USD,
            price_per_hour_ngn: constants_1.WALLET_PRICES.AI_PER_HOUR_NGN,
        });
        console.log('  ✓ AI wallet created');
    }
    else {
        console.log('  ✓ AI wallet already exists');
    }
}
/**
 * 7. Create the translation wallet for the demo org.
 *    Idempotent — skips if wallet already exists.
 */
async function seedTranslationWallet(db, orgId) {
    const existing = await db('translation_wallet').where({ organization_id: orgId }).first();
    if (!existing) {
        await db('translation_wallet').insert({
            organization_id: orgId,
            balance_minutes: 0,
            currency: constants_1.DEFAULTS.DEFAULT_CURRENCY,
            price_per_hour_usd: constants_1.WALLET_PRICES.TRANSLATION_PER_HOUR_USD,
            price_per_hour_ngn: constants_1.WALLET_PRICES.TRANSLATION_PER_HOUR_NGN,
        });
        console.log('  ✓ Translation wallet created');
    }
    else {
        console.log('  ✓ Translation wallet already exists');
    }
}
/**
 * 8. Create a default invite link for the demo org.
 *    Idempotent — skips if an active invite already exists.
 */
async function seedInviteLink(db, orgId, userId) {
    const existing = await db('invite_links')
        .where({ organization_id: orgId, is_active: true })
        .first();
    if (!existing) {
        const code = crypto_1.default.randomBytes(6).toString('hex').toUpperCase();
        await db('invite_links').insert({
            organization_id: orgId,
            code,
            role: constants_1.ROLES.MEMBER,
            is_active: true,
            created_by: userId,
        });
        console.log(`  ✓ Invite link created (code: ${code})`);
    }
    else {
        console.log(`  ✓ Invite link already exists (code: ${existing.code})`);
    }
}
/**
 * 9. Seed platform config key/value pairs.
 *    Idempotent — skips keys that already exist.
 */
async function seedPlatformConfig(db) {
    const configs = [
        { key: constants_1.CONFIG_KEYS.AI_PRICE_PER_CREDIT_HOUR, value: JSON.stringify(constants_1.WALLET_PRICES.AI_CREDIT_PER_HOUR_USD), description: 'Default AI price per credit hour in USD' },
        { key: constants_1.CONFIG_KEYS.PLATFORM_NAME, value: JSON.stringify('OrgsLedger'), description: 'Platform display name' },
        { key: constants_1.CONFIG_KEYS.STRIPE_ENABLED, value: JSON.stringify(true), description: 'Whether Stripe payments are enabled' },
        { key: constants_1.CONFIG_KEYS.PAYSTACK_ENABLED, value: JSON.stringify(true), description: 'Whether Paystack payments are enabled (NGN)' },
        { key: constants_1.CONFIG_KEYS.FLUTTERWAVE_ENABLED, value: JSON.stringify(true), description: 'Whether Flutterwave payments are enabled' },
        { key: constants_1.CONFIG_KEYS.MAX_FILE_UPLOAD_MB, value: JSON.stringify(constants_1.DEFAULTS.MAX_FILE_UPLOAD_MB), description: 'Max file upload size in MB' },
        { key: constants_1.CONFIG_KEYS.DEFAULT_BILLING_CYCLE, value: JSON.stringify(constants_1.DEFAULTS.DEFAULT_BILLING_CYCLE), description: 'Default billing cycle for new subscriptions' },
    ];
    for (const cfg of configs) {
        const exists = await db('platform_config').where({ key: cfg.key }).first();
        if (!exists) {
            await db('platform_config').insert(cfg);
        }
    }
    console.log(`  ✓ Platform config seeded (${configs.length} keys)`);
}
// ── Main Orchestrator ───────────────────────────────────────
async function seed() {
    const db = (0, knex_1.default)(knexfile_1.default);
    try {
        console.log('╔══════════════════════════════════════════════╗');
        console.log('║       OrgsLedger — Database Seeding          ║');
        console.log('╚══════════════════════════════════════════════╝');
        console.log(`  Super Admin: ${SUPER_ADMIN_EMAIL}`);
        console.log(`  Developer:   abel@globull.dev (env-based, NOT in DB)`);
        console.log();
        const superAdmin = await seedSuperAdmin(db);
        const demoOrg = await seedDemoOrganization(db);
        await seedMembership(db, superAdmin.id, demoOrg.id);
        await seedDefaultChannel(db, demoOrg.id, superAdmin.id);
        await seedSubscription(db, demoOrg.id);
        await seedAiWallet(db, demoOrg.id);
        await seedTranslationWallet(db, demoOrg.id);
        await seedInviteLink(db, demoOrg.id, superAdmin.id);
        await seedPlatformConfig(db);
        console.log();
        console.log('╔══════════════════════════════════════════════╗');
        console.log('║           Seeding Complete!                  ║');
        console.log('╠══════════════════════════════════════════════╣');
        console.log('║  Accounts:                                   ║');
        console.log('║                                              ║');
        console.log('║  DEVELOPER (God of all):                     ║');
        console.log('║    abel@globull.dev                          ║');
        console.log('║    Login: orgsledger.com/developer/admin     ║');
        console.log('║    Auth: env vars (NOT in database)          ║');
        console.log('║                                              ║');
        console.log('║  SUPER ADMIN (highest app role):             ║');
        console.log(`║    ${SUPER_ADMIN_EMAIL.padEnd(40)}║`);
        console.log('║    Login: app.orgsledger.com/login           ║');
        console.log('║    Auth: database (users table)              ║');
        console.log('║                                              ║');
        console.log('║  Role hierarchy (in app):                    ║');
        console.log('║    super_admin > org_admin > executive >     ║');
        console.log('║    member > guest                            ║');
        console.log('║                                              ║');
        console.log('║  Developer is OUTSIDE the app — manages     ║');
        console.log('║  the platform via orgsledger.com/developer   ║');
        console.log('╚══════════════════════════════════════════════╝');
    }
    catch (err) {
        console.error('Seeding failed:', err);
        process.exit(1);
    }
    finally {
        await db.destroy();
    }
}
seed();
//# sourceMappingURL=seed.js.map