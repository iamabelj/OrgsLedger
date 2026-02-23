// ============================================================
// OrgsLedger API — Organization Routes
// CRUD, settings, member management
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import db from '../db';
import {
  authenticate,
  loadMembership,
  loadMembershipAndSub,
  requireRole,
  requireDeveloper,
  validate,
} from '../middleware';
import { logger } from '../logger';
import { config } from '../config';
import { cacheAside, cacheDel } from '../services/cache.service';
import {
  getOrgSubscription,
  createSubscription,
  getAiWallet,
  getTranslationWallet,
  getPlanBySlug,
  getPlanPrice,
  getCurrency,
  createInviteLink,
  checkMemberLimit,
} from '../services/subscription.service';

const router = Router();

// ── Multer for logo uploads ────────────────────────────────
const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.resolve(config.upload.dir, 'logos');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req: any, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `org_${req.params.orgId}_${Date.now()}${ext}`);
  },
});
const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed. SVG not permitted for security.'));
  },
});

// ── Schemas ─────────────────────────────────────────────────
const createOrgSchema = z.object({
  name: z.string().min(2).max(200),
  slug: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9-]+$/),
  currency: z.string().length(3).default('USD'),
  timezone: z.string().default('UTC'),
});

const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['org_admin', 'executive', 'member', 'guest']).default('member'),
});

// ── Create Organization ─────────────────────────────────────
router.post(
  '/',
  authenticate,
  validate(createOrgSchema),
  async (req: Request, res: Response) => {
    try {
      const { name, slug, currency, timezone } = req.body;

      // Check slug uniqueness
      const existing = await db('organizations').where({ slug }).first();
      if (existing) {
        res.status(409).json({ success: false, error: 'Slug already taken' });
        return;
      }

      // Create org
      const [org] = await db('organizations')
        .insert({
          name,
          slug,
          status: 'active',
          subscription_status: 'active',
          billing_currency: currency === 'NGN' ? 'NGN' : 'USD',
          settings: JSON.stringify({
            currency,
            timezone,
            locale: 'en',
            aiEnabled: true,
            features: {
              chat: true,
              meetings: true,
              financials: true,
              polls: true,
              events: true,
              announcements: true,
              documents: true,
              committees: true,
            },
          }),
        })
        .returning('*');

      // Make creator org_admin
      await db('memberships').insert({
        user_id: req.user!.userId,
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
        user_id: req.user!.userId,
      });

      // Provision SaaS: Standard plan subscription + wallets
      const standardPlan = await getPlanBySlug('standard');
      if (standardPlan) {
        await createSubscription({
          organizationId: org.id,
          planId: standardPlan.id,
          billingCycle: 'annual',
          currency: currency === 'NGN' ? 'NGN' : 'USD',
          amountPaid: 0,
          createdBy: req.user!.userId,
        });
      }
      await getAiWallet(org.id); // auto-creates
      await getTranslationWallet(org.id); // auto-creates

      // Generate initial invite link for org admin
      const invite = await createInviteLink(org.id, req.user!.userId, 'member');

      await (req as any).audit?.({
        organizationId: org.id,
        action: 'create',
        entityType: 'organization',
        entityId: org.id,
        newValue: { name, slug },
      });

      // Invalidate org list cache for this user
      await cacheDel(`orgs:list:${req.user!.userId}:*`).catch(() => {});

      logger.info(`Organization created: ${name} (${slug})`);

      res.status(201).json({ success: true, data: org });
    } catch (err) {
      logger.error('Create org error', err);
      res.status(500).json({ success: false, error: 'Failed to create organization' });
    }
  }
);

// ── List User's Organizations ───────────────────────────────
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    let query = db('organizations');

    // Super admin and developer see all
    if (req.user!.globalRole !== 'super_admin' && req.user!.globalRole !== 'developer') {
      const orgIds = await db('memberships')
        .where({ user_id: req.user!.userId, is_active: true })
        .pluck('organization_id');
      query = query.whereIn('id', orgIds);
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 100));
    const offset = (page - 1) * limit;

    const cacheKey = `orgs:list:${req.user!.userId}:p${page}:l${limit}`;
    const result = await cacheAside(cacheKey, 30, async () => {
      const total = await query.clone().clear('select').count('id as count').first();
      const orgs = await query.select('*').orderBy('name').limit(limit).offset(offset);
      return { data: orgs, meta: { page, limit, total: parseInt(total?.count as string) || 0 } };
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to list organizations' });
  }
});

