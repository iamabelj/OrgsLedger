import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
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

export async function down(knex: Knex): Promise<void> {
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
