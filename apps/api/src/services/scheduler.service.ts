// ============================================================
// OrgsLedger API — Recurring Dues Scheduler
// Checks recurring dues and auto-generates pending transactions
// ============================================================

import db from '../db';
import { logger } from '../logger';

const INTERVAL_MS = 60 * 60 * 1000; // run every hour
let isRunning = false; // simple lock to prevent overlapping runs

// ── Recurrence rule parser ──────────────────────────────────
// Supports:  monthly | weekly | quarterly | yearly | biweekly
function nextOccurrence(lastDate: Date, rule: string): Date | null {
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
    const recurringDues = await db('dues')
      .where({ is_recurring: true })
      .whereNotNull('recurrence_rule')
      .select('*');

    if (!recurringDues.length) return;

    const now = new Date();
    const dueIds = recurringDues.map((d: any) => d.id);

    // Batch fetch latest transaction per due (eliminates N queries)
    const latestTransactions = await db('transactions')
      .whereIn('reference_id', dueIds)
      .where({ reference_type: 'due' })
      .select('reference_id', db.raw('MAX(created_at) as latest_created_at'))
      .groupBy('reference_id');
    const latestTxMap = new Map(latestTransactions.map((t: any) => [t.reference_id, new Date(t.latest_created_at)]));

    // Collect all dues that need processing and their next occurrence dates
    const duesToProcess: Array<{ due: any; next: Date }> = [];
    for (const due of recurringDues) {
      const lastDate = latestTxMap.get(due.id) || new Date(due.due_date);
      const next = nextOccurrence(lastDate, due.recurrence_rule);
      if (!next || next > now) continue;
      duesToProcess.push({ due, next });
    }

    if (!duesToProcess.length) return;

    // Batch check for existing transactions in the period (eliminates N queries)
    const periodCheckPromises = duesToProcess.map(({ due, next }) =>
      db('transactions')
        .where({ reference_id: due.id, reference_type: 'due' })
        .andWhere('created_at', '>=', new Date(next.getTime() - 24 * 60 * 60 * 1000).toISOString())
        .select('reference_id')
        .first()
    );
    const periodResults = await Promise.all(periodCheckPromises);

    const readyDues = duesToProcess.filter((_, i) => !periodResults[i]);
    if (!readyDues.length) return;

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
    let membersByOrg = new Map<string, string[]>();
    if (orgIdsNeedingMembers.length > 0) {
      const allMembers = await db('memberships')
        .whereIn('organization_id', [...new Set(orgIdsNeedingMembers)])
        .where({ is_active: true })
        .select('organization_id', 'user_id');
      for (const m of allMembers) {
        if (!membersByOrg.has(m.organization_id)) membersByOrg.set(m.organization_id, []);
        membersByOrg.get(m.organization_id)!.push(m.user_id);
      }
    }

    // Build all transaction and notification rows
    const allTransactions: any[] = [];
    const allNotifications: any[] = [];

    for (const { due } of readyDues) {
      let targetUserIds: string[] = [];
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
      if (!targetUserIds.length) continue;

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

      logger.info(`Recurring due ${due.id} processed: ${targetUserIds.length} transactions created`);
    }

    // Batch insert all transactions and notifications
    if (allTransactions.length > 0) await db('transactions').insert(allTransactions);
    if (allNotifications.length > 0) await db('notifications').insert(allNotifications);
  } catch (err) {
    logger.error('Recurring dues scheduler error', err);
  }
}