// ── Get Organization Detail ─────────────────────────────────
router.get(
  '/:orgId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const org = await db('organizations').where({ id: req.params.orgId }).first();
      if (!org) {
        res.status(404).json({ success: false, error: 'Organization not found' });
        return;
      }

      const memberCount = await db('memberships')
        .where({ organization_id: req.params.orgId, is_active: true })
        .count('id as count')
        .first();

      // SaaS subscription + wallet info
      const subscription = await getOrgSubscription(req.params.orgId);
      const [aiWallet, translationWallet] = await Promise.all([
        getAiWallet(req.params.orgId),
        getTranslationWallet(req.params.orgId),
      ]);

      res.json({
        success: true,
        data: {
          ...org,
          memberCount: parseInt(memberCount?.count as string) || 0,
          subscription,
          aiWallet,
          translationWallet,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get organization' });
    }
  }
);

// ── Update Organization Settings ────────────────────────────
router.put(
  '/:orgId/settings',
  authenticate,
  loadMembership,
  requireRole('org_admin'),
  async (req: Request, res: Response) => {
    try {
      const previous = await db('organizations').where({ id: req.params.orgId }).first();
      const { name, settings } = req.body;

      // Validate settings shape if provided
      const ALLOWED_SETTINGS_KEYS = [
        'allowPublicJoin', 'requireApproval', 'defaultRole',
        'billingCurrency', 'paymentMethods', 'enablePaystack', 'enableStripe', 'enableFlutterwave',
        'enableBankTransfer', 'bankDetails', 'primaryColor', 'accentColor',
        'currency', 'defaultLanguage', 'timezone', 'locale', 'aiEnabled', 'features',
        'notifications', 'enabledGateways', 'description',
        // Per-org payment gateway credentials (canonical structure)
        'payment_methods',
        // Gateway credentials (flat keys — legacy / fallback)
        'stripePublicKey', 'stripeSecretKey',
        'paystackPublicKey', 'paystackSecretKey',
        'flutterwavePublicKey', 'flutterwaveSecretKey',
        // Bank transfer details (flat keys)
        'bankName', 'bankAccountName', 'bankAccountNumber', 'bankRoutingCode',
      ];

      const updates: Record<string, any> = {};
      if (name && typeof name === 'string' && name.trim().length > 0 && name.length <= 200) {
        updates.name = name.trim();
      }

      // Handle slug as top-level org column
      if (settings?.slug && typeof settings.slug === 'string') {
        updates.slug = settings.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
      }
      // description is stored inside the JSON settings object (no DB column)

      if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
        // Merge with existing settings instead of replacing
        let existingSettings: Record<string, any> = {};
        try {
          const org = await db('organizations').where({ id: req.params.orgId }).select('settings').first();
          if (org?.settings) {
            existingSettings = typeof org.settings === 'string' ? JSON.parse(org.settings) : org.settings;
          }
        } catch {}

        const filtered: Record<string, any> = { ...existingSettings };
        for (const key of Object.keys(settings)) {
          if (ALLOWED_SETTINGS_KEYS.includes(key)) {
            filtered[key] = settings[key];
          }
        }
        updates.settings = JSON.stringify(filtered);

        // Update billing_currency column when currency changes
        if (settings.currency && typeof settings.currency === 'string') {
          updates.billing_currency = settings.currency.toUpperCase();
        }
      }

      await db('organizations').where({ id: req.params.orgId }).update(updates);

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'settings_change',
        entityType: 'organization',
        entityId: req.params.orgId,
        previousValue: { name: previous.name, settings: previous.settings },
        newValue: updates,
      });

      res.json({ success: true, message: 'Settings updated' });
    } catch (err) {
      logger.error('Update settings error', err);
      res.status(500).json({ success: false, error: 'Failed to update settings' });
    }
  }
);

