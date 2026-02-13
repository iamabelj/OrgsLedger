"use strict";
// ============================================================
// OrgsLedger API — Financial Management Routes
// Dues, Fines, Donations, Transactions, Ledger
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = __importDefault(require("../db"));
const middleware_1 = require("../middleware");
const logger_1 = require("../logger");
const socket_1 = require("../socket");
const push_service_1 = require("../services/push.service");
const router = (0, express_1.Router)();
// ── Schemas ─────────────────────────────────────────────────
const createDueSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(300),
    description: zod_1.z.string().max(2000).optional(),
    amount: zod_1.z.number().positive(),
    currency: zod_1.z.string().length(3).default('USD'),
    dueDate: zod_1.z.string().datetime(),
    lateFeeAmount: zod_1.z.number().min(0).optional(),
    lateFeeGraceDays: zod_1.z.number().int().min(0).optional(),
    isRecurring: zod_1.z.boolean().default(false),
    recurrenceRule: zod_1.z.string().optional(),
    targetMemberIds: zod_1.z.array(zod_1.z.string().uuid()).default([]),
});
const createFineSchema = zod_1.z.object({
    userId: zod_1.z.string().uuid(),
    type: zod_1.z.enum(['misconduct', 'late_payment', 'absence', 'other']),
    amount: zod_1.z.number().positive(),
    currency: zod_1.z.string().length(3).default('USD'),
    reason: zod_1.z.string().min(1).max(2000),
});
const createDonationCampaignSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(300),
    description: zod_1.z.string().max(5000).optional(),
    goalAmount: zod_1.z.number().positive().optional(),
    currency: zod_1.z.string().length(3).default('USD'),
    startDate: zod_1.z.string().datetime(),
    endDate: zod_1.z.string().datetime().optional(),
});
const makeDonationSchema = zod_1.z.object({
    amount: zod_1.z.number().positive(),
    currency: zod_1.z.string().length(3).default('USD'),
    campaignId: zod_1.z.string().uuid().optional(),
    isAnonymous: zod_1.z.boolean().default(false),
    message: zod_1.z.string().max(1000).optional(),
});
// ══════════════════════════════════════════════════════════════
// DUES
// ══════════════════════════════════════════════════════════════
router.post('/:orgId/dues', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin', 'executive'), (0, middleware_1.validate)(createDueSchema), async (req, res) => {
    try {
        const data = req.body;
        const [due] = await (0, db_1.default)('dues')
            .insert({
            organization_id: req.params.orgId,
            title: data.title,
            description: data.description || null,
            amount: data.amount,
            currency: data.currency,
            due_date: data.dueDate,
            late_fee_amount: data.lateFeeAmount || null,
            late_fee_grace_days: data.lateFeeGraceDays || null,
            is_recurring: data.isRecurring,
            recurrence_rule: data.recurrenceRule || null,
            target_member_ids: JSON.stringify(data.targetMemberIds),
            created_by: req.user.userId,
        })
            .returning('*');
        // Create pending transactions for targeted members
        let targetUserIds = data.targetMemberIds;
        if (!targetUserIds.length) {
            targetUserIds = await (0, db_1.default)('memberships')
                .where({ organization_id: req.params.orgId, is_active: true })
                .pluck('user_id');
        }
        const transactions = targetUserIds.map((userId) => ({
            organization_id: req.params.orgId,
            user_id: userId,
            type: 'due',
            amount: data.amount,
            currency: data.currency,
            status: 'pending',
            description: data.title,
            reference_id: due.id,
            reference_type: 'due',
        }));
        await (0, db_1.default)('transactions').insert(transactions);
        // Notify members
        const notifications = targetUserIds.map((userId) => ({
            user_id: userId,
            organization_id: req.params.orgId,
            type: 'due_reminder',
            title: 'New Due Created',
            body: `${data.title} — ${data.currency} ${data.amount} due by ${new Date(data.dueDate).toLocaleDateString()}`,
            data: JSON.stringify({ dueId: due.id }),
        }));
        await (0, db_1.default)('notifications').insert(notifications);
        // Push notification for new due
        (0, push_service_1.sendPushToOrg)(req.params.orgId, {
            title: 'New Due Created',
            body: `${data.title} — ${data.currency} ${data.amount} due by ${new Date(data.dueDate).toLocaleDateString()}`,
            data: { dueId: due.id, type: 'due_reminder' },
        }, req.user.userId).catch(() => { });
        await req.audit?.({
            organizationId: req.params.orgId,
            action: 'create',
            entityType: 'due',
            entityId: due.id,
            newValue: { title: data.title, amount: data.amount },
        });
        // Emit real-time financial update
        const io = req.app.get('io');
        if (io) {
            (0, socket_1.emitFinancialUpdate)(io, req.params.orgId, {
                type: 'due_created',
                dueId: due.id,
                title: data.title,
                amount: data.amount,
                currency: data.currency,
            });
        }
        res.status(201).json({ success: true, data: due });
    }
    catch (err) {
        logger_1.logger.error('Create due error', err);
        res.status(500).json({ success: false, error: 'Failed to create due' });
    }
});
router.get('/:orgId/dues', middleware_1.authenticate, middleware_1.loadMembership, async (req, res) => {
    try {
        const dues = await (0, db_1.default)('dues')
            .where({ organization_id: req.params.orgId })
            .orderBy('due_date', 'desc');
        // Attach payment stats per due
        const enriched = await Promise.all(dues.map(async (d) => {
            const stats = await (0, db_1.default)('transactions')
                .where({ reference_id: d.id, reference_type: 'due' })
                .select(db_1.default.raw("count(*) filter (where status = 'completed') as paid_count"), db_1.default.raw("count(*) filter (where status = 'pending') as pending_count"), db_1.default.raw("coalesce(sum(amount) filter (where status = 'completed'), 0) as total_collected"))
                .first();
            return { ...d, ...stats };
        }));
        res.json({ success: true, data: enriched });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to list dues' });
    }
});
// ══════════════════════════════════════════════════════════════
// FINES
// ══════════════════════════════════════════════════════════════
router.post('/:orgId/fines', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin', 'executive'), (0, middleware_1.validate)(createFineSchema), async (req, res) => {
    try {
        const data = req.body;
        // Verify target user is a member
        const membership = await (0, db_1.default)('memberships')
            .where({ user_id: data.userId, organization_id: req.params.orgId, is_active: true })
            .first();
        if (!membership) {
            res.status(404).json({ success: false, error: 'User is not an active member' });
            return;
        }
        const [fine] = await (0, db_1.default)('fines')
            .insert({
            organization_id: req.params.orgId,
            user_id: data.userId,
            type: data.type,
            amount: data.amount,
            currency: data.currency,
            reason: data.reason,
            issued_by: req.user.userId,
            status: 'unpaid',
        })
            .returning('*');
        // Create pending transaction
        await (0, db_1.default)('transactions').insert({
            organization_id: req.params.orgId,
            user_id: data.userId,
            type: data.type === 'misconduct' ? 'misconduct_fine' : 'fine',
            amount: data.amount,
            currency: data.currency,
            status: 'pending',
            description: `Fine: ${data.reason}`,
            reference_id: fine.id,
            reference_type: 'fine',
        });
        // Notify the fined member
        await (0, db_1.default)('notifications').insert({
            user_id: data.userId,
            organization_id: req.params.orgId,
            type: 'fine',
            title: 'Fine Issued',
            body: `You have been fined ${data.currency} ${data.amount}: ${data.reason}`,
            data: JSON.stringify({ fineId: fine.id }),
        });
        // Push notification for fine
        (0, push_service_1.sendPushToUser)(data.userId, {
            title: 'Fine Issued',
            body: `You have been fined ${data.currency} ${data.amount}: ${data.reason}`,
            data: { fineId: fine.id, type: 'fine' },
        }).catch(() => { });
        await req.audit?.({
            organizationId: req.params.orgId,
            action: 'create',
            entityType: 'fine',
            entityId: fine.id,
            newValue: { userId: data.userId, amount: data.amount, type: data.type, reason: data.reason },
        });
        // Emit real-time financial update
        const io = req.app.get('io');
        if (io) {
            (0, socket_1.emitFinancialUpdate)(io, req.params.orgId, {
                type: 'fine_created',
                fineId: fine.id,
                userId: data.userId,
                amount: data.amount,
                currency: data.currency,
            });
        }
        res.status(201).json({ success: true, data: fine });
    }
    catch (err) {
        logger_1.logger.error('Create fine error', err);
        res.status(500).json({ success: false, error: 'Failed to create fine' });
    }
});
router.get('/:orgId/fines', middleware_1.authenticate, middleware_1.loadMembership, async (req, res) => {
    try {
        let query = (0, db_1.default)('fines')
            .join('users as fined_user', 'fines.user_id', 'fined_user.id')
            .join('users as issuer', 'fines.issued_by', 'issuer.id')
            .where({ 'fines.organization_id': req.params.orgId })
            .select('fines.*', 'fined_user.first_name as finedFirstName', 'fined_user.last_name as finedLastName', 'issuer.first_name as issuerFirstName', 'issuer.last_name as issuerLastName');
        // Non-admins see only their own fines
        if (req.membership?.role === 'member' || req.membership?.role === 'guest') {
            query = query.where({ 'fines.user_id': req.user.userId });
        }
        const fines = await query.orderBy('fines.created_at', 'desc');
        res.json({ success: true, data: fines });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to list fines' });
    }
});
// ══════════════════════════════════════════════════════════════
// DONATIONS
// ══════════════════════════════════════════════════════════════
router.post('/:orgId/donation-campaigns', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin', 'executive'), (0, middleware_1.validate)(createDonationCampaignSchema), async (req, res) => {
    try {
        const data = req.body;
        const [campaign] = await (0, db_1.default)('donation_campaigns')
            .insert({
            organization_id: req.params.orgId,
            title: data.title,
            description: data.description || null,
            goal_amount: data.goalAmount || null,
            currency: data.currency,
            start_date: data.startDate,
            end_date: data.endDate || null,
            created_by: req.user.userId,
        })
            .returning('*');
        res.status(201).json({ success: true, data: campaign });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to create campaign' });
    }
});
router.get('/:orgId/donation-campaigns', middleware_1.authenticate, middleware_1.loadMembership, async (req, res) => {
    try {
        const campaigns = await (0, db_1.default)('donation_campaigns')
            .where({ organization_id: req.params.orgId })
            .orderBy('created_at', 'desc');
        const enriched = await Promise.all(campaigns.map(async (c) => {
            const stats = await (0, db_1.default)('donations')
                .where({ campaign_id: c.id, status: 'completed' })
                .select(db_1.default.raw('count(*) as donation_count'), db_1.default.raw('coalesce(sum(amount), 0) as total_raised'))
                .first();
            return { ...c, ...stats };
        }));
        res.json({ success: true, data: enriched });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to list campaigns' });
    }
});
router.post('/:orgId/donations', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.validate)(makeDonationSchema), async (req, res) => {
    try {
        const data = req.body;
        const [donation] = await (0, db_1.default)('donations')
            .insert({
            organization_id: req.params.orgId,
            user_id: data.isAnonymous ? null : req.user.userId,
            campaign_id: data.campaignId || null,
            amount: data.amount,
            currency: data.currency,
            is_anonymous: data.isAnonymous,
            message: data.message || null,
            status: 'pending',
        })
            .returning('*');
        // Create transaction
        await (0, db_1.default)('transactions').insert({
            organization_id: req.params.orgId,
            user_id: req.user.userId,
            type: 'donation',
            amount: data.amount,
            currency: data.currency,
            status: 'pending',
            description: `Donation${data.campaignId ? ' to campaign' : ''}`,
            reference_id: donation.id,
            reference_type: 'donation',
        });
        res.status(201).json({ success: true, data: donation });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to make donation' });
    }
});
// ══════════════════════════════════════════════════════════════
// ORGANIZATION LEDGER (REAL-TIME FINANCIAL RECORDS)
// ══════════════════════════════════════════════════════════════
router.get('/:orgId/ledger', middleware_1.authenticate, middleware_1.loadMembership, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const type = req.query.type;
        const status = req.query.status;
        const userId = req.query.userId;
        const fromDate = req.query.from;
        const toDate = req.query.to;
        let query = (0, db_1.default)('transactions')
            .join('users', 'transactions.user_id', 'users.id')
            .where({ 'transactions.organization_id': req.params.orgId })
            .select('transactions.*', 'users.first_name', 'users.last_name', 'users.email');
        if (type)
            query = query.where({ 'transactions.type': type });
        if (status)
            query = query.where({ 'transactions.status': status });
        if (userId)
            query = query.where({ 'transactions.user_id': userId });
        if (fromDate)
            query = query.where('transactions.created_at', '>=', fromDate);
        if (toDate)
            query = query.where('transactions.created_at', '<=', toDate);
        const total = await query.clone().clear('select').count('transactions.id as count').first();
        const transactions = await query
            .orderBy('transactions.created_at', 'desc')
            .offset((page - 1) * limit)
            .limit(limit);
        // Summary totals
        const summary = await (0, db_1.default)('transactions')
            .where({ organization_id: req.params.orgId, status: 'completed' })
            .select(db_1.default.raw("coalesce(sum(amount) filter (where type = 'due'), 0) as total_dues_collected"), db_1.default.raw("coalesce(sum(amount) filter (where type in ('fine', 'misconduct_fine', 'late_fee')), 0) as total_fines_collected"), db_1.default.raw("coalesce(sum(amount) filter (where type = 'donation'), 0) as total_donations"), db_1.default.raw("coalesce(sum(amount) filter (where type = 'refund'), 0) as total_refunds"), db_1.default.raw('coalesce(sum(amount), 0) as grand_total'))
            .first();
        res.json({
            success: true,
            data: {
                transactions,
                summary,
            },
            meta: {
                page,
                limit,
                total: parseInt(total?.count) || 0,
            },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get ledger' });
    }
});
// ── Per-User Payment History ────────────────────────────────
router.get('/:orgId/ledger/user/:userId', middleware_1.authenticate, middleware_1.loadMembership, async (req, res) => {
    try {
        // Members can only see their own unless admin
        if (req.params.userId !== req.user.userId &&
            req.membership?.role !== 'org_admin' &&
            req.membership?.role !== 'executive') {
            res.status(403).json({ success: false, error: 'Can only view your own payment history' });
            return;
        }
        const transactions = await (0, db_1.default)('transactions')
            .where({
            organization_id: req.params.orgId,
            user_id: req.params.userId,
        })
            .orderBy('created_at', 'desc');
        const outstanding = await (0, db_1.default)('transactions')
            .where({
            organization_id: req.params.orgId,
            user_id: req.params.userId,
            status: 'pending',
        })
            .select(db_1.default.raw('coalesce(sum(amount), 0) as total_outstanding'))
            .first();
        const paid = await (0, db_1.default)('transactions')
            .where({
            organization_id: req.params.orgId,
            user_id: req.params.userId,
            status: 'completed',
        })
            .select(db_1.default.raw('coalesce(sum(amount), 0) as total_paid'))
            .first();
        res.json({
            success: true,
            data: {
                transactions,
                totalOutstanding: outstanding?.total_outstanding || 0,
                totalPaid: paid?.total_paid || 0,
            },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get user payment history' });
    }
});
// ── Export Financial Report ─────────────────────────────────
router.get('/:orgId/ledger/export', middleware_1.authenticate, middleware_1.loadMembership, (0, middleware_1.requireRole)('org_admin', 'executive'), async (req, res) => {
    try {
        const fromDate = req.query.from;
        const toDate = req.query.to;
        let query = (0, db_1.default)('transactions')
            .join('users', 'transactions.user_id', 'users.id')
            .where({ 'transactions.organization_id': req.params.orgId })
            .select('transactions.id', 'transactions.type', 'transactions.amount', 'transactions.currency', 'transactions.status', 'transactions.description', 'transactions.created_at', 'users.first_name', 'users.last_name', 'users.email')
            .orderBy('transactions.created_at', 'asc');
        if (fromDate)
            query = query.where('transactions.created_at', '>=', fromDate);
        if (toDate)
            query = query.where('transactions.created_at', '<=', toDate);
        const transactions = await query;
        // Generate CSV — properly escape fields
        const escapeCSV = (val) => {
            if (val === null || val === undefined)
                return '';
            const str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        };
        const headers = 'ID,Type,Amount,Currency,Status,Description,Date,First Name,Last Name,Email\n';
        const rows = transactions
            .map((t) => [t.id, t.type, t.amount, t.currency, t.status, t.description, t.created_at, t.first_name, t.last_name, t.email]
            .map(escapeCSV)
            .join(','))
            .join('\n');
        await req.audit?.({
            organizationId: req.params.orgId,
            action: 'export',
            entityType: 'financial_report',
            entityId: req.params.orgId,
        });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=ledger_${req.params.orgId}.csv`);
        res.send(headers + rows);
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to export report' });
    }
});
exports.default = router;
//# sourceMappingURL=financials.js.map