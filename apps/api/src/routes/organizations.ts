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
  requireRole,
  requireSuperAdmin,
  validate,
} from '../middleware';
import { logger } from '../logger';
import { config } from '../config';

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
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, WebP, GIF, and SVG images are allowed'));
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

      // Create free license for org
      const [license] = await db('licenses')
        .insert({
          type: 'free',
          max_members: 50,
          features: JSON.stringify({
            chat: true,
            meetings: true,
            aiMinutes: false,
            financials: true,
            donations: true,
            voting: true,
          }),
          ai_credits_included: 0,
          price_monthly: 0,
        })
        .returning('*');

      // Create org
      const [org] = await db('organizations')
        .insert({
          name,
          slug,
          status: 'active',
          license_id: license.id,
          settings: JSON.stringify({
            currency,
            timezone,
            locale: 'en',
            aiEnabled: false,
            maxMembers: 50,
            features: {
              chat: true,
              meetings: true,
              aiMinutes: false,
              financials: true,
              donations: true,
              voting: true,
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

      // Initialize AI credits
      await db('ai_credits').insert({
        organization_id: org.id,
        total_credits: 0,
        used_credits: 0,
      });

      await (req as any).audit?.({
        organizationId: org.id,
        action: 'create',
        entityType: 'organization',
        entityId: org.id,
        newValue: { name, slug },
      });

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

    // Super admin sees all
    if (req.user!.globalRole !== 'super_admin') {
      const orgIds = await db('memberships')
        .where({ user_id: req.user!.userId, is_active: true })
        .pluck('organization_id');
      query = query.whereIn('id', orgIds);
    }

    const orgs = await query.select('*').orderBy('name');

    res.json({ success: true, data: orgs });
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

      const license = await db('licenses').where({ id: org.license_id }).first();

      res.json({
        success: true,
        data: {
          ...org,
          memberCount: parseInt(memberCount?.count as string) || 0,
          license,
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

      const updates: Record<string, any> = {};
      if (name) updates.name = name;
      if (settings) updates.settings = JSON.stringify(settings);

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
        // Check member limit
        const settings = typeof org.settings === 'string' ? JSON.parse(org.settings) : (org.settings || {});
        const memberCount = await db('memberships')
          .where({ organization_id: orgId, is_active: true })
          .count('id as count').first();
        if (settings.maxMembers && parseInt(memberCount?.count as string) >= settings.maxMembers) {
          res.status(403).json({ success: false, error: 'Organization has reached its member limit' });
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

      // Get committees
      const committees = await db('committee_members')
        .join('committees', 'committee_members.committee_id', 'committees.id')
        .where({ 'committee_members.user_id': req.params.userId, 'committees.organization_id': req.params.orgId })
        .select('committees.id', 'committees.name');

      // Get financial info
      const dues = await db('transactions')
        .where({ user_id: req.params.userId, organization_id: req.params.orgId, type: 'due' })
        .select('id', 'description as title', 'amount', 'status', 'created_at as dueDate')
        .orderBy('created_at', 'desc')
        .limit(20);

      const fines = await db('transactions')
        .where({ user_id: req.params.userId, organization_id: req.params.orgId, type: 'fine' })
        .select('id', 'description as reason', 'amount', 'status', 'created_at')
        .orderBy('created_at', 'desc')
        .limit(20);

      const donations = await db('donations')
        .join('donation_campaigns', 'donations.campaign_id', 'donation_campaigns.id')
        .where({ 'donations.user_id': req.params.userId, 'donation_campaigns.organization_id': req.params.orgId })
        .select('donations.id', 'donation_campaigns.title as campaignTitle', 'donations.amount', 'donations.created_at')
        .orderBy('donations.created_at', 'desc')
        .limit(20);

      const totalPaid = await db('transactions')
        .where({ user_id: req.params.userId, organization_id: req.params.orgId, status: 'paid' })
        .sum('amount as total')
        .first();

      const totalOwed = await db('transactions')
        .where({ user_id: req.params.userId, organization_id: req.params.orgId, status: 'pending' })
        .sum('amount as total')
        .first();

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
  loadMembership,
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
        // Check member limit
        const org = await db('organizations').where({ id: req.params.orgId }).first();
        const settings = typeof org.settings === 'string' ? JSON.parse(org.settings) : org.settings;
        const memberCount = await db('memberships')
          .where({ organization_id: req.params.orgId, is_active: true })
          .count('id as count')
          .first();
        if (parseInt(memberCount?.count as string) >= settings.maxMembers) {
          res.status(403).json({ success: false, error: 'Member limit reached for this license' });
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
  loadMembership,
  requireRole('org_admin'),
  async (req: Request, res: Response) => {
    try {
      const { role, isActive } = req.body;

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
  loadMembership,
  requireRole('org_admin'),
  async (req: Request, res: Response) => {
    try {
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
  requireSuperAdmin(),
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;

      const orgs = await db('organizations')
        .leftJoin('licenses', 'organizations.license_id', 'licenses.id')
        .select(
          'organizations.*',
          'licenses.type as licenseType',
          'licenses.max_members as licenseMaxMembers'
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

      const license = await db('licenses')
        .where({ id: org.license_id })
        .first();

      res.json({
        success: true,
        data: {
          id: license?.id || 'free',
          planId: license?.type || 'free',
          status: license?.is_active ? 'active' : 'expired',
          maxMembers: license?.max_members || 50,
          features: license?.features || {},
          aiCreditsIncluded: license?.ai_credits_included || 0,
          priceMonthly: parseFloat(license?.price_monthly) || 0,
          currentPeriodEnd: license?.valid_until || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
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
  loadMembership,
  requireRole('org_admin'),
  (req: Request, res: Response, next) => {
    logoUpload.single('logo')(req, res, (err) => {
      if (err) return res.status(400).json({ success: false, error: err.message });
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
  loadMembership,
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