// ── List Members ────────────────────────────────────────────
router.get(
  '/:orgId/members',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const search = req.query.search as string;

      let query = db('memberships')
        .join('users', 'memberships.user_id', 'users.id')
        .where({
          'memberships.organization_id': req.params.orgId,
          'memberships.is_active': true,
        })
        .select(
          'memberships.id',
          'memberships.role',
          'memberships.joined_at',
          'users.id as userId',
          'users.email',
          'users.first_name',
          'users.last_name',
          'users.avatar_url'
        );

      if (search) {
        // Escape LIKE special characters to prevent injection
        const escapedSearch = search.replace(/[%_\\]/g, '\\$&');
        query = query.where((qb) => {
          qb.where('users.email', 'ilike', `%${escapedSearch}%`)
            .orWhere('users.first_name', 'ilike', `%${escapedSearch}%`)
            .orWhere('users.last_name', 'ilike', `%${escapedSearch}%`);
        });
      }

      const total = await query.clone().clear('select').count('memberships.id as count').first();
      const members = await query
        .orderBy('users.first_name')
        .offset((page - 1) * limit)
        .limit(limit);

      res.json({
        success: true,
        data: members,
        meta: {
          page,
          limit,
          total: parseInt(total?.count as string) || 0,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to list members' });
    }
  }
);

// ── Look Up Organization by Slug ────────────────────────────
router.get(
  '/lookup/:slug',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const org = await db('organizations').where({ slug: req.params.slug }).first();
      if (!org) {
        res.status(404).json({ success: false, error: 'Organization not found' });
        return;
      }
      const memberCount = await db('memberships')
        .where({ organization_id: org.id, is_active: true })
        .count('id as count').first();
      res.json({
        success: true,
        data: { id: org.id, name: org.name, slug: org.slug, memberCount: parseInt(memberCount?.count as string) || 0 },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to look up organization' });
    }
  }
);

// ── Join Organization (Self-join) ───────────────────────────
// Requires org to have public joining enabled in settings, or use invite links instead
router.post(
  '/:orgId/join',
  authenticate,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const orgId = req.params.orgId;

      const org = await db('organizations').where({ id: orgId }).first();
      if (!org) {
        res.status(404).json({ success: false, error: 'Organization not found' });
        return;
      }

      // Check if public joining is allowed for this org
      const settings = typeof org.settings === 'string' ? JSON.parse(org.settings || '{}') : (org.settings || {});
      if (!settings.allowPublicJoin) {
        res.status(403).json({ success: false, error: 'This organization does not allow public joining. Use an invite link instead.' });
        return;
      }

      // Check if already a member
      const existing = await db('memberships')
        .where({ user_id: userId, organization_id: orgId })
        .first();
      if (existing) {
        if (existing.is_active) {
          res.status(409).json({ success: false, error: 'You are already a member of this organization' });
          return;
        }
        // Reactivate
        await db('memberships').where({ id: existing.id }).update({ is_active: true, role: 'member' });
      } else {
        // Check member limit from subscription plan
        const { allowed, current, max } = await checkMemberLimit(orgId);
        if (!allowed) {
          res.status(403).json({ success: false, error: `Organization has reached its member limit (${current}/${max}). An admin needs to upgrade the plan.` });
          return;
        }

        await db('memberships').insert({
          user_id: userId,
          organization_id: orgId,
          role: 'member',
        });
      }

      // Add to general channel
      const generalChannel = await db('channels')
        .where({ organization_id: orgId, type: 'general' })
        .first();
      if (generalChannel) {
        await db('channel_members')
          .insert({ channel_id: generalChannel.id, user_id: userId })
          .onConflict(['channel_id', 'user_id'])
          .ignore();
      }

      res.status(201).json({ success: true, message: 'Successfully joined organization', data: { organizationId: orgId, name: org.name } });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to join organization' });
    }
  }
);

