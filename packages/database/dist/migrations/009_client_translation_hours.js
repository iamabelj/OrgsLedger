"use strict";
// ============================================================
// Migration 009 — Add translation hours to AI clients
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    const hasTable = await knex.schema.hasTable('ai_clients');
    if (hasTable) {
        const hasCol = await knex.schema.hasColumn('ai_clients', 'translation_hours_balance');
        if (!hasCol) {
            await knex.schema.alterTable('ai_clients', (table) => {
                table.decimal('translation_hours_balance', 12, 4).notNullable().defaultTo(0);
                table.decimal('translation_hours_used', 12, 4).notNullable().defaultTo(0);
            });
        }
    }
}
async function down(knex) {
    const hasTable = await knex.schema.hasTable('ai_clients');
    if (hasTable) {
        const hasCol = await knex.schema.hasColumn('ai_clients', 'translation_hours_balance');
        if (hasCol) {
            await knex.schema.alterTable('ai_clients', (table) => {
                table.dropColumn('translation_hours_balance');
                table.dropColumn('translation_hours_used');
            });
        }
    }
}
//# sourceMappingURL=009_client_translation_hours.js.map