"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // Promote all super_admin users to developer role
    // Developer = GOD OF THEM ALL (platform owner, SaaS developer)
    // super_admin = God of organizations (can manage all orgs)
    await knex('users')
        .where({ global_role: 'super_admin' })
        .update({ global_role: 'developer' });
}
async function down(knex) {
    await knex('users')
        .where({ global_role: 'developer' })
        .update({ global_role: 'super_admin' });
}
//# sourceMappingURL=010_developer_role.js.map