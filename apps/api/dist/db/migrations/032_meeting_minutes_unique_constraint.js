"use strict";
// ============================================================
// OrgsLedger API — Migration: Add Unique Constraint to Meeting Minutes
// Ensures only one minutes document per meeting (idempotency)
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // Add unique constraint on meeting_id for idempotency
    // This ensures that if a minutes generation job runs twice,
    // the second insert will fail gracefully
    await knex.schema.alterTable('meeting_minutes', (table) => {
        table.unique(['meeting_id'], { indexName: 'meeting_minutes_meeting_id_unique' });
    });
}
async function down(knex) {
    await knex.schema.alterTable('meeting_minutes', (table) => {
        table.dropUnique(['meeting_id'], 'meeting_minutes_meeting_id_unique');
    });
}
//# sourceMappingURL=032_meeting_minutes_unique_constraint.js.map