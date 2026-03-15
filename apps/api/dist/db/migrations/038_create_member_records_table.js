"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
/**
 * Migration: Create member_records table for historical records
 *
 * This table stores historical records that admins can bulk import.
 * Records can be:
 * - Member-specific (tied to a user_id)
 * - Organization-wide (user_id is null)
 *
 * All org members can view all records - no restrictions.
 * Admin controls visibility by what they choose to upload.
 */
async function up(knex) {
    const hasTable = await knex.schema.hasTable('member_records');
    if (hasTable)
        return;
    await knex.schema.createTable('member_records', (table) => {
        // Primary key
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        // Organization context (required)
        table
            .uuid('organization_id')
            .notNullable()
            .references('id')
            .inTable('organizations')
            .onDelete('CASCADE')
            .index('idx_member_records_org_id');
        // Member context (optional - null means org-wide record)
        table
            .uuid('user_id')
            .nullable()
            .references('id')
            .inTable('users')
            .onDelete('SET NULL')
            .index('idx_member_records_user_id');
        // Record type: payment, dues, attendance, contribution, note, other
        table.string('record_type', 50).notNullable().defaultTo('other');
        // Record details
        table.string('title', 255).notNullable();
        table.text('description').nullable();
        // Financial fields (optional - for payment/dues records)
        table.decimal('amount', 14, 2).nullable();
        table.string('currency', 3).nullable().defaultTo('USD');
        // Date of the record (when it originally occurred)
        table.date('record_date').notNullable();
        // Category/tag for filtering
        table.string('category', 100).nullable();
        // Additional structured data
        table.jsonb('metadata').notNullable().defaultTo('{}');
        // Import batch tracking
        table.uuid('import_batch_id').nullable();
        // Uploaded by
        table
            .uuid('uploaded_by')
            .notNullable()
            .references('id')
            .inTable('users')
            .onDelete('SET NULL');
        // Timestamps
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
        // Composite indexes for common queries
        table.index(['organization_id', 'record_type'], 'idx_member_records_org_type');
        table.index(['organization_id', 'record_date'], 'idx_member_records_org_date');
        table.index(['organization_id', 'user_id', 'record_type'], 'idx_member_records_org_user_type');
    });
    // Add updated_at trigger
    await knex.raw(`
    CREATE OR REPLACE FUNCTION update_member_records_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trigger_member_records_updated_at
      BEFORE UPDATE ON member_records
      FOR EACH ROW
      EXECUTE FUNCTION update_member_records_updated_at();
  `);
    console.log('[Migration 038] Created member_records table');
}
async function down(knex) {
    await knex.raw('DROP TRIGGER IF EXISTS trigger_member_records_updated_at ON member_records');
    await knex.raw('DROP FUNCTION IF EXISTS update_member_records_updated_at');
    await knex.schema.dropTableIfExists('member_records');
}
//# sourceMappingURL=038_create_member_records_table.js.map