import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Create meeting_signatures table for digital signature tracking
  const hasTable = await knex.schema.hasTable('meeting_signatures');
  if (!hasTable) {
    await knex.schema.createTable('meeting_signatures', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('meeting_id').notNullable().index();
      table.uuid('organization_id').notNullable().index();
      table.uuid('signed_by_user_id').notNullable();
      table.string('signed_by_name').notNullable();
      table.string('signed_by_email');
      table.text('signature_hash').notNullable(); // cryptographic hash of signature
      table.text('signature_data').nullable(); // base64 encoded signature data (optional for display)
      table.jsonb('metadata').nullable(); // additional metadata (IP, user agent, etc)
      table.timestamp('signed_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

      // Foreign key constraints
      table.foreign('meeting_id').references('meetings.id').onDelete('CASCADE');
      table.foreign('organization_id').references('organizations.id').onDelete('CASCADE');
      table.foreign('signed_by_user_id').references('users.id').onDelete('SET NULL');

      // Composite unique index: one signature per user per meeting
      table.unique(['meeting_id', 'signed_by_user_id']);
    });
  }

  // Add signature_count column to meeting_minutes for quick count
  const hasSignatureCount = await knex.schema.hasColumn('meeting_minutes', 'signature_count');
  if (!hasSignatureCount) {
    await knex.schema.alterTable('meeting_minutes', (table) => {
      table.integer('signature_count').notNullable().defaultTo(0);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // Remove signature_count from meeting_minutes
  const hasSignatureCount = await knex.schema.hasColumn('meeting_minutes', 'signature_count');
  if (hasSignatureCount) {
    await knex.schema.alterTable('meeting_minutes', (table) => {
      table.dropColumn('signature_count');
    });
  }

  // Drop meeting_signatures table
  await knex.schema.dropTableIfExists('meeting_signatures');
}
