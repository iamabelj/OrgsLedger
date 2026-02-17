// ============================================================
// OrgsLedger API — Super Admin Auto-Seed Service
// ============================================================
// Ensures the platform super admin account exists on startup.
// Reads credentials from DEFAULT_ADMIN_EMAIL and DEFAULT_ADMIN_PASSWORD
// environment variables. Skips silently if env vars are not set
// or if the account already exists.
// ============================================================

import bcrypt from 'bcryptjs';
import { db } from '../db';
import { logger } from '../logger';

const BCRYPT_ROUNDS = 12;

export async function ensureSuperAdmin(): Promise<void> {
  const email = process.env.DEFAULT_ADMIN_EMAIL;
  const password = process.env.DEFAULT_ADMIN_PASSWORD;

  if (!email || !password) {
    logger.debug('[SEED] DEFAULT_ADMIN_EMAIL / DEFAULT_ADMIN_PASSWORD not set — skipping auto-seed');
    return;
  }

  try {
    const existing = await db('users').where({ email }).first();

    if (existing) {
      // Ensure the account is active and has the correct role
      if (!existing.is_active || existing.global_role !== 'super_admin') {
        await db('users').where({ id: existing.id }).update({
          is_active: true,
          global_role: 'super_admin',
          email_verified: true,
        });
        logger.info(`[SEED] Super admin account reactivated: ${email}`);
      }

      // If password changed, update it
      const passwordMatch = await bcrypt.compare(password, existing.password_hash);
      if (!passwordMatch) {
        const newHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        await db('users').where({ id: existing.id }).update({ password_hash: newHash });
        logger.info(`[SEED] Super admin password updated: ${email}`);
      }

      return;
    }

    // Create the super admin account
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await db('users').insert({
      email,
      password_hash: passwordHash,
      first_name: 'Platform',
      last_name: 'Admin',
      global_role: 'super_admin',
      email_verified: true,
      is_active: true,
    });

    logger.info(`[SEED] Super admin account created: ${email}`);

    // Auto-join the first organization if one exists
    const firstOrg = await db('organizations').orderBy('created_at', 'asc').first();
    if (firstOrg) {
      const adminUser = await db('users').where({ email }).first();
      if (adminUser) {
        const existingMembership = await db('memberships')
          .where({ user_id: adminUser.id, organization_id: firstOrg.id })
          .first();

        if (!existingMembership) {
          await db('memberships').insert({
            user_id: adminUser.id,
            organization_id: firstOrg.id,
            role: 'org_admin',
            is_active: true,
            joined_at: db.fn.now(),
          });
          logger.info(`[SEED] Super admin joined org: ${firstOrg.name}`);
        }
      }
    }
  } catch (err: any) {
    // Don't crash the server if seeding fails (e.g., users table doesn't exist yet)
    logger.warn(`[SEED] Auto-seed skipped: ${err.message}`);
  }
}
