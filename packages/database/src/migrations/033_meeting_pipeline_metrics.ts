import { Knex } from 'knex';

/**
 * Migration: meeting_pipeline_metrics
 * 
 * Creates table for tracking per-meeting pipeline metrics:
 * - Transcript count
 * - Translation count
 * - Broadcast events
 * - Minutes generation timing
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('meeting_pipeline_metrics', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('meeting_id').notNullable();
    table.integer('transcripts_generated').defaultTo(0);
    table.integer('translations_generated').defaultTo(0);
    table.integer('broadcast_events').defaultTo(0);
    table.integer('minutes_generation_ms').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    // Index for fast meeting lookups
    table.index('meeting_id', 'idx_meeting_pipeline_metrics_meeting_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('meeting_pipeline_metrics');
}
