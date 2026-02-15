"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    const exists = await knex.schema.hasColumn('meetings', 'translation_enabled');
    if (!exists) {
        await knex.schema.alterTable('meetings', (t) => {
            t.boolean('translation_enabled').notNullable().defaultTo(false);
        });
    }
}
async function down(knex) {
    const exists = await knex.schema.hasColumn('meetings', 'translation_enabled');
    if (exists) {
        await knex.schema.alterTable('meetings', (t) => {
            t.dropColumn('translation_enabled');
        });
    }
}
//# sourceMappingURL=005_meeting_translation.js.map