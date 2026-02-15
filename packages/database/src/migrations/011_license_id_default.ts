// ============================================================
// Migration 011 — Ensure license_id defaults on organizations
// Sets a database-level DEFAULT so inserts never fail for missing license_id
// ============================================================

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Ensure a free license exists
  let freeLicense = await knex('licenses').where({ type: 'free' }).first();
  if (!freeLicense) {
    [freeLicense] = await knex('licenses')
      .insert({
        type: 'free',
        max_members: 50,
        features: JSON.stringify({
          chat: true, meetings: true, aiMinutes: false,
          financials: true, donations: true, voting: true,
        }),
        ai_credits_included: 0,
        price_monthly: 0,
      })
      .returning('*');
  }

  // Set default license_id on organizations table
  await knex.raw(
    `ALTER TABLE organizations ALTER COLUMN license_id SET DEFAULT '${freeLicense.id}'`
  );

  // Backfill any orgs that somehow have NULL license_id
  await knex('organizations')
    .whereNull('license_id')
    .update({ license_id: freeLicense.id });
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE organizations ALTER COLUMN license_id DROP DEFAULT');
}
