// ============================================================
// OrgsLedger API — Expenses Routes
// ============================================================

import { Router, Request, Response } from 'express';
import { db } from '../db';
import { authenticate, loadMembership, requireRole } from '../middleware';

const router = Router();

// ── List Expenses ───────────────────────────────────────────
router.get(
  '/:orgId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const status = req.query.status as string;
      const category = req.query.category as string;

      let query = db('expenses')
        .where({ organization_id: req.params.orgId })
        .select('*');

      if (status) query = query.where({ status });
      if (category) query = query.where({ category });

      const total = await query.clone().clear('select').count('id as count').first();
      const expenses = await query
        .orderBy('created_at', 'desc')
        .offset((page - 1) * limit)
        .limit(limit);

      res.json({
        success: true,
        data: expenses,
        meta: {
          page,
          limit,
          total: parseInt(total?.count as string) || 0,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to list expenses' });
    }
  }
);

// ── Get Expense ─────────────────────────────────────────────
router.get(
  '/:orgId/:expenseId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const expense = await db('expenses')
        .where({ id: req.params.expenseId, organization_id: req.params.orgId })
        .first();

      if (!expense) {
        res.status(404).json({ success: false, error: 'Expense not found' });
        return;
      }

      res.json({ success: true, data: expense });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get expense' });
    }
  }
);

// ── Create Expense ──────────────────────────────────────────
router.post(
  '/:orgId',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  async (req: Request, res: Response) => {
    try {
      const { title, description, amount, category, date, receipt_url } = req.body;

      if (!title || !amount) {
        res.status(400).json({ success: false, error: 'Title and amount are required' });
        return;
      }

      const [expense] = await db('expenses')
        .insert({
          organization_id: req.params.orgId,
          title,
          description: description || null,
          amount: parseFloat(amount),
          category: category || 'general',
          date: date || new Date().toISOString(),
          receipt_url: receipt_url || null,
          created_by: req.user!.userId,
          status: 'approved',
        })
        .returning('*');

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'create',
        entityType: 'expense',
        entityId: expense.id,
        newValue: { title, amount, category },
      });

      res.status(201).json({ success: true, data: expense });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to create expense' });
    }
  }
);

// ── Update Expense ──────────────────────────────────────────
router.put(
  '/:orgId/:expenseId',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive', 'treasurer'),
  async (req: Request, res: Response) => {
    try {
      const { title, description, amount, category, date, status, receipt_url } = req.body;

      const existing = await db('expenses')
        .where({ id: req.params.expenseId, organization_id: req.params.orgId })
        .first();

      if (!existing) {
        res.status(404).json({ success: false, error: 'Expense not found' });
        return;
      }

      const updates: Record<string, any> = {};
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (amount !== undefined) updates.amount = parseFloat(amount);
      if (category !== undefined) updates.category = category;
      if (date !== undefined) updates.date = date;
      if (status !== undefined) updates.status = status;
      if (receipt_url !== undefined) updates.receipt_url = receipt_url;
      updates.updated_at = new Date().toISOString();

      const [updated] = await db('expenses')
        .where({ id: req.params.expenseId })
        .update(updates)
        .returning('*');

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'update',
        entityType: 'expense',
        entityId: req.params.expenseId,
        previousValue: existing,
        newValue: updates,
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to update expense' });
    }
  }
);

// ── Delete Expense ──────────────────────────────────────────
router.delete(
  '/:orgId/:expenseId',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive', 'treasurer'),
  async (req: Request, res: Response) => {
    try {
      const expense = await db('expenses')
        .where({ id: req.params.expenseId, organization_id: req.params.orgId })
        .first();

      if (!expense) {
        res.status(404).json({ success: false, error: 'Expense not found' });
        return;
      }

      await db('expenses').where({ id: req.params.expenseId }).delete();

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'delete',
        entityType: 'expense',
        entityId: req.params.expenseId,
      });

      res.json({ success: true, message: 'Expense deleted' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to delete expense' });
    }
  }
);

export default router;