// ── Get Single Member Detail ────────────────────────────────
router.get(
  '/:orgId/members/:userId',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const member = await db('memberships')
        .join('users', 'memberships.user_id', 'users.id')
        .where({
          'memberships.organization_id': req.params.orgId,
          'memberships.user_id': req.params.userId,
        })
        .select(
          'memberships.id',
          'memberships.role',
          'memberships.joined_at',
          'memberships.is_active',
          'users.id as userId',
          'users.email',
          'users.first_name',
          'users.last_name',
          'users.phone',
          'users.avatar_url'
        )
        .first();

      if (!member) {
        res.status(404).json({ success: false, error: 'Member not found' });
        return;
      }

      // Parallelize independent member-detail queries (was sequential N+1)
      const [committees, dues, fines, donations, totalPaid, totalOwed] = await Promise.all([
        db('committee_members')
          .join('committees', 'committee_members.committee_id', 'committees.id')
          .where({ 'committee_members.user_id': req.params.userId, 'committees.organization_id': req.params.orgId })
          .select('committees.id', 'committees.name'),

        db('transactions')
          .where({ user_id: req.params.userId, organization_id: req.params.orgId, type: 'due' })
          .select('id', 'description as title', 'amount', 'status', 'created_at as dueDate')
          .orderBy('created_at', 'desc')
          .limit(20),

        db('transactions')
          .where({ user_id: req.params.userId, organization_id: req.params.orgId, type: 'fine' })
          .select('id', 'description as reason', 'amount', 'status', 'created_at')
          .orderBy('created_at', 'desc')
          .limit(20),

        db('donations')
          .join('donation_campaigns', 'donations.campaign_id', 'donation_campaigns.id')
          .where({ 'donations.user_id': req.params.userId, 'donation_campaigns.organization_id': req.params.orgId })
          .select('donations.id', 'donation_campaigns.title as campaignTitle', 'donations.amount', 'donations.created_at')
          .orderBy('donations.created_at', 'desc')
          .limit(20),

        db('transactions')
          .where({ user_id: req.params.userId, organization_id: req.params.orgId, status: 'completed' })
          .sum('amount as total')
          .first(),

        db('transactions')
          .where({ user_id: req.params.userId, organization_id: req.params.orgId, status: 'pending' })
          .sum('amount as total')
          .first(),
      ]);

      res.json({
        success: true,
        data: {
          id: member.userId,
          fullName: `${member.first_name} ${member.last_name}`,
          email: member.email,
          phone: member.phone,
          role: member.role,
          joinedAt: member.joined_at,
          avatarUrl: member.avatar_url,
          committees,
          financials: {
            totalPaid: parseFloat(totalPaid?.total) || 0,
            totalOwed: parseFloat(totalOwed?.total) || 0,
            dues,
            fines,
            donations,
          },
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get member detail' });
    }
  }
);

// ── Add Member ──────────────────────────────────────────────
router.post(
  '/:orgId/members',
  authenticate,
  loadMembershipAndSub,
  requireRole('org_admin', 'executive'),
  validate(addMemberSchema),
  async (req: Request, res: Response) => {
    try {
      const { email, role } = req.body;

      const user = await db('users').where({ email }).first();
      if (!user) {
        res.status(404).json({ success: false, error: 'User not found. They must register first.' });
        return;
      }

      const existing = await db('memberships')
        .where({ user_id: user.id, organization_id: req.params.orgId })
        .first();
      if (existing) {
        if (existing.is_active) {
          res.status(409).json({ success: false, error: 'User is already a member' });
          return;
        }
        // Reactivate
        await db('memberships').where({ id: existing.id }).update({ is_active: true, role });
      } else {
        // Check member limit from subscription plan
        const { allowed, current, max } = await checkMemberLimit(req.params.orgId);
        if (!allowed) {
          res.status(403).json({ success: false, error: `Organization has reached its member limit (${current}/${max}). Upgrade the plan to add more members.` });
          return;
        }

        await db('memberships').insert({
          user_id: user.id,
          organization_id: req.params.orgId,
          role,
        });
      }

      // Add to general channel
      const generalChannel = await db('channels')
        .where({ organization_id: req.params.orgId, type: 'general' })
        .first();
      if (generalChannel) {
        await db('channel_members')
          .insert({ channel_id: generalChannel.id, user_id: user.id })
          .onConflict(['channel_id', 'user_id'])
          .ignore();
      }

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'create',
        entityType: 'membership',
        entityId: user.id,
        newValue: { email, role },
      });

      res.status(201).json({ success: true, message: 'Member added' });
    } catch (err) {
      logger.error('Add member error', err);
      res.status(500).json({ success: false, error: 'Failed to add member' });
    }
  }
);

