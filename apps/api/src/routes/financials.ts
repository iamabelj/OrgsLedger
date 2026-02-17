// ============================================================
// OrgsLedger API — Financial Management Routes
// Dues, Fines, Donations, Transactions, Ledger
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import db from '../db';
import { authenticate, loadMembershipAndSub as loadMembership, requireRole, validate } from '../middleware';
import { logger } from '../logger';
import { emitFinancialUpdate } from '../socket';
import { sendPushToUser, sendPushToOrg } from '../services/push.service';

const router = Router();

// ── Schemas ─────────────────────────────────────────────────
const createDueSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  amount: z.number().positive(),
  currency: z.string().length(3).default('USD'),
  dueDate: z.string().datetime(),
  lateFeeAmount: z.number().min(0).optional(),
  lateFeeGraceDays: z.number().int().min(0).optional(),
  isRecurring: z.boolean().default(false),
  recurrenceRule: z.string().optional(),
  targetMemberIds: z.array(z.string().uuid()).default([]),
});

const createFineSchema = z.object({
  userId: z.string().uuid(),
  type: z.enum(['misconduct', 'late_payment', 'absence', 'other']),
  amount: z.number().positive(),
  currency: z.string().length(3).default('USD'),
  reason: z.string().min(1).max(2000),
});

const createDonationCampaignSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  goalAmount: z.number().positive().optional(),
  currency: z.string().length(3).default('USD'),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
});

const makeDonationSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3).default('USD'),
  campaignId: z.string().uuid().optional(),
  isAnonymous: z.boolean().default(false),
  message: z.string().max(1000).optional(),
});

// ══════════════════════════════════════════════════════════════
// DUES
// ══════════════════════════════════════════════════════════════

router.post(
  '/:orgId/dues',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  validate(createDueSchema),
  async (req: Request, res: Response) => {
    try {
      const data = req.body;

      // Wrap due + transactions + notifications in a single transaction
      const due = await db.transaction(async (trx) => {
        const [due] = await trx('dues')
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
            created_by: req.user!.userId,
          })
          .returning('*');

        // Create pending transactions for targeted members
        let targetUserIds = data.targetMemberIds;
        if (!targetUserIds.length) {
          targetUserIds = await trx('memberships')
            .where({ organization_id: req.params.orgId, is_active: true })
            .pluck('user_id');
        }

        const transactions = targetUserIds.map((userId: string) => ({
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
        await trx('transactions').insert(transactions);

        // Notify members
        const notifications = targetUserIds.map((userId: string) => ({
          user_id: userId,
          organization_id: req.params.orgId,
          type: 'due_reminder',
          title: 'New Due Created',
          body: `${data.title} — ${data.currency} ${data.amount} due by ${new Date(data.dueDate).toLocaleDateString()}`,
          data: JSON.stringify({ dueId: due.id }),
        }));
        await trx('notifications').insert(notifications);

        return due;
      });

      // Push notification for new due
      sendPushToOrg(req.params.orgId, {
        title: 'New Due Created',
        body: `${data.title} — ${data.currency} ${data.amount} due by ${new Date(data.dueDate).toLocaleDateString()}`,
        data: { dueId: due.id, type: 'due_reminder' },
      }, req.user!.userId).catch(err => logger.warn('Push notification failed (new due)', err));

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'create',
        entityType: 'due',
        entityId: due.id,
        newValue: { title: data.title, amount: data.amount },
      });

      // Emit real-time financial update
      const io = req.app.get('io');
      if (io) {
        emitFinancialUpdate(io, req.params.orgId, {
          type: 'due_created',
          dueId: due.id,
          title: data.title,
          amount: data.amount,
          currency: data.currency,
        });
      }

      res.status(201).json({ success: true, data: due });
    } catch (err) {
      logger.error('Create due error', err);
      res.status(500).json({ success: false, error: 'Failed to create due' });
    }
  }
);

