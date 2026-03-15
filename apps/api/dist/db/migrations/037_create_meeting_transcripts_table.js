"use strict";
// ============================================================
// OrgsLedger API — Migration: Create Meeting Transcripts Table
// Stores transcript entries persisted after meeting ends
// During meeting, transcripts are held in Redis for performance
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    const hasTable = await knex.schema.hasTable('meeting_transcripts');
    if (hasTable)
        return;
    await knex.schema.createTable('meeting_transcripts', (table) => {
        // Primary key
        table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
        // Foreign key to meetings
        table
            .uuid('meeting_id')
            .notNullable()
            .references('id')
            .inTable('meetings')
            .onDelete('CASCADE')
            .index('idx_meeting_transcripts_meeting_id');
        // Organization ID (for efficient queries)
        table
            .uuid('organization_id')
            .notNullable()
            .references('id')
            .inTable('organizations')
            .onDelete('CASCADE')
            .index('idx_meeting_transcripts_org_id');
        // Speaker information
        table.uuid('speaker_id').nullable(); // NULL if speaker couldn't be identified
        table.string('speaker_name', 255).notNullable();
        // Transcript content
        table.text('text').notNullable();
        // Timing
        table.timestamp('spoken_at').notNullable();
        table.integer('duration_ms').nullable(); // Duration of this segment
        // Quality indicators
        table.float('confidence').nullable(); // 0.0 - 1.0
        table.string('language', 10).nullable(); // ISO language code
        table.boolean('is_final').notNullable().defaultTo(true);
        // Sequence number for ordering
        table.integer('sequence').notNullable();
        // Timestamps
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        // Composite index for efficient retrieval
        table.index(['meeting_id', 'sequence'], 'idx_meeting_transcripts_order');
        table.index(['meeting_id', 'spoken_at'], 'idx_meeting_transcripts_time');
    });
}
async function down(knex) {
    await knex.schema.dropTableIfExists('meeting_transcripts');
}
//# sourceMappingURL=037_create_meeting_transcripts_table.js.map