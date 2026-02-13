"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    const hasTable = await knex.schema.hasTable('expenses');
    if (!hasTable) {
        await knex.schema.createTable('expenses', (table) => {
            table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
            table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
            table.string('title').notNullable();
            table.text('description');
            table.decimal('amount', 12, 2).notNullable();
            table.string('category').defaultTo('general');
            table.string('status').defaultTo('approved'); // pending, approved, rejected
            table.timestamp('date').defaultTo(knex.fn.now());
            table.string('receipt_url');
            table.uuid('created_by').references('id').inTable('users').onDelete('SET NULL');
            table.timestamps(true, true);
            table.index(['organization_id']);
            table.index(['category']);
            table.index(['status']);
            table.index(['date']);
        });
    }
}
async function down(knex) {
    await knex.schema.dropTableIfExists('expenses');
}
//# sourceMappingURL=004_expenses.js.map