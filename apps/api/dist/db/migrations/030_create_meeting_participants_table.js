"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
/**
 * Migration: Create meeting_participants relational table
 *
 * Replaces JSON storage in meetings.participants with a proper relational table.
 * This enables efficient querying and reduces write amplification.
 */
async function up(knex) {
    const hasTable = await knex.schema.hasTable('meeting_participants');
    if (hasTable)
        return;
    await knex.schema.createTable('meeting_participants', (table) => {
        // Primary key
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        // Foreign keys
        table
            .uuid('meeting_id')
            .notNullable()
            .references('id')
            .inTable('meetings')
            .onDelete('CASCADE')
            .index('idx_meeting_participants_meeting_id');
        table
            .uuid('user_id')
            .notNullable()
            .references('id')
            .inTable('users')
            .onDelete('CASCADE')
            .index('idx_meeting_participants_user_id');
        // Participant data
        table.string('role', 50).notNullable().defaultTo('participant');
        table.string('display_name', 255).nullable();
        // Timestamps
        table.timestamp('joined_at').notNullable().defaultTo(knex.fn.now());
        table.timestamp('left_at').nullable();
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        // Composite index for common queries
        table.index(['meeting_id', 'user_id'], 'idx_meeting_participants_meeting_user');
        table.index(['meeting_id', 'left_at'], 'idx_meeting_participants_meeting_active');
    });
}
async function down(knex) {
    await knex.schema.dropTableIfExists('meeting_participants');
}
//# sourceMappingURL=030_create_meeting_participants_table.js.map