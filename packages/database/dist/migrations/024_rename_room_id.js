"use strict";
// ============================================================
// Migration 024 — Rename jitsi_room_id → room_id
// Cleans up the legacy column name from the Jitsi era.
// The column now stores LiveKit room names.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    const hasColumn = await knex.schema.hasColumn('meetings', 'jitsi_room_id');
    if (hasColumn) {
        await knex.schema.alterTable('meetings', (t) => {
            t.renameColumn('jitsi_room_id', 'room_id');
        });
    }
}
async function down(knex) {
    const hasColumn = await knex.schema.hasColumn('meetings', 'room_id');
    if (hasColumn) {
        await knex.schema.alterTable('meetings', (t) => {
            t.renameColumn('room_id', 'jitsi_room_id');
        });
    }
}
//# sourceMappingURL=024_rename_room_id.js.map