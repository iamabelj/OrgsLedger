// ============================================================
// OrgsLedger API — Subscription Routes
// Plans, subscriptions, wallets, invite links, super admin
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import db from '../db';
import { authenticate, loadMembership, requireRole, requireSuperAdmin, requireActiveSubscription, validate } from '../middleware';
import { logger } from '../logger';
import * as subSvc from '../services/subscription.service';
import { writeAuditLog } from '../middleware/audit';

const router = Router();

// ── Schemas ─────────────────────────────────────────────────
const subscribeSchema = z.object({
  planSlug: z.string(),
  billingCycle: z.enum(['annual', 'monthly']).default('annual'),
  billingCountry: z.string().optional(),
  paymentGateway: z.string().optional(),
  paymentReference: z.string().optional(),
});

const renewSchema = z.object({
  paymentReference: z.string().optional(),
  amountPaid: z.number().optional(),
});

const topUpSchema = z.object({
  hours: z.number().min(1),
  paymentGateway: z.string().optional(),
  paymentReference: z.string().optional(),
});

const createInviteSchema = z.object({
  role: z.enum(['member', 'executive', 'org_admin']).default('member'),
  maxUses: z.number().int().min(1).max(1000).default(50),
  expiresAt: z.string().optional(),
});

const adjustWalletSchema = z.object({
  organizationId: z.string().uuid().optional(),
  organization_id: z.string().uuid().optional(),
  hours: z.number(),
  description: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
}).refine(d => d.organizationId || d.organization_id, { message: 'organizationId or organization_id required' })
  .refine(d => d.description || d.reason, { message: 'description or reason required' });

const orgStatusSchema = z.object({
  organizationId: z.string().uuid(),
  action: z.enum(['suspend', 'activate']),
  reason: z.string().optional(),
});

const overrideSchema = z.object({
  subscriptionId: z.string().uuid().optional(),
  organizationId: z.string().uuid(),
  planSlug: z.string().optional(),
  status: z.enum(['active', 'grace_period', 'expired', 'cancelled', 'suspended']).optional(),
  periodEnd: z.string().optional(),
});

// ════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ════════════════════════════════════════════════════════════

// GET /plans — list all active plans
router.get('/plans', async (_req: Request, res: Response) => {
  try {
    const plans = await subSvc.getPlans();
    res.json({ success: true, data: plans });
  } catch (err: any) {
    logger.error('Get plans error', err);
    res.status(500).json({ success: false, error: 'Failed to load plans' });
  }
});

// GET /invite/:code — validate invite link (public, no auth needed)
router.get('/invite/:code', async (req: Request, res: Response) => {
  try {
    const invite = await subSvc.validateInviteLink(req.params.code);
    if (!invite) {
      res.status(404).json({ success: false, error: 'Invalid or expired invite link' });
      return;
    }
    res.json({ success: true, data: invite });
  } catch (err: any) {
    logger.error('Validate invite error', err);
    res.status(500).json({ success: false, error: 'Failed to validate invite' });
  }
});

// POST /invite/:code/join — join org via invite (requires auth)
router.post('/invite/:code/join', authenticate, async (req: Request, res: Response) => {
  try {
    const result = await subSvc.useInviteLink(req.params.code, req.user!.userId);
    res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error('Join via invite error', err);
    const status = err.message?.includes('already') ? 409 :
                   err.message?.includes('limit') ? 403 :
                   err.message?.includes('Invalid') || err.message?.includes('expired') ? 404 : 500;
    res.status(status).json({ success: false, error: err.message || 'Failed to join' });
  }
});

// ════════════════════════════════════════════════════════════
// ORG-SCOPED ROUTES (authenticated)
// ════════════════════════════════════════════════════════════

// GET /:orgId/subscription
router.get('/:orgId/subscription', authenticate, loadMembership, async (req: Request, res: Response) => {
  try {
    const sub = await subSvc.getOrgSubscription(req.params.orgId);
    if (!sub) {
      res.json({ success: true, data: null });
      return;
    }
    const plan = sub.plan_id ? await subSvc.getPlanById(sub.plan_id) : null;
    res.json({ success: true, data: { ...sub, plan } });
  } catch (err: any) {
    logger.error('Get subscription error', err);
    res.status(500).json({ success: false, error: 'Failed to get subscription' });
  }
});

