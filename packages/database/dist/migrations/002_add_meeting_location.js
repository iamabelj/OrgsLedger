"use strict";
// ============================================================
// OrgsLedger — Migration: Add location column to meetings
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    const exists = await knex.schema.hasColumn('meetings', 'location');
    if (!exists) {
        await knex.schema.alterTable('meetings', (t) => {
            t.string('location').nullable();
        });
    }
}
async function down(knex) {
    const exists = await knex.schema.hasColumn('meetings', 'location');
    if (exists) {
        await knex.schema.alterTable('meetings', (t) => {
            t.dropColumn('location');
        });
    }
}
//# sourceMappingURL=002_add_meeting_location.js.map