// ── Update Member Role ──────────────────────────────────────
router.put(
  '/:orgId/members/:userId',
  authenticate,
  loadMembershipAndSub,
  requireRole('org_admin'),
  async (req: Request, res: Response) => {
    try {
      const { role, isActive } = req.body;

      // Only developer can assign developer or super_admin roles
      if (role && ['developer', 'super_admin'].includes(role) && req.user!.globalRole !== 'developer') {
        res.status(403).json({ success: false, error: 'Only the platform developer can assign this role' });
        return;
      }

      const membership = await db('memberships')
        .where({ user_id: req.params.userId, organization_id: req.params.orgId })
        .first();
      if (!membership) {
        res.status(404).json({ success: false, error: 'Membership not found' });
        return;
      }

      const updates: Record<string, any> = {};
      if (role) updates.role = role;
      if (isActive !== undefined) updates.is_active = isActive;

      // Prevent demoting the last org_admin
      if (role && membership.role === 'org_admin' && role !== 'org_admin') {
        const adminCount = await db('memberships')
          .where({ organization_id: req.params.orgId, role: 'org_admin', is_active: true })
          .count('id as count')
          .first();
        if ((parseInt(adminCount?.count as string) || 0) <= 1) {
          res.status(400).json({ success: false, error: 'Cannot demote the last admin. Promote another member first.' });
          return;
        }
      }

      const previousValue = { role: membership.role, is_active: membership.is_active };
      await db('memberships').where({ id: membership.id }).update(updates);

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'role_change',
        entityType: 'membership',
        entityId: membership.id,
        previousValue,
        newValue: updates,
      });

      res.json({ success: true, message: 'Member updated' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to update member' });
    }
  }
);

// ── Remove Member ───────────────────────────────────────────
router.delete(
  '/:orgId/members/:userId',
  authenticate,
  loadMembershipAndSub,
  requireRole('org_admin'),
  async (req: Request, res: Response) => {
    try {
      // Prevent removing yourself
      if (req.params.userId === req.user!.userId) {
        res.status(400).json({ success: false, error: 'You cannot remove yourself. Transfer ownership first.' });
        return;
      }

      // Prevent removing last org_admin
      const target = await db('memberships')
        .where({ user_id: req.params.userId, organization_id: req.params.orgId, is_active: true })
        .first();
      if (target?.role === 'org_admin') {
        const adminCount = await db('memberships')
          .where({ organization_id: req.params.orgId, role: 'org_admin', is_active: true })
          .count('id as count')
          .first();
        if ((parseInt(adminCount?.count as string) || 0) <= 1) {
          res.status(400).json({ success: false, error: 'Cannot remove the last admin. Promote another member first.' });
          return;
        }
      }

      await db('memberships')
        .where({ user_id: req.params.userId, organization_id: req.params.orgId })
        .update({ is_active: false });

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'delete',
        entityType: 'membership',
        entityId: req.params.userId,
      });

      res.json({ success: true, message: 'Member removed' });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to remove member' });
    }
  }
);

