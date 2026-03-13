import { Knex } from 'knex';

/**
 * Migration: Evolve meetings table for real-time meeting infrastructure
 *
 * The meeting service uses:
 *   host_id, participants (jsonb), settings (jsonb),
 *   scheduled_at, started_at, ended_at
 *
 * The legacy schema has:
 *   created_by, scheduled_start, actual_start, actual_end
 *
 * This migration adds the new columns and copies data from old columns.
 * Old columns are kept for backward compatibility.
 */
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('meetings'))) return;

  // ── Add new columns if they don't exist ──
  const addIfMissing = async (col: string, fn: (t: Knex.AlterTableBuilder) => void) => {
    if (!(await knex.schema.hasColumn('meetings', col))) {
      await knex.schema.alterTable('meetings', fn);
    }
  };

  await addIfMissing('host_id', (t) => {
    t.uuid('host_id').nullable();
  });

  await addIfMissing('participants', (t) => {
    t.jsonb('participants').notNullable().defaultTo('[]');
  });

  await addIfMissing('settings', (t) => {
    t.jsonb('settings').notNullable().defaultTo('{}');
  });

  await addIfMissing('scheduled_at', (t) => {
    t.timestamp('scheduled_at').nullable();
  });

  await addIfMissing('started_at', (t) => {
    t.timestamp('started_at').nullable();
  });

  await addIfMissing('ended_at', (t) => {
    t.timestamp('ended_at').nullable();
  });

  // Make title nullable (service can send null)
  // PostgreSQL: ALTER COLUMN ... DROP NOT NULL is idempotent
  await knex.raw('ALTER TABLE meetings ALTER COLUMN title DROP NOT NULL');

  // ── Copy data from legacy columns to new columns ──
  await knex.raw(`
    UPDATE meetings SET
      host_id = COALESCE(host_id, created_by),
      scheduled_at = COALESCE(scheduled_at, scheduled_start),
      started_at = COALESCE(started_at, actual_start),
      ended_at = COALESCE(ended_at, actual_end)
    WHERE host_id IS NULL AND created_by IS NOT NULL
  `);

  // Add FK constraint on host_id if not already present
  // (reference to users table like created_by)
  try {
    await knex.raw(`
      DO $$ BEGIN
        ALTER TABLE meetings
          ADD CONSTRAINT fk_meetings_host_id
          FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
  } catch {
    // FK may already exist or host_id might have nulls — not critical
  }

  // Index for host_id + status queries
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_meetings_host_status
    ON meetings (host_id, status)
  `);

  // ── Create meeting_participants table ──
  if (!(await knex.schema.hasTable('meeting_participants'))) {
    await knex.schema.createTable('meeting_participants', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw("gen_random_uuid()"));
      t.uuid('meeting_id').notNullable().references('id').inTable('meetings').onDelete('CASCADE');
      t.uuid('user_id').notNullable();
      t.string('role', 20).notNullable().defaultTo('participant');
      t.string('display_name', 100).nullable();
      t.timestamp('joined_at').notNullable().defaultTo(knex.fn.now());
      t.timestamp('left_at').nullable();
      t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      t.index(['meeting_id']);
      t.index(['user_id']);
    });
  }

  // Auto-update updated_at trigger (if not already set up)
  await knex.raw(`
    CREATE OR REPLACE FUNCTION update_meetings_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trigger_meetings_updated_at ON meetings;
    CREATE TRIGGER trigger_meetings_updated_at
      BEFORE UPDATE ON meetings
      FOR EACH ROW
      EXECUTE FUNCTION update_meetings_updated_at();
  `);
}

export async function down(knex: Knex): Promise<void> {
  // Remove trigger
  await knex.raw('DROP TRIGGER IF EXISTS trigger_meetings_updated_at ON meetings');
  await knex.raw('DROP FUNCTION IF EXISTS update_meetings_updated_at');

  // Drop meeting_participants table
  await knex.schema.dropTableIfExists('meeting_participants');

  // Remove new columns (keep data in legacy columns)
  const dropIfExists = async (col: string) => {
    if (await knex.schema.hasColumn('meetings', col)) {
      await knex.schema.alterTable('meetings', (t) => t.dropColumn(col));
    }
  };

  await dropIfExists('host_id');
  await dropIfExists('participants');
  await dropIfExists('settings');
  await dropIfExists('scheduled_at');
  await dropIfExists('started_at');
  await dropIfExists('ended_at');
}
