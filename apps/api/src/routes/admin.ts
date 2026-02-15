// ============================================================
// OrgsLedger API — Platform Admin Routes
// Subscription plan management, feature toggles, analytics
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import db from '../db';
import { authenticate, requireDeveloper, validate } from '../middleware';
import { logger } from '../logger';

const router = Router();

// ── Schemas ─────────────────────────────────────────────────
const updatePlanSchema = z.object({
  maxMembers: z.number().int().min(1).optional(),
  features: z.record(z.boolean()).optional(),
  priceUsdAnnual: z.number().min(0).optional(),
  priceUsdMonthly: z.number().min(0).optional(),
  priceNgnAnnual: z.number().min(0).optional(),
  priceNgnMonthly: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
  description: z.string().optional(),
});
const updateConfigSchema = z.object({
  key: z.string().min(1),
  value: z.any(),
  description: z.string().optional(),
});

// ══════════════════════════════════════════════════════════════
// SUBSCRIPTION PLAN MANAGEMENT (Developer only)
// ══════════════════════════════════════════════════════════════

// ── List subscription plans ─────────────────────────────────
router.get(
  '/plans',
  authenticate,
  requireDeveloper(),
  async (_req: Request, res: Response) => {
    try {
      const plans = await db('subscription_plans')
        .select('*')
        .orderBy('sort_order', 'asc');
      res.json({ success: true, data: plans });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to list plans' });
    }
  }
);

// ── Update a subscription plan ──────────────────────────────
router.put(
  '/plans/:planId',
  authenticate,
  requireDeveloper(),
  validate(updatePlanSchema),
  async (req: Request, res: Response) => {
    try {
      const previous = await db('subscription_plans').where({ id: req.params.planId }).first();
      if (!previous) {
        res.status(404).json({ success: false, error: 'Plan not found' });
        return;
      }

      const updates: Record<string, any> = {};
      if (req.body.maxMembers !== undefined) updates.max_members = req.body.maxMembers;
      if (req.body.features !== undefined) updates.features = JSON.stringify(req.body.features);
      if (req.body.priceUsdAnnual !== undefined) updates.price_usd_annual = req.body.priceUsdAnnual;
      if (req.body.priceUsdMonthly !== undefined) updates.price_usd_monthly = req.body.priceUsdMonthly;
      if (req.body.priceNgnAnnual !== undefined) updates.price_ngn_annual = req.body.priceNgnAnnual;
      if (req.body.priceNgnMonthly !== undefined) updates.price_ngn_monthly = req.body.priceNgnMonthly;
      if (req.body.isActive !== undefined) updates.is_active = req.body.isActive;
      if (req.body.description !== undefined) updates.description = req.body.description;

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ success: false, error: 'No fields to update' });
        return;
      }

      await db('subscription_plans').where({ id: req.params.planId }).update(updates);

      await (req as any).audit?.({
        action: 'update',
        entityType: 'subscription_plan',
        entityId: req.params.planId,
        previousValue: previous,
        newValue: updates,
      });

      res.json({ success: true, message: 'Plan updated' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to update plan' });
    }
  }
);

// ══════════════════════════════════════════════════════════════
// PLATFORM CONFIG (Developer)
// ══════════════════════════════════════════════════════════════

router.get(
  '/config',
  authenticate,
  requireDeveloper(),
  async (req: Request, res: Response) => {
    try {
      const configs = await db('platform_config').select('*').orderBy('key');
      res.json({ success: true, data: configs });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get config' });
    }
  }
);

// ══════════════════════════════════════════════════════════════
// GRANT AI WALLET MINUTES (Developer)
// ══════════════════════════════════════════════════════════════
router.post(
  '/ai-credits/grant',
  authenticate,
  requireDeveloper(),
  async (req: Request, res: Response) => {
    try {
      const { organizationId, credits, reason } = req.body;
      if (!organizationId || !credits || credits < 1) {
        res.status(400).json({ success: false, error: 'organizationId and credits (>=1) required' });
        return;
      }

      // Ensure ai_wallet exists
      let wallet = await db('ai_wallet')
        .where({ organization_id: organizationId })
        .first();

      if (wallet) {
        await db('ai_wallet')
          .where({ organization_id: organizationId })
          .update({
            balance_minutes: db.raw('balance_minutes + ?', [credits]),
          });
      } else {
        await db('ai_wallet').insert({
          organization_id: organizationId,
          balance_minutes: credits,
        });
      }

      await db('ai_wallet_transactions').insert({
        organization_id: organizationId,
        type: 'bonus',
        amount_minutes: credits,
        cost: 0,
        description: reason || `Admin granted ${credits} AI minute${credits > 1 ? 's' : ''}`,
      });

      await (req as any).audit?.({
        action: 'grant',
        entityType: 'ai_wallet',
        entityId: organizationId,
        newValue: { credits, reason },
      });

      res.json({ success: true, message: `${credits} credit(s) granted` });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to grant credits' });
    }
  }
);

