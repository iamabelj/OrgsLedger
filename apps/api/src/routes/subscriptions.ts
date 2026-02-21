// ============================================================
// OrgsLedger API — Subscription Routes
// Plans, subscriptions, wallets, invite links, super admin
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import db from '../db';
import { authenticate, loadMembership, requireRole, requireDeveloper, validate } from '../middleware';
import { logger } from '../logger';
import * as subSvc from '../services/subscription.service';
import { sendEmail } from '../services/email.service';
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
  maxUses: z.number().int().min(1).max(1000).default(1),
  expiresAt: z.string().optional(),
  description: z.string().max(500).optional(),
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
    if (!invite || !invite.valid) {
      res.status(404).json({ success: false, error: invite?.error || 'Invalid or expired invite link' });
      return;
    }
    // Return flattened data with org info for a premium invite UX
    res.json({
      success: true,
      data: {
        valid: true,
        role: invite.link?.role || 'member',
        organizationName: invite.organization?.name || '',
        organizationSlug: invite.organization?.slug || '',
        organizationLogo: invite.organization?.logo_url || null,
        description: invite.link?.description || null,
        expiresAt: invite.link?.expires_at || null,
        maxUses: invite.link?.max_uses || null,
        useCount: invite.link?.use_count || 0,
      },
    });
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
    const msg = err.message || '';
    const status = msg.includes('already') ? 409 :
                   msg.includes('limit') ? 403 :
                   msg.includes('Invalid') || msg.includes('expired') ? 404 : 500;
    const safeMessages: Record<number, string> = {
      409: 'You have already joined this organization',
      403: 'This organization has reached its member limit',
      404: 'Invite link is invalid or expired',
      500: 'Failed to join organization',
    };
    res.status(status).json({ success: false, error: safeMessages[status] });
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

    // Free plans activate immediately; paid plans start as pending until webhook confirms
    const isFree = price <= 0;
    const sub = await subSvc.createSubscription({
      organizationId: req.params.orgId,
      planId: plan.id,
      billingCycle,
      currency,
      amountPaid: isFree ? 0 : price,
      paymentGateway,
      gatewaySubscriptionId: paymentReference,
      status: isFree ? 'active' : 'pending',
    });
    res.json({ success: true, data: sub });
  } catch (err: any) {
    logger.error('Subscribe error', err);
    res.status(500).json({ success: false, error: 'Subscription failed' });
  }
});