// ── Platform: List All Orgs (Super Admin) ───────────────────
router.get(
  '/platform/all',
  authenticate,
  requireDeveloper(),
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;

      const orgs = await db('organizations')
        .leftJoin('subscriptions', 'organizations.id', 'subscriptions.organization_id')
        .leftJoin('subscription_plans', 'subscriptions.plan_id', 'subscription_plans.id')
        .select(
          'organizations.*',
          'subscription_plans.slug as planSlug',
          'subscription_plans.name as planName',
          'subscription_plans.max_members as planMaxMembers',
          'subscriptions.status as subStatus'
        )
        .orderBy('organizations.created_at', 'desc')
        .offset((page - 1) * limit)
        .limit(limit);

      const total = await db('organizations').count('id as count').first();

      res.json({
        success: true,
        data: orgs,
        meta: { page, limit, total: parseInt(total?.count as string) || 0 },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to list all organizations' });
    }
  }
);

// ── Edit History (visible to ALL members) ───────────────────
// Returns audit log entries for edit (update) actions only,
// so all members can see what was changed and by whom.
router.get(
  '/:orgId/edit-history',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(100, parseInt(req.query.limit as string) || 30);
      const entityType = req.query.entityType as string;
      const entityId = req.query.entityId as string;

      let query = db('audit_logs')
        .where({ 'audit_logs.organization_id': req.params.orgId, 'audit_logs.action': 'update' })
        .leftJoin('users', 'audit_logs.user_id', 'users.id')
        .select(
          'audit_logs.id',
          'audit_logs.action',
          'audit_logs.entity_type',
          'audit_logs.entity_id',
          'audit_logs.previous_value',
          'audit_logs.new_value',
          'audit_logs.created_at',
          'users.first_name',
          'users.last_name'
        );

      if (entityType) query = query.where({ 'audit_logs.entity_type': entityType });
      if (entityId) query = query.where({ 'audit_logs.entity_id': entityId });

      const total = await query.clone().clear('select').count('audit_logs.id as count').first();
      const logs = await query
        .orderBy('audit_logs.created_at', 'desc')
        .offset((page - 1) * limit)
        .limit(limit);

      // Parse JSONB columns for the response
      const parsed = logs.map((log: any) => ({
        ...log,
        previous_value: typeof log.previous_value === 'string'
          ? JSON.parse(log.previous_value) : log.previous_value,
        new_value: typeof log.new_value === 'string'
          ? JSON.parse(log.new_value) : log.new_value,
        editedBy: `${log.first_name || ''} ${log.last_name || ''}`.trim() || 'Unknown',
      }));

      res.json({
        success: true,
        data: parsed,
        meta: { page, limit, total: parseInt(total?.count as string) || 0 },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get edit history' });
    }
  }
);

