import knex from 'knex';
import config from './knexfile';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// Super admin — highest role in the app (admin@orgsledger.com)
// Logs in at app.orgsledger.com/login
const SUPER_ADMIN_EMAIL = process.env.DEFAULT_ADMIN_EMAIL || 'admin@orgsledger.com';
const SUPER_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'SuperAdmin1234!';

// NOTE: Developer (abel@globull.dev) does NOT have a database account.
// Developer logs in at orgsledger.com/developer/admin using env vars
// (ADMIN_EMAIL + ADMIN_PASSWORD in env.js). That's a separate auth system.

async function seed() {
  const db = knex(config);
  try {
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║       OrgsLedger — Database Seeding          ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log(`  Super Admin: ${SUPER_ADMIN_EMAIL}`);
    console.log(`  Developer:   abel@globull.dev (env-based, NOT in DB)`);
    console.log();

    // Hash password helper (must match API's bcrypt usage)
    const hashPassword = async (pw: string) =>
      bcrypt.hash(pw, 12);

    // ═══════════════════════════════════════════════════════
    // 1. SUPER ADMIN USER (highest role in the app)
    // ═══════════════════════════════════════════════════════
    let superAdmin = await db('users').where({ email: SUPER_ADMIN_EMAIL }).first();
    if (!superAdmin) {
      [superAdmin] = await db('users')
        .insert({
          email: SUPER_ADMIN_EMAIL,
          password_hash: await hashPassword(SUPER_ADMIN_PASSWORD),
          first_name: 'Platform',
          last_name: 'Admin',
          global_role: 'super_admin',
          email_verified: true,
        })
        .returning('*');
      console.log('  ✓ Super admin created (admin@orgsledger.com)');
    } else {
      console.log('  ✓ Super admin already exists');
    }

    // ═══════════════════════════════════════════════════════
    // 2. DEMO ORGANIZATION
    // ═══════════════════════════════════════════════════════
    let demoOrg = await db('organizations').where({ slug: 'demo-org' }).first();
    if (!demoOrg) {
      [demoOrg] = await db('organizations')
        .insert({
          name: 'Demo Organization',
          slug: 'demo-org',
          status: 'active',
          subscription_status: 'active',
          billing_currency: 'USD',
          settings: JSON.stringify({
            currency: 'USD',
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
    } else {
      console.log('  ✓ Demo organization already exists');
    }

    // ═══════════════════════════════════════════════════════
    // 3. SUPER ADMIN MEMBERSHIP (org_admin in demo org)
    // ═══════════════════════════════════════════════════════
    const existingMembership = await db('memberships')
      .where({ user_id: superAdmin.id, organization_id: demoOrg.id })
      .first();
    if (!existingMembership) {
      await db('memberships').insert({
        user_id: superAdmin.id,
        organization_id: demoOrg.id,
        role: 'org_admin',
      });
      console.log('  ✓ Super admin membership created (admin@orgsledger.com → org_admin)');
    } else {
      console.log('  ✓ Super admin membership already exists');
    }

    // ═══════════════════════════════════════════════════════
    // 4. DEFAULT GENERAL CHANNEL
    // ═══════════════════════════════════════════════════════
    let generalChannel = await db('channels')
      .where({ organization_id: demoOrg.id, name: 'General' })
      .first();
    if (!generalChannel) {
      [generalChannel] = await db('channels')
        .insert({
          organization_id: demoOrg.id,
          name: 'General',
          type: 'general',
          description: 'General discussion channel',
        })
        .returning('*');

      await db('channel_members').insert({
        channel_id: generalChannel.id,
        user_id: superAdmin.id,
      });
      console.log('  ✓ Default channel created with super admin');
    } else {
      console.log('  ✓ Default channel already exists');
    }

    // ═══════════════════════════════════════════════════════
    // 5. SUBSCRIPTION (Standard plan for demo org)
    // ═══════════════════════════════════════════════════════
    const standardPlan = await db('subscription_plans').where({ slug: 'standard' }).first();
    if (standardPlan) {
      const existingSub = await db('subscriptions')
        .where({ organization_id: demoOrg.id })
        .first();
      if (!existingSub) {
        const now = new Date();
        const oneYear = new Date(now);
        oneYear.setFullYear(oneYear.getFullYear() + 1);
        const grace = new Date(oneYear);
        grace.setDate(grace.getDate() + 7);

        await db('subscriptions').insert({
          organization_id: demoOrg.id,
          plan_id: standardPlan.id,
          status: 'active',
          billing_cycle: 'annual',
          currency: 'USD',
          amount_paid: 0,
          current_period_start: now.toISOString(),
          current_period_end: oneYear.toISOString(),
          grace_period_end: grace.toISOString(),
        });
        console.log('  ✓ Standard subscription created for demo org');
      } else {
        console.log('  ✓ Subscription already exists for demo org');
      }
    } else {
      console.log('  ⚠ No subscription plans found (migration 006 may not have run)');
    }

    // ═══════════════════════════════════════════════════════
    // 6. AI WALLET (SaaS wallet)
    // ═══════════════════════════════════════════════════════
    const existingAiWallet = await db('ai_wallet')
      .where({ organization_id: demoOrg.id })
      .first();
    if (!existingAiWallet) {
      await db('ai_wallet').insert({
        organization_id: demoOrg.id,
        balance_minutes: 0,
        currency: 'USD',
        price_per_hour_usd: 10.00,
        price_per_hour_ngn: 18000.00,
      });
      console.log('  ✓ AI wallet created');
    } else {
      console.log('  ✓ AI wallet already exists');
    }

    // ═══════════════════════════════════════════════════════
    // 7. TRANSLATION WALLET
    // ═══════════════════════════════════════════════════════
    const existingTransWallet = await db('translation_wallet')
      .where({ organization_id: demoOrg.id })
      .first();
    if (!existingTransWallet) {
      await db('translation_wallet').insert({
        organization_id: demoOrg.id,
        balance_minutes: 0,
        currency: 'USD',
        price_per_hour_usd: 25.00,
        price_per_hour_ngn: 45000.00,
      });
      console.log('  ✓ Translation wallet created');
    } else {
      console.log('  ✓ Translation wallet already exists');
    }

    // ═══════════════════════════════════════════════════════
    // 8. INVITE LINK (default for demo org)
    // ═══════════════════════════════════════════════════════
    const existingInvite = await db('invite_links')
      .where({ organization_id: demoOrg.id, is_active: true })
      .first();
    if (!existingInvite) {
      const code = crypto.randomBytes(6).toString('hex').toUpperCase();
      await db('invite_links').insert({
        organization_id: demoOrg.id,
        code,
        role: 'member',
        is_active: true,
        created_by: superAdmin.id,
      });
      console.log(`  ✓ Invite link created (code: ${code})`);
    } else {
      console.log(`  ✓ Invite link already exists (code: ${existingInvite.code})`);
    }

    // ═══════════════════════════════════════════════════════
    // 9. PLATFORM CONFIG
    // ═══════════════════════════════════════════════════════
    const configs = [
      { key: 'ai_price_per_credit_hour', value: JSON.stringify(7.00), description: 'Default AI price per credit hour in USD' },
      { key: 'platform_name', value: JSON.stringify('OrgsLedger'), description: 'Platform display name' },
      { key: 'stripe_enabled', value: JSON.stringify(true), description: 'Whether Stripe payments are enabled' },
      { key: 'paystack_enabled', value: JSON.stringify(true), description: 'Whether Paystack payments are enabled (NGN)' },
      { key: 'flutterwave_enabled', value: JSON.stringify(true), description: 'Whether Flutterwave payments are enabled' },
      { key: 'max_file_upload_mb', value: JSON.stringify(10), description: 'Max file upload size in MB' },
      { key: 'default_billing_cycle', value: JSON.stringify('annual'), description: 'Default billing cycle for new subscriptions' },
    ];
    for (const cfg of configs) {
      const exists = await db('platform_config').where({ key: cfg.key }).first();
      if (!exists) {
        await db('platform_config').insert(cfg);
      }
    }
    console.log('  ✓ Platform config seeded (7 keys)');

    // ═══════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════
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
    console.log('║    admin@orgsledger.com                      ║');
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

  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

seed();
