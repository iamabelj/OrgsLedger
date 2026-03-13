import { Knex } from 'knex';
/**
 * Migration: Create meeting_participants relational table
 *
 * Replaces JSON storage in meetings.participants with a proper relational table.
 * This enables efficient querying and reduces write amplification.
 */
export declare function up(knex: Knex): Promise<void>;
export declare function down(knex: Knex): Promise<void>;
//# sourceMappingURL=030_create_meeting_participants_table.d.ts.map