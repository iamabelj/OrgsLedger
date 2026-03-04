"use strict";
// ============================================================
// OrgsLedger API — Recurring Dues Scheduler
// Checks recurring dues and auto-generates pending transactions
// ============================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startScheduler = startScheduler;
exports.stopScheduler = stopScheduler;
const db_1 = __importDefault(require("../db"));
const logger_1 = require("../logger");
const INTERVAL_MS = 60 * 60 * 1000; // run every hour
let isRunning = false; // simple lock to prevent overlapping runs
// ── Recurrence rule parser ──────────────────────────────────
// Supports:  monthly | weekly | quarterly | yearly | biweekly
function nextOccurrence(lastDate, rule) {
    const d = new Date(lastDate);
    switch (rule.toLowerCase()) {
        case 'weekly':
            d.setDate(d.getDate() + 7);
            return d;
        case 'biweekly':
            d.setDate(d.getDate() + 14);
            return d;
        case 'monthly':
            d.setMonth(d.getMonth() + 1);
            return d;
        case 'quarterly':
            d.setMonth(d.getMonth() + 3);
            return d;
        case 'yearly':
            d.setFullYear(d.getFullYear() + 1);
            return d;
        default:
            return null;
    }
}
async function processRecurringDues() {
    try {
        const recurringDues = await (0, db_1.default)('dues')
            .where({ is_recurring: true })
            .whereNotNull('recurrence_rule')
            .select('*');
        if (!recurringDues.length)
            return;
        const now = new Date();
        const dueIds = recurringDues.map((d) => d.id);
        // Batch fetch latest transaction per due (eliminates N queries)
        const latestTransactions = await (0, db_1.default)('transactions')
            .whereIn('reference_id', dueIds)
            .where({ reference_type: 'due' })
            .select('reference_id', db_1.default.raw('MAX(created_at) as latest_created_at'))
            .groupBy('reference_id');
        const latestTxMap = new Map(latestTransactions.map((t) => [t.reference_id, new Date(t.latest_created_at)]));
        // Collect all dues that need processing and their next occurrence dates
        const duesToProcess = [];
        for (const due of recurringDues) {
            const lastDate = latestTxMap.get(due.id) || new Date(due.due_date);
            const next = nextOccurrence(lastDate, due.recurrence_rule);
            if (!next || next > now)
                continue;
            duesToProcess.push({ due, next });
        }
        if (!duesToProcess.length)
            return;
        // Batch check for existing transactions in the period (eliminates N queries)
        const periodCheckPromises = duesToProcess.map(({ due, next }) => (0, db_1.default)('transactions')
            .where({ reference_id: due.id, reference_type: 'due' })
            .andWhere('created_at', '>=', new Date(next.getTime() - 24 * 60 * 60 * 1000).toISOString())
            .select('reference_id')
            .first());
        const periodResults = await Promise.all(periodCheckPromises);
        const readyDues = duesToProcess.filter((_, i) => !periodResults[i]);
        if (!readyDues.length)
            return;
        // Gather all org IDs for membership lookups
        const orgIdsNeedingMembers = readyDues
            .filter(({ due }) => {
            if (due.target_member_ids) {
                const parsed = typeof due.target_member_ids === 'string'
                    ? JSON.parse(due.target_member_ids)
                    : due.target_member_ids;
                return !Array.isArray(parsed) || parsed.length === 0;
            }
            return true;
        })
            .map(({ due }) => due.organization_id);
        // Batch fetch memberships for all orgs that need them
        let membersByOrg = new Map();
        if (orgIdsNeedingMembers.length > 0) {
            const allMembers = await (0, db_1.default)('memberships')
                .whereIn('organization_id', [...new Set(orgIdsNeedingMembers)])
                .where({ is_active: true })
                .select('organization_id', 'user_id');
            for (const m of allMembers) {
                if (!membersByOrg.has(m.organization_id))
                    membersByOrg.set(m.organization_id, []);
                membersByOrg.get(m.organization_id).push(m.user_id);
            }
        }
        // Build all transaction and notification rows
        const allTransactions = [];
        const allNotifications = [];
        for (const { due } of readyDues) {
            let targetUserIds = [];
            if (due.target_member_ids) {
                const parsed = typeof due.target_member_ids === 'string'
                    ? JSON.parse(due.target_member_ids)
                    : due.target_member_ids;
                if (Array.isArray(parsed) && parsed.length > 0) {
                    targetUserIds = parsed;
                }
            }
            if (!targetUserIds.length) {
                targetUserIds = membersByOrg.get(due.organization_id) || [];
            }
            if (!targetUserIds.length)
                continue;
            for (const userId of targetUserIds) {
                allTransactions.push({
                    organization_id: due.organization_id,
                    user_id: userId,
                    type: 'due',
                    amount: due.amount,
                    currency: due.currency,
                    status: 'pending',
                    description: `${due.title} (recurring)`,
                    reference_id: due.id,
                    reference_type: 'due',
                });
                allNotifications.push({
                    user_id: userId,
                    organization_id: due.organization_id,
                    type: 'due_reminder',
                    title: 'Recurring Due',
                    body: `${due.title} — ${due.currency} ${due.amount} is due.`,
                    data: JSON.stringify({ dueId: due.id }),
                });
            }
            logger_1.logger.info(`Recurring due ${due.id} processed: ${targetUserIds.length} transactions created`);
        }
        // Batch insert all transactions and notifications
        if (allTransactions.length > 0)
            await (0, db_1.default)('transactions').insert(allTransactions);
        if (allNotifications.length > 0)
            await (0, db_1.default)('notifications').insert(allNotifications);
    }
    catch (err) {
        logger_1.logger.error('Recurring dues scheduler error', err);
    }
}
// ── Late-fee processor ──────────────────────────────────────
async function processLateFees() {
    try {
        const now = new Date();
        const overdueDues = await (0, db_1.default)('dues')
            .whereNotNull('late_fee_amount')
            .where('late_fee_amount', '>', 0)
            .whereNotNull('due_date')
            .select('*');
        if (!overdueDues.length)
            return;
        // Filter to dues past their grace period
        const eligibleDues = overdueDues.filter((due) => {
            const dueDate = new Date(due.due_date);
            const graceDays = due.late_fee_grace_days || 0;
            const lateDate = new Date(dueDate.getTime() + graceDays * 24 * 60 * 60 * 1000);
            return now > lateDate;
        });
        if (!eligibleDues.length)
            return;
        const dueIds = eligibleDues.map((d) => d.id);
        // Batch fetch all unpaid transactions for eligible dues
        const allUnpaid = await (0, db_1.default)('transactions')
            .whereIn('reference_id', dueIds)
            .where({ reference_type: 'due', status: 'pending' })
            .select('*');
        if (!allUnpaid.length)
            return;
        // Batch fetch all existing late fees for these dues (eliminates inner-loop query)
        const existingLateFees = await (0, db_1.default)('transactions')
            .whereIn('reference_id', dueIds)
            .where({ type: 'late_fee' })
            .select('user_id', 'reference_id');
        const lateFeeSet = new Set(existingLateFees.map((lf) => `${lf.user_id}:${lf.reference_id}`));
        // Build batch inserts
        const dueMap = new Map(eligibleDues.map((d) => [d.id, d]));
        const newLateFees = [];
        const newNotifications = [];
        for (const tx of allUnpaid) {
            const key = `${tx.user_id}:${tx.reference_id}`;
            if (lateFeeSet.has(key))
                continue; // already has late fee
            lateFeeSet.add(key); // prevent duplicate within same batch
            const due = dueMap.get(tx.reference_id);
            if (!due)
                continue;
            newLateFees.push({
                organization_id: tx.organization_id,
                user_id: tx.user_id,
                type: 'late_fee',
                amount: due.late_fee_amount,
                currency: due.currency,
                status: 'pending',
                description: `Late fee for: ${due.title}`,
                reference_id: due.id,
                reference_type: 'due',
            });
            newNotifications.push({
                user_id: tx.user_id,
                organization_id: tx.organization_id,
                type: 'due_reminder',
                title: 'Late Fee Applied',
                body: `A late fee of ${due.currency} ${due.late_fee_amount} has been applied for ${due.title}.`,
                data: JSON.stringify({ dueId: due.id }),
            });
        }
        if (newLateFees.length > 0)
            await (0, db_1.default)('transactions').insert(newLateFees);
        if (newNotifications.length > 0)
            await (0, db_1.default)('notifications').insert(newNotifications);
    }
    catch (err) {
        logger_1.logger.error('Late-fee processor error', err);
    }
}
// ── Meeting reminder processor ──────────────────────────────
async function checkMeetingReminders() {
    try {
        const now = new Date();
        const remind24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const remind1h = new Date(now.getTime() + 60 * 60 * 1000);
        const remind15m = new Date(now.getTime() + 15 * 60 * 1000);
        // Find meetings in the next 24 hours that haven't been reminded
        const upcomingMeetings = await (0, db_1.default)('meetings')
            .where('scheduled_start', '>', now.toISOString())
            .where('scheduled_start', '<=', remind24h.toISOString())
            .where('status', 'scheduled')
            .select('*');
        if (!upcomingMeetings.length)
            return;
        for (const meeting of upcomingMeetings) {
            const scheduledStart = new Date(meeting.scheduled_start);
            // Fetch org settings
            const org = await (0, db_1.default)('organizations')
                .where({ id: meeting.organization_id })
                .select('settings')
                .first();
            if (!org?.settings)
                continue;
            const settings = typeof org.settings === 'string' ? JSON.parse(org.settings) : org.settings;
            if (settings.notifications?.meetingReminders === false)
                continue;
            // Fetch attendees with email preference enabled
            const attendees = await (0, db_1.default)('meeting_attendance')
                .where({ meeting_id: meeting.id })
                .select('user_id');
            const attendeeIds = attendees.map((a) => a.user_id);
            if (!attendeeIds.length)
                continue;
            // Get user emails and their notification preferences
            const users = await (0, db_1.default)('users')
                .whereIn('id', attendeeIds)
                .select('id', 'email');
            const userEmails = users.map((u) => u.email);
            if (!userEmails.length)
                continue;
            // Check which users have email reminders enabled
            const userPrefs = await (0, db_1.default)('notification_preferences')
                .whereIn('user_id', users.map((u) => u.id))
                .select('user_id', 'email_meetings');
            const usersWithEmailEnabled = new Set();
            for (const pref of userPrefs) {
                if (pref.email_meetings !== false) {
                    usersWithEmailEnabled.add(pref.user_id);
                }
            }
            // Determine which reminder to send
            const minutesUntil = (scheduledStart.getTime() - now.getTime()) / (1000 * 60);
            let reminderType = null;
            if (minutesUntil <= 15 && minutesUntil > 0) {
                reminderType = '15min';
            }
            else if (minutesUntil <= 65 && minutesUntil > 40) {
                reminderType = '1h';
            }
            else if (minutesUntil <= 1445 && minutesUntil > 1380) {
                reminderType = '24h';
            }
            if (!reminderType)
                continue;
            // Send emails
            const emailsToSend = userEmails.filter((_, idx) => usersWithEmailEnabled.has(users[idx].id));
            if (emailsToSend.length > 0) {
                // Dynamic import to avoid circular dependency
                const { sendMeetingReminderEmail } = await Promise.resolve().then(() => __importStar(require('./email.service')));
                await sendMeetingReminderEmail(meeting.title, scheduledStart, reminderType, emailsToSend);
                logger_1.logger.info(`Meeting reminder sent (${reminderType}) for ${meeting.title} to ${emailsToSend.length} users`);
            }
        }
    }
    catch (err) {
        logger_1.logger.error('Meeting reminder checker error', err);
    }
}
// ── Due reminder processor ──────────────────────────────────
async function checkDueReminders() {
    try {
        const now = new Date();
        const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
        // Find pending transactions for dues that are coming due
        const upcomingDues = await (0, db_1.default)('transactions')
            .join('dues', 'transactions.reference_id', 'dues.id')
            .where('transactions.status', 'pending')
            .where('transactions.type', 'due')
            .where('dues.due_date', '>', now.toISOString())
            .where('dues.due_date', '<=', threeDaysFromNow.toISOString())
            .select('transactions.*', 'dues.title', 'dues.currency', 'dues.amount', 'dues.due_date');
        if (!upcomingDues.length)
            return;
        // Group by user and org to check preferences once per user
        const userReminders = new Map();
        for (const due of upcomingDues) {
            const key = `${due.user_id}:${due.organization_id}`;
            if (!userReminders.has(key))
                userReminders.set(key, []);
            userReminders.get(key).push(due);
        }
        for (const [key, dues] of userReminders.entries()) {
            const [userId, orgId] = key.split(':');
            // Check org settings
            const org = await (0, db_1.default)('organizations')
                .where({ id: orgId })
                .select('settings')
                .first();
            if (!org?.settings)
                continue;
            const settings = typeof org.settings === 'string' ? JSON.parse(org.settings) : org.settings;
            if (settings.notifications?.dueReminders === false)
                continue;
            // Check user preference
            const userPref = await (0, db_1.default)('notification_preferences')
                .where({ user_id: userId })
                .select('email_finances')
                .first();
            if (userPref?.email_finances === false)
                continue;
            // Get user email
            const user = await (0, db_1.default)('users').where({ id: userId }).select('email').first();
            if (!user?.email)
                continue;
            // Send reminder for first due (most urgent)
            const mostUrgent = dues.reduce((a, b) => new Date(a.due_date).getTime() < new Date(b.due_date).getTime() ? a : b);
            const { sendDueReminderEmail } = await Promise.resolve().then(() => __importStar(require('./email.service')));
            await sendDueReminderEmail(mostUrgent.title, mostUrgent.amount, mostUrgent.currency, new Date(mostUrgent.due_date), user.email);
            logger_1.logger.info(`Due reminder sent for "${mostUrgent.title}" to ${user.email}`);
        }
    }
    catch (err) {
        logger_1.logger.error('Due reminder checker error', err);
    }
}
// ── 30-Day No-Signin Check (Mobile Users) ────────────────
// Deactivates users on mobile devices who haven't signed in for 30+ days
// This prevents stale tokens from being used indefinitely
async function checkNoSigninPurge() {
    try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        // Find all users who last signed in 30+ days ago
        const expiredSessions = await (0, db_1.default)('users')
            .where({ is_active: true })
            .andWhere(db_1.default.raw('DATE(last_signin_at) < ?', [thirtyDaysAgo.toISOString().split('T')[0]]))
            .whereNull('deleted_at')
            .select('id', 'email', 'last_signin_at');
        if (expiredSessions.length === 0) {
            logger_1.logger.debug('[SCHEDULER] No users expired by 30-day no-signin rule');
            return;
        }
        const userIds = expiredSessions.map((u) => u.id);
        // Deactivate these users (preserves data, but forces re-login)
        const result = await (0, db_1.default)('users')
            .whereIn('id', userIds)
            .update({
            is_active: false,
            deactivation_reason: 'Automatic: No sign-in for 30+ days',
            deactivated_at: db_1.default.fn.now(),
        });
        logger_1.logger.info('[SCHEDULER] Deactivated users due to 30-day no-signin rule', {
            count: result,
            userIds: userIds.slice(0, 5), // Log first 5 for debugging
        });
        // Log audit trail for each deactivated user
        const auditEntries = expiredSessions.map((user) => ({
            user_id: user.id,
            action: 'deactivate',
            entity_type: 'user',
            entity_id: user.id,
            old_value: { is_active: true },
            new_value: { is_active: false, reason: 'No sign-in for 30+ days' },
            ip_address: '127.0.0.1', // System action
            user_agent: 'OrgsLedger Scheduler',
            created_at: db_1.default.fn.now(),
        }));
        if (auditEntries.length > 0) {
            await (0, db_1.default)('audit_logs').insert(auditEntries);
        }
    }
    catch (err) {
        logger_1.logger.error('[SCHEDULER] No-signin purge error', err);
    }
}
let intervalHandle = null;
function startScheduler() {
    logger_1.logger.info('Starting scheduler (interval: 1h)');
    const runCycle = async () => {
        if (isRunning) {
            logger_1.logger.warn('Scheduler: previous cycle still running, skipping');
            return;
        }
        isRunning = true;
        try {
            await processRecurringDues();
            await processLateFees();
            await checkMeetingReminders();
            await checkDueReminders();
            await checkNoSigninPurge();
        }
        finally {
            isRunning = false;
        }
    };
    // Run once on start (after 10s delay)
    setTimeout(runCycle, 10_000);
    intervalHandle = setInterval(runCycle, INTERVAL_MS);
}
function stopScheduler() {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
        logger_1.logger.info('Scheduler stopped');
    }
}
//# sourceMappingURL=scheduler.service.js.map