router.get(
  '/:orgId/dues',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
      const offset = (page - 1) * limit;

      const dues = await db('dues')
        .where({ organization_id: req.params.orgId })
        .orderBy('due_date', 'desc')
        .limit(limit)
        .offset(offset);

      // Batch: payment stats for all dues in one query (GROUP BY)
      let enriched = dues;
      if (dues.length) {
        const dueIds = dues.map((d: any) => d.id);
        const allStats = await db('transactions')
          .whereIn('reference_id', dueIds)
          .where({ reference_type: 'due' })
          .select(
            'reference_id',
            db.raw("count(*) filter (where status = 'completed') as paid_count"),
            db.raw("count(*) filter (where status = 'pending') as pending_count"),
            db.raw("coalesce(sum(amount) filter (where status = 'completed'), 0) as total_collected")
          )
          .groupBy('reference_id');

        const statsMap: Record<string, any> = {};
        allStats.forEach((s: any) => { statsMap[s.reference_id] = s; });

        enriched = dues.map((d: any) => {
          const stats = statsMap[d.id] || { paid_count: 0, pending_count: 0, total_collected: 0 };
          return { ...d, ...stats };
        });
      }

      res.json({ success: true, data: enriched });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to list dues' });
    }
  }
);

// ══════════════════════════════════════════════════════════════
// FINES
// ══════════════════════════════════════════════════════════════

router.post(
  '/:orgId/fines',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  validate(createFineSchema),
  async (req: Request, res: Response) => {
    try {
      const data = req.body;

      // Verify target user is a member
      const membership = await db('memberships')
        .where({ user_id: data.userId, organization_id: req.params.orgId, is_active: true })
        .first();
      if (!membership) {
        res.status(404).json({ success: false, error: 'User is not an active member' });
        return;
      }

      // Wrap fine + transaction + notification in a single transaction
      const fine = await db.transaction(async (trx) => {
        const [fine] = await trx('fines')
          .insert({
            organization_id: req.params.orgId,
            user_id: data.userId,
            type: data.type,
            amount: data.amount,
            currency: data.currency,
            reason: data.reason,
            issued_by: req.user!.userId,
            status: 'unpaid',
          })
          .returning('*');

        // Create pending transaction
        await trx('transactions').insert({
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
        await trx('notifications').insert({
          user_id: data.userId,
          organization_id: req.params.orgId,
          type: 'fine',
          title: 'Fine Issued',
          body: `You have been fined ${data.currency} ${data.amount}: ${data.reason}`,
          data: JSON.stringify({ fineId: fine.id }),
        });

        return fine;
      });

      // Push notification for fine
      sendPushToUser(data.userId, {
        title: 'Fine Issued',
        body: `You have been fined ${data.currency} ${data.amount}: ${data.reason}`,
        data: { fineId: fine.id, type: 'fine' },
      }).catch(err => logger.warn('Push notification failed (fine issued)', err));

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'create',
        entityType: 'fine',
        entityId: fine.id,
        newValue: { userId: data.userId, amount: data.amount, type: data.type, reason: data.reason },
      });

      // Emit real-time financial update
      const io = req.app.get('io');
      if (io) {
        emitFinancialUpdate(io, req.params.orgId, {
          type: 'fine_created',
          fineId: fine.id,
          userId: data.userId,
          amount: data.amount,
          currency: data.currency,
        });
      }

      res.status(201).json({ success: true, data: fine });
    } catch (err) {
      logger.error('Create fine error', err);
      res.status(500).json({ success: false, error: 'Failed to create fine' });
    }
  }
);

router.get(
  '/:orgId/fines',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      let query = db('fines')
        .join('users as fined_user', 'fines.user_id', 'fined_user.id')
        .join('users as issuer', 'fines.issued_by', 'issuer.id')
        .where({ 'fines.organization_id': req.params.orgId })
        .select(
          'fines.*',
          'fined_user.first_name as finedFirstName',
          'fined_user.last_name as finedLastName',
          'issuer.first_name as issuerFirstName',
          'issuer.last_name as issuerLastName'
        );

      // Non-admins see only their own fines
      if (req.membership?.role === 'member' || req.membership?.role === 'guest') {
        query = query.where({ 'fines.user_id': req.user!.userId });
      }

      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
      const offset = (page - 1) * limit;

      const fines = await query.orderBy('fines.created_at', 'desc').limit(limit).offset(offset);
      res.json({ success: true, data: fines, meta: { page, limit } });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to list fines' });
    }
  }
);

