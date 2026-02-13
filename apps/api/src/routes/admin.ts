// ============================================================
// OrgsLedger API — Licensing & Platform Admin Routes
// License management, reselling, feature toggles, analytics
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import db from '../db';
import { authenticate, requireSuperAdmin, validate } from '../middleware';
import { logger } from '../logger';

const router = Router();

// ── Schemas ─────────────────────────────────────────────────
const createLicenseSchema = z.object({
  organizationId: z.string().uuid(),
  type: z.enum(['free', 'basic', 'professional', 'enterprise']),
  maxMembers: z.number().int().min(1),
  features: z.object({
    chat: z.boolean().default(true),
    meetings: z.boolean().default(true),
    aiMinutes: z.boolean().default(false),
    financials: z.boolean().default(true),
    donations: z.boolean().default(true),
    voting: z.boolean().default(true),
  }),
  aiCreditsIncluded: z.number().int().default(0),
  priceMonthly: z.number().min(0),
  validFrom: z.string().datetime(),
  validUntil: z.string().datetime().optional(),
  resellerId: z.string().uuid().optional(),
});

const updateConfigSchema = z.object({
  key: z.string().min(1),
  value: z.any(),
  description: z.string().optional(),
});

// ══════════════════════════════════════════════════════════════
// LICENSE MANAGEMENT (Super Admin only)
// ══════════════════════════════════════════════════════════════

router.post(
  '/licenses',
  authenticate,
  requireSuperAdmin(),
  validate(createLicenseSchema),
  async (req: Request, res: Response) => {
    try {
      const data = req.body;

      const [license] = await db('licenses')
        .insert({
          type: data.type,
          max_members: data.maxMembers,
          features: JSON.stringify(data.features),
          ai_credits_included: data.aiCreditsIncluded,
          price_monthly: data.priceMonthly,
          valid_from: data.validFrom,
          valid_until: data.validUntil || null,
          is_active: true,
          reseller_id: data.resellerId || null,
        })
        .returning('*');

      // Assign to organization
      await db('organizations')
        .where({ id: data.organizationId })
        .update({
          license_id: license.id,
          settings: db.raw(
            `jsonb_set(settings, '{features}', ?::jsonb)`,
            [JSON.stringify(data.features)]
          ),
        });

      // If includes AI credits, add them
      if (data.aiCreditsIncluded > 0) {
        await db('ai_credits')
          .where({ organization_id: data.organizationId })
          .update({
            total_credits: db.raw('total_credits + ?', [data.aiCreditsIncluded]),
          });

        await db('ai_credit_transactions').insert({
          organization_id: data.organizationId,
          type: 'bonus',
          amount: data.aiCreditsIncluded,
          description: `License activation: ${data.aiCreditsIncluded} AI minutes included`,
        });
      }

      await (req as any).audit?.({
        action: 'create',
        entityType: 'license',
        entityId: license.id,
        newValue: { type: data.type, organizationId: data.organizationId },
      });

      res.status(201).json({ success: true, data: license });
    } catch (err) {
      logger.error('Create license error', err);
      res.status(500).json({ success: false, error: 'Failed to create license' });
    }
  }
);

router.get(
  '/licenses',
  authenticate,
  requireSuperAdmin(),
  async (req: Request, res: Response) => {
    try {
      const licenses = await db('licenses')
        .leftJoin('organizations', 'licenses.id', 'organizations.license_id')
        .select(
          'licenses.*',
          'organizations.name as organizationName',
          'organizations.slug as organizationSlug'
        )
        .orderBy('licenses.created_at', 'desc');

      res.json({ success: true, data: licenses });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to list licenses' });
    }
  }
);

router.put(
  '/licenses/:licenseId',
  authenticate,
  requireSuperAdmin(),
  async (req: Request, res: Response) => {
    try {
      const { type, maxMembers, features, isActive, priceMonthly } = req.body;
      const previous = await db('licenses').where({ id: req.params.licenseId }).first();

      const updates: Record<string, any> = {};
      if (type) updates.type = type;
      if (maxMembers) updates.max_members = maxMembers;
      if (features) updates.features = JSON.stringify(features);
      if (isActive !== undefined) updates.is_active = isActive;
      if (priceMonthly !== undefined) updates.price_monthly = priceMonthly;

      await db('licenses').where({ id: req.params.licenseId }).update(updates);

      // Sync features to org settings
      if (features) {
        const org = await db('organizations').where({ license_id: req.params.licenseId }).first();
        if (org) {
          const settings = typeof org.settings === 'string' ? JSON.parse(org.settings) : org.settings;
          settings.features = features;
          settings.maxMembers = maxMembers || settings.maxMembers;
          await db('organizations')
            .where({ id: org.id })
            .update({ settings: JSON.stringify(settings) });
        }
      }

      await (req as any).audit?.({
        action: 'update',
        entityType: 'license',
        entityId: req.params.licenseId,
        previousValue: previous,
        newValue: updates,
      });

      res.json({ success: true, message: 'License updated' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to update license' });
    }
  }
);

// ══════════════════════════════════════════════════════════════
// PLATFORM CONFIG (Super Admin)
// ══════════════════════════════════════════════════════════════

router.get(
  '/config',
  authenticate,
  requireSuperAdmin(),
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
// GRANT AI CREDITS (Super Admin)
// ══════════════════════════════════════════════════════════════
router.post(
  '/ai-credits/grant',
  authenticate,
  requireSuperAdmin(),
  async (req: Request, res: Response) => {
    try {
      const { organizationId, credits, reason } = req.body;
      if (!organizationId || !credits || credits < 1) {
        res.status(400).json({ success: false, error: 'organizationId and credits (>=1) required' });
        return;
      }

      // Ensure ai_credits row exists
      const existing = await db('ai_credits')
        .where({ organization_id: organizationId })
        .first();

      if (existing) {
        await db('ai_credits')
          .where({ organization_id: organizationId })
          .update({
            total_credits: db.raw('total_credits + ?', [credits]),
          });
      } else {
        await db('ai_credits').insert({
          organization_id: organizationId,
          total_credits: credits,
          used_credits: 0,
        });
      }

      await db('ai_credit_transactions').insert({
        organization_id: organizationId,
        type: 'bonus',
        amount: credits,
        description: reason || `Admin granted ${credits} AI credit${credits > 1 ? 's' : ''}`,
      });

      await (req as any).audit?.({
        action: 'grant',
        entityType: 'ai_credits',
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
  requireSuperAdmin(),
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
  requireSuperAdmin(),
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
      const aiMinutesUsed = await db('ai_credits')
        .select(db.raw('coalesce(sum(used_credits), 0) as total'))
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
  requireSuperAdmin(),
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