// ── Organization Audit Log (for compliance dashboard) ───────
router.get(
  '/:orgId/audit-logs',
  authenticate,
  loadMembership,
  requireRole('org_admin'),
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const action = req.query.action as string;
      const entityType = req.query.entityType as string;

      let query = db('audit_logs')
        .where({ 'audit_logs.organization_id': req.params.orgId })
        .leftJoin('users', 'audit_logs.user_id', 'users.id')
        .select(
          'audit_logs.id',
          'audit_logs.action',
          'audit_logs.entity_type',
          'audit_logs.entity_id',
          'audit_logs.ip_address',
          'audit_logs.created_at',
          'users.email',
          'users.first_name',
          'users.last_name'
        );

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

// ── Get Member Activity Log ─────────────────────────────────
router.get(
  '/:orgId/members/:userId/activity',
  authenticate,
  loadMembership,
  requireRole('org_admin', 'executive'),
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 30;

      const activities = await db('audit_logs')
        .where({
          user_id: req.params.userId,
          organization_id: req.params.orgId,
        })
        .select('id', 'action', 'entity_type', 'entity_id', 'new_value', 'ip_address', 'created_at')
        .orderBy('created_at', 'desc')
        .offset((page - 1) * limit)
        .limit(limit);

      const total = await db('audit_logs')
        .where({ user_id: req.params.userId, organization_id: req.params.orgId })
        .count('id as count')
        .first();

      res.json({
        success: true,
        data: activities,
        meta: { page, limit, total: parseInt(total?.count as string) || 0 },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get member activity' });
    }
  }
);

// ── Get Organization Subscription ───────────────────────────
router.get(
  '/:orgId/subscription',
  authenticate,
  loadMembership,
  async (req: Request, res: Response) => {
    try {
      const org = await db('organizations')
        .where({ id: req.params.orgId })
        .first();
      if (!org) {
        res.status(404).json({ success: false, error: 'Organization not found' });
        return;
      }

      const subscription = await db('subscriptions')
        .where({ organization_id: req.params.orgId })
        .orderBy('created_at', 'desc')
        .first();

      let plan = null;
      if (subscription) {
        plan = await db('subscription_plans')
          .where({ id: subscription.plan_id })
          .first();
      }

      const aiWallet = await db('ai_wallet')
        .where({ organization_id: req.params.orgId })
        .first();

      res.json({
        success: true,
        data: {
          id: subscription?.id || 'free',
          planId: plan?.slug || 'standard',
          planName: plan?.name || 'Standard',
          status: subscription?.status || org.subscription_status || 'active',
          maxMembers: plan?.max_members || 100,
          features: plan?.features || {},
          billingCycle: subscription?.billing_cycle || 'annual',
          currency: subscription?.currency || org.billing_currency,
          currentPeriodEnd: subscription?.current_period_end || null,
          gracePeriodEnd: subscription?.grace_period_end || null,
          aiWalletBalance: parseFloat(aiWallet?.balance_minutes) || 0,
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to get subscription' });
    }
  }
);

// ── Upload Organization Logo ──────────────────────────────
router.post(
  '/:orgId/logo',
  authenticate,
  loadMembershipAndSub,
  requireRole('org_admin'),
  (req: Request, res: Response, next) => {
    logoUpload.single('logo')(req, res, (err) => {
      if (err) {
        logger.warn('Logo upload error', err);
        return res.status(400).json({ success: false, error: 'Invalid file upload' });
      }
      next();
    });
  },
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No image file provided' });
      }

      const logoUrl = `/uploads/logos/${req.file.filename}`;
      await db('organizations').where({ id: req.params.orgId }).update({ logo_url: logoUrl });

      logger.info(`Logo uploaded for org ${req.params.orgId}: ${logoUrl}`);

      res.json({
        success: true,
        data: { logoUrl },
        message: 'Logo uploaded successfully',
      });
    } catch (err) {
      logger.error('Logo upload error:', err);
      res.status(500).json({ success: false, error: 'Failed to upload logo' });
    }
  }
);

// ── Update Organization Branding ──────────────────────────
router.put(
  '/:orgId/branding',
  authenticate,
  loadMembershipAndSub,
  requireRole('org_admin'),
  async (req: Request, res: Response) => {
    try {
      const { primaryColor, secondaryColor, accentColor, tagline, description, website } = req.body;

      const org = await db('organizations').where({ id: req.params.orgId }).first();
      if (!org) {
        return res.status(404).json({ success: false, error: 'Organization not found' });
      }

      // Merge branding into settings JSON
      const settings = typeof org.settings === 'string' ? JSON.parse(org.settings) : (org.settings || {});
      settings.branding = {
        ...(settings.branding || {}),
        primaryColor: primaryColor || settings.branding?.primaryColor || '#6366f1',
        secondaryColor: secondaryColor || settings.branding?.secondaryColor || '#8b5cf6',
        accentColor: accentColor || settings.branding?.accentColor || '#f59e0b',
        tagline: tagline !== undefined ? tagline : (settings.branding?.tagline || ''),
        description: description !== undefined ? description : (settings.branding?.description || ''),
        website: website !== undefined ? website : (settings.branding?.website || ''),
      };

      await db('organizations')
        .where({ id: req.params.orgId })
        .update({ settings: JSON.stringify(settings) });

      await (req as any).audit?.({
        organizationId: req.params.orgId,
        action: 'settings_change',
        entityType: 'organization',
        entityId: req.params.orgId,
        newValue: { branding: settings.branding },
      });

      res.json({
        success: true,
        data: { branding: settings.branding },
        message: 'Branding updated successfully',
      });
    } catch (err) {
      logger.error('Branding update error:', err);
      res.status(500).json({ success: false, error: 'Failed to update branding' });
    }
  }
);

export default router;
