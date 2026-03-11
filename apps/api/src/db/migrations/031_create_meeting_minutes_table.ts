// ============================================================
// OrgsLedger API — Migration: Create Meeting Minutes Table
// Stores AI-generated meeting minutes and summaries
// ============================================================

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('meeting_minutes', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('meeting_id').notNullable().references('id').inTable('meetings').onDelete('CASCADE');
    table.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    
    // Summary and content
    table.text('summary').notNullable();
    table.jsonb('agenda').notNullable().defaultTo('[]');
    table.jsonb('key_points').notNullable().defaultTo('[]');
    table.jsonb('decisions').notNullable().defaultTo('[]');
    table.jsonb('action_items').notNullable().defaultTo('[]');
    table.jsonb('participants').notNullable().defaultTo('[]');
    
    // Metadata
    table.integer('word_count').notNullable().defaultTo(0);
    table.timestamp('generated_at').notNullable();
    table.timestamps(true, true);

    // Indexes
    table.index('meeting_id');
    table.index('organization_id');
    table.index('generated_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('meeting_minutes');
}