// POST /:orgId/renew
router.post('/:orgId/renew', authenticate, loadMembership, requireRole('org_admin'), validate(renewSchema), async (req: Request, res: Response) => {
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
    res.status(500).json({ success: false, error: 'Renewal failed' });
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
    res.status(500).json({ success: false, error: 'Top-up failed' });
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
    res.status(500).json({ success: false, error: 'Top-up failed' });
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
    const { role, maxUses, expiresAt, description } = req.body;
    const invite = await subSvc.createInviteLink(
      req.params.orgId,
      req.user!.userId,
      role || 'member',
      maxUses || 1,
      expiresAt,
      description,
    );
    res.json({ success: true, data: invite });
  } catch (err: any) {
    logger.error('Create invite error', { orgId: req.params.orgId, error: err.message, stack: err.stack });
    // Check for common DB errors
    const msg = err.message || '';
    if (msg.includes('relation') && msg.includes('does not exist')) {
      res.status(500).json({ success: false, error: 'Database not fully migrated. Please run migrations.' });
    } else if (msg.includes('column') && msg.includes('does not exist')) {
      res.status(500).json({ success: false, error: 'Database schema outdated. Please run migrations.' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to create invite link' });
    }
  }
});

// GET /:orgId/invites
router.get('/:orgId/invites', authenticate, loadMembership, async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    const invites = await db('invite_links')
      .where({ organization_id: req.params.orgId })
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);
    res.json({ success: true, data: invites, meta: { page, limit } });
  } catch (err: any) {
    logger.error('Get invites error', { orgId: req.params.orgId, error: err.message });
    // If table doesn't exist, return empty array instead of error
    if (err.message?.includes('does not exist')) {
      res.json({ success: true, data: [] });
    } else {
      res.status(500).json({ success: false, error: 'Failed to get invites' });
    }
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
router.get('/admin/revenue', authenticate, requireDeveloper(), async (_req: Request, res: Response) => {
  try {
    const revenue = await subSvc.getPlatformRevenue();

    // Per-plan revenue breakdown
    const byPlan = await db('subscriptions')
      .join('subscription_plans', 'subscriptions.plan_id', 'subscription_plans.id')
      .where('subscriptions.amount_paid', '>', 0)
      .groupBy('subscription_plans.slug', 'subscriptions.currency')
      .select(
        'subscription_plans.slug as plan',
        'subscriptions.currency',
        db.raw('COUNT(*) as count'),
        db.raw('COALESCE(SUM(subscriptions.amount_paid), 0) as revenue'),
      );

    // Separate USD / NGN sums
    const subRevenueUsd = byPlan.filter((r: any) => r.currency === 'USD').reduce((s: number, r: any) => s + parseFloat(r.revenue || 0), 0);
    const subRevenueNgn = byPlan.filter((r: any) => r.currency === 'NGN').reduce((s: number, r: any) => s + parseFloat(r.revenue || 0), 0);

    const aiTxUsd = await db('ai_wallet_transactions').where({ type: 'topup', currency: 'USD' }).select(db.raw('COALESCE(SUM(cost),0) as total')).first();
    const aiTxNgn = await db('ai_wallet_transactions').where({ type: 'topup', currency: 'NGN' }).select(db.raw('COALESCE(SUM(cost),0) as total')).first();
    const transTxUsd = await db('translation_wallet_transactions').where({ type: 'topup', currency: 'USD' }).select(db.raw('COALESCE(SUM(cost),0) as total')).first();
    const transTxNgn = await db('translation_wallet_transactions').where({ type: 'topup', currency: 'NGN' }).select(db.raw('COALESCE(SUM(cost),0) as total')).first();

    const walletRevenueUsd = parseFloat(aiTxUsd?.total || 0) + parseFloat(transTxUsd?.total || 0);
    const walletRevenueNgn = parseFloat(aiTxNgn?.total || 0) + parseFloat(transTxNgn?.total || 0);

    // Total AI usage hours across all orgs
    const aiUsage = await db('ai_wallet_transactions').where('amount_minutes', '<', 0).select(db.raw('COALESCE(SUM(ABS(amount_minutes)),0) as total')).first();
    const transUsage = await db('translation_wallet_transactions').where('amount_minutes', '<', 0).select(db.raw('COALESCE(SUM(ABS(amount_minutes)),0) as total')).first();

    // Flatten response to match dashboard expectations
    res.json({
      success: true,
      subscription_revenue_usd: subRevenueUsd,
      subscription_revenue_ngn: subRevenueNgn,
      wallet_revenue_usd: walletRevenueUsd,
      wallet_revenue_ngn: walletRevenueNgn,
      total_revenue_usd: subRevenueUsd + walletRevenueUsd,
      total_revenue_ngn: subRevenueNgn + walletRevenueNgn,
      total_ai_hours_used: parseFloat(aiUsage?.total || 0) / 60,
      total_translation_hours_used: parseFloat(transUsage?.total || 0) / 60,
      by_plan: byPlan.map((r: any) => ({
        plan: r.plan,
        currency: r.currency,
        count: parseInt(r.count),
        revenue_usd: r.currency === 'USD' ? parseFloat(r.revenue) : 0,
        revenue_ngn: r.currency === 'NGN' ? parseFloat(r.revenue) : 0,
      })),
      // Also include structured data for API consumers
      data: revenue,
    });
  } catch (err: any) {
    logger.error('Admin revenue error', err);
    res.status(500).json({ success: false, error: 'Failed to get revenue' });
  }
});

// GET /admin/subscriptions
router.get('/admin/subscriptions', authenticate, requireDeveloper(), async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const subs = await db('subscriptions')
      .join('subscription_plans', 'subscriptions.plan_id', 'subscription_plans.id')
      .join('organizations', 'subscriptions.organization_id', 'organizations.id')
      .leftJoin(
        db('memberships').groupBy('organization_id').select('organization_id').count('* as member_count').as('mc'),
        'organizations.id', 'mc.organization_id'
      )
      .select(
        'subscriptions.id',
        'subscriptions.organization_id',
        'subscriptions.status',
        'subscriptions.billing_cycle',
        'subscriptions.currency',
        'subscriptions.amount_paid',
        'subscriptions.current_period_end',
        'subscriptions.current_period_start',
        'subscriptions.grace_period_end',
        'subscriptions.created_at',
        'subscription_plans.name as plan_name',
        'subscription_plans.slug as plan',
        'organizations.name as org_name',
        'organizations.subscription_status',
        db.raw('COALESCE(mc.member_count, 0) as member_count'),
      )
      .orderBy('subscriptions.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    // Return as `subscriptions` to match frontend expectations
    res.json({ success: true, subscriptions: subs });
  } catch (err: any) {
    logger.error('Admin subscriptions error', err);
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

// GET /admin/organizations — list all orgs with subscription + wallet info
router.get('/admin/organizations', authenticate, requireDeveloper(), async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    // Use a subquery for the LATEST subscription per org to prevent duplicate
    // rows when an org has multiple non-cancelled subscriptions (e.g. an expired
    // one that was never cleaned up plus a newly-assigned active one).
    const baseQuery = db('organizations')
      .leftJoin(
        db.raw(`(
          SELECT DISTINCT ON (organization_id) *
          FROM subscriptions
          WHERE status IN ('active', 'grace_period', 'expired')
          ORDER BY organization_id, created_at DESC
        ) AS latest_sub`),
        'organizations.id',
        'latest_sub.organization_id',
      )
      .leftJoin('subscription_plans', 'latest_sub.plan_id', 'subscription_plans.id')
      .leftJoin('ai_wallet', 'organizations.id', 'ai_wallet.organization_id')
      .leftJoin('translation_wallet', 'organizations.id', 'translation_wallet.organization_id');

    const [{ count: totalCount }] = await db('organizations').count('* as count');

    const orgs = await baseQuery
      .select(
        'organizations.id',
        'organizations.name',
        'organizations.slug',
        'organizations.status',
        'organizations.subscription_status',
        'organizations.billing_currency',
        'organizations.billing_country',
        'organizations.created_at',
        'subscription_plans.name as plan_name',
        'subscription_plans.slug as plan_slug',
        'latest_sub.status as sub_status',
        'latest_sub.current_period_end',
        'ai_wallet.balance_minutes as ai_balance_minutes',
        'translation_wallet.balance_minutes as translation_balance_minutes',
      )
      .orderBy('organizations.created_at', 'desc')
      .limit(limit)
      .offset(offset);

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
    res.json({ success: true, organizations: result, pagination: { page, limit, total: parseInt(totalCount as string) } });
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
  plan: z.string().min(1).max(100).default('standard'),
  currency: z.enum(['USD', 'NGN']).default('USD'),
});

router.post('/admin/organizations', authenticate, requireDeveloper(), validate(adminCreateOrgSchema), async (req: Request, res: Response) => {
  try {
    const { name, slug, ownerEmail, plan, currency } = req.body;
    const normalizedEmail = ownerEmail.toLowerCase().trim();

    // Check slug uniqueness
    const existing = await db('organizations').where({ slug }).first();
    if (existing) {
      res.status(409).json({ success: false, error: 'Slug already taken' });
      return;
    }

    // Check if user exists
    const owner = await db('users').where({ email: normalizedEmail }).first();

    // Wrap all creation in a transaction for atomicity
    const result = await db.transaction(async (trx) => {
      // Create organization
      const [org] = await trx('organizations')
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

      let membershipCreated = false;
      let pendingInviteCreated = false;

      if (owner) {
        // User exists — create membership immediately
        await trx('memberships').insert({
          user_id: owner.id,
          organization_id: org.id,
          role: 'org_admin',
        });
        membershipCreated = true;

        // Create default General channel and add user
        const [channel] = await trx('channels')
          .insert({
            organization_id: org.id,
            name: 'General',
            type: 'general',
            description: 'General discussion',
          })
          .returning('*');

        await trx('channel_members').insert({
          channel_id: channel.id,
          user_id: owner.id,
        });
      } else {
        // User doesn't exist — create pending invitation
        await trx('pending_invitations').insert({
          email: normalizedEmail,
          organization_id: org.id,
          role: 'org_admin',
          invited_by: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.user!.userId)
            ? req.user!.userId
            : null,
        });
        pendingInviteCreated = true;

        // Still create the General channel (without members for now)
        await trx('channels').insert({
          organization_id: org.id,
          name: 'General',
          type: 'general',
          description: 'General discussion',
        });
      }

      // Provision subscription
      const selectedPlan = await subSvc.getPlanBySlug(plan);
      if (selectedPlan) {
        await subSvc.createSubscription({
          organizationId: org.id,
          planId: selectedPlan.id,
          billingCycle: 'annual',
          currency,
          amountPaid: 0,
          createdBy: owner?.id || req.user!.userId,
        });
      } else {
        logger.warn(`Plan slug "${plan}" not found — organization created without subscription. Available plans should be created first.`);
      }

      // Provision wallets
      await subSvc.getAiWallet(org.id);
      await subSvc.getTranslationWallet(org.id);

      // Generate invite link for additional members
      const invite = await subSvc.createInviteLink(org.id, owner?.id || req.user!.userId, 'member');

      return { org, membershipCreated, pendingInviteCreated, invite };
    });

    const { org, membershipCreated, pendingInviteCreated, invite } = result;

    await writeAuditLog({
      organizationId: org.id,
      userId: req.user!.userId,
      action: 'admin_create_org',
      entityType: 'organization',
      entityId: org.id,
      newValue: { name, slug, ownerEmail, plan, currency, pendingInvite: pendingInviteCreated },
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });

    logger.info(`Admin created organization: ${name} (${slug}) for ${ownerEmail}${pendingInviteCreated ? ' (pending invite)' : ''}`);

    const statusMsg = pendingInviteCreated
      ? `Pending invitation created for ${normalizedEmail}. They will auto-join when they register.`
      : `${normalizedEmail} has been added as org_admin.`;

    res.status(201).json({
      success: true,
      organization: org,
      inviteCode: invite.code,
      ownerStatus: pendingInviteCreated ? 'pending' : 'active',
      message: `Organization "${name}" created. ${statusMsg} Plan: ${plan}.`,
    });
  } catch (err: any) {
    logger.error('Admin create org error', err);
    res.status(500).json({ success: false, error: 'Failed to create organization' });
  }
});

// POST /admin/wallet/ai/adjust
router.post('/admin/wallet/ai/adjust', authenticate, requireDeveloper(), validate(adjustWalletSchema), async (req: Request, res: Response) => {
  try {
    const organizationId = req.body.organizationId || req.body.organization_id;
    const hours = req.body.hours;
    const description = req.body.description || req.body.reason;
    const minutes = hours * 60;
    // Ensure wallet row exists before adjusting
    await subSvc.getAiWallet(organizationId);
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
router.post('/admin/wallet/translation/adjust', authenticate, requireDeveloper(), validate(adjustWalletSchema), async (req: Request, res: Response) => {
  try {
    const organizationId = req.body.organizationId || req.body.organization_id;
    const hours = req.body.hours;
    const description = req.body.description || req.body.reason;
    const minutes = hours * 60;
    // Ensure wallet row exists before adjusting
    await subSvc.getTranslationWallet(organizationId);
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
router.post('/admin/org/status', authenticate, requireDeveloper(), validate(orgStatusSchema), async (req: Request, res: Response) => {
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
router.post('/admin/subscription/override', authenticate, requireDeveloper(), validate(overrideSchema), async (req: Request, res: Response) => {
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
router.get('/admin/wallet-analytics', authenticate, requireDeveloper(), async (_req: Request, res: Response) => {
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

    // Per-org wallet data (dashboard shows per-org table)
    const perOrg = await db('organizations')
      .leftJoin('ai_wallet', 'organizations.id', 'ai_wallet.organization_id')
      .leftJoin('translation_wallet', 'organizations.id', 'translation_wallet.organization_id')
      .select(
        'organizations.id',
        'organizations.name',
        'organizations.billing_currency',
        db.raw('COALESCE(ai_wallet.balance_minutes, 0) as ai_balance_minutes'),
        db.raw('COALESCE(translation_wallet.balance_minutes, 0) as translation_balance_minutes'),
      )
      .orderBy('organizations.name');

    // Add usage stats per org
    const orgIds = perOrg.map((o: any) => o.id);
    let aiUsageByOrg: Record<string, number> = {};
    let transUsageByOrg: Record<string, number> = {};
    if (orgIds.length > 0) {
      const aiUsageRows = await db('ai_wallet_transactions')
        .whereIn('organization_id', orgIds)
        .where('amount_minutes', '<', 0)
        .groupBy('organization_id')
        .select('organization_id', db.raw('SUM(ABS(amount_minutes)) as used_minutes'));
      aiUsageRows.forEach((r: any) => { aiUsageByOrg[r.organization_id] = parseFloat(r.used_minutes || 0); });

      const transUsageRows = await db('translation_wallet_transactions')
        .whereIn('organization_id', orgIds)
        .where('amount_minutes', '<', 0)
        .groupBy('organization_id')
        .select('organization_id', db.raw('SUM(ABS(amount_minutes)) as used_minutes'));
      transUsageRows.forEach((r: any) => { transUsageByOrg[r.organization_id] = parseFloat(r.used_minutes || 0); });
    }

    const organizations = perOrg.map((o: any) => ({
      id: o.id,
      org_id: o.id,
      name: o.name,
      org_name: o.name,
      currency: o.billing_currency || 'USD',
      ai_balance: parseFloat(o.ai_balance_minutes || 0),
      ai_used: aiUsageByOrg[o.id] || 0,
      translation_balance: parseFloat(o.translation_balance_minutes || 0),
      translation_used: transUsageByOrg[o.id] || 0,
      // Keep hours variants for backward compat
      ai_balance_hours: parseFloat(o.ai_balance_minutes || 0) / 60,
      ai_used_hours: (aiUsageByOrg[o.id] || 0) / 60,
      translation_balance_hours: parseFloat(o.translation_balance_minutes || 0) / 60,
      translation_used_hours: (transUsageByOrg[o.id] || 0) / 60,
    }));

    const totalAiBalance = parseFloat(aiStats?.total_balance || '0');
    const totalAiUsed = parseFloat(aiTxStats?.total_used || '0');
    const totalTranslationBalance = parseFloat(transStats?.total_balance || '0');
    const totalTranslationUsed = parseFloat(transTxStats?.total_used || '0');

    res.json({
      success: true,
      platformTotals: {
        totalAiBalance: totalAiBalance,
        totalAiUsed: totalAiUsed,
        totalTranslationBalance: totalTranslationBalance,
        totalTranslationUsed: totalTranslationUsed,
      },
      summary: {
        total_ai_balance_hours: totalAiBalance / 60,
        total_ai_used_hours: totalAiUsed / 60,
        total_ai_sold_hours: parseFloat(aiTxStats?.total_added || '0') / 60,
        ai_wallet_count: parseInt(aiStats?.wallet_count || '0'),
        total_translation_balance_hours: totalTranslationBalance / 60,
        total_translation_used_hours: totalTranslationUsed / 60,
        total_translation_sold_hours: parseFloat(transTxStats?.total_added || '0') / 60,
        translation_wallet_count: parseInt(transStats?.wallet_count || '0'),
      },
      organizations,
    });
  } catch (err: any) {
    logger.error('Wallet analytics error', err);
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

// ════════════════════════════════════════════════════════════
// SUBSCRIPTION PLAN MANAGEMENT (Developer)
// ════════════════════════════════════════════════════════════

// GET /admin/plans
router.get('/admin/plans', authenticate, requireDeveloper(), async (_req: Request, res: Response) => {
  try {
    const plans = await db('subscription_plans').orderBy('sort_order', 'asc');
    // Get subscriber counts per plan
    const planIds = plans.map((p: any) => p.id);
    const counts = planIds.length > 0
      ? await db('subscriptions')
          .whereIn('plan_id', planIds)
          .whereIn('status', ['active', 'grace_period'])
          .groupBy('plan_id')
          .select('plan_id', db.raw('COUNT(*) as subscriber_count'))
      : [];
    const countMap: Record<string, number> = {};
    counts.forEach((c: any) => { countMap[c.plan_id] = parseInt(c.subscriber_count); });
    
    const enriched = plans.map((p: any) => ({
      ...p,
      subscriber_count: countMap[p.id] || 0,
    }));
    res.json({ success: true, data: enriched });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed' });
  }
});

// POST /admin/plans — Create new subscription plan
const createPlanSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().optional(),
  maxMembers: z.number().int().min(1).default(100),
  priceUsdAnnual: z.number().min(0).default(0),
  priceUsdMonthly: z.number().min(0).optional(),
  priceNgnAnnual: z.number().min(0).default(0),
  priceNgnMonthly: z.number().min(0).optional(),
  features: z.record(z.boolean()).optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

router.post('/admin/plans', authenticate, requireDeveloper(), validate(createPlanSchema), async (req: Request, res: Response) => {
  try {
    const { name, slug, description, maxMembers, priceUsdAnnual, priceUsdMonthly, priceNgnAnnual, priceNgnMonthly, features, sortOrder, isActive } = req.body;
    
    // Check slug uniqueness
    const existing = await db('subscription_plans').where({ slug }).first();
    if (existing) {
      res.status(409).json({ success: false, error: 'Plan slug already exists' });
      return;
    }

    const [plan] = await db('subscription_plans')
      .insert({
        name,
        slug,
        description: description || null,
        max_members: maxMembers,
        price_usd_annual: priceUsdAnnual,
        price_usd_monthly: priceUsdMonthly || null,
        price_ngn_annual: priceNgnAnnual,
        price_ngn_monthly: priceNgnMonthly || null,
        features: features ? JSON.stringify(features) : '{}',
        sort_order: sortOrder,
        is_active: isActive,
      })
      .returning('*');

    await writeAuditLog({
      userId: req.user!.userId,
      action: 'create',
      entityType: 'subscription_plan',
      entityId: plan.id,
      newValue: { name, slug, priceUsdAnnual, maxMembers },
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });

    logger.info(`Created subscription plan: ${name} (${slug})`);
    res.status(201).json({ success: true, data: plan });
  } catch (err: any) {
    logger.error('Create plan error', err);
    res.status(500).json({ success: false, error: 'Failed to create plan' });
  }
});

// PUT /admin/plans/:planId
const updatePlanFieldsSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(1000).optional(),
  price_usd_annual: z.number().min(0).optional(),
  price_usd_monthly: z.number().min(0).optional(),
  price_ngn_annual: z.number().min(0).optional(),
  price_ngn_monthly: z.number().min(0).optional(),
  max_members: z.number().int().min(1).optional(),
  features: z.any().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
}).strict();

router.put('/admin/plans/:planId', authenticate, requireDeveloper(), validate(updatePlanFieldsSchema), async (req: Request, res: Response) => {
  try {
    const previous = await db('subscription_plans').where({ id: req.params.planId }).first();
    if (!previous) {
      res.status(404).json({ success: false, error: 'Plan not found' });
      return;
    }

    const allowed = ['name', 'description', 'price_usd_annual', 'price_usd_monthly', 'price_ngn_annual', 'price_ngn_monthly', 'max_members', 'features', 'is_active', 'sort_order'];
    const updates: any = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    updates.updated_at = new Date();
    await db('subscription_plans').where({ id: req.params.planId }).update(updates);
    const plan = await db('subscription_plans').where({ id: req.params.planId }).first();

    await writeAuditLog({
      userId: req.user!.userId,
      action: 'update',
      entityType: 'subscription_plan',
      entityId: req.params.planId,
      previousValue: previous,
      newValue: updates,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });

    res.json({ success: true, data: plan });
  } catch (err: any) {
    logger.error('Update plan error', err);
    res.status(500).json({ success: false, error: 'Failed to update plan' });
  }
});

// DELETE /admin/plans/:planId — Archive a plan (soft delete via is_active)
router.delete('/admin/plans/:planId', authenticate, requireDeveloper(), async (req: Request, res: Response) => {
  try {
    const plan = await db('subscription_plans').where({ id: req.params.planId }).first();
    if (!plan) {
      res.status(404).json({ success: false, error: 'Plan not found' });
      return;
    }

    // Check if any active subscriptions use this plan
    const activeCount = await db('subscriptions')
      .where({ plan_id: req.params.planId })
      .whereIn('status', ['active', 'grace_period'])
      .count('id as count')
      .first();

    if (parseInt(activeCount?.count as string) > 0) {
      // Soft delete - just deactivate
      await db('subscription_plans').where({ id: req.params.planId }).update({ is_active: false, updated_at: new Date() });
      
      await writeAuditLog({
        userId: req.user!.userId,
        action: 'archive',
        entityType: 'subscription_plan',
        entityId: req.params.planId,
        previousValue: plan,
        newValue: { is_active: false, reason: 'Has active subscribers' },
        ipAddress: req.ip || '',
        userAgent: req.headers['user-agent'] || '',
      });

      res.json({ success: true, message: 'Plan archived (has active subscribers)', archived: true });
      return;
    }

    // Hard delete if no active subscriptions
    await db('subscription_plans').where({ id: req.params.planId }).delete();

    await writeAuditLog({
      userId: req.user!.userId,
      action: 'delete',
      entityType: 'subscription_plan',
      entityId: req.params.planId,
      previousValue: plan,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });

    logger.info(`Deleted subscription plan: ${plan.name} (${plan.slug})`);
    res.json({ success: true, message: 'Plan deleted' });
  } catch (err: any) {
    logger.error('Delete plan error', err);
    res.status(500).json({ success: false, error: 'Failed to delete plan' });
  }
});

// ════════════════════════════════════════════════════════════
// ORGANIZATION MANAGEMENT (Developer)
// ════════════════════════════════════════════════════════════

// GET /admin/organizations/:orgId — Get detailed org info
router.get('/admin/organizations/:orgId', authenticate, requireDeveloper(), async (req: Request, res: Response) => {
  try {
    const org = await db('organizations').where({ id: req.params.orgId }).first();
    if (!org) {
      res.status(404).json({ success: false, error: 'Organization not found' });
      return;
    }

    // Get subscription
    const subscription = await db('subscriptions')
      .where({ organization_id: req.params.orgId })
      .whereIn('status', ['active', 'grace_period', 'expired', 'suspended'])
      .orderBy('created_at', 'desc')
      .first();

    const plan = subscription 
      ? await db('subscription_plans').where({ id: subscription.plan_id }).first()
      : null;

    // Get wallets
    const aiWallet = await db('ai_wallet').where({ organization_id: req.params.orgId }).first();
    const translationWallet = await db('translation_wallet').where({ organization_id: req.params.orgId }).first();

    // Get member count and list of admins
    const memberCount = await db('memberships')
      .where({ organization_id: req.params.orgId, is_active: true })
      .count('id as count')
      .first();

    const admins = await db('memberships')
      .join('users', 'memberships.user_id', 'users.id')
      .where({ 'memberships.organization_id': req.params.orgId, 'memberships.is_active': true })
      .whereIn('memberships.role', ['org_admin', 'executive'])
      .select('users.id', 'users.email', 'users.first_name', 'users.last_name', 'memberships.role');

    // Get recent activity
    const recentActivity = await db('audit_logs')
      .where({ organization_id: req.params.orgId })
      .orderBy('created_at', 'desc')
      .limit(10)
      .select('*');

    res.json({
      success: true,
      data: {
        ...org,
        settings: typeof org.settings === 'string' ? JSON.parse(org.settings) : org.settings,
        subscription: subscription ? { ...subscription, plan } : null,
        aiWallet,
        translationWallet,
        memberCount: parseInt(memberCount?.count as string) || 0,
        admins,
        recentActivity,
      },
    });
  } catch (err: any) {
    logger.error('Get org detail error', err);
    res.status(500).json({ success: false, error: 'Failed to get organization' });
  }
});

// PUT /admin/organizations/:orgId — Update org info
const updateOrgSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/).optional(),
  status: z.enum(['active', 'suspended', 'pending']).optional(),
  subscriptionStatus: z.enum(['active', 'grace_period', 'expired', 'cancelled', 'suspended']).optional(),
  billingCurrency: z.enum(['USD', 'NGN']).optional(),
  billingCountry: z.string().max(5).optional(),
  settings: z.record(z.any()).optional(),
});

router.put('/admin/organizations/:orgId', authenticate, requireDeveloper(), validate(updateOrgSchema), async (req: Request, res: Response) => {
  try {
    const previous = await db('organizations').where({ id: req.params.orgId }).first();
    if (!previous) {
      res.status(404).json({ success: false, error: 'Organization not found' });
      return;
    }

    const { name, slug, status, subscriptionStatus, billingCurrency, billingCountry, settings } = req.body;

    // Check slug uniqueness if changed
    if (slug && slug !== previous.slug) {
      const existing = await db('organizations').where({ slug }).whereNot({ id: req.params.orgId }).first();
      if (existing) {
        res.status(409).json({ success: false, error: 'Slug already taken by another organization' });
        return;
      }
    }

    const updates: Record<string, any> = { updated_at: new Date() };
    if (name !== undefined) updates.name = name;
    if (slug !== undefined) updates.slug = slug;
    if (status !== undefined) updates.status = status;
    if (subscriptionStatus !== undefined) updates.subscription_status = subscriptionStatus;
    if (billingCurrency !== undefined) updates.billing_currency = billingCurrency;
    if (billingCountry !== undefined) updates.billing_country = billingCountry;
    if (settings !== undefined) {
      // Merge with existing settings
      const existingSettings = typeof previous.settings === 'string' 
        ? JSON.parse(previous.settings || '{}') 
        : (previous.settings || {});
      updates.settings = JSON.stringify({ ...existingSettings, ...settings });
    }

    await db('organizations').where({ id: req.params.orgId }).update(updates);

    // If subscription status is being set to 'active', also renew the actual subscription record
    // so that getOrgSubscription() doesn't auto-expire it back
    if (subscriptionStatus === 'active') {
      const existingSub = await db('subscriptions')
        .where({ organization_id: req.params.orgId })
        .orderBy('created_at', 'desc')
        .first();
      if (existingSub) {
        const now = new Date();
        const periodEnd = new Date(existingSub.current_period_end);
        // If subscription period has expired, extend it for another year from now
        if (now > periodEnd) {
          const newEnd = new Date(now);
          newEnd.setFullYear(newEnd.getFullYear() + 1);
          const newGrace = new Date(newEnd);
          newGrace.setDate(newGrace.getDate() + 7);
          await db('subscriptions').where({ id: existingSub.id }).update({
            status: 'active',
            current_period_start: now.toISOString(),
            current_period_end: newEnd.toISOString(),
            grace_period_end: newGrace.toISOString(),
            updated_at: db.fn.now(),
          });
          logger.info(`Auto-renewed subscription for org ${req.params.orgId} (was expired)`);
        } else {
          // Period hasn't expired yet, just set status back to active
          await db('subscriptions').where({ id: existingSub.id }).update({
            status: 'active',
            updated_at: db.fn.now(),
          });
        }
      }
    }

    await writeAuditLog({
      organizationId: req.params.orgId,
      userId: req.user!.userId,
      action: 'admin_update_org',
      entityType: 'organization',
      entityId: req.params.orgId,
      previousValue: { name: previous.name, slug: previous.slug, status: previous.status },
      newValue: updates,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });

    const updated = await db('organizations').where({ id: req.params.orgId }).first();
    logger.info(`Admin updated organization: ${updated.name} (${updated.slug})`);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    logger.error('Update org error', err);
    res.status(500).json({ success: false, error: 'Failed to update organization' });
  }
});

// POST /admin/organizations/:orgId/assign-plan — Assign/renew a subscription plan for an existing org
const assignPlanSchema = z.object({
  planSlug: z.string().min(1).max(100),
  billingCycle: z.enum(['annual', 'monthly']).default('annual'),
  currency: z.enum(['USD', 'NGN']).default('USD'),
});

router.post('/admin/organizations/:orgId/assign-plan', authenticate, requireDeveloper(), validate(assignPlanSchema), async (req: Request, res: Response) => {
  try {
    const org = await db('organizations').where({ id: req.params.orgId }).first();
    if (!org) {
      res.status(404).json({ success: false, error: 'Organization not found' });
      return;
    }

    const { planSlug, billingCycle, currency } = req.body;
    const plan = await subSvc.getPlanBySlug(planSlug);
    if (!plan) {
      res.status(404).json({ success: false, error: `Plan "${planSlug}" not found. Create the plan first.` });
      return;
    }

    // Create a fresh subscription (this deactivates any previous ones)
    const sub = await subSvc.createSubscription({
      organizationId: org.id,
      planId: plan.id,
      billingCycle,
      currency,
      amountPaid: 0, // Developer/admin override — no payment required
      createdBy: req.user!.userId,
    });

    // Ensure wallets exist
    await subSvc.getAiWallet(org.id);
    await subSvc.getTranslationWallet(org.id);

    await writeAuditLog({
      organizationId: org.id,
      userId: req.user!.userId,
      action: 'admin_assign_plan',
      entityType: 'subscription',
      entityId: sub?.id || org.id,
      newValue: { planSlug, billingCycle, currency, planName: plan.name },
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });

    logger.info(`Admin assigned plan "${plan.name}" to org "${org.name}" (${org.slug})`);

    // Return fresh subscription details
    const freshSub = await subSvc.getOrgSubscription(org.id);
    res.json({
      success: true,
      message: `Plan "${plan.name}" (${billingCycle}) assigned to "${org.name}". Subscription is now active.`,
      subscription: freshSub,
    });
  } catch (err: any) {
    logger.error('Assign plan error', err);
    res.status(500).json({ success: false, error: 'Failed to assign plan' });
  }
});

// DELETE /admin/organizations/:orgId — Delete organization (with safety checks)
router.delete('/admin/organizations/:orgId', authenticate, requireDeveloper(), async (req: Request, res: Response) => {
  try {
    const org = await db('organizations').where({ id: req.params.orgId }).first();
    if (!org) {
      res.status(404).json({ success: false, error: 'Organization not found' });
      return;
    }

    // Require confirmation via query param
    if (req.query.confirm !== 'yes') {
      res.status(400).json({ 
        success: false, 
        error: 'Deletion requires confirmation. Add ?confirm=yes to proceed.',
        warning: `This will permanently delete "${org.name}" and all associated data.`,
      });
      return;
    }

    // Log before deletion
    await writeAuditLog({
      organizationId: req.params.orgId,
      userId: req.user!.userId,
      action: 'admin_delete_org',
      entityType: 'organization',
      entityId: req.params.orgId,
      previousValue: org,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });

    // Delete organization (cascades to related tables)
    await db('organizations').where({ id: req.params.orgId }).delete();

    logger.warn(`Admin DELETED organization: ${org.name} (${org.slug}) by user ${req.user!.userId}`);
    res.json({ success: true, message: `Organization "${org.name}" deleted` });
  } catch (err: any) {
    logger.error('Delete org error', err);
    res.status(500).json({ success: false, error: 'Failed to delete organization' });
  }
});

// ════════════════════════════════════════════════════════════
// USER MANAGEMENT (Developer)
// ════════════════════════════════════════════════════════════

// GET /admin/users — List all platform users
router.get('/admin/users', authenticate, requireDeveloper(), async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const search = req.query.search as string;
    const globalRole = req.query.globalRole as string;

    let query = db('users')
      .select(
        'users.id',
        'users.email',
        'users.first_name',
        'users.last_name',
        'users.global_role',
        'users.email_verified',
        'users.created_at',
        'users.last_login_at',
        db.raw('(SELECT COUNT(*) FROM memberships WHERE memberships.user_id = users.id AND memberships.is_active = true) as org_count'),
      );

    if (search) {
      const escapedSearch = search.replace(/[%_\\]/g, '\\$&');
      query = query.where((qb) => {
        qb.where('users.email', 'ilike', `%${escapedSearch}%`)
          .orWhere('users.first_name', 'ilike', `%${escapedSearch}%`)
          .orWhere('users.last_name', 'ilike', `%${escapedSearch}%`);
      });
    }

    if (globalRole) {
      query = query.where('users.global_role', globalRole);
    }

    const total = await query.clone().clear('select').count('users.id as count').first();
    const users = await query
      .orderBy('users.created_at', 'desc')
      .offset((page - 1) * limit)
      .limit(limit);

    res.json({
      success: true,
      data: users,
      meta: {
        page,
        limit,
        total: parseInt(total?.count as string) || 0,
      },
    });
  } catch (err: any) {
    logger.error('List users error', err);
    res.status(500).json({ success: false, error: 'Failed to list users' });
  }
});

// GET /admin/users/:userId — Get user details
router.get('/admin/users/:userId', authenticate, requireDeveloper(), async (req: Request, res: Response) => {
  try {
    const user = await db('users')
      .where({ id: req.params.userId })
      .select('id', 'email', 'first_name', 'last_name', 'phone', 'global_role', 'email_verified', 'avatar_url', 'created_at', 'last_login_at')
      .first();

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // Get user's memberships
    const memberships = await db('memberships')
      .join('organizations', 'memberships.organization_id', 'organizations.id')
      .where({ 'memberships.user_id': req.params.userId })
      .select(
        'memberships.id',
        'memberships.role',
        'memberships.is_active',
        'memberships.joined_at',
        'organizations.id as org_id',
        'organizations.name as org_name',
        'organizations.slug as org_slug',
      );

    // Get recent audit activity
    const recentActivity = await db('audit_logs')
      .where({ user_id: req.params.userId })
      .orderBy('created_at', 'desc')
      .limit(20)
      .select('*');

    res.json({
      success: true,
      data: {
        ...user,
        memberships,
        recentActivity,
      },
    });
  } catch (err: any) {
    logger.error('Get user detail error', err);
    res.status(500).json({ success: false, error: 'Failed to get user' });
  }
});

// PUT /admin/users/:userId — Update user
const updateUserSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  globalRole: z.enum(['member', 'developer', 'super_admin']).optional(),
  isVerified: z.boolean().optional(),
});

router.put('/admin/users/:userId', authenticate, requireDeveloper(), validate(updateUserSchema), async (req: Request, res: Response) => {
  try {
    const previous = await db('users').where({ id: req.params.userId }).first();
    if (!previous) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const { firstName, lastName, globalRole, isVerified } = req.body;

    const updates: Record<string, any> = { updated_at: new Date() };
    if (firstName !== undefined) updates.first_name = firstName;
    if (lastName !== undefined) updates.last_name = lastName;
    if (globalRole !== undefined) updates.global_role = globalRole;
    if (isVerified !== undefined) updates.email_verified = isVerified;

    await db('users').where({ id: req.params.userId }).update(updates);

    await writeAuditLog({
      userId: req.user!.userId,
      action: 'admin_update_user',
      entityType: 'user',
      entityId: req.params.userId,
      previousValue: { globalRole: previous.global_role, isVerified: previous.email_verified },
      newValue: updates,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });

    const updated = await db('users')
      .where({ id: req.params.userId })
      .select('id', 'email', 'first_name', 'last_name', 'global_role', 'email_verified')
      .first();

    logger.info(`Admin updated user: ${updated.email} - role: ${updated.global_role}`);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    logger.error('Update user error', err);
    res.status(500).json({ success: false, error: 'Failed to update user' });
  }
});

// ════════════════════════════════════════════════════════════
// RISK MONITORING ENDPOINTS
// ════════════════════════════════════════════════════════════

// GET /admin/audit-logs — Platform-wide audit log for developer console
router.get('/admin/audit-logs', authenticate, requireDeveloper(), async (req: Request, res: Response) => {
  try {
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
    const offset = (page - 1) * limit;
    const { action, entityType, orgId } = req.query;

    let query = db('audit_logs')
      .leftJoin('users', 'audit_logs.user_id', 'users.id')
      .leftJoin('organizations', 'audit_logs.organization_id', 'organizations.id')
      .select(
        'audit_logs.id',
        'audit_logs.action',
        'audit_logs.entity_type',
        'audit_logs.entity_id',
        'audit_logs.ip_address',
        'audit_logs.created_at',
        'audit_logs.user_id',
        'audit_logs.organization_id',
        db.raw("COALESCE(users.first_name || ' ' || users.last_name, users.email, 'System') as user_name"),
        db.raw("COALESCE(organizations.name, '') as org_name"),
      );

    if (action) query = query.where({ 'audit_logs.action': action as string });
    if (entityType) query = query.where({ 'audit_logs.entity_type': entityType as string });
    if (orgId) query = query.where({ 'audit_logs.organization_id': orgId as string });

    const total = await query.clone().clearSelect().clearOrder().count('audit_logs.id as count').first();
    const logs = await query
      .orderBy('audit_logs.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    res.json({
      success: true,
      data: logs,
      pagination: {
        page,
        limit,
        total: parseInt(total?.count as string) || 0,
        pages: Math.ceil((parseInt(total?.count as string) || 0) / limit),
      },
    });
  } catch (err: any) {
    logger.error('Admin audit logs error', err);
    res.status(500).json({ success: false, error: 'Failed to get audit logs' });
  }
});

// GET /admin/risk/low-balances — orgs with wallets below threshold
router.get('/admin/risk/low-balances', authenticate, requireDeveloper(), async (req: Request, res: Response) => {
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

    // Merge into per-org view for dashboard
    const orgMap: Record<string, any> = {};
    for (const w of [...lowAi, ...lowTranslation, ...emptyAi, ...emptyTranslation]) {
      if (!orgMap[w.org_id]) orgMap[w.org_id] = { id: w.org_id, org_id: w.org_id, name: w.org_name, org_name: w.org_name, ai_balance: 0, translation_balance: 0, ai_balance_hours: 0, translation_balance_hours: 0, type: 'low' };
      const mins = parseFloat(w.balance_minutes);
      const hours = mins / 60;
      if (w.wallet_type === 'ai') { orgMap[w.org_id].ai_balance = mins; orgMap[w.org_id].ai_balance_hours = hours; }
      else { orgMap[w.org_id].translation_balance = mins; orgMap[w.org_id].translation_balance_hours = hours; }
      if (hours <= 0) orgMap[w.org_id].type = 'critical';
    }

    const lowBalancesArr = Object.values(orgMap);
    res.json({
      success: true,
      low_balances: lowBalancesArr,
      lowBalances: lowBalancesArr,
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
router.get('/admin/risk/spikes', authenticate, requireDeveloper(), async (req: Request, res: Response) => {
  try {
    const daysBack = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 365);
    const spikeMultiplier = Math.min(Math.max(parseFloat(req.query.multiplier as string) || 3, 1.5), 20);
    const lookbackDays = daysBack + 30;

    // Get daily AI usage per org for the analysis period + prior 30 days for baseline
    const aiDaily = await db('ai_wallet_transactions')
      .where('amount_minutes', '<', 0)
      .where('created_at', '>=', db.raw("NOW() - make_interval(days := ?)", [lookbackDays]))
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
      .where('created_at', '>=', db.raw("NOW() - make_interval(days := ?)", [lookbackDays]))
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

    // Get failed payments in recent period (use LEFT JOIN to handle missing orgs)
    let failedPayments: any[] = [];
    try {
      failedPayments = await db('transactions')
        .where('transactions.status', 'failed')
        .where('transactions.created_at', '>=', db.raw("NOW() - make_interval(days := ?)", [daysBack]))
        .leftJoin('organizations', 'transactions.organization_id', 'organizations.id')
        .select(
          'transactions.organization_id',
          db.raw("COALESCE(organizations.name, 'Unknown') as org_name"),
          db.raw('COUNT(*) as failed_count'),
          db.raw('SUM(transactions.amount) as failed_amount'),
        )
        .groupBy('transactions.organization_id', 'organizations.name')
        .orderBy('failed_count', 'desc');
    } catch (paymentErr: any) {
      logger.warn('Failed payments query error (non-fatal)', paymentErr.message);
    }

    // Enrich spikes with org names
    const orgIds = [...new Set([...aiSpikes, ...transSpikes].map(s => s.organization_id))];
    const orgNames: Record<string, string> = {};
    if (orgIds.length > 0) {
      const orgs = await db('organizations').whereIn('id', orgIds).select('id', 'name');
      orgs.forEach((o: any) => { orgNames[o.id] = o.name; });
    }
    aiSpikes.forEach(s => { s.org_name = orgNames[s.organization_id] || 'Unknown'; });
    transSpikes.forEach(s => { s.org_name = orgNames[s.organization_id] || 'Unknown'; });

    // Flatten spikes for dashboard
    const allSpikes = [...aiSpikes, ...transSpikes].map(s => ({
      name: s.org_name,
      organization_name: s.org_name,
      spike_type: s.wallet_type,
      current_usage: s.recent_max_minutes,
      average_usage: s.baseline_avg_minutes,
      spike_ratio: s.spike_ratio,
      description: `${s.wallet_type} usage ${s.recent_max_minutes.toFixed(0)}min vs avg ${s.baseline_avg_minutes.toFixed(0)}min (${s.spike_ratio}x)`,
    }));

    res.json({
      success: true,
      spikes: allSpikes,
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

// ════════════════════════════════════════════════════════════
// SIGNUP INVITE MANAGEMENT (Super Admin)
// ════════════════════════════════════════════════════════════

const createSignupInviteSchema = z.object({
  email: z.string().email().optional().nullable(),
  role: z.enum(['member', 'executive', 'org_admin']).default('member'),
  organizationId: z.string().uuid().optional().nullable(),
  maxUses: z.number().int().min(1).default(1),
  expiresInDays: z.number().int().min(1).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});

// POST /admin/signup-invites — Create a signup invite link
router.post('/admin/signup-invites', authenticate, requireDeveloper(), validate(createSignupInviteSchema), async (req: Request, res: Response) => {
  try {
    const { email, role, organizationId, maxUses, expiresInDays, note } = req.body;
    const code = crypto.randomBytes(8).toString('hex').toUpperCase();
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const [invite] = await db('signup_invites').insert({
      code,
      email: email ? email.toLowerCase() : null,
      role: role || 'member',
      organization_id: organizationId || null,
      max_uses: maxUses ?? 1,
      expires_at: expiresAt,
      is_active: true,
      created_by: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.user!.userId)
        ? req.user!.userId
        : null,
      note: note || null,
    }).returning('*');

    // Build the invite URL
    const baseUrl = process.env.APP_URL || 'https://app.orgsledger.com';
    const inviteUrl = `${baseUrl}/register?invite=${code}`;

    // If email is provided, send the invite email
    if (email) {
      try {
        await sendEmail({
          to: email.toLowerCase(),
          subject: 'You\'re Invited to Join OrgsLedger',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: #0B1426; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
                <h1 style="color: #C9A84C; margin: 0; font-size: 24px;">OrgsLedger</h1>
              </div>
              <div style="background: #f8f9fa; padding: 32px; border-radius: 0 0 8px 8px;">
                <h2 style="color: #0B1426; margin-top: 0;">You've Been Invited!</h2>
                <p style="color: #555;">You have been invited to create an account on OrgsLedger — Your organization's operational hub.</p>
                <p style="color: #555;">Use the invite code below to register:</p>
                <div style="background: #0B1426; color: #C9A84C; font-size: 24px; font-weight: bold; text-align: center; padding: 16px; border-radius: 8px; letter-spacing: 4px; margin: 16px 0;">${code}</div>
                <p style="text-align: center; margin: 20px 0;">
                  <a href="${inviteUrl}" style="background: #C9A84C; color: #0B1426; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Create Your Account</a>
                </p>
                ${expiresAt ? `<p style="color: #888; font-size: 13px;">This invite expires on ${expiresAt.toLocaleDateString()}.</p>` : ''}
                <p style="color: #888; font-size: 13px;">If you didn't expect this invitation, you can safely ignore this email.</p>
              </div>
              <p style="color: #aaa; font-size: 11px; text-align: center; margin-top: 16px;">&copy; ${new Date().getFullYear()} OrgsLedger. All rights reserved.</p>
            </div>
          `,
          text: `You've been invited to join OrgsLedger! Use invite code: ${code} or visit: ${inviteUrl}`,
        });
        logger.info(`Signup invite email sent to ${email} with code ${code}`);
      } catch (emailErr) {
        logger.warn('Failed to send signup invite email:', emailErr);
      }
    }

    await writeAuditLog({
      userId: req.user!.userId,
      action: 'create_signup_invite',
      entityType: 'signup_invite',
      entityId: invite.id,
      newValue: { code, email, role, organizationId, maxUses, expiresInDays },
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });

    logger.info(`Signup invite created: ${code} by ${req.user!.userId}`);
    res.status(201).json({ success: true, data: { ...invite, inviteUrl } });
  } catch (err: any) {
    logger.error('Create signup invite error', err);
    res.status(500).json({ success: false, error: 'Failed to create signup invite' });
  }
});

// GET /admin/signup-invites — List all signup invites
router.get('/admin/signup-invites', authenticate, requireDeveloper(), async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    const status = req.query.status as string; // 'active', 'expired', 'used', 'all'

    let query = db('signup_invites')
      .leftJoin('organizations', 'signup_invites.organization_id', 'organizations.id')
      .leftJoin('users as creator', 'signup_invites.created_by', 'creator.id')
      .select(
        'signup_invites.*',
        'organizations.name as organization_name',
        'organizations.slug as organization_slug',
        'creator.first_name as creator_first_name',
        'creator.last_name as creator_last_name',
      );

    if (status === 'active') {
      query = query.where('signup_invites.is_active', true);
    } else if (status === 'expired') {
      query = query.where('signup_invites.expires_at', '<', new Date());
    } else if (status === 'used') {
      query = query.whereRaw('signup_invites.use_count >= signup_invites.max_uses')
        .whereNotNull('signup_invites.max_uses');
    }

    const invites = await query
      .orderBy('signup_invites.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db('signup_invites').count('* as count');

    res.json({ success: true, data: invites, total: parseInt(count as string), page, limit });
  } catch (err: any) {
    logger.error('List signup invites error', err);
    res.status(500).json({ success: false, error: 'Failed to list signup invites' });
  }
});

// DELETE /admin/signup-invites/:inviteId — Deactivate a signup invite
router.delete('/admin/signup-invites/:inviteId', authenticate, requireDeveloper(), async (req: Request, res: Response) => {
  try {
    await db('signup_invites').where({ id: req.params.inviteId }).update({ is_active: false });
    res.json({ success: true, message: 'Signup invite deactivated' });
  } catch (err: any) {
    logger.error('Delete signup invite error', err);
    res.status(500).json({ success: false, error: 'Failed to deactivate signup invite' });
  }
});

// GET /admin/signup-invites/validate/:code — Public: validate signup invite code
router.get('/invite/validate/:code', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const invite = await db('signup_invites').where({ code, is_active: true }).first();

    if (!invite) {
      res.status(404).json({ success: false, valid: false, error: 'Invalid invite code' });
      return;
    }
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      res.status(410).json({ success: false, valid: false, error: 'Invite code has expired' });
      return;
    }
    if (invite.max_uses && invite.use_count >= invite.max_uses) {
      res.status(410).json({ success: false, valid: false, error: 'Invite code has reached its maximum uses' });
      return;
    }

    // Optionally fetch organization name
    let organizationName = null;
    if (invite.organization_id) {
      const org = await db('organizations').where({ id: invite.organization_id }).first();
      organizationName = org?.name || null;
    }

    // Mask email to prevent PII leakage on public endpoint
    let maskedEmail: string | null = null;
    if (invite.email) {
      const [local, domain] = invite.email.split('@');
      maskedEmail = local.length > 2
        ? `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}@${domain}`
        : `${local[0]}***@${domain}`;
    }

    res.json({
      success: true,
      valid: true,
      data: {
        code: invite.code,
        role: invite.role,
        email: maskedEmail,
        targetedEmail: !!invite.email,
        organizationName,
        expiresAt: invite.expires_at,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to validate invite code' });
  }
});

export default router;