// ── Late-fee processor ──────────────────────────────────────
async function processLateFees() {
  try {
    const now = new Date();
    const overdueDues = await db('dues')
      .whereNotNull('late_fee_amount')
      .where('late_fee_amount', '>', 0)
      .whereNotNull('due_date')
      .select('*');

    if (!overdueDues.length) return;

    // Filter to dues past their grace period
    const eligibleDues = overdueDues.filter((due: any) => {
      const dueDate = new Date(due.due_date);
      const graceDays = due.late_fee_grace_days || 0;
      const lateDate = new Date(dueDate.getTime() + graceDays * 24 * 60 * 60 * 1000);
      return now > lateDate;
    });

    if (!eligibleDues.length) return;

    const dueIds = eligibleDues.map((d: any) => d.id);

    // Batch fetch all unpaid transactions for eligible dues
    const allUnpaid = await db('transactions')
      .whereIn('reference_id', dueIds)
      .where({ reference_type: 'due', status: 'pending' })
      .select('*');

    if (!allUnpaid.length) return;

    // Batch fetch all existing late fees for these dues (eliminates inner-loop query)
    const existingLateFees = await db('transactions')
      .whereIn('reference_id', dueIds)
      .where({ type: 'late_fee' })
      .select('user_id', 'reference_id');
    const lateFeeSet = new Set(existingLateFees.map((lf: any) => `${lf.user_id}:${lf.reference_id}`));

    // Build batch inserts
    const dueMap = new Map(eligibleDues.map((d: any) => [d.id, d]));
    const newLateFees: any[] = [];
    const newNotifications: any[] = [];

    for (const tx of allUnpaid) {
      const key = `${tx.user_id}:${tx.reference_id}`;
      if (lateFeeSet.has(key)) continue; // already has late fee
      lateFeeSet.add(key); // prevent duplicate within same batch

      const due = dueMap.get(tx.reference_id);
      if (!due) continue;

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

    if (newLateFees.length > 0) await db('transactions').insert(newLateFees);
    if (newNotifications.length > 0) await db('notifications').insert(newNotifications);
  } catch (err) {
    logger.error('Late-fee processor error', err);
  }
}

// ── Due reminder processor ──────────────────────────────────
async function checkDueReminders() {
  try {
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    // Find pending transactions for dues that are coming due
    const upcomingDues = await db('transactions')
      .join('dues', 'transactions.reference_id', 'dues.id')
      .where('transactions.status', 'pending')
      .where('transactions.type', 'due')
      .where('dues.due_date', '>', now.toISOString())
      .where('dues.due_date', '<=', threeDaysFromNow.toISOString())
      .select('transactions.*', 'dues.title', 'dues.currency', 'dues.amount', 'dues.due_date');

    if (!upcomingDues.length) return;

    // Group by user and org to check preferences once per user
    const userReminders: Map<string, typeof upcomingDues> = new Map();
    for (const due of upcomingDues) {
      const key = `${due.user_id}:${due.organization_id}`;
      if (!userReminders.has(key)) userReminders.set(key, []);
      userReminders.get(key)!.push(due);
    }

    for (const [key, dues] of userReminders.entries()) {
      const [userId, orgId] = key.split(':');

      // Check org settings
      const org = await db('organizations')
        .where({ id: orgId })
        .select('settings')
        .first();

      if (!org?.settings) continue;
      const settings = typeof org.settings === 'string' ? JSON.parse(org.settings) : org.settings;
      if (settings.notifications?.dueReminders === false) continue;

      // Check user preference
      const userPref = await db('notification_preferences')
        .where({ user_id: userId })
        .select('email_finances')
        .first();

      if (userPref?.email_finances === false) continue;

      // Get user email
      const user = await db('users').where({ id: userId }).select('email').first();
      if (!user?.email) continue;

      // Send reminder for first due (most urgent)
      const mostUrgent = dues.reduce((a, b) => 
        new Date(a.due_date).getTime() < new Date(b.due_date).getTime() ? a : b
      );

      const { sendDueReminderEmail } = await import('./email.service');
      await sendDueReminderEmail(
        mostUrgent.title,
        mostUrgent.amount,
        mostUrgent.currency,
        new Date(mostUrgent.due_date),
        user.email
      );

      logger.info(`Due reminder sent for "${mostUrgent.title}" to ${user.email}`);
    }
  } catch (err) {
    logger.error('Due reminder checker error', err);
  }
}

// ── 30-Day No-Signin Check (Mobile Users) ────────────────
// Deactivates users on mobile devices who haven't signed in for 30+ days
// This prevents stale tokens from being used indefinitely
async function checkNoSigninPurge() {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Find all users who last signed in 30+ days ago
    const expiredSessions = await db('users')
      .where({ is_active: true })
      .andWhere(db.raw('DATE(last_login_at) < ?', [thirtyDaysAgo.toISOString().split('T')[0]]))
      .whereNull('deleted_at')
      .select('id', 'email', 'last_login_at');

    if (expiredSessions.length === 0) {
      logger.debug('[SCHEDULER] No users expired by 30-day no-signin rule');
      return;
    }

    const userIds = expiredSessions.map((u: any) => u.id);

    // Deactivate these users (preserves data, but forces re-login)
    const result = await db('users')
      .whereIn('id', userIds)
      .update({
        is_active: false,
        deactivation_reason: 'Automatic: No sign-in for 30+ days',
        deactivated_at: db.fn.now(),
      });

    logger.info('[SCHEDULER] Deactivated users due to 30-day no-signin rule', {
      count: result,
      userIds: userIds.slice(0, 5),  // Log first 5 for debugging
    });

    // Log audit trail for each deactivated user
    const auditEntries = expiredSessions.map((user: any) => ({
      user_id: user.id,
      action: 'deactivate',
      entity_type: 'user',
      entity_id: user.id,
      old_value: { is_active: true },
      new_value: { is_active: false, reason: 'No sign-in for 30+ days' },
      ip_address: '127.0.0.1',  // System action
      user_agent: 'OrgsLedger Scheduler',
      created_at: db.fn.now(),
    }));

    if (auditEntries.length > 0) {
      await db('audit_logs').insert(auditEntries);
    }
  } catch (err) {
    logger.error('[SCHEDULER] No-signin purge error', err);
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startScheduler() {
  logger.info('Starting scheduler (interval: 1h)');

  const runCycle = async () => {
    if (isRunning) {
      logger.warn('Scheduler: previous cycle still running, skipping');
      return;
    }
    isRunning = true;
    try {
      await processRecurringDues();
      await processLateFees();
      await checkDueReminders();
      await checkNoSigninPurge();
    } finally {
      isRunning = false;
    }
  };

  // Run once on start (after 10s delay)
  setTimeout(runCycle, 10_000);

  intervalHandle = setInterval(runCycle, INTERVAL_MS);
}

export function stopScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('Scheduler stopped');
  }
}
