"use strict";
// ============================================================
// Migration 026 — Account Lockout
// Adds failed_login_attempts and locked_until to users table
// for brute-force protection.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    const hasAttempts = await knex.schema.hasColumn('users', 'failed_login_attempts');
    const hasLocked = await knex.schema.hasColumn('users', 'locked_until');
    await knex.schema.alterTable('users', (table) => {
        if (!hasAttempts) {
            table.integer('failed_login_attempts').notNullable().defaultTo(0);
        }
        if (!hasLocked) {
            table.timestamp('locked_until').nullable();
        }
    });
}
async function down(knex) {
    const hasAttempts = await knex.schema.hasColumn('users', 'failed_login_attempts');
    const hasLocked = await knex.schema.hasColumn('users', 'locked_until');
    await knex.schema.alterTable('users', (table) => {
        if (hasAttempts)
            table.dropColumn('failed_login_attempts');
        if (hasLocked)
            table.dropColumn('locked_until');
    });
}
//# sourceMappingURL=026_account_lockout.js.map