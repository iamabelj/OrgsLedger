"use strict";
// ============================================================
// OrgsLedger — Migration: Add location column to meetings
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.alterTable('meetings', (t) => {
        t.string('location').nullable();
    });
}
async function down(knex) {
    await knex.schema.alterTable('meetings', (t) => {
        t.dropColumn('location');
    });
}
//# sourceMappingURL=002_add_meeting_location.js.map