// POST /:orgId/subscribe
router.post('/:orgId/subscribe', authenticate, loadMembership, requireRole('org_admin'), validate(subscribeSchema), async (req: Request, res: Response) => {
  try {
    const { planSlug, billingCycle, billingCountry, paymentGateway, paymentReference } = req.body;
    const plan = await subSvc.getPlanBySlug(planSlug);
    if (!plan) {
      res.status(404).json({ success: false, error: 'Plan not found' });
      return;
    }
    const currency = subSvc.getCurrency(billingCountry);
    const price = subSvc.getPlanPrice(plan, currency, billingCycle);

    // If plan has a cost but no payment reference, create as pending (needs webhook confirmation)
    const isPaid = price <= 0 || !!paymentReference;
    const sub = await subSvc.createSubscription({
      organizationId: req.params.orgId,
      planId: plan.id,
      billingCycle,
      currency,
      amountPaid: isPaid ? price : 0,
      paymentGateway,
      gatewaySubscriptionId: paymentReference,
      status: isPaid ? 'active' : 'pending',
    });
    res.json({ success: true, data: sub });
  } catch (err: any) {
    logger.error('Subscribe error', err);
    res.status(500).json({ success: false, error: err.message || 'Subscription failed' });
  }
});

// POST /:orgId/renew
router.post('/:orgId/renew', authenticate, loadMembership, requireRole('org_admin'), async (req: Request, res: Response) => {
  try {
    const sub = await subSvc.getOrgSubscription(req.params.orgId);
    if (!sub) {
      res.status(404).json({ success: false, error: 'No subscription found' });
      return;
    }
    const plan = await subSvc.getPlanById(sub.plan_id);
    if (!plan) {
      res.status(404).json({ success: false, error: 'Plan not found' });
      return;
    }
    const org = await db('organizations').where({ id: req.params.orgId }).select('billing_currency').first();
    const currency = (org?.billing_currency as 'USD' | 'NGN') || 'USD';
    const price = subSvc.getPlanPrice(plan, currency, sub.billing_cycle);
    const renewed = await subSvc.renewSubscription(req.params.orgId, price, req.body?.paymentReference);
    res.json({ success: true, data: renewed });
  } catch (err: any) {
    logger.error('Renew error', err);
    res.status(500).json({ success: false, error: err.message || 'Renewal failed' });
  }
});

// ── Wallets ─────────────────────────────────────────────────

// GET /:orgId/wallets — combined
router.get('/:orgId/wallets', authenticate, loadMembership, async (req: Request, res: Response) => {
  try {
    const [ai, translation] = await Promise.all([
      subSvc.getAiWallet(req.params.orgId),
      subSvc.getTranslationWallet(req.params.orgId),
    ]);
    res.json({ success: true, data: { ai, translation } });
  } catch (err: any) {
    logger.error('Get wallets error', err);
    res.status(500).json({ success: false, error: 'Failed to get wallets' });
  }
});

// GET /:orgId/wallet/ai
router.get('/:orgId/wallet/ai', authenticate, loadMembership, async (req: Request, res: Response) => {
  try {
    const wallet = await subSvc.getAiWallet(req.params.orgId);
    res.json({ success: true, data: wallet });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to get AI wallet' });
  }
});

// GET /:orgId/wallet/translation
router.get('/:orgId/wallet/translation', authenticate, loadMembership, async (req: Request, res: Response) => {
  try {
    const wallet = await subSvc.getTranslationWallet(req.params.orgId);
    res.json({ success: true, data: wallet });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to get translation wallet' });
  }
});

// POST /:orgId/wallet/ai/topup
router.post('/:orgId/wallet/ai/topup', authenticate, loadMembership, requireRole('org_admin'), validate(topUpSchema), async (req: Request, res: Response) => {
  try {
    const { hours, paymentGateway, paymentReference } = req.body;

    // Require payment reference for real top-ups
    if (!paymentReference) {
      res.status(400).json({ success: false, error: 'Payment reference required. Complete payment first.' });
      return;
    }

    const org = await db('organizations').where({ id: req.params.orgId }).select('billing_currency').first();
    const currency = (org?.billing_currency as string) || 'USD';
    const pricePerHour = currency === 'NGN' ? 18000 : 10;
    const minutes = hours * 60;
    const cost = hours * pricePerHour;
    const wallet = await subSvc.topUpAiWallet({
      orgId: req.params.orgId,
      minutes,
      cost,
      currency,
      paymentRef: paymentReference,
      paymentGateway,
    });
    res.json({ success: true, data: wallet });
  } catch (err: any) {
    logger.error('AI topup error', err);
    res.status(500).json({ success: false, error: err.message || 'Top-up failed' });
  }
});

