"use strict";
// ============================================================
// OrgsLedger API — Migration: Create Organization Role Members Table
// Maps users to specific organization roles (executives, committees)
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    const hasTable = await knex.schema.hasTable('organization_role_members');
    if (hasTable)
        return;
    await knex.schema.createTable('organization_role_members', (table) => {
        // Primary key
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        // Foreign key to organization_roles
        table
            .uuid('role_id')
            .notNullable()
            .references('id')
            .inTable('organization_roles')
            .onDelete('CASCADE')
            .index('idx_role_members_role_id');
        // Foreign key to users
        table
            .uuid('user_id')
            .notNullable()
            .references('id')
            .inTable('users')
            .onDelete('CASCADE')
            .index('idx_role_members_user_id');
        // When user was added to the role
        table.timestamp('added_at').notNullable().defaultTo(knex.fn.now());
        // Who added them
        table
            .uuid('added_by')
            .nullable()
            .references('id')
            .inTable('users')
            .onDelete('SET NULL');
        // Active status
        table.boolean('is_active').notNullable().defaultTo(true);
        // Timestamps
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        // Composite unique: user can only be in a role once
        table.unique(['role_id', 'user_id'], {
            indexName: 'idx_role_members_unique',
        });
        // Composite index for lookups
        table.index(['user_id', 'is_active'], 'idx_role_members_user_active');
    });
}
async function down(knex) {
    await knex.schema.dropTableIfExists('organization_role_members');
}
//# sourceMappingURL=034_create_organization_role_members_table.js.map