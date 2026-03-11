import { Knex } from 'knex';

/**
 * Migration: meeting_pipeline_latency
 *
 * Creates table for per-event pipeline stage latency tracking.
 * Used by the meeting-metrics module for:
 *   - Historical p50/p95/p99 latency analysis
 *   - Per-meeting stage-level latency breakdown
 *   - Grafana dashboard panels
 */
export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('meeting_pipeline_latency');
  if (!hasTable) {
    await knex.schema.createTable('meeting_pipeline_latency', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('meeting_id').notNullable();
      table.string('stage', 32).notNullable(); // 'transcription' | 'translation' | 'broadcast'
      table.float('latency_ms').notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

      // Fast lookups by meeting
      table.index('meeting_id', 'idx_mpl_meeting_id');
      // Time-range queries per stage
      table.index(['stage', 'created_at'], 'idx_mpl_stage_created');
      // Retention cleanup
      table.index('created_at', 'idx_mpl_created_at');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('meeting_pipeline_latency');
}
