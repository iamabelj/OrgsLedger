"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // Add session tracking columns to users table
    const hasLastActivityAt = await knex.schema.hasColumn('users', 'last_activity_at');
    const hasLastSigninAt = await knex.schema.hasColumn('users', 'last_signin_at');
    if (!hasLastActivityAt || !hasLastSigninAt) {
        await knex.schema.alterTable('users', (table) => {
            if (!hasLastActivityAt) {
                table
                    .timestamp('last_activity_at')
                    .nullable()
                    .defaultTo(knex.fn.now())
                    .comment('Timestamp of last API request (for inactivity timeout)');
            }
            if (!hasLastSigninAt) {
                table
                    .timestamp('last_signin_at')
                    .nullable()
                    .defaultTo(knex.fn.now())
                    .comment('Timestamp of last login (for 30-day no-signin check on mobile)');
            }
        });
    }
}
async function down(knex) {
    // Remove session tracking columns
    const hasLastActivityAt = await knex.schema.hasColumn('users', 'last_activity_at');
    const hasLastSigninAt = await knex.schema.hasColumn('users', 'last_signin_at');
    if (hasLastActivityAt || hasLastSigninAt) {
        await knex.schema.alterTable('users', (table) => {
            if (hasLastActivityAt) {
                table.dropColumn('last_activity_at');
            }
            if (hasLastSigninAt) {
                table.dropColumn('last_signin_at');
            }
        });
    }
}
//# sourceMappingURL=028_add_session_tracking.js.map