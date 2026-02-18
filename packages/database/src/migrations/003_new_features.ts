// ============================================================
// Migration 003 — New Features: Video Conferencing, Password Reset, Email
// Verification, Announcements, Events, Polls, Documents,
// Notification Prefs, Recurring Meetings, Analytics
// ============================================================

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Helper: check if column exists before adding
  async function addColumnIfNotExists(table: string, column: string, cb: (t: Knex.AlterTableBuilder) => void) {
    const exists = await knex.schema.hasColumn(table, column);
    if (!exists) {
      await knex.schema.alterTable(table, cb);
    }
  }

  // ── Add new columns to users table ────────────────────────
  await addColumnIfNotExists('users', 'reset_code', (t) => t.string('reset_code', 10).nullable());
  await addColumnIfNotExists('users', 'reset_code_expires_at', (t) => t.timestamp('reset_code_expires_at').nullable());
  await addColumnIfNotExists('users', 'email_verified', (t) => t.boolean('email_verified').defaultTo(false));
  await addColumnIfNotExists('users', 'verification_code', (t) => t.string('verification_code', 10).nullable());
  await addColumnIfNotExists('users', 'verification_code_expires_at', (t) => t.timestamp('verification_code_expires_at').nullable());
  await addColumnIfNotExists('users', 'notification_preferences', (t) => t.jsonb('notification_preferences').nullable());

  // ── Add new columns to meetings table ─────────────────────
  await addColumnIfNotExists('meetings', 'jitsi_room_id', (t) => t.string('jitsi_room_id', 100).nullable());
  await addColumnIfNotExists('meetings', 'recurring_pattern', (t) => t.string('recurring_pattern', 20).defaultTo('none'));
  await addColumnIfNotExists('meetings', 'recurring_end_date', (t) => t.timestamp('recurring_end_date').nullable());
  await addColumnIfNotExists('meetings', 'parent_meeting_id', (t) => t.uuid('parent_meeting_id').nullable().references('id').inTable('meetings').onDelete('SET NULL'));

  // ── Announcements ─────────────────────────────────────────
  if (!(await knex.schema.hasTable('announcements'))) {
    await knex.schema.createTable('announcements', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.string('title', 300).notNullable();
    t.text('body').notNullable();
    t.string('priority', 20).defaultTo('normal'); // low, normal, high, urgent
    t.boolean('pinned').defaultTo(false);
    t.uuid('created_by').notNullable().references('id').inTable('users');
    t.timestamps(true, true);

    t.index(['organization_id', 'created_at']);
  });
  }

  // ── Events ────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('events'))) {
  await knex.schema.createTable('events', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.string('title', 300).notNullable();
    t.text('description').nullable();
    t.string('location', 500).nullable();
    t.timestamp('start_date').notNullable();
    t.timestamp('end_date').nullable();
    t.boolean('all_day').defaultTo(false);
    t.string('category', 50).defaultTo('general');
    t.integer('max_attendees').nullable();
    t.boolean('rsvp_required').defaultTo(false);
    t.uuid('created_by').notNullable().references('id').inTable('users');
    t.timestamps(true, true);

    t.index(['organization_id', 'start_date']);
  });
  }

  // ── Event RSVPs ───────────────────────────────────────────
  if (!(await knex.schema.hasTable('event_rsvps'))) {
  await knex.schema.createTable('event_rsvps', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('event_id').notNullable().references('id').inTable('events').onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users');
    t.string('status', 20).defaultTo('attending'); // attending, declined, maybe
    t.timestamps(true, true);

    t.unique(['event_id', 'user_id']);
  });
  }

  // ── Polls ─────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('polls'))) {
  await knex.schema.createTable('polls', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.string('title', 300).notNullable();
    t.text('description').nullable();
    t.boolean('multiple_choice').defaultTo(false);
    t.boolean('anonymous').defaultTo(false);
    t.string('status', 20).defaultTo('active'); // active, closed
    t.timestamp('expires_at').nullable();
    t.uuid('created_by').notNullable().references('id').inTable('users');
    t.timestamps(true, true);

    t.index(['organization_id', 'status']);
  });
  }

  // ── Poll Options ──────────────────────────────────────────
  if (!(await knex.schema.hasTable('poll_options'))) {
  await knex.schema.createTable('poll_options', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('poll_id').notNullable().references('id').inTable('polls').onDelete('CASCADE');
    t.string('label', 300).notNullable();
    t.integer('order').defaultTo(0);
    t.timestamps(true, true);
  });
  }

  // ── Poll Votes ────────────────────────────────────────────
  if (!(await knex.schema.hasTable('poll_votes'))) {
  await knex.schema.createTable('poll_votes', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('poll_id').notNullable().references('id').inTable('polls').onDelete('CASCADE');
    t.uuid('option_id').notNullable().references('id').inTable('poll_options').onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users');
    t.timestamps(true, true);

    t.index(['poll_id', 'user_id']);
  });
  }

  // ── Documents ─────────────────────────────────────────────
  if (!(await knex.schema.hasTable('documents'))) {
  await knex.schema.createTable('documents', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.string('title', 300).notNullable();
    t.text('description').nullable();
    t.string('category', 50).defaultTo('general');
    t.uuid('folder_id').nullable();
    t.string('file_name', 500).notNullable();
    t.string('file_path', 1000).notNullable();
    t.bigInteger('file_size').defaultTo(0);
    t.string('mime_type', 200).nullable();
    t.uuid('uploaded_by').notNullable().references('id').inTable('users');
    t.timestamps(true, true);

    t.index(['organization_id', 'category']);
  });
  }

  // ── Document Folders ──────────────────────────────────────
  if (!(await knex.schema.hasTable('document_folders'))) {
  await knex.schema.createTable('document_folders', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.string('name', 200).notNullable();
    t.uuid('parent_id').nullable();
    t.uuid('created_by').notNullable().references('id').inTable('users');
    t.timestamps(true, true);
  });
  }

  // Add folder_id foreign key after document_folders table exists
  if (await knex.schema.hasTable('documents') && await knex.schema.hasTable('document_folders')) {
    // Check if foreign key already exists by trying; ignore error
    try {
      await knex.schema.alterTable('documents', (t) => {
        t.foreign('folder_id').references('id').inTable('document_folders').onDelete('SET NULL');
      });
    } catch {}
  }
}

export async function down(knex: Knex): Promise<void> {
  // Drop tables in reverse order
  await knex.schema.alterTable('documents', (t) => {
    t.dropForeign(['folder_id']);
  });
  await knex.schema.dropTableIfExists('document_folders');
  await knex.schema.dropTableIfExists('documents');
  await knex.schema.dropTableIfExists('poll_votes');
  await knex.schema.dropTableIfExists('poll_options');
  await knex.schema.dropTableIfExists('polls');
  await knex.schema.dropTableIfExists('event_rsvps');
  await knex.schema.dropTableIfExists('events');
  await knex.schema.dropTableIfExists('announcements');

  // Remove columns from meetings
  await knex.schema.alterTable('meetings', (t) => {
    t.dropColumn('jitsi_room_id');
    t.dropColumn('recurring_pattern');
    t.dropColumn('recurring_end_date');
    t.dropColumn('parent_meeting_id');
  });

  // Remove columns from users
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('reset_code');
    t.dropColumn('reset_code_expires_at');
    t.dropColumn('email_verified');
    t.dropColumn('verification_code');
    t.dropColumn('verification_code_expires_at');
    t.dropColumn('notification_preferences');
  });
}
