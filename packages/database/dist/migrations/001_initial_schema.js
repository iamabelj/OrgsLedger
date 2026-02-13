"use strict";
// ============================================================
// OrgsLedger — Complete Database Migration
// Creates all tables for the platform
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // ── Enable extensions ───────────────────────────────────
    await knex.raw('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    // ── Users ───────────────────────────────────────────────
    await knex.schema.createTable('users', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.string('email').notNullable().unique();
        t.string('phone').nullable();
        t.string('password_hash').notNullable();
        t.string('first_name').notNullable();
        t.string('last_name').notNullable();
        t.string('avatar_url').nullable();
        t.boolean('is_active').notNullable().defaultTo(true);
        t.boolean('email_verified').notNullable().defaultTo(false);
        t.string('global_role').notNullable().defaultTo('member'); // super_admin or member
        t.string('fcm_token').nullable(); // Firebase push token
        t.string('apns_token').nullable(); // Apple push token
        t.timestamp('last_login_at').nullable();
        t.timestamps(true, true);
        t.index(['email']);
    });
    // ── Licenses ────────────────────────────────────────────
    await knex.schema.createTable('licenses', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.string('type').notNullable().defaultTo('free'); // free, basic, professional, enterprise
        t.integer('max_members').notNullable().defaultTo(50);
        t.jsonb('features').notNullable().defaultTo('{}');
        t.integer('ai_credits_included').notNullable().defaultTo(0); // in minutes
        t.decimal('price_monthly', 10, 2).notNullable().defaultTo(0);
        t.timestamp('valid_from').notNullable().defaultTo(knex.fn.now());
        t.timestamp('valid_until').nullable();
        t.boolean('is_active').notNullable().defaultTo(true);
        t.uuid('reseller_id').nullable().references('id').inTable('users').onDelete('SET NULL');
        t.timestamps(true, true);
    });
    // ── Organizations ───────────────────────────────────────
    await knex.schema.createTable('organizations', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.string('name').notNullable();
        t.string('slug').notNullable().unique();
        t.string('logo_url').nullable();
        t.string('status').notNullable().defaultTo('active'); // active, suspended, trial, expired
        t.uuid('license_id').notNullable().references('id').inTable('licenses').onDelete('RESTRICT');
        t.jsonb('settings').notNullable().defaultTo(JSON.stringify({
            currency: 'USD',
            timezone: 'UTC',
            locale: 'en',
            aiEnabled: false,
            maxMembers: 50,
            features: {
                chat: true,
                meetings: true,
                aiMinutes: false,
                financials: true,
                donations: true,
                voting: true,
            },
        }));
        t.timestamps(true, true);
        t.index(['slug']);
        t.index(['status']);
    });
    // ── Memberships ─────────────────────────────────────────
    await knex.schema.createTable('memberships', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
        t.string('role').notNullable().defaultTo('member'); // org_admin, executive, member, guest
        t.boolean('is_active').notNullable().defaultTo(true);
        t.timestamp('joined_at').notNullable().defaultTo(knex.fn.now());
        t.timestamps(true, true);
        t.unique(['user_id', 'organization_id']);
        t.index(['organization_id', 'role']);
    });
    // ── Committees (sub-groups) ─────────────────────────────
    await knex.schema.createTable('committees', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
        t.string('name').notNullable();
        t.text('description').nullable();
        t.uuid('chair_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
        t.timestamps(true, true);
        t.index(['organization_id']);
    });
    await knex.schema.createTable('committee_members', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('committee_id').notNullable().references('id').inTable('committees').onDelete('CASCADE');
        t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.timestamps(true, true);
        t.unique(['committee_id', 'user_id']);
    });
    // ── Channels (Chat) ────────────────────────────────────
    await knex.schema.createTable('channels', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
        t.string('name').notNullable();
        t.string('type').notNullable().defaultTo('general'); // general, committee, direct, announcement
        t.text('description').nullable();
        t.uuid('committee_id').nullable().references('id').inTable('committees').onDelete('SET NULL');
        t.boolean('is_archived').notNullable().defaultTo(false);
        t.timestamps(true, true);
        t.index(['organization_id', 'type']);
    });
    await knex.schema.createTable('channel_members', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('channel_id').notNullable().references('id').inTable('channels').onDelete('CASCADE');
        t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.timestamp('last_read_at').nullable();
        t.boolean('is_muted').notNullable().defaultTo(false);
        t.timestamps(true, true);
        t.unique(['channel_id', 'user_id']);
    });
    // ── Messages ────────────────────────────────────────────
    await knex.schema.createTable('messages', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('channel_id').notNullable().references('id').inTable('channels').onDelete('CASCADE');
        t.uuid('sender_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.text('content').notNullable();
        t.uuid('thread_id').nullable(); // self-referencing for threads
        t.boolean('is_edited').notNullable().defaultTo(false);
        t.boolean('is_deleted').notNullable().defaultTo(false);
        t.timestamps(true, true);
        t.index(['channel_id', 'created_at']);
        t.index(['thread_id']);
    });
    // Self-reference for threads
    await knex.schema.alterTable('messages', (t) => {
        t.foreign('thread_id').references('id').inTable('messages').onDelete('SET NULL');
    });
    // ── Attachments ─────────────────────────────────────────
    await knex.schema.createTable('attachments', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('message_id').nullable().references('id').inTable('messages').onDelete('CASCADE');
        t.uuid('meeting_id').nullable(); // set later after meetings table
        t.string('file_name').notNullable();
        t.string('file_url').notNullable();
        t.string('mime_type').notNullable();
        t.bigInteger('size_bytes').notNullable().defaultTo(0);
        t.uuid('uploaded_by').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.timestamps(true, true);
        t.index(['message_id']);
    });
    // ── Meetings ────────────────────────────────────────────
    await knex.schema.createTable('meetings', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
        t.string('title').notNullable();
        t.text('description').nullable();
        t.string('status').notNullable().defaultTo('scheduled'); // scheduled, live, ended, cancelled
        t.timestamp('scheduled_start').notNullable();
        t.timestamp('scheduled_end').nullable();
        t.timestamp('actual_start').nullable();
        t.timestamp('actual_end').nullable();
        t.uuid('created_by').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.boolean('ai_enabled').notNullable().defaultTo(false);
        t.string('audio_storage_url').nullable(); // stored audio for AI processing
        t.timestamps(true, true);
        t.index(['organization_id', 'status']);
        t.index(['scheduled_start']);
    });
    // Add foreign key from attachments to meetings
    await knex.schema.alterTable('attachments', (t) => {
        t.foreign('meeting_id').references('id').inTable('meetings').onDelete('CASCADE');
    });
    // ── Agenda Items ────────────────────────────────────────
    await knex.schema.createTable('agenda_items', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('meeting_id').notNullable().references('id').inTable('meetings').onDelete('CASCADE');
        t.string('title').notNullable();
        t.text('description').nullable();
        t.integer('order').notNullable().defaultTo(0);
        t.integer('duration_minutes').nullable();
        t.uuid('presenter_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
        t.timestamps(true, true);
        t.index(['meeting_id', 'order']);
    });
    // ── Meeting Attendance ──────────────────────────────────
    await knex.schema.createTable('meeting_attendance', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('meeting_id').notNullable().references('id').inTable('meetings').onDelete('CASCADE');
        t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.string('status').notNullable().defaultTo('present'); // present, absent, excused, late
        t.timestamp('joined_at').nullable();
        t.timestamp('left_at').nullable();
        t.timestamps(true, true);
        t.unique(['meeting_id', 'user_id']);
    });
    // ── Meeting Votes / Resolutions ─────────────────────────
    await knex.schema.createTable('votes', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('meeting_id').notNullable().references('id').inTable('meetings').onDelete('CASCADE');
        t.string('title').notNullable();
        t.text('description').nullable();
        t.jsonb('options').notNullable().defaultTo('[]');
        t.string('status').notNullable().defaultTo('open'); // open, closed
        t.timestamp('closed_at').nullable();
        t.timestamps(true, true);
        t.index(['meeting_id']);
    });
    await knex.schema.createTable('vote_ballots', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('vote_id').notNullable().references('id').inTable('votes').onDelete('CASCADE');
        t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.string('selected_option').notNullable();
        t.timestamps(true, true);
        t.unique(['vote_id', 'user_id']);
    });
    // ── AI Meeting Minutes ──────────────────────────────────
    await knex.schema.createTable('meeting_minutes', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('meeting_id').notNullable().references('id').inTable('meetings').onDelete('CASCADE');
        t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
        t.jsonb('transcript').notNullable().defaultTo('[]');
        t.text('summary').nullable();
        t.jsonb('decisions').notNullable().defaultTo('[]');
        t.jsonb('motions').notNullable().defaultTo('[]');
        t.jsonb('action_items').notNullable().defaultTo('[]');
        t.jsonb('contributions').notNullable().defaultTo('[]');
        t.decimal('ai_credits_used', 10, 2).notNullable().defaultTo(0);
        t.string('status').notNullable().defaultTo('processing'); // processing, completed, failed
        t.text('error_message').nullable();
        t.timestamp('generated_at').nullable();
        t.timestamps(true, true);
        t.unique(['meeting_id']);
        t.index(['organization_id']);
    });
    // ── Dues ────────────────────────────────────────────────
    await knex.schema.createTable('dues', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
        t.string('title').notNullable();
        t.text('description').nullable();
        t.decimal('amount', 12, 2).notNullable();
        t.string('currency', 3).notNullable().defaultTo('USD');
        t.timestamp('due_date').notNullable();
        t.decimal('late_fee_amount', 12, 2).nullable();
        t.integer('late_fee_grace_days').nullable();
        t.boolean('is_recurring').notNullable().defaultTo(false);
        t.string('recurrence_rule').nullable();
        t.jsonb('target_member_ids').notNullable().defaultTo('[]'); // empty = all members
        t.uuid('created_by').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.timestamps(true, true);
        t.index(['organization_id', 'due_date']);
    });
    // ── Fines ───────────────────────────────────────────────
    await knex.schema.createTable('fines', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
        t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.string('type').notNullable().defaultTo('other'); // misconduct, late_payment, absence, other
        t.decimal('amount', 12, 2).notNullable();
        t.string('currency', 3).notNullable().defaultTo('USD');
        t.text('reason').notNullable();
        t.uuid('issued_by').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.string('status').notNullable().defaultTo('unpaid'); // unpaid, paid, waived
        t.timestamps(true, true);
        t.index(['organization_id', 'user_id']);
        t.index(['status']);
    });
    // ── Donations ───────────────────────────────────────────
    await knex.schema.createTable('donation_campaigns', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
        t.string('title').notNullable();
        t.text('description').nullable();
        t.decimal('goal_amount', 12, 2).nullable();
        t.string('currency', 3).notNullable().defaultTo('USD');
        t.boolean('is_active').notNullable().defaultTo(true);
        t.timestamp('start_date').notNullable();
        t.timestamp('end_date').nullable();
        t.uuid('created_by').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.timestamps(true, true);
        t.index(['organization_id', 'is_active']);
    });
    await knex.schema.createTable('donations', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
        t.uuid('user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
        t.uuid('campaign_id').nullable().references('id').inTable('donation_campaigns').onDelete('SET NULL');
        t.decimal('amount', 12, 2).notNullable();
        t.string('currency', 3).notNullable().defaultTo('USD');
        t.boolean('is_anonymous').notNullable().defaultTo(false);
        t.text('message').nullable();
        t.string('status').notNullable().defaultTo('pending'); // pending, completed, failed, refunded
        t.timestamps(true, true);
        t.index(['organization_id', 'campaign_id']);
    });
    // ── Transactions (Immutable Ledger) ─────────────────────
    await knex.schema.createTable('transactions', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
        t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.string('type').notNullable(); // due, fine, donation, late_fee, misconduct_fine, refund, ai_credit_purchase
        t.decimal('amount', 12, 2).notNullable();
        t.string('currency', 3).notNullable().defaultTo('USD');
        t.string('status').notNullable().defaultTo('pending'); // pending, completed, failed, refunded, partially_refunded
        t.text('description').notNullable();
        t.uuid('reference_id').nullable(); // FK to dues/fines/donations
        t.string('reference_type').nullable(); // 'due', 'fine', 'donation'
        t.string('payment_gateway_id').nullable(); // Stripe charge ID, etc.
        t.string('payment_method').nullable(); // card, bank_transfer, etc.
        t.string('receipt_url').nullable();
        t.jsonb('metadata').notNullable().defaultTo('{}');
        // Immutability: no update_at trigger; only status can transition
        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        t.index(['organization_id', 'type']);
        t.index(['user_id']);
        t.index(['status']);
        t.index(['created_at']);
    });
    // ── Refunds ─────────────────────────────────────────────
    await knex.schema.createTable('refunds', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('transaction_id').notNullable().references('id').inTable('transactions').onDelete('CASCADE');
        t.decimal('amount', 12, 2).notNullable();
        t.text('reason').notNullable();
        t.string('status').notNullable().defaultTo('pending'); // pending, completed, failed
        t.string('payment_gateway_refund_id').nullable();
        t.uuid('processed_by').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.timestamps(true, true);
        t.index(['transaction_id']);
    });
    // ── AI Credits ──────────────────────────────────────────
    await knex.schema.createTable('ai_credits', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
        t.decimal('total_credits', 10, 2).notNullable().defaultTo(0); // in minutes
        t.decimal('used_credits', 10, 2).notNullable().defaultTo(0);
        t.decimal('price_per_credit_hour', 10, 2).notNullable().defaultTo(5.00); // $5/hour default
        t.timestamps(true, true);
        t.unique(['organization_id']);
    });
    await knex.schema.createTable('ai_credit_transactions', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
        t.string('type').notNullable(); // purchase, usage, refund, bonus
        t.decimal('amount', 10, 2).notNullable(); // in minutes
        t.uuid('meeting_id').nullable().references('id').inTable('meetings').onDelete('SET NULL');
        t.uuid('transaction_id').nullable().references('id').inTable('transactions').onDelete('SET NULL');
        t.text('description').notNullable();
        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        t.index(['organization_id', 'type']);
    });
    // ── Audit Logs (Immutable) ──────────────────────────────
    await knex.schema.createTable('audit_logs', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('organization_id').nullable().references('id').inTable('organizations').onDelete('SET NULL');
        t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.string('action').notNullable(); // create, update, delete, login, payment, etc.
        t.string('entity_type').notNullable(); // user, organization, transaction, etc.
        t.string('entity_id').notNullable();
        t.jsonb('previous_value').nullable();
        t.jsonb('new_value').nullable();
        t.string('ip_address').nullable();
        t.text('user_agent').nullable();
        t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        // No updated_at — immutable
        t.index(['organization_id', 'action']);
        t.index(['user_id']);
        t.index(['entity_type', 'entity_id']);
        t.index(['created_at']);
    });
    // ── Notifications ───────────────────────────────────────
    await knex.schema.createTable('notifications', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.uuid('organization_id').nullable().references('id').inTable('organizations').onDelete('SET NULL');
        t.string('type').notNullable(); // message, meeting, payment, fine, due_reminder, minutes_ready, system
        t.string('title').notNullable();
        t.text('body').notNullable();
        t.jsonb('data').nullable();
        t.boolean('is_read').notNullable().defaultTo(false);
        t.boolean('push_sent').notNullable().defaultTo(false);
        t.timestamps(true, true);
        t.index(['user_id', 'is_read']);
        t.index(['organization_id']);
    });
    // ── Platform Config (Super Admin) ──────────────────────
    await knex.schema.createTable('platform_config', (t) => {
        t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
        t.string('key').notNullable().unique();
        t.jsonb('value').notNullable();
        t.text('description').nullable();
        t.timestamps(true, true);
    });
}
async function down(knex) {
    const tables = [
        'platform_config',
        'notifications',
        'audit_logs',
        'ai_credit_transactions',
        'ai_credits',
        'refunds',
        'transactions',
        'donations',
        'donation_campaigns',
        'fines',
        'dues',
        'meeting_minutes',
        'vote_ballots',
        'votes',
        'meeting_attendance',
        'agenda_items',
        'attachments',
        'meetings',
        'messages',
        'channel_members',
        'channels',
        'committee_members',
        'committees',
        'memberships',
        'organizations',
        'licenses',
        'users',
    ];
    for (const table of tables) {
        await knex.schema.dropTableIfExists(table);
    }
}
//# sourceMappingURL=001_initial_schema.js.map