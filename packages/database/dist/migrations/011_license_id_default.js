"use strict";
// ============================================================
// Migration 011 — Ensure license_id defaults on organizations
// Sets a database-level DEFAULT so inserts never fail for missing license_id
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // Guard: if license_id column was already removed (by 012), skip entirely
    if (!(await knex.schema.hasColumn('organizations', 'license_id')))
        return;
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
    await knex.schema.alterTable('organizations', (t) => {
        t.uuid('license_id').defaultTo(freeLicense.id).alter();
    });
    // Backfill any orgs that somehow have NULL license_id
    await knex('organizations')
        .whereNull('license_id')
        .update({ license_id: freeLicense.id });
}
async function down(knex) {
    // Guard: if license_id column is gone (dropped by 012), skip
    if (!(await knex.schema.hasColumn('organizations', 'license_id')))
        return;
    // Remove the default
    await knex.schema.alterTable('organizations', (t) => {
        t.uuid('license_id').defaultTo(null).alter();
    });
    // Remove the seeded free license if it was created by this migration
    await knex('licenses').where({ type: 'free' }).del();
}
//# sourceMappingURL=011_license_id_default.js.map