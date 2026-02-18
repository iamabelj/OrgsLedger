"use strict";
// ============================================================
// Migration 018 — Invite Link Description
// Adds an optional description column to invite_links so org
// admins can include a welcome message / context on the invite.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    const hasCol = await knex.schema.hasColumn('invite_links', 'description');
    if (!hasCol) {
        await knex.schema.alterTable('invite_links', (t) => {
            t.text('description').nullable(); // optional welcome / context message
        });
    }
}
async function down(knex) {
    if (await knex.schema.hasColumn('invite_links', 'description')) {
        await knex.schema.alterTable('invite_links', (t) => {
            t.dropColumn('description');
        });
    }
}
//# sourceMappingURL=018_invite_link_description.js.map