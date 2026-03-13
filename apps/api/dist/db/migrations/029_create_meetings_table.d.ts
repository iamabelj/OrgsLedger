import { Knex } from 'knex';
/**
 * Migration: Create meetings table for AI meeting infrastructure
 *
 * Supports the following meeting statuses:
 * - scheduled: Meeting is scheduled but not yet started
 * - active: Meeting is currently in progress
 * - ended: Meeting has concluded normally
 * - cancelled: Meeting was cancelled before it started
 */
export declare function up(knex: Knex): Promise<void>;
export declare function down(knex: Knex): Promise<void>;
//# sourceMappingURL=029_create_meetings_table.d.ts.map