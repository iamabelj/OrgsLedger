import { Knex } from 'knex';
/**
 * Migration 023 — Performance Indexes
 *
 * Adds high-value missing indexes identified during the LiveKit migration
 * performance audit. All are CREATE INDEX IF NOT EXISTS to be idempotent.
 */
export declare function up(knex: Knex): Promise<void>;
export declare function down(knex: Knex): Promise<void>;
//# sourceMappingURL=023_performance_indexes.d.ts.map