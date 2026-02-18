"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.createTable('user_language_preferences', (t) => {
        t.uuid('id').primary().defaultTo(knex.fn.uuid());
        t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
        t.string('preferred_language', 10).notNullable().defaultTo('en');
        t.boolean('receive_voice').notNullable().defaultTo(true);
        t.boolean('receive_text').notNullable().defaultTo(true);
        t.timestamps(true, true);
        // One preference per user per org
        t.unique(['user_id', 'organization_id']);
        t.index(['organization_id']);
    });
}
async function down(knex) {
    await knex.schema.dropTableIfExists('user_language_preferences');
}
//# sourceMappingURL=022_user_language_preferences.js.map