// POST /:orgId/wallet/translation/topup
router.post('/:orgId/wallet/translation/topup', authenticate, loadMembership, requireRole('org_admin'), validate(topUpSchema), async (req: Request, res: Response) => {
  try {
    const { hours, paymentGateway, paymentReference } = req.body;

    // Require payment reference for real top-ups
    if (!paymentReference) {
      res.status(400).json({ success: false, error: 'Payment reference required. Complete payment first.' });
      return;
    }

    const org = await db('organizations').where({ id: req.params.orgId }).select('billing_currency').first();
    const currency = (org?.billing_currency as string) || 'USD';
    const pricePerHour = currency === 'NGN' ? 45000 : 25;
    const minutes = hours * 60;
    const cost = hours * pricePerHour;
    const wallet = await subSvc.topUpTranslationWallet({
      orgId: req.params.orgId,
      minutes,
      cost,
      currency,
      paymentRef: paymentReference,
      paymentGateway,
    });
    res.json({ success: true, data: wallet });
  } catch (err: any) {
    logger.error('Translation topup error', err);
    res.status(500).json({ success: false, error: err.message || 'Top-up failed' });
  }
});

// GET /:orgId/wallet/ai/history
router.get('/:orgId/wallet/ai/history', authenticate, loadMembership, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const history = await subSvc.getAiWalletHistory(req.params.orgId, limit, offset);
    res.json({ success: true, data: history });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to get AI wallet history' });
  }
});

// GET /:orgId/wallet/translation/history
router.get('/:orgId/wallet/translation/history', authenticate, loadMembership, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const history = await subSvc.getTranslationWalletHistory(req.params.orgId, limit, offset);
    res.json({ success: true, data: history });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to get translation history' });
  }
});

// ── Invite Links ────────────────────────────────────────────

