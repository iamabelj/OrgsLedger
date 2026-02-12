import knex from 'knex';
import config from './knexfile';
import bcrypt from 'bcryptjs';

// Default admin credentials (can be overridden via environment variables)
const DEFAULT_ADMIN_EMAIL = process.env.DEFAULT_ADMIN_EMAIL || 'admin@orgsledger.com';
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'SuperAdmin123!';

async function seed() {
  const db = knex(config);
  try {
    console.log('Seeding database...');
    console.log(`  Admin Email: ${DEFAULT_ADMIN_EMAIL}`);
    console.log(`  Admin Password: ${DEFAULT_ADMIN_PASSWORD.replace(/./g, '*').slice(0, 6)}...`);

    // Hash password helper (must match API's bcrypt usage)
    const hashPassword = async (pw: string) =>
      bcrypt.hash(pw, 12);

    // ── Super Admin ─────────────────────────────────────
    let superAdmin = await db('users').where({ email: DEFAULT_ADMIN_EMAIL }).first();
    if (!superAdmin) {
      [superAdmin] = await db('users')
        .insert({
          email: DEFAULT_ADMIN_EMAIL,
          password_hash: await hashPassword(DEFAULT_ADMIN_PASSWORD),
          first_name: 'Platform',
          last_name: 'Admin',
          global_role: 'super_admin',
          email_verified: true,
        })
        .returning('*');
      console.log('  ✓ Super admin created');
    } else {
      console.log('  ✓ Super admin already exists');
    }

    // ── Free License ────────────────────────────────────
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

    // ── Demo Organization ──────────────────────────────
    let demoOrg = await db('organizations').where({ slug: 'demo-org' }).first();
    if (!demoOrg) {
      [demoOrg] = await db('organizations')
        .insert({
          name: 'Demo Organization',
          slug: 'demo-org',
          status: 'active',
          license_id: freeLicense.id,
        })
        .returning('*');
      console.log('  ✓ Demo organization created');
    } else {
      console.log('  ✓ Demo organization already exists');
    }

    // ── Admin membership ───────────────────────────────
    const existingMembership = await db('memberships')
      .where({ user_id: superAdmin.id, organization_id: demoOrg.id })
      .first();
    if (!existingMembership) {
      await db('memberships').insert({
        user_id: superAdmin.id,
        organization_id: demoOrg.id,
        role: 'org_admin',
      });
      console.log('  ✓ Admin membership created');
    } else {
      console.log('  ✓ Admin membership already exists');
    }

    // ── Default channel ────────────────────────────────
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
      console.log('  ✓ Default channel created');
    } else {
      console.log('  ✓ Default channel already exists');
    }

    // ── AI Credits record ──────────────────────────────
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
      console.log('  ✓ AI credits initialized');
    } else {
      console.log('  ✓ AI credits already exist');
    }

    // ── Platform Config defaults ───────────────────────
    const configs = [
      { key: 'ai_price_per_credit_hour', value: JSON.stringify(7.00), description: 'Default AI price per credit hour in USD' },
      { key: 'platform_name', value: JSON.stringify('OrgsLedger'), description: 'Platform display name' },
      { key: 'stripe_enabled', value: JSON.stringify(true), description: 'Whether Stripe payments are enabled' },
    ];
    for (const cfg of configs) {
      const exists = await db('platform_config').where({ key: cfg.key }).first();
      if (!exists) {
        await db('platform_config').insert(cfg);
      }
    }
    console.log('  ✓ Platform config seeded');

    console.log('\nSeeding complete!');
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

seed();