router.put(
  '/config',
  authenticate,
  requireDeveloper(),
  validate(updateConfigSchema),
  async (req: Request, res: Response) => {
    try {
      const { key, value, description } = req.body;

      await db('platform_config')
        .insert({
          key,
          value: JSON.stringify(value),
          description: description || null,
        })
        .onConflict('key')
        .merge({ value: JSON.stringify(value) });

      await (req as any).audit?.({
        action: 'settings_change',
        entityType: 'platform_config',
        entityId: key,
        newValue: { key, value },
      });

      res.json({ success: true, message: 'Config updated' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to update config' });
    }
  }
);

// ══════════════════════════════════════════════════════════════
// PLATFORM ANALYTICS (Super Admin)
// ══════════════════════════════════════════════════════════════

router.get(
  '/analytics',
  authenticate,
  requireDeveloper(),
  async (req: Request, res: Response) => {
    try {
      const totalOrgs = await db('organizations').count('id as count').first();
      const totalUsers = await db('users').count('id as count').first();
      const activeOrgs = await db('organizations')
        .where({ status: 'active' })
        .count('id as count')
        .first();
      const totalRevenue = await db('transactions')
        .where({ status: 'completed' })
        .whereIn('type', ['ai_credit_purchase'])
        .select(db.raw('coalesce(sum(amount), 0) as total'))
        .first();
      const totalMeetings = await db('meetings').count('id as count').first();
      const aiMinutesUsed = await db('ai_wallet_transactions')
        .where('amount_minutes', '<', 0)
        .select(db.raw('coalesce(sum(abs(amount_minutes)), 0) as total'))
        .first();

      // Recent activity
      const recentAudit = await db('audit_logs')
        .join('users', 'audit_logs.user_id', 'users.id')
        .select(
          'audit_logs.*',
          'users.email',
          'users.first_name',
          'users.last_name'
        )
        .orderBy('audit_logs.created_at', 'desc')
        .limit(20);

      res.json({
        success: true,
        data: {
          totalOrganizations: parseInt(totalOrgs?.count as string) || 0,
          activeOrganizations: parseInt(activeOrgs?.count as string) || 0,
          totalUsers: parseInt(totalUsers?.count as string) || 0,
          totalRevenue: totalRevenue?.total || 0,
          totalMeetings: parseInt(totalMeetings?.count as string) || 0,
          totalAIMinutesUsed: aiMinutesUsed?.total || 0,
          recentActivity: recentAudit,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get analytics' });
    }
  }
);

// ══════════════════════════════════════════════════════════════
// AUDIT LOGS (Admin)
// ══════════════════════════════════════════════════════════════

router.get(
  '/audit-logs',
  authenticate,
  requireDeveloper(),
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const orgId = req.query.orgId as string;
      const action = req.query.action as string;
      const entityType = req.query.entityType as string;

      let query = db('audit_logs')
        .join('users', 'audit_logs.user_id', 'users.id')
        .select(
          'audit_logs.*',
          'users.email',
          'users.first_name',
          'users.last_name'
        );

      if (orgId) query = query.where({ 'audit_logs.organization_id': orgId });
      if (action) query = query.where({ 'audit_logs.action': action });
      if (entityType) query = query.where({ 'audit_logs.entity_type': entityType });

      const total = await query.clone().clear('select').count('audit_logs.id as count').first();
      const logs = await query
        .orderBy('audit_logs.created_at', 'desc')
        .offset((page - 1) * limit)
        .limit(limit);

      res.json({
        success: true,
        data: logs,
        meta: { page, limit, total: parseInt(total?.count as string) || 0 },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get audit logs' });
    }
  }
);

export default router;