// POST /:orgId/invite
router.post('/:orgId/invite', authenticate, loadMembership, requireRole('org_admin'), validate(createInviteSchema), async (req: Request, res: Response) => {
  try {
    const { role, maxUses, expiresAt } = req.body;
    const invite = await subSvc.createInviteLink(
      req.params.orgId,
      req.user!.userId,
      role || 'member',
      maxUses || 50,
      expiresAt,
    );
    res.json({ success: true, data: invite });
  } catch (err: any) {
    logger.error('Create invite error', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to create invite' });
  }
});

// GET /:orgId/invites
router.get('/:orgId/invites', authenticate, loadMembership, async (req: Request, res: Response) => {
  try {
    const invites = await db('invite_links')
      .where({ organization_id: req.params.orgId })
      .orderBy('created_at', 'desc');
    res.json({ success: true, data: invites });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to get invites' });
  }
});

// DELETE /:orgId/invite/:inviteId
router.delete('/:orgId/invite/:inviteId', authenticate, loadMembership, requireRole('org_admin'), async (req: Request, res: Response) => {
  try {
    await db('invite_links').where({ id: req.params.inviteId, organization_id: req.params.orgId }).del();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to delete invite' });
  }
});

// ════════════════════════════════════════════════════════════
// SUPER ADMIN ROUTES
// ════════════════════════════════════════════════════════════

// GET /admin/revenue
router.get('/admin/revenue', authenticate, requireSuperAdmin(), async (_req: Request, res: Response) => {
  try {
    const revenue = await subSvc.getPlatformRevenue();
    res.json({ success: true, data: revenue });
  } catch (err: any) {
    logger.error('Admin revenue error', err);
    res.status(500).json({ success: false, error: 'Failed to get revenue' });
  }
});

// GET /admin/subscriptions
router.get('/admin/subscriptions', authenticate, requireSuperAdmin(), async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const subs = await db('subscriptions')
      .join('subscription_plans', 'subscriptions.plan_id', 'subscription_plans.id')
      .join('organizations', 'subscriptions.organization_id', 'organizations.id')
      .select(
        'subscriptions.*',
        'subscription_plans.name as plan_name',
        'subscription_plans.slug as plan_slug',
        'organizations.name as org_name',
      )
      .orderBy('subscriptions.created_at', 'desc')
      .limit(limit)
      .offset(offset);
    res.json({ success: true, data: subs });
  } catch (err: any) {
    logger.error('Admin subscriptions error', err);
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

// GET /admin/organizations — list all orgs with subscription + wallet info
router.get('/admin/organizations', authenticate, requireSuperAdmin(), async (_req: Request, res: Response) => {
  try {
    const orgs = await db('organizations')
      .leftJoin('subscriptions', function () {
        this.on('organizations.id', '=', 'subscriptions.organization_id')
          .andOnVal('subscriptions.status', 'in', db.raw('(?, ?, ?)', ['active', 'grace_period', 'expired']));
      })
      .leftJoin('subscription_plans', 'subscriptions.plan_id', 'subscription_plans.id')
      .leftJoin('ai_wallet', 'organizations.id', 'ai_wallet.organization_id')
      .leftJoin('translation_wallet', 'organizations.id', 'translation_wallet.organization_id')
      .select(
        'organizations.id',
        'organizations.name',
        'organizations.subscription_status',
        'organizations.billing_currency',
        'organizations.billing_country',
        'organizations.created_at',
        'subscription_plans.name as plan_name',
        'subscription_plans.slug as plan_slug',
        'subscriptions.status as sub_status',
        'subscriptions.current_period_end',
        'ai_wallet.balance_minutes as ai_balance_minutes',
        'translation_wallet.balance_minutes as translation_balance_minutes',
      )
      .orderBy('organizations.created_at', 'desc');

    // Add member count
    const orgIds = orgs.map((o: any) => o.id);
    const counts = orgIds.length > 0
      ? await db('memberships')
          .whereIn('organization_id', orgIds)
          .groupBy('organization_id')
          .select('organization_id')
          .count('* as member_count')
      : [];
    const countMap: Record<string, number> = {};
    counts.forEach((c: any) => { countMap[c.organization_id] = parseInt(c.member_count); });

    const result = orgs.map((o: any) => ({ ...o, member_count: countMap[o.id] || 0 }));
    res.json({ success: true, organizations: result });
  } catch (err: any) {
    logger.error('Admin orgs error', err);
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

// POST /admin/organizations — super admin creates an organization
const adminCreateOrgSchema = z.object({
  name: z.string().min(2).max(200),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  ownerEmail: z.string().email(),
  plan: z.enum(['standard', 'professional', 'enterprise']).default('standard'),
  currency: z.enum(['USD', 'NGN']).default('USD'),
});

router.post('/admin/organizations', authenticate, requireSuperAdmin(), validate(adminCreateOrgSchema), async (req: Request, res: Response) => {
  try {
    const { name, slug, ownerEmail, plan, currency } = req.body;

    // Check slug uniqueness
    const existing = await db('organizations').where({ slug }).first();
    if (existing) {
      res.status(409).json({ success: false, error: 'Slug already taken' });
      return;
    }

    // Find or validate owner user
    const owner = await db('users').where({ email: ownerEmail.toLowerCase() }).first();
    if (!owner) {
      res.status(404).json({ success: false, error: `User with email ${ownerEmail} not found. They must register first.` });
      return;
    }

    // Create organization
    const [org] = await db('organizations')
      .insert({
        name,
        slug,
        status: 'active',
        subscription_status: 'active',
        billing_currency: currency,
        settings: JSON.stringify({
          currency,
          timezone: 'UTC',
          locale: 'en',
          aiEnabled: true,
          features: {
            chat: true, meetings: true, financials: true, polls: true,
            events: true, announcements: true, documents: true, committees: true,
          },
        }),
      })
      .returning('*');

    // Make owner the org_admin
    await db('memberships').insert({
      user_id: owner.id,
      organization_id: org.id,
      role: 'org_admin',
    });

    // Create default General channel
    const [channel] = await db('channels')
      .insert({
        organization_id: org.id,
        name: 'General',
        type: 'general',
        description: 'General discussion',
      })
      .returning('*');

    await db('channel_members').insert({
      channel_id: channel.id,
      user_id: owner.id,
    });

    // Provision subscription
    const selectedPlan = await subSvc.getPlanBySlug(plan);
    if (selectedPlan) {
      await subSvc.createSubscription({
        organizationId: org.id,
        planId: selectedPlan.id,
        billingCycle: 'annual',
        currency,
        amountPaid: 0,
        createdBy: owner.id,
      });
    }

    // Provision wallets
    await subSvc.getAiWallet(org.id);
    await subSvc.getTranslationWallet(org.id);

    // Legacy ai_credits
    try {
      await db('ai_credits').insert({ organization_id: org.id, total_credits: 0, used_credits: 0 });
    } catch { /* ignore */ }

    // Generate invite link
    const invite = await subSvc.createInviteLink(org.id, owner.id, 'member');

    await writeAuditLog({
      organizationId: org.id,
      userId: req.user!.userId,
      action: 'admin_create_org',
      entityType: 'organization',
      entityId: org.id,
      newValue: { name, slug, ownerEmail, plan, currency },
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });

    logger.info(`Admin created organization: ${name} (${slug}) for ${ownerEmail}`);

    res.status(201).json({
      success: true,
      organization: org,
      inviteCode: invite.code,
      message: `Organization "${name}" created. Owner: ${ownerEmail}. Plan: ${plan}.`,
    });
  } catch (err: any) {
    logger.error('Admin create org error', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to create organization' });
  }
});

// POST /admin/wallet/ai/adjust
router.post('/admin/wallet/ai/adjust', authenticate, requireSuperAdmin(), validate(adjustWalletSchema), async (req: Request, res: Response) => {
  try {
    const organizationId = req.body.organizationId || req.body.organization_id;
    const hours = req.body.hours;
    const description = req.body.description || req.body.reason;
    const minutes = hours * 60;
    const wallet = await subSvc.adminAdjustAiWallet(organizationId, minutes, description);
    await writeAuditLog({
      organizationId,
      userId: req.user!.userId,
      action: 'admin_adjust',
      entityType: 'ai_wallet',
      entityId: organizationId,
      newValue: { hours, minutes, description },
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });
    res.json({ success: true, data: wallet });
  } catch (err: any) {
    logger.error('Admin adjust AI error', err);
    res.status(500).json({ success: false, error: err.message || 'Adjustment failed' });
  }
});

// POST /admin/wallet/translation/adjust
router.post('/admin/wallet/translation/adjust', authenticate, requireSuperAdmin(), validate(adjustWalletSchema), async (req: Request, res: Response) => {
  try {
    const organizationId = req.body.organizationId || req.body.organization_id;
    const hours = req.body.hours;
    const description = req.body.description || req.body.reason;
    const minutes = hours * 60;
    const wallet = await subSvc.adminAdjustTranslationWallet(organizationId, minutes, description);
    await writeAuditLog({
      organizationId,
      userId: req.user!.userId,
      action: 'admin_adjust',
      entityType: 'translation_wallet',
      entityId: organizationId,
      newValue: { hours, minutes, description },
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });
    res.json({ success: true, data: wallet });
  } catch (err: any) {
    logger.error('Admin adjust translation error', err);
    res.status(500).json({ success: false, error: err.message || 'Adjustment failed' });
  }
});

// POST /admin/org/status — suspend or activate
router.post('/admin/org/status', authenticate, requireSuperAdmin(), async (req: Request, res: Response) => {
  try {
    // Accept both camelCase (organizationId, action) and snake_case (organization_id, status) from frontend
    const organizationId = req.body.organizationId || req.body.organization_id;
    const action = req.body.action || (req.body.status === 'suspended' ? 'suspend' : 'activate');
    const reason = req.body.reason || 'Admin action';
    const newStatus = action === 'suspend' ? 'suspended' : 'active';
    await db('organizations').where({ id: organizationId }).update({ subscription_status: newStatus });
    if (action === 'suspend') {
      await db('subscriptions').where({ organization_id: organizationId, status: 'active' }).update({ status: 'suspended' });
    } else {
      // Reactivate latest subscription
      const latestSub = await db('subscriptions').where({ organization_id: organizationId }).orderBy('created_at', 'desc').first();
      if (latestSub && latestSub.status === 'suspended') {
        await db('subscriptions').where({ id: latestSub.id }).update({ status: 'active' });
      }
    }
    logger.info(`Admin ${action} org ${organizationId}: ${reason || 'no reason'}`);
    await writeAuditLog({
      organizationId,
      userId: req.user!.userId,
      action: `admin_${action}`,
      entityType: 'organization',
      entityId: organizationId,
      newValue: { action, reason: reason || null, newStatus },
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });
    res.json({ success: true, message: `Organization ${action}d` });
  } catch (err: any) {
    logger.error('Admin org status error', err);
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

// POST /admin/subscription/override
router.post('/admin/subscription/override', authenticate, requireSuperAdmin(), validate(overrideSchema), async (req: Request, res: Response) => {
  try {
    const { organizationId, planSlug, status, periodEnd } = req.body;
    const updates: any = {};
    if (planSlug) {
      const plan = await subSvc.getPlanBySlug(planSlug);
      if (plan) updates.plan_id = plan.id;
    }
    if (status) updates.status = status;
    if (periodEnd) updates.current_period_end = new Date(periodEnd);
    updates.updated_at = new Date();

    const sub = await db('subscriptions')
      .where({ organization_id: organizationId })
      .orderBy('created_at', 'desc')
      .first();
    if (!sub) {
      res.status(404).json({ success: false, error: 'No subscription found' });
      return;
    }
    await db('subscriptions').where({ id: sub.id }).update(updates);
    logger.info(`Admin override subscription for org ${organizationId}`, updates);
    await writeAuditLog({
      organizationId,
      userId: req.user!.userId,
      action: 'admin_override',
      entityType: 'subscription',
      entityId: sub.id,
      previousValue: { planId: sub.plan_id, status: sub.status, periodEnd: sub.current_period_end },
      newValue: { planSlug, status, periodEnd },
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });
    res.json({ success: true, message: 'Subscription overridden' });
  } catch (err: any) {
    logger.error('Admin override error', err);
    res.status(500).json({ success: false, error: 'Override failed' });
  }
});

// GET /admin/wallet-analytics
router.get('/admin/wallet-analytics', authenticate, requireSuperAdmin(), async (_req: Request, res: Response) => {
  try {
    // AI wallet totals
    const aiStats = await db('ai_wallet')
      .select(
        db.raw('SUM(balance_minutes) as total_balance'),
        db.raw('COUNT(*) as wallet_count'),
      )
      .first();
    const aiTxStats = await db('ai_wallet_transactions')
      .select(
        db.raw("SUM(CASE WHEN amount_minutes > 0 THEN amount_minutes ELSE 0 END) as total_added"),
        db.raw("SUM(CASE WHEN amount_minutes < 0 THEN ABS(amount_minutes) ELSE 0 END) as total_used"),
      )
      .first();

    // Translation wallet totals
    const transStats = await db('translation_wallet')
      .select(
        db.raw('SUM(balance_minutes) as total_balance'),
        db.raw('COUNT(*) as wallet_count'),
      )
      .first();
    const transTxStats = await db('translation_wallet_transactions')
      .select(
        db.raw("SUM(CASE WHEN amount_minutes > 0 THEN amount_minutes ELSE 0 END) as total_added"),
        db.raw("SUM(CASE WHEN amount_minutes < 0 THEN ABS(amount_minutes) ELSE 0 END) as total_used"),
      )
      .first();

    res.json({
      success: true,
      data: {
        aiHoursSold: parseFloat(aiTxStats?.total_added || '0') / 60,
        aiHoursUsed: parseFloat(aiTxStats?.total_used || '0') / 60,
        aiWalletCount: parseInt(aiStats?.wallet_count || '0'),
        aiTotalBalanceHours: parseFloat(aiStats?.total_balance || '0') / 60,
        translationHoursSold: parseFloat(transTxStats?.total_added || '0') / 60,
        translationHoursUsed: parseFloat(transTxStats?.total_used || '0') / 60,
        translationWalletCount: parseInt(transStats?.wallet_count || '0'),
        translationTotalBalanceHours: parseFloat(transStats?.total_balance || '0') / 60,
      },
    });
  } catch (err: any) {
    logger.error('Wallet analytics error', err);
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

// GET /admin/plans
router.get('/admin/plans', authenticate, requireSuperAdmin(), async (_req: Request, res: Response) => {
  try {
    const plans = await db('subscription_plans').orderBy('sort_order', 'asc');
    res.json({ success: true, data: plans });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

// PUT /admin/plans/:planId
router.put('/admin/plans/:planId', authenticate, requireSuperAdmin(), async (req: Request, res: Response) => {
  try {
    const allowed = ['name', 'description', 'price_usd_annual', 'price_usd_monthly', 'price_ngn_annual', 'price_ngn_monthly', 'max_members', 'features', 'is_active', 'sort_order'];
    const updates: any = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    updates.updated_at = new Date();
    await db('subscription_plans').where({ id: req.params.planId }).update(updates);
    const plan = await db('subscription_plans').where({ id: req.params.planId }).first();
    res.json({ success: true, data: plan });
  } catch (err: any) {
    logger.error('Update plan error', err);
    res.status(500).json({ success: false, error: 'Failed to update plan' });
  }
});

// ════════════════════════════════════════════════════════════
// RISK MONITORING ENDPOINTS
// ════════════════════════════════════════════════════════════

// GET /admin/risk/low-balances — orgs with wallets below threshold
router.get('/admin/risk/low-balances', authenticate, requireSuperAdmin(), async (req: Request, res: Response) => {
  try {
    const thresholdMinutes = parseFloat(req.query.threshold as string) || 60; // default 1 hour

    const lowAi = await db('ai_wallet')
      .join('organizations', 'ai_wallet.organization_id', 'organizations.id')
      .where('ai_wallet.balance_minutes', '<', thresholdMinutes)
      .where('ai_wallet.balance_minutes', '>', 0)
      .select(
        'organizations.id as org_id',
        'organizations.name as org_name',
        'ai_wallet.balance_minutes',
        db.raw("'ai' as wallet_type"),
      )
      .orderBy('ai_wallet.balance_minutes', 'asc');

    const lowTranslation = await db('translation_wallet')
      .join('organizations', 'translation_wallet.organization_id', 'organizations.id')
      .where('translation_wallet.balance_minutes', '<', thresholdMinutes)
      .where('translation_wallet.balance_minutes', '>', 0)
      .select(
        'organizations.id as org_id',
        'organizations.name as org_name',
        'translation_wallet.balance_minutes',
        db.raw("'translation' as wallet_type"),
      )
      .orderBy('translation_wallet.balance_minutes', 'asc');

    const emptyAi = await db('ai_wallet')
      .join('organizations', 'ai_wallet.organization_id', 'organizations.id')
      .where('ai_wallet.balance_minutes', '<=', 0)
      .select(
        'organizations.id as org_id',
        'organizations.name as org_name',
        'ai_wallet.balance_minutes',
        db.raw("'ai' as wallet_type"),
      );

    const emptyTranslation = await db('translation_wallet')
      .join('organizations', 'translation_wallet.organization_id', 'organizations.id')
      .where('translation_wallet.balance_minutes', '<=', 0)
      .select(
        'organizations.id as org_id',
        'organizations.name as org_name',
        'translation_wallet.balance_minutes',
        db.raw("'translation' as wallet_type"),
      );

    res.json({
      success: true,
      data: {
        thresholdMinutes,
        lowBalance: [...lowAi, ...lowTranslation],
        emptyWallets: [...emptyAi, ...emptyTranslation],
        summary: {
          lowAiCount: lowAi.length,
          lowTranslationCount: lowTranslation.length,
          emptyAiCount: emptyAi.length,
          emptyTranslationCount: emptyTranslation.length,
        },
      },
    });
  } catch (err: any) {
    logger.error('Low balance check error', err);
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

// GET /admin/risk/spikes — detect abnormal usage spikes
router.get('/admin/risk/spikes', authenticate, requireSuperAdmin(), async (req: Request, res: Response) => {
  try {
    const daysBack = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 365);
    const spikeMultiplier = Math.min(Math.max(parseFloat(req.query.multiplier as string) || 3, 1.5), 20);
    const lookbackDays = daysBack + 30;

    // Get daily AI usage per org for the analysis period + prior 30 days for baseline
    const aiDaily = await db('ai_wallet_transactions')
      .where('amount_minutes', '<', 0)
      .where('created_at', '>=', db.raw('NOW() - INTERVAL ? DAY', [lookbackDays]))
      .select(
        'organization_id',
        db.raw("DATE(created_at) as day"),
        db.raw('SUM(ABS(amount_minutes)) as daily_usage'),
      )
      .groupBy('organization_id', db.raw('DATE(created_at)'))
      .orderBy('organization_id');

    // Get daily translation usage per org
    const transDaily = await db('translation_wallet_transactions')
      .where('amount_minutes', '<', 0)
      .where('created_at', '>=', db.raw('NOW() - INTERVAL ? DAY', [lookbackDays]))
      .select(
        'organization_id',
        db.raw("DATE(created_at) as day"),
        db.raw('SUM(ABS(amount_minutes)) as daily_usage'),
      )
      .groupBy('organization_id', db.raw('DATE(created_at)'))
      .orderBy('organization_id');

    // Detect spikes: days in the recent period where usage > multiplier * average of prior period
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysBack);

    function detectSpikes(rows: any[], walletType: string) {
      const byOrg: Record<string, { baseline: number[]; recent: number[] }> = {};
      for (const r of rows) {
        if (!byOrg[r.organization_id]) byOrg[r.organization_id] = { baseline: [], recent: [] };
        const day = new Date(r.day);
        const usage = parseFloat(r.daily_usage);
        if (day >= cutoff) {
          byOrg[r.organization_id].recent.push(usage);
        } else {
          byOrg[r.organization_id].baseline.push(usage);
        }
      }

      const spikes: any[] = [];
      for (const [orgId, data] of Object.entries(byOrg)) {
        if (data.baseline.length === 0) continue;
        const avg = data.baseline.reduce((a, b) => a + b, 0) / data.baseline.length;
        if (avg === 0) continue;
        const maxRecent = Math.max(...data.recent, 0);
        if (maxRecent > avg * spikeMultiplier) {
          spikes.push({
            organization_id: orgId,
            wallet_type: walletType,
            baseline_avg_minutes: +avg.toFixed(1),
            recent_max_minutes: +maxRecent.toFixed(1),
            spike_ratio: +(maxRecent / avg).toFixed(1),
          });
        }
      }
      return spikes;
    }

    const aiSpikes = detectSpikes(aiDaily, 'ai');
    const transSpikes = detectSpikes(transDaily, 'translation');

    // Get failed payments in recent period
    const failedPayments = await db('transactions')
      .where({ status: 'failed' })
      .where('created_at', '>=', db.raw(`NOW() - INTERVAL '${daysBack} days'`))
      .join('organizations', 'transactions.organization_id', 'organizations.id')
      .select(
        'transactions.organization_id',
        'organizations.name as org_name',
        db.raw('COUNT(*) as failed_count'),
        db.raw('SUM(transactions.amount) as failed_amount'),
      )
      .groupBy('transactions.organization_id', 'organizations.name')
      .orderBy('failed_count', 'desc');

    // Enrich spikes with org names
    const orgIds = [...new Set([...aiSpikes, ...transSpikes].map(s => s.organization_id))];
    const orgNames: Record<string, string> = {};
    if (orgIds.length > 0) {
      const orgs = await db('organizations').whereIn('id', orgIds).select('id', 'name');
      orgs.forEach((o: any) => { orgNames[o.id] = o.name; });
    }
    aiSpikes.forEach(s => { s.org_name = orgNames[s.organization_id] || 'Unknown'; });
    transSpikes.forEach(s => { s.org_name = orgNames[s.organization_id] || 'Unknown'; });

    res.json({
      success: true,
      data: {
        period: { daysBack, spikeMultiplier },
        usageSpikes: [...aiSpikes, ...transSpikes],
        failedPayments,
        summary: {
          aiSpikeCount: aiSpikes.length,
          translationSpikeCount: transSpikes.length,
          failedPaymentOrgs: failedPayments.length,
        },
      },
    });
  } catch (err: any) {
    logger.error('Spike detection error', err);
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

export default router;
