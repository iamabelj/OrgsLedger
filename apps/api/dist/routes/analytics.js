"use strict";
// ============================================================
// OrgsLedger API — Analytics / Dashboard Routes
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const middleware_1 = require("../middleware");
const router = (0, express_1.Router)();
// ── Dashboard Analytics ─────────────────────────────────────
router.get('/:orgId/dashboard', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), async (req, res) => {
    try {
        const orgId = req.params.orgId;
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString();
        // Member stats
        const totalMembers = await (0, db_1.default)('memberships')
            .where({ organization_id: orgId, is_active: true })
            .count('id as count').first();
        const newMembersThisMonth = await (0, db_1.default)('memberships')
            .where({ organization_id: orgId, is_active: true })
            .where('joined_at', '>=', startOfMonth)
            .count('id as count').first();
        // Financial stats
        const totalRevenue = await (0, db_1.default)('transactions')
            .where({ organization_id: orgId })
            .whereIn('type', ['due', 'donation'])
            .where('status', 'completed')
            .sum('amount as total').first();
        const monthlyRevenue = await (0, db_1.default)('transactions')
            .where({ organization_id: orgId })
            .whereIn('type', ['due', 'donation'])
            .where('status', 'completed')
            .where('created_at', '>=', startOfMonth)
            .sum('amount as total').first();
        const totalExpenses = await (0, db_1.default)('expenses')
            .where({ organization_id: orgId, status: 'approved' })
            .sum('amount as total').first();
        const monthlyExpenses = await (0, db_1.default)('expenses')
            .where({ organization_id: orgId, status: 'approved' })
            .where('created_at', '>=', startOfMonth)
            .sum('amount as total').first();
        const outstandingDues = await (0, db_1.default)('transactions')
            .where({ organization_id: orgId, type: 'due', status: 'pending' })
            .sum('amount as total').first();
        const outstandingFines = await (0, db_1.default)('transactions')
            .where({ organization_id: orgId, type: 'fine', status: 'pending' })
            .sum('amount as total').first();
        // Collection rate
        const totalBilled = await (0, db_1.default)('transactions')
            .where({ organization_id: orgId })
            .whereIn('type', ['due', 'fine'])
            .sum('amount as total').first();
        const totalCollected = await (0, db_1.default)('transactions')
            .where({ organization_id: orgId, status: 'completed' })
            .whereIn('type', ['due', 'fine'])
            .sum('amount as total').first();
        const collectionRate = (totalBilled?.total && parseFloat(totalBilled.total) > 0)
            ? ((parseFloat(totalCollected?.total || '0') / parseFloat(totalBilled.total)) * 100).toFixed(1)
            : '0';
        // Monthly revenue breakdown (last 6 months)
        const monthlyBreakdown = await (0, db_1.default)('transactions')
            .where({ organization_id: orgId, status: 'completed' })
            .where('created_at', '>=', new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString())
            .select(db_1.default.raw("TO_CHAR(created_at, 'YYYY-MM') as month"))
            .sum('amount as total')
            .groupByRaw("TO_CHAR(created_at, 'YYYY-MM')")
            .orderBy('month');
        // Recent activity
        const recentActivity = await (0, db_1.default)('audit_logs')
            .where({ organization_id: orgId })
            .join('users', 'audit_logs.user_id', 'users.id')
            .select('audit_logs.action', 'audit_logs.entity_type', 'audit_logs.created_at', 'users.first_name', 'users.last_name')
            .orderBy('audit_logs.created_at', 'desc')
            .limit(10);
        res.json({
            success: true,
            data: {
                members: {
                    total: parseInt(totalMembers?.count) || 0,
                    newThisMonth: parseInt(newMembersThisMonth?.count) || 0,
                },
                finances: {
                    totalRevenue: parseFloat(totalRevenue?.total || '0'),
                    monthlyRevenue: parseFloat(monthlyRevenue?.total || '0'),
                    totalExpenses: parseFloat(totalExpenses?.total || '0'),
                    monthlyExpenses: parseFloat(monthlyExpenses?.total || '0'),
                    outstandingDues: parseFloat(outstandingDues?.total || '0'),
                    outstandingFines: parseFloat(outstandingFines?.total || '0'),
                    netBalance: parseFloat(totalRevenue?.total || '0') - parseFloat(totalExpenses?.total || '0'),
                    collectionRate: parseFloat(collectionRate),
                },
                monthlyBreakdown,
                recentActivity,
            },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get analytics' });
    }
});
// ── Member payment status ───────────────────────────────────
router.get('/:orgId/member-payments', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), async (req, res) => {
    try {
        const orgId = req.params.orgId;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
        const offset = (page - 1) * limit;
        const totalCount = await (0, db_1.default)('memberships')
            .where({ organization_id: orgId, is_active: true })
            .count('id as count')
            .first();
        const members = await (0, db_1.default)('memberships')
            .join('users', 'memberships.user_id', 'users.id')
            .where({ 'memberships.organization_id': orgId, 'memberships.is_active': true })
            .select('users.id', 'users.first_name', 'users.last_name', 'users.email', 'memberships.role')
            .orderBy('users.last_name')
            .limit(limit)
            .offset(offset);
        if (!members.length) {
            res.json({ success: true, data: [], meta: { page, limit, total: parseInt(totalCount?.count) || 0 } });
            return;
        }
        const memberIds = members.map((m) => m.id);
        // Batch aggregate: one query for all members' pending + completed totals
        const paymentStats = await (0, db_1.default)('transactions')
            .where({ organization_id: orgId })
            .whereIn('user_id', memberIds)
            .whereIn('status', ['pending', 'completed'])
            .select('user_id', db_1.default.raw("coalesce(sum(amount) filter (where status = 'pending'), 0) as total_owed"), db_1.default.raw("coalesce(sum(amount) filter (where status = 'completed'), 0) as total_paid"))
            .groupBy('user_id');
        const statsMap = {};
        paymentStats.forEach((s) => {
            statsMap[s.user_id] = {
                totalOwed: parseFloat(s.total_owed),
                totalPaid: parseFloat(s.total_paid),
            };
        });
        const enriched = members.map((m) => {
            const stats = statsMap[m.id] || { totalOwed: 0, totalPaid: 0 };
            return {
                ...m,
                totalOwed: stats.totalOwed,
                totalPaid: stats.totalPaid,
                status: stats.totalOwed > 0 ? 'outstanding' : 'clear',
            };
        });
        res.json({ success: true, data: enriched, meta: { page, limit, total: parseInt(totalCount?.count) || 0 } });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get member payments' });
    }
});
// ── Receipt / Invoice Generation ────────────────────────────
router.get('/:orgId/receipt/:recordId', middleware_1.authenticate, middleware_1.loadMembershipAndSub, async (req, res) => {
    try {
        const record = await (0, db_1.default)('transactions')
            .where({ id: req.params.recordId, organization_id: req.params.orgId })
            .first();
        if (!record) {
            res.status(404).json({ success: false, error: 'Record not found' });
            return;
        }
        // Only allow viewing own receipts or admin
        const membership = req.membership;
        if (record.user_id !== req.user.userId && !['org_admin', 'executive'].includes(membership?.role)) {
            res.status(403).json({ success: false, error: 'Forbidden' });
            return;
        }
        const org = await (0, db_1.default)('organizations').where({ id: req.params.orgId }).first();
        const user = await (0, db_1.default)('users').where({ id: record.user_id }).first();
        const receipt = {
            receiptNumber: `OL-${record.id.slice(0, 8).toUpperCase()}`,
            date: record.created_at,
            organization: {
                name: org?.name,
                address: org?.address,
            },
            member: {
                name: `${user?.first_name} ${user?.last_name}`,
                email: user?.email,
            },
            item: {
                type: record.type,
                description: record.description || `${record.type} payment`,
                amount: parseFloat(record.amount),
                currency: record.currency || 'NGN',
                status: record.status,
            },
        };
        res.json({ success: true, data: receipt });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to generate receipt' });
    }
});
exports.default = router;
//# sourceMappingURL=analytics.js.map