// ══════════════════════════════════════════════════════════════
// DONATIONS
// ══════════════════════════════════════════════════════════════

router.post(
  '/:orgId/donation-campaigns',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  validate(createDonationCampaignSchema),
  async (req: Request, res: Response) => {
    try {
      const data = req.body;
      const [campaign] = await db('donation_campaigns')
        .insert({
          organization_id: req.params.orgId,
          title: data.title,
          description: data.description || null,
          goal_amount: data.goalAmount || null,
          currency: data.currency,
          start_date: data.startDate,
          end_date: data.endDate || null,
          created_by: req.user!.userId,
        })
        .returning('*');

      res.status(201).json({ success: true, data: campaign });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to create campaign' });
    }
  }
);

router.get(
  '/:orgId/donation-campaigns',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
      const offset = (page - 1) * limit;

      const campaigns = await db('donation_campaigns')
        .where({ organization_id: req.params.orgId })
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset);

      // Batch: donation stats for all campaigns in one query (GROUP BY)
      let enriched = campaigns;
      if (campaigns.length) {
        const campaignIds = campaigns.map((c: any) => c.id);
        const allStats = await db('donations')
          .whereIn('campaign_id', campaignIds)
          .where({ status: 'completed' })
          .select(
            'campaign_id',
            db.raw('count(*) as donation_count'),
            db.raw('coalesce(sum(amount), 0) as total_raised')
          )
          .groupBy('campaign_id');

        const statsMap: Record<string, any> = {};
        allStats.forEach((s: any) => { statsMap[s.campaign_id] = s; });

        enriched = campaigns.map((c: any) => {
          const stats = statsMap[c.id] || { donation_count: 0, total_raised: 0 };
          return { ...c, ...stats };
        });
      }

      res.json({ success: true, data: enriched, meta: { page, limit } });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to list campaigns' });
    }
  }
);

router.post(
  '/:orgId/donations',
  authenticate,
  loadMembership,
  validate(makeDonationSchema),
  async (req: Request, res: Response) => {
    try {
      const data = req.body;

      const [donation] = await db('donations')
        .insert({
          organization_id: req.params.orgId,
          user_id: data.isAnonymous ? null : req.user!.userId,
          campaign_id: data.campaignId || null,
          amount: data.amount,
          currency: data.currency,
          is_anonymous: data.isAnonymous,
          message: data.message || null,
          status: 'pending',
        })
        .returning('*');

      // Create transaction
      await db('transactions').insert({
        organization_id: req.params.orgId,
        user_id: data.isAnonymous ? null : req.user!.userId,
        type: 'donation',
        amount: data.amount,
        currency: data.currency,
        status: 'pending',
        description: `Donation${data.campaignId ? ' to campaign' : ''}`,
        reference_id: donation.id,
        reference_type: 'donation',
      });

      res.status(201).json({ success: true, data: donation });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to make donation' });
    }
  }
);

// ══════════════════════════════════════════════════════════════
// ORGANIZATION LEDGER (REAL-TIME FINANCIAL RECORDS)
// ══════════════════════════════════════════════════════════════

