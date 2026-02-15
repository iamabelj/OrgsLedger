import knex from 'knex';
import config from './knexfile';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// Developer (platform owner) — hidden from regular users
const DEVELOPER_EMAIL = process.env.DEVELOPER_EMAIL || 'abel@globull.dev';
const DEVELOPER_PASSWORD = process.env.DEVELOPER_PASSWORD || '@@@AAAbel111090thanks';

// Demo org admin — visible org-level admin
const ORG_ADMIN_EMAIL = process.env.DEFAULT_ADMIN_EMAIL || 'admin@orgsledger.com';
const ORG_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'SuperAdmin1234!';

async function seed() {
  const db = knex(config);
  try {
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║       OrgsLedger — Database Seeding          ║');
    console.log('╚══════════════════════════════════════════════╝');
    console.log(`  Developer: ${DEVELOPER_EMAIL}`);
    console.log(`  Org Admin: ${ORG_ADMIN_EMAIL}`);
    console.log();

    // Hash password helper (must match API's bcrypt usage)
    const hashPassword = async (pw: string) =>
      bcrypt.hash(pw, 12);

    // ═══════════════════════════════════════════════════════
    // 1. DEVELOPER USER (GOD — platform owner, hidden role)
    // ═══════════════════════════════════════════════════════
    let developer = await db('users').where({ email: DEVELOPER_EMAIL }).first();
    if (!developer) {
      [developer] = await db('users')
        .insert({
          email: DEVELOPER_EMAIL,
          password_hash: await hashPassword(DEVELOPER_PASSWORD),
          first_name: 'Abel',
          last_name: 'J',
          global_role: 'developer',
          email_verified: true,
        })
        .returning('*');
      console.log('  ✓ Developer user created (abel@globull.dev)');
    } else {
      if (developer.global_role !== 'developer') {
        await db('users').where({ id: developer.id }).update({ global_role: 'developer' });
        console.log('  ✓ Developer role ensured');
      } else {
        console.log('  ✓ Developer already exists');
      }
    }

    // ═══════════════════════════════════════════════════════
    // 1b. ORG ADMIN USER (visible admin for demo org)
    // ═══════════════════════════════════════════════════════
    let orgAdmin = await db('users').where({ email: ORG_ADMIN_EMAIL }).first();
    if (!orgAdmin) {
      [orgAdmin] = await db('users')
        .insert({
          email: ORG_ADMIN_EMAIL,
          password_hash: await hashPassword(ORG_ADMIN_PASSWORD),
          first_name: 'Platform',
          last_name: 'Admin',
          global_role: 'super_admin',
          email_verified: true,
        })
        .returning('*');
      console.log('  ✓ Org admin created (admin@orgsledger.com, super_admin)');
    } else {
      console.log('  ✓ Org admin already exists');
    }

    // ═══════════════════════════════════════════════════════
    // 2. LEGACY FREE LICENSE (backward compat)
    // ═══════════════════════════════════════════════════════
    let freeLicense = await db('licenses').where({ type: 'free' }).first();
    if (!freeLicense) {
      [freeLicense] = await db('licenses')
        .insert({
          type: 'free',
          max_members: 50,
          features: JSON.stringify({
            chat: true,
            meetings: true,
            aiMinutes: false,
            financials: true,
            donations: true,
            voting: true,
          }),
          ai_credits_included: 0,
          price_monthly: 0,
        })
        .returning('*');
      console.log('  ✓ Free license created');
    } else {
      console.log('  ✓ Free license already exists');
    }

    // ═══════════════════════════════════════════════════════
    // 3. DEMO ORGANIZATION
    // ═══════════════════════════════════════════════════════
    let demoOrg = await db('organizations').where({ slug: 'demo-org' }).first();
    if (!demoOrg) {
      [demoOrg] = await db('organizations')
        .insert({
          name: 'Demo Organization',
          slug: 'demo-org',
          status: 'active',
          license_id: freeLicense.id,
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
    // 4a. ORG ADMIN MEMBERSHIP (org_admin in demo org)
    // ═══════════════════════════════════════════════════════
    const existingOrgAdminMembership = await db('memberships')
      .where({ user_id: orgAdmin.id, organization_id: demoOrg.id })
      .first();
    if (!existingOrgAdminMembership) {
      await db('memberships').insert({
        user_id: orgAdmin.id,
        organization_id: demoOrg.id,
        role: 'org_admin',
      });
      console.log('  ✓ Org admin membership created (admin@orgsledger.com → org_admin)');
    } else {
      console.log('  ✓ Org admin membership already exists');
    }

    // ═══════════════════════════════════════════════════════
    // 4b. DEVELOPER MEMBERSHIP (org_admin in demo org too)
    // ═══════════════════════════════════════════════════════
    const existingDevMembership = await db('memberships')
      .where({ user_id: developer.id, organization_id: demoOrg.id })
      .first();
    if (!existingDevMembership) {
      await db('memberships').insert({
        user_id: developer.id,
        organization_id: demoOrg.id,
        role: 'org_admin',
      });
      console.log('  ✓ Developer membership created (abel@globull.dev → org_admin)');
    } else {
      console.log('  ✓ Developer membership already exists');
    }

    // ═══════════════════════════════════════════════════════
    // 5. DEFAULT GENERAL CHANNEL
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

      await db('channel_members').insert([
        { channel_id: generalChannel.id, user_id: orgAdmin.id },
        { channel_id: generalChannel.id, user_id: developer.id },
      ]);
      console.log('  ✓ Default channel created with both admins');
    } else {
      console.log('  ✓ Default channel already exists');
    }

    // ═══════════════════════════════════════════════════════
    // 6. LEGACY AI CREDITS (backward compat)
    // ═══════════════════════════════════════════════════════
    const existingCredits = await db('ai_credits')
      .where({ organization_id: demoOrg.id })
      .first();
    if (!existingCredits) {
      await db('ai_credits').insert({
        organization_id: demoOrg.id,
        total_credits: 0,
        used_credits: 0,
        price_per_credit_hour: 7.00,
      });
      console.log('  ✓ Legacy AI credits initialized');
    } else {
      console.log('  ✓ Legacy AI credits already exist');
    }

    // ═══════════════════════════════════════════════════════
    // 7. SUBSCRIPTION (Standard plan for demo org)
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
    // 8. AI WALLET (SaaS wallet)
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
    // 9. TRANSLATION WALLET
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
    // 10. INVITE LINK (default for demo org)
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
        created_by: orgAdmin.id,
      });
      console.log(`  ✓ Invite link created (code: ${code})`);
    } else {
      console.log(`  ✓ Invite link already exists (code: ${existingInvite.code})`);
    }

    // ═══════════════════════════════════════════════════════
    // 11. PLATFORM CONFIG
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
    console.log('║  Users:                                      ║');
    console.log('║    abel@globull.dev     → developer (hidden) ║');
    console.log('║    admin@orgsledger.com → super_admin        ║');
    console.log('║                                              ║');
    console.log('║  Tables seeded:                              ║');
    console.log('║    users, licenses, organizations,           ║');
    console.log('║    memberships, channels, channel_members,   ║');
    console.log('║    ai_credits, subscriptions, ai_wallet,     ║');
    console.log('║    translation_wallet, invite_links,         ║');
    console.log('║    platform_config                           ║');
    console.log('║                                              ║');
    console.log('║  Subscription plans (from migration 006):    ║');
    console.log('║    Standard, Professional, Enterprise        ║');
    console.log('║                                              ║');
    console.log('║  Role hierarchy:                             ║');
    console.log('║    developer > super_admin > org_admin >     ║');
    console.log('║    executive > member > guest                ║');
    console.log('║                                              ║');
    console.log('║  Developer role is INVISIBLE to org admins.  ║');
    console.log('║  Members list shows org role, not global.    ║');
    console.log('╚══════════════════════════════════════════════╝');

  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

seed();
