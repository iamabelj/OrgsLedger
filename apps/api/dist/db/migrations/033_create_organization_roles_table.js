"use strict";
// ============================================================
// OrgsLedger API — Migration: Create Organization Roles Table
// Defines executive and committee roles within organizations
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // Check if enum exists
    const enumExists = await knex.raw(`
    SELECT 1 FROM pg_type WHERE typname = 'organization_role_type'
  `);
    if (enumExists.rows.length === 0) {
        await knex.raw(`
      CREATE TYPE organization_role_type AS ENUM ('EXECUTIVE', 'COMMITTEE')
    `);
    }
    const hasTable = await knex.schema.hasTable('organization_roles');
    if (hasTable)
        return;
    await knex.schema.createTable('organization_roles', (table) => {
        // Primary key
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        // Foreign key to organization
        table
            .uuid('organization_id')
            .notNullable()
            .references('id')
            .inTable('organizations')
            .onDelete('CASCADE')
            .index('idx_org_roles_organization_id');
        // Role name (e.g., "Board of Directors", "Finance Committee")
        table.string('role_name', 255).notNullable();
        // Role type (EXECUTIVE or COMMITTEE)
        table
            .specificType('role_type', 'organization_role_type')
            .notNullable()
            .index('idx_org_roles_type');
        // Optional description
        table.text('description').nullable();
        // Metadata
        table.boolean('is_active').notNullable().defaultTo(true);
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
        // Composite unique constraint: one role name per type per org
        table.unique(['organization_id', 'role_name', 'role_type'], {
            indexName: 'idx_org_roles_unique_name',
        });
    });
    // Create trigger for updated_at
    await knex.raw(`
    CREATE OR REPLACE FUNCTION update_organization_roles_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trigger_organization_roles_updated_at
      BEFORE UPDATE ON organization_roles
      FOR EACH ROW
      EXECUTE FUNCTION update_organization_roles_updated_at();
  `);
}
async function down(knex) {
    await knex.raw('DROP TRIGGER IF EXISTS trigger_organization_roles_updated_at ON organization_roles');
    await knex.raw('DROP FUNCTION IF EXISTS update_organization_roles_updated_at');
    await knex.schema.dropTableIfExists('organization_roles');
    await knex.raw('DROP TYPE IF EXISTS organization_role_type');
}
//# sourceMappingURL=033_create_organization_roles_table.js.map