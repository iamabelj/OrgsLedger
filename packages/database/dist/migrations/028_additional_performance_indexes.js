"use strict";
// ============================================================
// Migration 028 — Additional Performance Indexes
// Covers common query patterns identified in performance audit.
// All idempotent — uses IF NOT EXISTS via raw SQL.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // ── Notifications: user_id + read status for unread count / list ──
    if (await knex.schema.hasTable('notifications')) {
        await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_read
      ON notifications (user_id, is_read)
      WHERE is_read = false
    `);
        await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_created
      ON notifications (user_id, created_at DESC)
    `);
    }
    // ── Memberships: user lookups for login/auth ──
    if (await knex.schema.hasTable('memberships')) {
        await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_memberships_user_active
      ON memberships (user_id, is_active)
      WHERE is_active = true
    `);
    }
    // ── Messages: channel + created_at for chat pagination ──
    if (await knex.schema.hasTable('messages')) {
        await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_messages_channel_created
      ON messages (channel_id, created_at DESC)
    `);
    }
    // ── Audit logs: user_id + created_at for audit trail ──
    if (await knex.schema.hasTable('audit_logs')) {
        await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
      ON audit_logs (user_id, created_at DESC)
    `);
        await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created
      ON audit_logs (organization_id, created_at DESC)
    `);
    }
    // ── Meetings: org + status for meeting list page ──
    if (await knex.schema.hasTable('meetings')) {
        await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_meetings_org_scheduled
      ON meetings (organization_id, scheduled_start DESC)
    `);
        await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_meetings_org_status
      ON meetings (organization_id, status)
    `);
    }
    // ── Documents: org + created_at for document list ──
    if (await knex.schema.hasTable('documents')) {
        await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_documents_org_created
      ON documents (organization_id, created_at DESC)
    `);
    }
    // ── Wallet transactions: wallet_id + created_at for history ──
    if (await knex.schema.hasTable('wallet_transactions')) {
        await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_wallet_txns_wallet_created
      ON wallet_transactions (wallet_id, created_at DESC)
    `);
    }
    // ── Refresh tokens: cleanup by expires_at ──
    if (await knex.schema.hasTable('refresh_tokens')) {
        await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires
      ON refresh_tokens (expires_at)
    `);
    }
    // ── Users: email lookup (likely already exists, but ensures it) ──
    if (await knex.schema.hasTable('users')) {
        await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_users_email
      ON users (email)
    `);
        // Account lockout: failed attempts for monitoring
        await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_users_locked_until
      ON users (locked_until)
      WHERE locked_until IS NOT NULL
    `);
    }
}
async function down(knex) {
    const indexes = [
        'idx_notifications_user_read',
        'idx_notifications_user_created',
        'idx_memberships_user_active',
        'idx_messages_channel_created',
        'idx_audit_logs_user_created',
        'idx_audit_logs_org_created',
        'idx_meetings_org_scheduled',
        'idx_meetings_org_status',
        'idx_documents_org_created',
        'idx_wallet_txns_wallet_created',
        'idx_refresh_tokens_expires',
        'idx_users_email',
        'idx_users_locked_until',
    ];
    for (const idx of indexes) {
        await knex.raw(`DROP INDEX IF EXISTS ${idx}`);
    }
}
//# sourceMappingURL=028_additional_performance_indexes.js.map