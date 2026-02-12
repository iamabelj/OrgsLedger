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

    for (const due of recurringDues) {
      // Find the most recent transaction created for this due
      const lastTransaction = await db('transactions')
        .where({ reference_id: due.id, reference_type: 'due' })
        .orderBy('created_at', 'desc')
        .first();

      const lastDate = lastTransaction
        ? new Date(lastTransaction.created_at)
        : new Date(due.due_date);

      const next = nextOccurrence(lastDate, due.recurrence_rule);
      if (!next || next > now) continue; // not yet time

      // Check if we already generated transactions for this period
      const existingForPeriod = await db('transactions')
        .where({ reference_id: due.id, reference_type: 'due' })
        .andWhere('created_at', '>=', new Date(next.getTime() - 24 * 60 * 60 * 1000).toISOString())
        .first();

      if (existingForPeriod) continue; // already processed

      // Determine target members
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
        targetUserIds = await db('memberships')
          .where({ organization_id: due.organization_id, is_active: true })
          .pluck('user_id');
      }

      if (!targetUserIds.length) continue;

      // Create new pending transactions
      const newDueDate = next.toISOString();
      const transactions = targetUserIds.map((userId: string) => ({
        organization_id: due.organization_id,
        user_id: userId,
        type: 'due',
        amount: due.amount,
        currency: due.currency,
        status: 'pending',
        description: `${due.title} (recurring)`,
        reference_id: due.id,
        reference_type: 'due',
      }));
      await db('transactions').insert(transactions);

      // Send notifications
      const notifications = targetUserIds.map((userId: string) => ({
        user_id: userId,
        organization_id: due.organization_id,
        type: 'due_reminder',
        title: 'Recurring Due',
        body: `${due.title} — ${due.currency} ${due.amount} is due.`,
        data: JSON.stringify({ dueId: due.id }),
      }));
      await db('notifications').insert(notifications);

      logger.info(`Recurring due ${due.id} processed: ${targetUserIds.length} transactions created`);
    }
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

    for (const due of overdueDues) {
      const dueDate = new Date(due.due_date);
      const graceDays = due.late_fee_grace_days || 0;
      const lateDate = new Date(dueDate.getTime() + graceDays * 24 * 60 * 60 * 1000);

      if (now <= lateDate) continue;

      // Find pending (unpaid) transactions for this due
      const unpaid = await db('transactions')
        .where({ reference_id: due.id, reference_type: 'due', status: 'pending' })
        .select('*');

      for (const tx of unpaid) {
        // Check if late fee already applied
        const existingLateFee = await db('transactions')
          .where({
            user_id: tx.user_id,
            reference_id: due.id,
            type: 'late_fee',
          })
          .first();
        if (existingLateFee) continue;

        await db('transactions').insert({
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

        await db('notifications').insert({
          user_id: tx.user_id,
          organization_id: tx.organization_id,
          type: 'due_reminder',
          title: 'Late Fee Applied',
          body: `A late fee of ${due.currency} ${due.late_fee_amount} has been applied for ${due.title}.`,
          data: JSON.stringify({ dueId: due.id }),
        });
      }
    }
  } catch (err) {
    logger.error('Late-fee processor error', err);
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startScheduler() {
  logger.info('Starting recurring dues scheduler (interval: 1h)');

  const runCycle = async () => {
    if (isRunning) {
      logger.warn('Scheduler: previous cycle still running, skipping');
      return;
    }
    isRunning = true;
    try {
      await processRecurringDues();
      await processLateFees();
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
