"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
/**
 * Migration: Create meetings table for AI meeting infrastructure
 *
 * Supports the following meeting statuses:
 * - scheduled: Meeting is scheduled but not yet started
 * - active: Meeting is currently in progress
 * - ended: Meeting has concluded normally
 * - cancelled: Meeting was cancelled before it started
 */
async function up(knex) {
    const hasTable = await knex.schema.hasTable('meetings');
    if (hasTable)
        return;
    await knex.schema.createTable('meetings', (table) => {
        // Primary key - UUID for distributed systems
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        // Organization context
        table
            .uuid('organization_id')
            .notNullable()
            .references('id')
            .inTable('organizations')
            .onDelete('CASCADE')
            .index('idx_meetings_organization_id');
        // Host user
        table
            .uuid('host_id')
            .notNullable()
            .references('id')
            .inTable('users')
            .onDelete('CASCADE')
            .index('idx_meetings_host_id');
        // Meeting metadata
        table.string('title', 255).nullable();
        table.text('description').nullable();
        // Meeting status
        table
            .enum('status', ['scheduled', 'active', 'ended', 'cancelled'], {
            useNative: true,
            enumName: 'meeting_status',
        })
            .notNullable()
            .defaultTo('scheduled')
            .index('idx_meetings_status');
        // Participant storage (JSONB for flexibility and querying)
        // Structure: [{ userId: string, joinedAt: timestamp, leftAt?: timestamp, role: 'host' | 'participant' }]
        table.jsonb('participants').notNullable().defaultTo('[]');
        // Meeting settings (extensible)
        table.jsonb('settings').notNullable().defaultTo('{}');
        // Timestamps
        table.timestamp('scheduled_at').nullable();
        table.timestamp('started_at').nullable();
        table.timestamp('ended_at').nullable();
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
        // Composite indexes for common queries
        table.index(['organization_id', 'status'], 'idx_meetings_org_status');
        table.index(['host_id', 'status'], 'idx_meetings_host_status');
        table.index(['organization_id', 'created_at'], 'idx_meetings_org_created');
    });
    // Add trigger to auto-update updated_at
    await knex.raw(`
    CREATE OR REPLACE FUNCTION update_meetings_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trigger_meetings_updated_at
      BEFORE UPDATE ON meetings
      FOR EACH ROW
      EXECUTE FUNCTION update_meetings_updated_at();
  `);
}
async function down(knex) {
    await knex.raw('DROP TRIGGER IF EXISTS trigger_meetings_updated_at ON meetings');
    await knex.raw('DROP FUNCTION IF EXISTS update_meetings_updated_at');
    await knex.schema.dropTableIfExists('meetings');
    await knex.raw('DROP TYPE IF EXISTS meeting_status');
}
//# sourceMappingURL=029_create_meetings_table.js.map