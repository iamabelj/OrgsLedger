// ============================================================
// OrgsLedger API — Subscription Routes
// Plans, subscriptions, wallets, invite links, super admin
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import db from '../db';
import { authenticate, requireSuperAdmin, validate } from '../middleware';
import { logger } from '../logger';
import * as subSvc from '../services/subscription.service';

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
  organizationId: z.string().uuid(),
  hours: z.number(),
  description: z.string().min(1),
});

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
router.get('/:orgId/subscription', authenticate, async (req: Request, res: Response) => {
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
router.post('/:orgId/subscribe', authenticate, validate(subscribeSchema), async (req: Request, res: Response) => {
  try {
    const { planSlug, billingCycle, billingCountry, paymentGateway, paymentReference } = req.body;
    const plan = await subSvc.getPlanBySlug(planSlug);
    if (!plan) {
      res.status(404).json({ success: false, error: 'Plan not found' });
      return;
    }
    const currency = subSvc.getCurrency(billingCountry);
    const price = subSvc.getPlanPrice(plan, currency, billingCycle);
    const sub = await subSvc.createSubscription({
      organizationId: req.params.orgId,
      planId: plan.id,
      billingCycle,
      currency,
      amountPaid: price,
      paymentGateway,
      gatewaySubscriptionId: paymentReference,
    });
    res.json({ success: true, data: sub });
  } catch (err: any) {
    logger.error('Subscribe error', err);
    res.status(500).json({ success: false, error: err.message || 'Subscription failed' });
  }
});

// POST /:orgId/renew
router.post('/:orgId/renew', authenticate, async (req: Request, res: Response) => {
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
router.get('/:orgId/wallets', authenticate, async (req: Request, res: Response) => {
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
router.get('/:orgId/wallet/ai', authenticate, async (req: Request, res: Response) => {
  try {
    const wallet = await subSvc.getAiWallet(req.params.orgId);
    res.json({ success: true, data: wallet });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to get AI wallet' });
  }
});

// GET /:orgId/wallet/translation
router.get('/:orgId/wallet/translation', authenticate, async (req: Request, res: Response) => {
  try {
    const wallet = await subSvc.getTranslationWallet(req.params.orgId);
    res.json({ success: true, data: wallet });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to get translation wallet' });
  }
});

// POST /:orgId/wallet/ai/topup
router.post('/:orgId/wallet/ai/topup', authenticate, validate(topUpSchema), async (req: Request, res: Response) => {
  try {
    const { hours, paymentGateway, paymentReference } = req.body;
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
router.post('/:orgId/wallet/translation/topup', authenticate, validate(topUpSchema), async (req: Request, res: Response) => {
  try {
    const { hours, paymentGateway, paymentReference } = req.body;
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
router.get('/:orgId/wallet/ai/history', authenticate, async (req: Request, res: Response) => {
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
router.get('/:orgId/wallet/translation/history', authenticate, async (req: Request, res: Response) => {
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
router.post('/:orgId/invite', authenticate, validate(createInviteSchema), async (req: Request, res: Response) => {
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
router.get('/:orgId/invites', authenticate, async (req: Request, res: Response) => {
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
router.delete('/:orgId/invite/:inviteId', authenticate, async (req: Request, res: Response) => {
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
router.get('/admin/revenue', authenticate, requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const revenue = await subSvc.getPlatformRevenue();
    res.json({ success: true, data: revenue });
  } catch (err: any) {
    logger.error('Admin revenue error', err);
    res.status(500).json({ success: false, error: 'Failed to get revenue' });
  }
});

// GET /admin/subscriptions
router.get('/admin/subscriptions', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
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
router.get('/admin/organizations', authenticate, requireSuperAdmin, async (_req: Request, res: Response) => {
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
      ? await db('organization_members')
          .whereIn('organization_id', orgIds)
          .groupBy('organization_id')
          .select('organization_id')
          .count('* as member_count')
      : [];
    const countMap: Record<string, number> = {};
    counts.forEach((c: any) => { countMap[c.organization_id] = parseInt(c.member_count); });

    const result = orgs.map((o: any) => ({ ...o, member_count: countMap[o.id] || 0 }));
    res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error('Admin orgs error', err);
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

// POST /admin/wallet/ai/adjust
router.post('/admin/wallet/ai/adjust', authenticate, requireSuperAdmin, validate(adjustWalletSchema), async (req: Request, res: Response) => {
  try {
    const { organizationId, hours, description } = req.body;
    const minutes = hours * 60;
    const wallet = await subSvc.adminAdjustAiWallet(organizationId, minutes, description);
    res.json({ success: true, data: wallet });
  } catch (err: any) {
    logger.error('Admin adjust AI error', err);
    res.status(500).json({ success: false, error: err.message || 'Adjustment failed' });
  }
});

// POST /admin/wallet/translation/adjust
router.post('/admin/wallet/translation/adjust', authenticate, requireSuperAdmin, validate(adjustWalletSchema), async (req: Request, res: Response) => {
  try {
    const { organizationId, hours, description } = req.body;
    const minutes = hours * 60;
    const wallet = await subSvc.adminAdjustTranslationWallet(organizationId, minutes, description);
    res.json({ success: true, data: wallet });
  } catch (err: any) {
    logger.error('Admin adjust translation error', err);
    res.status(500).json({ success: false, error: err.message || 'Adjustment failed' });
  }
});

// POST /admin/org/status — suspend or activate
router.post('/admin/org/status', authenticate, requireSuperAdmin, validate(orgStatusSchema), async (req: Request, res: Response) => {
  try {
    const { organizationId, action, reason } = req.body;
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
    res.json({ success: true, message: `Organization ${action}d` });
  } catch (err: any) {
    logger.error('Admin org status error', err);
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

// POST /admin/subscription/override
router.post('/admin/subscription/override', authenticate, requireSuperAdmin, validate(overrideSchema), async (req: Request, res: Response) => {
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
    res.json({ success: true, message: 'Subscription overridden' });
  } catch (err: any) {
    logger.error('Admin override error', err);
    res.status(500).json({ success: false, error: 'Override failed' });
  }
});

// GET /admin/wallet-analytics
router.get('/admin/wallet-analytics', authenticate, requireSuperAdmin, async (_req: Request, res: Response) => {
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
router.get('/admin/plans', authenticate, requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const plans = await db('subscription_plans').orderBy('sort_order', 'asc');
    res.json({ success: true, data: plans });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

// PUT /admin/plans/:planId
router.put('/admin/plans/:planId', authenticate, requireSuperAdmin, async (req: Request, res: Response) => {
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

export default router;
