// ============================================================
// Migration 019 — Schema Hardening
//
// Comprehensive database audit fix:
// 1. Add missing columns (total_topped_up on wallets, notes on transactions)
// 2. Add 25+ missing indexes for FK columns and hot query patterns
// 3. Add document_folders.parent_id self-referencing FK
// 4. Fix nullable booleans that should be NOT NULL
// 5. Add partial indexes for soft-delete tables
// ============================================================

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ═══════════════════════════════════════════════════════════
  // 1. ADD MISSING COLUMNS
  // ═══════════════════════════════════════════════════════════

  // 1a. total_topped_up on ai_wallet — tracks cumulative top-up minutes
  const hasAiTotalTopUp = await knex.schema.hasColumn('ai_wallet', 'total_topped_up');
  if (!hasAiTotalTopUp) {
    await knex.schema.alterTable('ai_wallet', (t) => {
      t.decimal('total_topped_up', 14, 2).notNullable().defaultTo(0);
    });
    // Backfill from existing top-up transactions
    await knex.raw(`
      UPDATE ai_wallet w
      SET total_topped_up = COALESCE((
        SELECT SUM(amount_minutes)
        FROM ai_wallet_transactions t
        WHERE t.wallet_id = w.id AND t.type = 'topup'
      ), 0)
    `);
  }

  // 1b. total_topped_up on translation_wallet
  const hasTransTotalTopUp = await knex.schema.hasColumn('translation_wallet', 'total_topped_up');
  if (!hasTransTotalTopUp) {
    await knex.schema.alterTable('translation_wallet', (t) => {
      t.decimal('total_topped_up', 14, 2).notNullable().defaultTo(0);
    });
    await knex.raw(`
      UPDATE translation_wallet w
      SET total_topped_up = COALESCE((
        SELECT SUM(amount_minutes)
        FROM translation_wallet_transactions t
        WHERE t.wallet_id = w.id AND t.type = 'topup'
      ), 0)
    `);
  }

  // 1c. notes column on transactions — records failure reasons from webhooks
  const hasTxNotes = await knex.schema.hasColumn('transactions', 'notes');
  if (!hasTxNotes) {
    await knex.schema.alterTable('transactions', (t) => {
      t.text('notes').nullable();
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 2. ADD MISSING INDEXES — Critical (zero-index tables)
  // ═══════════════════════════════════════════════════════════

  // subscriptions — queried ~25x, had ZERO indexes
  await safeCreateIndex(knex, 'subscriptions', 'idx_subscriptions_org_status', ['organization_id', 'status']);
  await safeCreateIndex(knex, 'subscriptions', 'idx_subscriptions_plan', ['plan_id']);

  // ai_wallet_transactions — queried ~12x, had ZERO indexes
  await safeCreateIndex(knex, 'ai_wallet_transactions', 'idx_ai_wallet_tx_org_created', ['organization_id', 'created_at']);
  await safeCreateIndex(knex, 'ai_wallet_transactions', 'idx_ai_wallet_tx_wallet', ['wallet_id']);

  // translation_wallet_transactions — queried ~10x, had ZERO indexes
  await safeCreateIndex(knex, 'translation_wallet_transactions', 'idx_trans_wallet_tx_org_created', ['organization_id', 'created_at']);
  await safeCreateIndex(knex, 'translation_wallet_transactions', 'idx_trans_wallet_tx_wallet', ['wallet_id']);

  // poll_options — N+1 target, had ZERO indexes
  await safeCreateIndex(knex, 'poll_options', 'idx_poll_options_poll', ['poll_id']);

  // subscription_history — had ZERO indexes
  await safeCreateIndex(knex, 'subscription_history', 'idx_sub_history_sub', ['subscription_id']);
  await safeCreateIndex(knex, 'subscription_history', 'idx_sub_history_org', ['organization_id']);

  // usage_records — had ZERO indexes
  await safeCreateIndex(knex, 'usage_records', 'idx_usage_records_org', ['organization_id']);
  await safeCreateIndex(knex, 'usage_records', 'idx_usage_records_meeting', ['meeting_id']);

  // document_folders — had ZERO non-PK indexes
  await safeCreateIndex(knex, 'document_folders', 'idx_doc_folders_org', ['organization_id']);
  await safeCreateIndex(knex, 'document_folders', 'idx_doc_folders_parent', ['parent_id']);

  // ═══════════════════════════════════════════════════════════
  // 3. ADD MISSING INDEXES — High-priority query patterns
  // ═══════════════════════════════════════════════════════════

  // Payment webhooks (Paystack/Flutterwave look up by gateway reference)
  await safeCreateIndex(knex, 'transactions', 'idx_transactions_gateway', ['payment_gateway_id']);
  await safeCreateIndex(knex, 'transactions', 'idx_transactions_ref', ['reference_id', 'reference_type']);

  // N+1 support indexes
  await safeCreateIndex(knex, 'poll_votes', 'idx_poll_votes_option', ['option_id']);
  await safeCreateIndex(knex, 'documents', 'idx_documents_folder', ['folder_id']);

  // Invite links — queried by organization_id
  await safeCreateIndex(knex, 'invite_links', 'idx_invite_links_org', ['organization_id']);

  // Attachments — missing index on meeting_id FK
  await safeCreateIndex(knex, 'attachments', 'idx_attachments_meeting', ['meeting_id']);

  // Messages sender — used in edit/delete authorization
  await safeCreateIndex(knex, 'messages', 'idx_messages_sender', ['sender_id']);

  // ═══════════════════════════════════════════════════════════
  // 4. PARTIAL INDEXES for soft-delete performance
  // ═══════════════════════════════════════════════════════════

  // Messages: every chat query filters is_deleted = false
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_messages_channel_alive
    ON messages (channel_id, created_at DESC)
    WHERE is_deleted = false
  `);

  // Memberships: every org request filters is_active = true
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_memberships_org_active
    ON memberships (organization_id, is_active)
    WHERE is_active = true
  `);

  // ═══════════════════════════════════════════════════════════
  // 5. FIX NULLABLE BOOLEANS — set NOT NULL where they have defaults
  //    and are used in WHERE clauses
  // ═══════════════════════════════════════════════════════════

  // subscription_plans.is_active — used in plan listing filter
  await safeSetBoolNotNull(knex, 'subscription_plans', 'is_active', true);

  // invite_links.is_active — used in invite redemption filter
  await safeSetBoolNotNull(knex, 'invite_links', 'is_active', true);

  // subscriptions.auto_renew — renewal logic
  await safeSetBoolNotNull(knex, 'subscriptions', 'auto_renew', true);

  // polls.multiple_choice, polls.anonymous, polls.status
  await safeSetBoolNotNull(knex, 'polls', 'multiple_choice', false);
  await safeSetBoolNotNull(knex, 'polls', 'anonymous', false);

  // events.all_day, events.rsvp_required
  await safeSetBoolNotNull(knex, 'events', 'all_day', false);
  await safeSetBoolNotNull(knex, 'events', 'rsvp_required', false);

  // announcements.pinned
  await safeSetBoolNotNull(knex, 'announcements', 'pinned', false);

  // event_rsvps.status — used in RSVP count queries
  await safeSetStringNotNull(knex, 'event_rsvps', 'status', 'attending');

  // polls.status — used in poll listing filter
  await safeSetStringNotNull(knex, 'polls', 'status', 'active');

  // announcements.priority
  await safeSetStringNotNull(knex, 'announcements', 'priority', 'normal');

  // expenses.status and expenses.category — used in filter queries
  await safeSetStringNotNull(knex, 'expenses', 'status', 'approved');
  await safeSetStringNotNull(knex, 'expenses', 'category', 'general');

  // ═══════════════════════════════════════════════════════════
  // 6. ADD MISSING FK — document_folders.parent_id self-reference
  // ═══════════════════════════════════════════════════════════

  // First clean up any orphaned parent_id references
  await knex.raw(`
    UPDATE document_folders
    SET parent_id = NULL
    WHERE parent_id IS NOT NULL
      AND parent_id NOT IN (SELECT id FROM document_folders)
  `);

  // Check if FK already exists
  const fkExists = await knex.raw(`
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'document_folders'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name = 'fk_doc_folders_parent'
    LIMIT 1
  `);
  if (!fkExists.rows?.length) {
    await knex.raw(`
      ALTER TABLE document_folders
      ADD CONSTRAINT fk_doc_folders_parent
      FOREIGN KEY (parent_id) REFERENCES document_folders(id)
      ON DELETE CASCADE
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  // Remove columns
  await knex.schema.alterTable('ai_wallet', (t) => {
    t.dropColumn('total_topped_up');
  });
  await knex.schema.alterTable('translation_wallet', (t) => {
    t.dropColumn('total_topped_up');
  });
  await knex.schema.alterTable('transactions', (t) => {
    t.dropColumn('notes');
  });

  // Remove indexes (safe — IF EXISTS)
  const indexNames = [
    'idx_subscriptions_org_status', 'idx_subscriptions_plan',
    'idx_ai_wallet_tx_org_created', 'idx_ai_wallet_tx_wallet',
    'idx_trans_wallet_tx_org_created', 'idx_trans_wallet_tx_wallet',
    'idx_poll_options_poll',
    'idx_sub_history_sub', 'idx_sub_history_org',
    'idx_usage_records_org', 'idx_usage_records_meeting',
    'idx_doc_folders_org', 'idx_doc_folders_parent',
    'idx_transactions_gateway', 'idx_transactions_ref',
    'idx_poll_votes_option', 'idx_documents_folder',
    'idx_invite_links_org', 'idx_attachments_meeting', 'idx_messages_sender',
    'idx_messages_channel_alive', 'idx_memberships_org_active',
  ];
  for (const idx of indexNames) {
    await knex.raw(`DROP INDEX IF EXISTS ${idx}`);
  }

  // Remove FK
  await knex.raw(`
    ALTER TABLE document_folders
    DROP CONSTRAINT IF EXISTS fk_doc_folders_parent
  `);

  // Note: NOT NULL constraints are not reverted to avoid data loss
}

// ── Helpers ───────────────────────────────────────────────

/** Safely create an index if it doesn't already exist */
async function safeCreateIndex(
  knex: Knex,
  table: string,
  indexName: string,
  columns: string[],
): Promise<void> {
  const colList = columns.join(', ');
  await knex.raw(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${table} (${colList})`);
}

/** Safely set a boolean column to NOT NULL with a default */
async function safeSetBoolNotNull(
  knex: Knex,
  table: string,
  column: string,
  defaultVal: boolean,
): Promise<void> {
  const has = await knex.schema.hasColumn(table, column);
  if (!has) return;
  const pgDefault = defaultVal ? 'true' : 'false';
  await knex.raw(`UPDATE ${table} SET ${column} = ${pgDefault} WHERE ${column} IS NULL`);
  await knex.raw(`ALTER TABLE ${table} ALTER COLUMN ${column} SET NOT NULL`);
  await knex.raw(`ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT ${pgDefault}`);
}

/** Safely set a string column to NOT NULL with a default */
async function safeSetStringNotNull(
  knex: Knex,
  table: string,
  column: string,
  defaultVal: string,
): Promise<void> {
  const has = await knex.schema.hasColumn(table, column);
  if (!has) return;
  const escaped = defaultVal.replace(/'/g, "''");
  await knex.raw(`UPDATE ${table} SET ${column} = '${escaped}' WHERE ${column} IS NULL`);
  await knex.raw(`ALTER TABLE ${table} ALTER COLUMN ${column} SET NOT NULL`);
  await knex.raw(`ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT '${escaped}'`);
}
