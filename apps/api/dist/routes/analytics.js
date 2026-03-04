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
        // Meeting stats
        const totalMeetings = await (0, db_1.default)('meetings')
            .where({ organization_id: orgId })
            .count('id as count').first();
        const meetingsThisMonth = await (0, db_1.default)('meetings')
            .where({ organization_id: orgId })
            .where('scheduled_start', '>=', startOfMonth)
            .count('id as count').first();
        const avgAttendance = await (0, db_1.default)('meeting_attendance')
            .join('meetings', 'meeting_attendance.meeting_id', 'meetings.id')
            .where({ 'meetings.organization_id': orgId, 'meetings.status': 'ended' })
            .countDistinct('meeting_attendance.user_id as total_attendees')
            .countDistinct('meeting_attendance.meeting_id as total_meetings')
            .first();
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
                meetings: {
                    total: parseInt(totalMeetings?.count) || 0,
                    thisMonth: parseInt(meetingsThisMonth?.count) || 0,
                    avgAttendance: avgAttendance?.total_meetings
                        ? Math.round(parseInt(avgAttendance.total_attendees) / parseInt(avgAttendance.total_meetings))
                        : 0,
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
// ── AI Meeting Insights Dashboard ────────────────────────────
router.get('/:orgId/meeting-insights', middleware_1.authenticate, middleware_1.loadMembershipAndSub, (0, middleware_1.requireRole)('org_admin', 'executive'), async (req, res) => {
    try {
        const orgId = req.params.orgId;
        const now = new Date();
        const lastSixMonths = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();
        const lastThirtyDays = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
        // ── Overview Metrics ──
        const totalMeetings = await (0, db_1.default)('meetings')
            .where({ organization_id: orgId })
            .where('status', 'ended')
            .count('id as count')
            .first();
        const meetingsWithAI = await (0, db_1.default)('meetings')
            .where({ organization_id: orgId, ai_enabled: true })
            .where('status', 'ended')
            .count('id as count')
            .first();
        const minutesGenerated = await (0, db_1.default)('meeting_minutes')
            .join('meetings', 'meeting_minutes.meeting_id', 'meetings.id')
            .where({ 'meetings.organization_id': orgId, 'meeting_minutes.status': 'completed' })
            .count('meeting_minutes.id as count')
            .first();
        const totalAiCreditsUsed = await (0, db_1.default)('meeting_minutes')
            .join('meetings', 'meeting_minutes.meeting_id', 'meetings.id')
            .where({ 'meetings.organization_id': orgId, 'meeting_minutes.status': 'completed' })
            .sum('meeting_minutes.ai_credits_used as total')
            .first();
        // ── Meeting Frequency (Last 6 Months) ──
        const meetingFrequency = await (0, db_1.default)('meetings')
            .where({ organization_id: orgId })
            .where('scheduled_start', '>=', lastSixMonths)
            .select(db_1.default.raw("DATE_TRUNC('month', scheduled_start) as month"))
            .count('id as count')
            .groupBy('month')
            .orderBy('month', 'asc');
        // ── Average Meeting Duration ──
        const durationStats = await (0, db_1.default)('meetings')
            .where({ organization_id: orgId, status: 'ended' })
            .whereNotNull('actual_start')
            .whereNotNull('actual_end')
            .select(db_1.default.raw(`
          AVG(EXTRACT(EPOCH FROM (actual_end::timestamp - actual_start::timestamp)) / 60) as avg_minutes,
          MAX(EXTRACT(EPOCH FROM (actual_end::timestamp - actual_start::timestamp)) / 60) as max_minutes,
          MIN(EXTRACT(EPOCH FROM (actual_end::timestamp - actual_start::timestamp)) / 60) as min_minutes
        `))
            .first();
        // ── Average Attendance ──
        const attendanceStats = await (0, db_1.default)('meeting_attendance')
            .join('meetings', 'meeting_attendance.meeting_id', 'meetings.id')
            .where({ 'meetings.organization_id': orgId, 'meetings.status': 'ended' })
            .select(db_1.default.raw(`
          COUNT(DISTINCT meeting_attendance.meeting_id) as total_meetings,
          COUNT(meeting_attendance.id) as total_attendance
        `))
            .first();
        const avgAttendance = attendanceStats?.total_meetings > 0
            ? Math.round(attendanceStats.total_attendance / attendanceStats.total_meetings)
            : 0;
        // ── Decisions & Action Items ──
        const decisionsCount = await (0, db_1.default)('meeting_minutes')
            .join('meetings', 'meeting_minutes.meeting_id', 'meetings.id')
            .where({ 'meetings.organization_id': orgId, 'meeting_minutes.status': 'completed' })
            .select(db_1.default.raw(`
          SUM(COALESCE(jsonb_array_length(decisions), 0)) as total_decisions
        `))
            .first();
        const actionItemsCount = await (0, db_1.default)('meeting_minutes')
            .join('meetings', 'meeting_minutes.meeting_id', 'meetings.id')
            .where({ 'meetings.organization_id': orgId, 'meeting_minutes.status': 'completed' })
            .select(db_1.default.raw(`
          SUM(COALESCE(jsonb_array_length(action_items), 0)) as total_action_items
        `))
            .first();
        // ── Action Items by Priority ──
        const actionItemsByPriority = await (0, db_1.default)('meeting_minutes')
            .join('meetings', 'meeting_minutes.meeting_id', 'meetings.id')
            .where({ 'meetings.organization_id': orgId, 'meeting_minutes.status': 'completed' })
            .select(db_1.default.raw(`
          COALESCE(jsonb_array_elements(action_items) ->> 'priority', 'medium') as priority,
          COUNT(*) as count
        `))
            .groupBy('priority');
        const priorityCounts = {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
        };
        actionItemsByPriority.forEach((row) => {
            const priority = row.priority?.toLowerCase() || 'medium';
            if (priority in priorityCounts) {
                priorityCounts[priority] = parseInt(row.count) || 0;
            }
        });
        const motionsCount = await (0, db_1.default)('meeting_minutes')
            .join('meetings', 'meeting_minutes.meeting_id', 'meetings.id')
            .where({ 'meetings.organization_id': orgId, 'meeting_minutes.status': 'completed' })
            .select(db_1.default.raw(`
          SUM(COALESCE(jsonb_array_length(motions), 0)) as total_motions
        `))
            .first();
        // ── Top Contributors (by speaking time) ──
        const topContributors = await (0, db_1.default)('meeting_minutes')
            .join('meetings', 'meeting_minutes.meeting_id', 'meetings.id')
            .where({ 'meetings.organization_id': orgId, 'meeting_minutes.status': 'completed' })
            .select(db_1.default.raw(`
          jsonb_array_elements(contributions) -> 'userName' as contributor_name,
          SUM((jsonb_array_elements(contributions) -> 'speakingTimeSeconds')::int) as total_speaking_seconds
        `))
            .groupBy('contributor_name')
            .orderBy('total_speaking_seconds', 'desc')
            .limit(10);
        // ── Recent Insights (Last 30 days) ──
        const recentMetrics = await (0, db_1.default)('meetings')
            .where({ organization_id: orgId, status: 'ended' })
            .where('actual_end', '>=', lastThirtyDays)
            .count('id as meetings_last_30_days')
            .first();
        const recentMinutes = await (0, db_1.default)('meeting_minutes')
            .join('meetings', 'meeting_minutes.meeting_id', 'meetings.id')
            .where({ 'meetings.organization_id': orgId, 'meeting_minutes.status': 'completed' })
            .where('meeting_minutes.generated_at', '>=', lastThirtyDays)
            .count('meeting_minutes.id as minutes_last_30_days')
            .first();
        // ── AI Minutes Trend (Last 6 months) ──
        const minutesTrend = await (0, db_1.default)('meeting_minutes')
            .join('meetings', 'meeting_minutes.meeting_id', 'meetings.id')
            .where({ 'meetings.organization_id': orgId, 'meeting_minutes.status': 'completed' })
            .where('meeting_minutes.generated_at', '>=', lastSixMonths)
            .select(db_1.default.raw("DATE_TRUNC('month', meeting_minutes.generated_at) as month"))
            .count('meeting_minutes.id as count')
            .sum('meeting_minutes.ai_credits_used as credits_used')
            .groupBy('month')
            .orderBy('month', 'asc');
        res.json({
            success: true,
            data: {
                overview: {
                    totalMeetings: parseInt(totalMeetings?.count) || 0,
                    meetingsWithAI: parseInt(meetingsWithAI?.count) || 0,
                    minutesGenerated: parseInt(minutesGenerated?.count) || 0,
                    totalAiCreditsUsed: parseFloat(totalAiCreditsUsed?.total || '0'),
                    avgAttendance,
                    avgDuration: parseFloat(durationStats?.avg_minutes || '0').toFixed(1),
                    maxDuration: parseFloat(durationStats?.max_minutes || '0').toFixed(1),
                    minDuration: parseFloat(durationStats?.min_minutes || '0').toFixed(1),
                },
                decisions: {
                    totalDecisions: parseInt(decisionsCount?.total_decisions || '0'),
                    totalActionItems: parseInt(actionItemsCount?.total_action_items || '0'),
                    actionItemsByPriority: priorityCounts,
                    totalMotions: parseInt(motionsCount?.total_motions || '0'),
                    avgDecisionsPerMeeting: minutesGenerated?.count
                        ? (parseInt(decisionsCount?.total_decisions || '0') / parseInt(String(minutesGenerated.count))).toFixed(1)
                        : '0',
                    avgActionItemsPerMeeting: minutesGenerated?.count
                        ? (parseInt(actionItemsCount?.total_action_items || '0') / parseInt(String(minutesGenerated.count))).toFixed(1)
                        : '0',
                },
                contributors: topContributors.map((c) => ({
                    name: c.contributor_name?.replace(/"/g, '') || 'Unknown',
                    speakingTimeMinutes: Math.round(parseInt(c.total_speaking_seconds || '0') / 60),
                })),
                trends: {
                    meetingFrequency: meetingFrequency.map((m) => ({
                        month: new Date(m.month).toISOString().slice(0, 7), // YYYY-MM format
                        count: parseInt(m.count),
                    })),
                    minutesTrend: minutesTrend.map((m) => ({
                        month: new Date(m.month).toISOString().slice(0, 7),
                        count: parseInt(m.count),
                        creditsUsed: parseFloat(m.credits_used || '0'),
                    })),
                },
                recent: {
                    meetingsLast30Days: parseInt(recentMetrics?.meetings_last_30_days) || 0,
                    minutesLast30Days: parseInt(recentMinutes?.minutes_last_30_days) || 0,
                },
            },
        });
    }
    catch (err) {
        console.error('Meeting insights error:', err);
        res.status(500).json({ success: false, error: 'Failed to load meeting insights' });
    }
});
exports.default = router;
//# sourceMappingURL=analytics.js.map