import { Knex } from 'knex';
/**
 * Migration: Create member_records table for historical records
 *
 * This table stores historical records that admins can bulk import.
 * Records can be:
 * - Member-specific (tied to a user_id)
 * - Organization-wide (user_id is null)
 *
 * All org members can view all records - no restrictions.
 * Admin controls visibility by what they choose to upload.
 */
export declare function up(knex: Knex): Promise<void>;
export declare function down(knex: Knex): Promise<void>;
//# sourceMappingURL=038_create_member_records_table.d.ts.map