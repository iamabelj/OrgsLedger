"use strict";
// ============================================================
// Migration 008 — Security Hardening
// - Add password_changed_at to users for token invalidation
// - Add separate refresh token secret support
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // Add password_changed_at column to users table
    const hasColumn = await knex.schema.hasColumn('users', 'password_changed_at');
    if (!hasColumn) {
        await knex.schema.alterTable('users', (table) => {
            table.timestamp('password_changed_at').nullable();
        });
    }
}
async function down(knex) {
    const hasColumn = await knex.schema.hasColumn('users', 'password_changed_at');
    if (hasColumn) {
        await knex.schema.alterTable('users', (table) => {
            table.dropColumn('password_changed_at');
        });
    }
}
//# sourceMappingURL=008_security_hardening.js.map