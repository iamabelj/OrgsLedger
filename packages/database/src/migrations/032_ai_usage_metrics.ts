import { Knex } from 'knex';

/**
 * Migration: AI Usage Metrics
 * 
 * Creates table for persisting AI service usage and cost metrics.
 * Used by the AI Cost Monitor for:
 * - Historical cost analysis
 * - Daily/monthly billing summaries
 * - Usage trend tracking
 */
export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('ai_usage_metrics');
  if (!hasTable) {
    await knex.schema.createTable('ai_usage_metrics', (table) => {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      
      // Timestamp of the metrics snapshot
      table.timestamp('timestamp').notNullable().defaultTo(knex.fn.now());
      
      // Deepgram transcription metrics
      table.float('deepgram_minutes').notNullable().defaultTo(0);
      
      // OpenAI usage metrics
      table.bigInteger('openai_input_tokens').notNullable().defaultTo(0);
      table.bigInteger('openai_output_tokens').notNullable().defaultTo(0);
      
      // Translation metrics
      table.bigInteger('translation_characters').notNullable().defaultTo(0);
      table.integer('translation_requests').notNullable().defaultTo(0);
      
      // Estimated cost
      table.decimal('estimated_cost_usd', 10, 4).notNullable().defaultTo(0);
      
      // Optional: breakdown costs for detailed analysis
      table.decimal('deepgram_cost_usd', 10, 4).nullable();
      table.decimal('openai_input_cost_usd', 10, 4).nullable();
      table.decimal('openai_output_cost_usd', 10, 4).nullable();
      table.decimal('translation_cost_usd', 10, 4).nullable();
      
      // Interval type (for aggregation)
      table.string('interval_type').notNullable().defaultTo('snapshot'); // 'snapshot' | 'daily' | 'monthly'
      
      // Created at for record keeping
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      
      // Index on timestamp for time-range queries
      table.index('timestamp', 'idx_ai_usage_metrics_timestamp');
      
      // Index on estimated_cost_usd for cost analysis
      table.index('estimated_cost_usd', 'idx_ai_usage_metrics_cost');
      
      // Composite index for interval-based queries
      table.index(['interval_type', 'timestamp'], 'idx_ai_usage_metrics_interval_time');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('ai_usage_metrics');
}
