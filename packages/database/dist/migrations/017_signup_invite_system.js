"use strict";
// ============================================================
// Migration 017 — Signup Invite System
// Adds invite_code tracking to users table and creates a
// signup_invites table for super admin to generate signup links.
// Registration is restricted to users with a valid signup invite.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // ── signup_invites table ────────────────────────────────
    const hasSignupInvites = await knex.schema.hasTable('signup_invites');
    if (!hasSignupInvites) {
        await knex.schema.createTable('signup_invites', (t) => {
            t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
            t.string('code', 32).notNullable().unique();
            t.string('email').nullable(); // if targeted to specific email
            t.string('role').notNullable().defaultTo('member'); // default role on signup
            t.uuid('organization_id').nullable().references('id').inTable('organizations').onDelete('SET NULL');
            t.integer('max_uses').nullable(); // null = unlimited
            t.integer('use_count').notNullable().defaultTo(0);
            t.timestamp('expires_at').nullable();
            t.boolean('is_active').notNullable().defaultTo(true);
            t.uuid('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
            t.text('note').nullable(); // admin note for this invite
            t.timestamps(true, true);
            t.index(['code']);
            t.index(['email']);
            t.index(['is_active']);
        });
    }
    // ── Add invite_code to users table ──────────────────────
    const hasInviteCode = await knex.schema.hasColumn('users', 'signup_invite_code');
    if (!hasInviteCode) {
        await knex.schema.alterTable('users', (t) => {
            t.string('signup_invite_code', 32).nullable(); // tracks which invite code was used
        });
    }
}
async function down(knex) {
    if (await knex.schema.hasColumn('users', 'signup_invite_code')) {
        await knex.schema.alterTable('users', (t) => {
            t.dropColumn('signup_invite_code');
        });
    }
    await knex.schema.dropTableIfExists('signup_invites');
}
//# sourceMappingURL=017_signup_invite_system.js.map