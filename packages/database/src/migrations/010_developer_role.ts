import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Promote all super_admin users to developer role
  // Developer = GOD OF THEM ALL (platform owner, SaaS developer)
  // super_admin = God of organizations (can manage all orgs)
  await knex('users')
    .where({ global_role: 'super_admin' })
    .update({ global_role: 'developer' });
}

export async function down(knex: Knex): Promise<void> {
  await knex('users')
    .where({ global_role: 'developer' })
    .update({ global_role: 'super_admin' });
}
