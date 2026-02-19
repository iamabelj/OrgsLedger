"use strict";
// ============================================================
// Migration 025 — Meeting Chat Messages
// In-meeting chat (persisted, real-time via Socket.IO)
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    const exists = await knex.schema.hasTable('meeting_messages');
    if (!exists) {
        await knex.schema.createTable('meeting_messages', (t) => {
            t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
            t.uuid('meeting_id').notNullable().references('id').inTable('meetings').onDelete('CASCADE');
            t.uuid('sender_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
            t.string('sender_name', 255).notNullable();
            t.text('message').notNullable();
            t.timestamp('created_at').defaultTo(knex.fn.now());
        });
        // Index for fast meeting-scoped queries ordered by time
        await knex.schema.raw('CREATE INDEX idx_meeting_messages_meeting_created ON meeting_messages (meeting_id, created_at)');
    }
}
async function down(knex) {
    await knex.schema.dropTableIfExists('meeting_messages');
}
//# sourceMappingURL=025_meeting_messages.js.map