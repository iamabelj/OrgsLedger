// ============================================================
// OrgsLedger API — Migration: Add Meeting Visibility Type
// Adds visibility_type enum to meetings table for role-segmented access
// ============================================================

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Check if enum exists
  const enumExists = await knex.raw(`
    SELECT 1 FROM pg_type WHERE typname = 'meeting_visibility_type'
  `);
  
  if (enumExists.rows.length === 0) {
    await knex.raw(`
      CREATE TYPE meeting_visibility_type AS ENUM ('ALL_MEMBERS', 'EXECUTIVES', 'COMMITTEE', 'CUSTOM')
    `);
  }

  // Check if column exists
  const hasColumn = await knex.schema.hasColumn('meetings', 'visibility_type');
  if (!hasColumn) {
    await knex.schema.alterTable('meetings', (table) => {
      table
        .specificType('visibility_type', 'meeting_visibility_type')
        .nullable()
        .defaultTo('ALL_MEMBERS');
      
      // Optional: reference to a specific committee/role
      table
        .uuid('target_role_id')
        .nullable()
        .references('id')
        .inTable('organization_roles')
        .onDelete('SET NULL');
    });

    // Add index for visibility queries
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_meetings_visibility 
      ON meetings(organization_id, visibility_type) 
      WHERE status != 'cancelled'
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_meetings_visibility');
  
  const hasColumn = await knex.schema.hasColumn('meetings', 'visibility_type');
  if (hasColumn) {
    await knex.schema.alterTable('meetings', (table) => {
      table.dropColumn('visibility_type');
      table.dropColumn('target_role_id');
    });
  }
  
  await knex.raw('DROP TYPE IF EXISTS meeting_visibility_type');
}
