// ============================================================
// Migration 013 — Pending Invitations for Developer Org Creation
//
// When a developer creates an organization for an email that hasn't
// registered yet, we store a pending invitation. When the user
// registers with that email, they automatically join the org.
// ============================================================

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('pending_invitations', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.string('email').notNullable();
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.string('role').notNullable().defaultTo('org_admin');
    t.uuid('invited_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('expires_at').nullable(); // null = never expires
    t.timestamps(true, true);

    // One pending invitation per email per org
    t.unique(['email', 'organization_id']);
    t.index(['email']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('pending_invitations');
}
