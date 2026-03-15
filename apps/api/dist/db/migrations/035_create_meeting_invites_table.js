"use strict";
// ============================================================
// OrgsLedger API — Migration: Create Meeting Invites Table
// Tracks meeting access - who is invited to which meetings
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    const hasTable = await knex.schema.hasTable('meeting_invites');
    if (hasTable)
        return;
    await knex.schema.createTable('meeting_invites', (table) => {
        // Primary key
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        // Foreign key to meetings
        table
            .uuid('meeting_id')
            .notNullable()
            .references('id')
            .inTable('meetings')
            .onDelete('CASCADE')
            .index('idx_meeting_invites_meeting_id');
        // Foreign key to users (invitee)
        table
            .uuid('user_id')
            .notNullable()
            .references('id')
            .inTable('users')
            .onDelete('CASCADE')
            .index('idx_meeting_invites_user_id');
        // Role in the meeting (host, co-host, participant, viewer)
        table.string('role', 50).notNullable().defaultTo('participant');
        // Who sent the invite
        table
            .uuid('invited_by')
            .nullable()
            .references('id')
            .inTable('users')
            .onDelete('SET NULL');
        // Invite status
        table.string('status', 50).notNullable().defaultTo('pending'); // pending, accepted, declined
        // When invited
        table.timestamp('invited_at').notNullable().defaultTo(knex.fn.now());
        // When responded
        table.timestamp('responded_at').nullable();
        // Timestamps
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
        // Composite unique: user can only be invited to a meeting once
        table.unique(['meeting_id', 'user_id'], {
            indexName: 'idx_meeting_invites_unique',
        });
        // Index for finding user's meetings
        table.index(['user_id', 'status'], 'idx_meeting_invites_user_status');
    });
    // Create trigger for updated_at
    await knex.raw(`
    CREATE OR REPLACE FUNCTION update_meeting_invites_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trigger_meeting_invites_updated_at
      BEFORE UPDATE ON meeting_invites
      FOR EACH ROW
      EXECUTE FUNCTION update_meeting_invites_updated_at();
  `);
}
async function down(knex) {
    await knex.raw('DROP TRIGGER IF EXISTS trigger_meeting_invites_updated_at ON meeting_invites');
    await knex.raw('DROP FUNCTION IF EXISTS update_meeting_invites_updated_at');
    await knex.schema.dropTableIfExists('meeting_invites');
}
//# sourceMappingURL=035_create_meeting_invites_table.js.map