router.get(
  '/:orgId/ledger',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const type = req.query.type as string;
      const status = req.query.status as string;
      const userId = req.query.userId as string;
      const fromDate = req.query.from as string;
      const toDate = req.query.to as string;

      let query = db('transactions')
        .leftJoin('users', 'transactions.user_id', 'users.id')
        .where({ 'transactions.organization_id': req.params.orgId })
        .select(
          'transactions.*',
          'users.first_name',
          'users.last_name',
          'users.email'
        );

      if (type) query = query.where({ 'transactions.type': type });
      if (status) query = query.where({ 'transactions.status': status });
      if (userId) query = query.where({ 'transactions.user_id': userId });
      if (fromDate) query = query.where('transactions.created_at', '>=', fromDate);
      if (toDate) query = query.where('transactions.created_at', '<=', toDate);

      const total = await query.clone().clear('select').count('transactions.id as count').first();

      const transactions = await query
        .orderBy('transactions.created_at', 'desc')
        .offset((page - 1) * limit)
        .limit(limit);

      // Summary totals
      const summary = await db('transactions')
        .where({ organization_id: req.params.orgId, status: 'completed' })
        .select(
          db.raw("coalesce(sum(amount) filter (where type = 'due'), 0) as total_dues_collected"),
          db.raw("coalesce(sum(amount) filter (where type in ('fine', 'misconduct_fine', 'late_fee')), 0) as total_fines_collected"),
          db.raw("coalesce(sum(amount) filter (where type = 'donation'), 0) as total_donations"),
          db.raw("coalesce(sum(amount) filter (where type = 'refund'), 0) as total_refunds"),
          db.raw("coalesce(sum(amount), 0) as grand_total")
        )
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
          total: parseInt(total?.count as string) || 0,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get ledger' });
    }
  }
);

// ── Per-User Payment History ────────────────────────────────
router.get(
  '/:orgId/ledger/user/:userId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      // Members can only see their own unless admin
      if (
        req.params.userId !== req.user!.userId &&
        req.membership?.role !== 'org_admin' &&
        req.membership?.role !== 'executive'
      ) {
        res.status(403).json({ success: false, error: 'Can only view your own payment history' });
        return;
      }

      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
      const offset = (page - 1) * limit;

      const transactions = await db('transactions')
        .where({
          organization_id: req.params.orgId,
          user_id: req.params.userId,
        })
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset);

      const outstanding = await db('transactions')
        .where({
          organization_id: req.params.orgId,
          user_id: req.params.userId,
          status: 'pending',
        })
        .select(db.raw('coalesce(sum(amount), 0) as total_outstanding'))
        .first();

      const paid = await db('transactions')
        .where({
          organization_id: req.params.orgId,
          user_id: req.params.userId,
          status: 'completed',
        })
        .select(db.raw('coalesce(sum(amount), 0) as total_paid'))
        .first();

      res.json({
        success: true,
        data: {
          transactions,
          totalOutstanding: outstanding?.total_outstanding || 0,
          totalPaid: paid?.total_paid || 0,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get user payment history' });
    }
  }
);

// ── Export Financial Report ─────────────────────────────────
router.get(
  '/:orgId/ledger/export',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  async (req: Request, res: Response) => {
    try {
      const fromDate = req.query.from as string;
      const toDate = req.query.to as string;

      let query = db('transactions')
        .leftJoin('users', 'transactions.user_id', 'users.id')
        .where({ 'transactions.organization_id': req.params.orgId })
        .select(
          'transactions.id',
          'transactions.type',
          'transactions.amount',
          'transactions.currency',
          'transactions.status',
          'transactions.description',
          'transactions.created_at',
          'users.first_name',
          'users.last_name',
          'users.email'
        )
        .orderBy('transactions.created_at', 'asc');

      if (fromDate) query = query.where('transactions.created_at', '>=', fromDate);
      if (toDate) query = query.where('transactions.created_at', '<=', toDate);

      const transactions = await query.limit(50000);

      // Generate CSV — properly escape fields
      const escapeCSV = (val: any): string => {
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
          return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      };

      const headers = 'ID,Type,Amount,Currency,Status,Description,Date,First Name,Last Name,Email\n';
      const rows = transactions
        .map(
          (t: any) =>
            [t.id, t.type, t.amount, t.currency, t.status, t.description, t.created_at, t.first_name, t.last_name, t.email]
              .map(escapeCSV)
              .join(',')
        )
        .join('\n');

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'export',
        entityType: 'financial_report',
        entityId: req.params.orgId,
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=ledger_${req.params.orgId}.csv`);
      res.send(headers + rows);
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to export report' });
    }
  }
);

export default router;
