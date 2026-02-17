// ============================================================
// OrgsLedger API — Auth Routes
// Registration, Login, Token Refresh, Password Reset
// ============================================================

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import db from '../db';
import { config } from '../config';
import { authenticate, validate, writeAuditLog } from '../middleware';
import { logger } from '../logger';
import { checkMemberLimit } from '../services/subscription.service';
import { sendEmail } from '../services/email.service';
import { timingSafeCompare } from '../utils/validators';

const router = Router();

// ── Multer for avatar uploads ───────────────────────────────
const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.resolve(config.upload.dir, 'avatars');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req: any, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${req.user?.userId || 'unknown'}_${Date.now()}${ext}`);
  },
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'));
  },
});

// ── Schemas ─────────────────────────────────────────────────
const registerSchema = z.object({
  email: z.string({ required_error: 'Email is required' }).email('Please enter a valid email address'),
  password: z.string({ required_error: 'Password is required' }).min(8, 'Password must be at least 8 characters').max(128, 'Password is too long'),
  firstName: z.string({ required_error: 'First name is required' }).min(1, 'First name is required').max(100, 'First name is too long'),
  lastName: z.string({ required_error: 'Last name is required' }).min(1, 'Last name is required').max(100, 'Last name is too long'),
  phone: z.string().nullable().optional(),
  orgSlug: z.string().nullable().optional(),
  inviteCode: z.string({ required_error: 'Invite code is required' }).min(1, 'Invite code is required').max(32, 'Invite code is too long'),
});

const adminRegisterSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  phone: z.string().nullable().optional(),
  orgName: z.string().min(2, 'Organization name is required').max(200),
  orgSlug: z.string().min(3, 'Organization URL must be at least 3 characters').max(60).regex(/^[a-z0-9-]+$/, 'URL can only contain lowercase letters, numbers, and hyphens'),
  plan: z.string().optional(),
  billingCycle: z.string().optional(),
  billingRegion: z.string().optional(),
  currency: z.string().optional(),
});

const registerWithInviteSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  phone: z.string().nullable().optional(),
  inviteCode: z.string().min(1, 'Invite code is required').max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ── Helpers ─────────────────────────────────────────────────
function generateTokens(userId: string, email: string, globalRole: string) {
  const accessToken = jwt.sign(
    { userId, email, globalRole },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn as any }
  );
  const refreshToken = jwt.sign(
    { userId, type: 'refresh' },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn as any }
  );
  return { accessToken, refreshToken };
}

// ── Register ────────────────────────────────────────────────
router.post('/register', validate(registerSchema), async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, phone, orgSlug, inviteCode } = req.body;

    // ── Wrap entire registration in a transaction for atomicity ──
    const result = await db.transaction(async (trx) => {
      // Lock the invite row (FOR UPDATE) to prevent race conditions when
      // two users try to register with the same single-use invite simultaneously
      const signupInvite = await trx('signup_invites')
        .where({ code: inviteCode, is_active: true })
        .forUpdate()
        .first();
      if (!signupInvite) {
        return { status: 403, error: 'Invalid or expired invite code. Registration requires a valid invite link.' };
      }
      if (signupInvite.expires_at && new Date(signupInvite.expires_at) < new Date()) {
        return { status: 403, error: 'This invite code has expired. Please request a new one.' };
      }
      if (signupInvite.max_uses && signupInvite.use_count >= signupInvite.max_uses) {
        return { status: 403, error: 'This invite code has reached its maximum number of uses.' };
      }
      // If invite is targeted to a specific email, validate
      if (signupInvite.email && signupInvite.email.toLowerCase() !== email.toLowerCase()) {
        return { status: 403, error: 'This invite code is not valid for this email address.' };
      }

      // Check if user already exists
      const existing = await trx('users').where({ email }).first();
      if (existing) {
        return { status: 409, error: 'Email already registered' };
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const [user] = await trx('users')
        .insert({
          email,
          password_hash: passwordHash,
          first_name: firstName,
          last_name: lastName,
          phone: phone || null,
          global_role: 'member',
          signup_invite_code: inviteCode,
        })
        .returning(['id', 'email', 'first_name', 'last_name', 'global_role', 'created_at']);

      // Atomically increment signup invite use count
      await trx('signup_invites').where({ id: signupInvite.id }).update({ use_count: trx.raw('use_count + 1') });

      // If the signup invite is tied to an organization, auto-join that org
      if (signupInvite.organization_id) {
        const inviteOrg = await trx('organizations').where({ id: signupInvite.organization_id }).first();
        if (inviteOrg) {
          const countResult = await trx('memberships')
            .where({ organization_id: inviteOrg.id, is_active: true })
            .count('id as count')
            .first();
          const memberCount = parseInt(countResult?.count as string) || 0;
          const sub = await trx('subscriptions')
            .where({ organization_id: inviteOrg.id })
            .orderBy('created_at', 'desc')
            .first();
          let maxMembers = 100; // Default limit
          if (sub?.plan_id) {
            const planRecord = await trx('subscription_plans').where({ id: sub.plan_id }).first();
            maxMembers = planRecord?.max_members || 100;
          }
          if (memberCount < maxMembers) {
            await trx('memberships').insert({
              user_id: user.id,
              organization_id: inviteOrg.id,
              role: signupInvite.role || 'member',
              is_active: true,
              joined_at: trx.fn.now(),
            });
            const generalChannel = await trx('channels')
              .where({ organization_id: inviteOrg.id, name: 'General' })
              .first();
            if (generalChannel) {
              await trx('channel_members').insert({
                channel_id: generalChannel.id,
                user_id: user.id,
              }).onConflict(['channel_id', 'user_id']).ignore();
            }
            logger.info(`User ${email} auto-joined org ${inviteOrg.slug} via signup invite (role: ${signupInvite.role})`);
          }
        }
      }

      return { success: true, user };
    });

    // Handle transaction-level validation errors
    if ('error' in result) {
      res.status(result.status as number).json({ success: false, error: result.error });
      return;
    }

    const user = result.user;
    const tokens = generateTokens(user.id, user.email, user.global_role);

    // Check for pending invitations from developer org creation
    const pendingInvites = await db('pending_invitations')
      .where({ email: email.toLowerCase() })
      .select('*');

    // Process pending invitations — auto-join those orgs
    for (const invite of pendingInvites) {
      // Check not already a member
      const existingMembership = await db('memberships')
        .where({ user_id: user.id, organization_id: invite.organization_id })
        .first();

      if (!existingMembership) {
        await db('memberships').insert({
          user_id: user.id,
          organization_id: invite.organization_id,
          role: invite.role || 'org_admin',
          is_active: true,
          joined_at: db.fn.now(),
        });

        // Add to general channel if it exists
        const generalChannel = await db('channels')
          .where({ organization_id: invite.organization_id, name: 'General' })
          .first();
        if (generalChannel) {
          await db('channel_members').insert({
            channel_id: generalChannel.id,
            user_id: user.id,
          }).onConflict(['channel_id', 'user_id']).ignore();
        }

        logger.info(`User ${email} auto-joined org via pending invitation (role: ${invite.role})`);
      }
    }

    // Delete processed pending invitations
    if (pendingInvites.length > 0) {
      await db('pending_invitations').where({ email: email.toLowerCase() }).delete();
    }

    // Auto-join organization: use orgSlug if provided, else join the default org
    let memberships: any[] = [];
    let org = null;
    if (orgSlug) {
      org = await db('organizations').where({ slug: orgSlug }).first();
    }
    // Only auto-join default org if user wasn't invited to any org
    if (!org && pendingInvites.length === 0) {
      // Auto-join the first (default) organization for this deployment
      org = await db('organizations').orderBy('created_at', 'asc').first();
    }
    if (org) {
        // Check not already a member (shouldn't be for new registration, but just in case)
        const existingMembership = await db('memberships')
          .where({ user_id: user.id, organization_id: org.id })
          .first();

        if (!existingMembership) {
          // Check member limit before auto-joining
          const { allowed, current, max } = await checkMemberLimit(org.id);
          if (!allowed) {
            logger.warn(`User ${email} cannot auto-join org ${org.slug}: member limit reached (${current}/${max})`);
          } else {
            await db('memberships').insert({
              user_id: user.id,
              organization_id: org.id,
              role: 'member',
              is_active: true,
              joined_at: db.fn.now(),
            });

            // Add to general channel if it exists
            const generalChannel = await db('channels')
              .where({ organization_id: org.id, name: 'General' })
              .first();
            if (generalChannel) {
              await db('channel_members').insert({
                channel_id: generalChannel.id,
                user_id: user.id,
              }).onConflict(['channel_id', 'user_id']).ignore();
            }

            logger.info(`User ${email} auto-joined org ${org.slug}`);
          }
        }

        // Load memberships
        memberships = await db('memberships')
          .join('organizations', 'memberships.organization_id', 'organizations.id')
          .where({ 'memberships.user_id': user.id, 'memberships.is_active': true })
          .select(
            'memberships.id',
            'memberships.role',
            'organizations.id as organizationId',
            'organizations.name as organizationName',
            'organizations.slug as organizationSlug'
          );
    }

    await writeAuditLog({
      userId: user.id,
      action: 'create',
      entityType: 'user',
      entityId: user.id,
      newValue: { email, firstName, lastName, orgSlug },
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });

    logger.info(`User registered: ${email}`);

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.global_role,
          globalRole: user.global_role,
        },
        memberships,
        ...tokens,
      },
    });
  } catch (err) {
    logger.error('Registration error', err);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

// ── Admin Register (Organization Founder) ───────────────────
// Creates a super admin account + new organization in one step.
// No invite code needed — this is for new org founders from pricing page.
router.post('/admin-register', validate(adminRegisterSchema), async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, phone, orgName, orgSlug, plan, billingCycle, billingRegion, currency } = req.body;

    const result = await db.transaction(async (trx) => {
      // Check if user already exists
      const existing = await trx('users').where({ email }).first();
      if (existing) {
        return { status: 409, error: 'Email already registered' };
      }

      // Check if org slug is taken
      const existingOrg = await trx('organizations').where({ slug: orgSlug }).first();
      if (existingOrg) {
        return { status: 409, error: 'This organization URL is already taken. Please choose a different one.' };
      }

      // Create the user as org_admin (they become super admin of their own org)
      const passwordHash = await bcrypt.hash(password, 12);
      const [user] = await trx('users')
        .insert({
          email,
          password_hash: passwordHash,
          first_name: firstName,
          last_name: lastName,
          phone: phone || null,
          global_role: 'member',
        })
        .returning(['id', 'email', 'first_name', 'last_name', 'global_role', 'created_at']);

      // Create the organization
      const [org] = await trx('organizations')
        .insert({
          name: orgName,
          slug: orgSlug,
          created_by: user.id,
          billing_currency: currency || 'USD',
        })
        .returning('*');

      // Add founder as org_admin
      await trx('memberships').insert({
        user_id: user.id,
        organization_id: org.id,
        role: 'org_admin',
        is_active: true,
        joined_at: trx.fn.now(),
      });

      // Create default General channel
      const [generalChannel] = await trx('channels')
        .insert({
          organization_id: org.id,
          name: 'General',
          description: 'General discussion channel',
          created_by: user.id,
        })
        .returning('*');

      // Add founder to general channel
      if (generalChannel) {
        await trx('channel_members').insert({
          channel_id: generalChannel.id,
          user_id: user.id,
        }).onConflict(['channel_id', 'user_id']).ignore();
      }

      // If a plan was selected, create a subscription
      if (plan) {
        const planRecord = await trx('subscription_plans').where({ slug: plan, is_active: true }).first();
        if (planRecord) {
          const billingCycleVal = billingCycle || 'annual';
          const currencyVal = currency || 'USD';
          const currLower = currencyVal.toLowerCase();
          const priceField = billingCycleVal === 'annual'
            ? `price_${currLower}_annual`
            : `price_${currLower}_monthly`;
          const price = planRecord[priceField] || planRecord.price_usd_annual || 0;

          const periodEnd = new Date();
          if (billingCycleVal === 'annual') {
            periodEnd.setFullYear(periodEnd.getFullYear() + 1);
          } else {
            periodEnd.setMonth(periodEnd.getMonth() + 1);
          }

          await trx('subscriptions').insert({
            organization_id: org.id,
            plan_id: planRecord.id,
            status: 'active',
            billing_cycle: billingCycleVal,
            currency: currencyVal,
            amount_paid: price,
            current_period_start: trx.fn.now(),
            current_period_end: periodEnd.toISOString(),
          });
        }
      }

      return { success: true, user, org };
    });

    if ('error' in result) {
      res.status(result.status as number).json({ success: false, error: result.error });
      return;
    }

    const user = result.user;
    const org = (result as any).org;
    const tokens = generateTokens(user.id, user.email, user.global_role);

    const memberships = [{
      id: undefined,
      role: 'org_admin',
      organizationId: org.id,
      organization_id: org.id,
      organizationName: org.name,
      organizationSlug: org.slug,
    }];

    await writeAuditLog({
      userId: user.id,
      organizationId: org.id,
      action: 'create',
      entityType: 'organization',
      entityId: org.id,
      newValue: { orgName, orgSlug, plan },
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });

    logger.info(`Admin registered: ${email}, org: ${orgSlug}`);

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.global_role,
          globalRole: user.global_role,
        },
        memberships,
        ...tokens,
      },
    });
  } catch (err) {
    logger.error('Admin registration error', err);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

// ── Register with Org Invite Link (Member Signup + Join) ────
// For unauthenticated users clicking an org invite link.
// Creates account + joins the org + returns tokens in one step.
router.post('/register-with-invite', validate(registerWithInviteSchema), async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, phone, inviteCode } = req.body;

    const result = await db.transaction(async (trx) => {
      // Validate the invite link (NULL expires_at = never expires)
      const invite = await trx('invite_links')
        .where({ code: inviteCode, is_active: true })
        .where(function (this: any) {
          this.whereNull('expires_at').orWhere('expires_at', '>', trx.fn.now());
        })
        .forUpdate()
        .first();

      if (!invite) {
        return { status: 404, error: 'Invalid or expired invite link' };
      }

      if (invite.max_uses && invite.use_count >= invite.max_uses) {
        return { status: 403, error: 'This invite link has reached its maximum number of uses.' };
      }

      // Check if user already exists
      const existing = await trx('users').where({ email }).first();
      if (existing) {
        return { status: 409, error: 'Email already registered. Please sign in instead.' };
      }

      // Get the organization
      const org = await trx('organizations').where({ id: invite.organization_id }).first();
      if (!org) {
        return { status: 404, error: 'Organization not found' };
      }

      // Check member limit
      const countResult = await trx('memberships')
        .where({ organization_id: org.id, is_active: true })
        .count('id as count')
        .first();
      const memberCount = parseInt(countResult?.count as string) || 0;
      
      // Get subscription and plan for member limit (with fallback for missing tables)
      let maxMembers = 100; // default
      try {
        const sub = await trx('subscriptions')
          .where({ organization_id: org.id })
          .orderBy('created_at', 'desc')
          .first();
        if (sub?.plan_id) {
          const planRecord = await trx('subscription_plans').where({ id: sub.plan_id }).first();
          maxMembers = planRecord?.max_members || 100;
        }
      } catch {
        // Table may not exist - use default
      }
      
      if (memberCount >= maxMembers) {
        return { status: 403, error: 'This organization has reached its member limit.' };
      }

      // Create the user
      const passwordHash = await bcrypt.hash(password, 12);
      const [user] = await trx('users')
        .insert({
          email,
          password_hash: passwordHash,
          first_name: firstName,
          last_name: lastName,
          phone: phone || null,
          global_role: 'member',
          is_active: true,
          email_verified: false,
        })
        .returning(['id', 'email', 'first_name', 'last_name', 'global_role', 'created_at']);

      // Join the organization
      await trx('memberships').insert({
        user_id: user.id,
        organization_id: org.id,
        role: invite.role || 'member',
        is_active: true,
        joined_at: trx.fn.now(),
      });

      // Add to General channel
      const generalChannel = await trx('channels')
        .where({ organization_id: org.id, name: 'General' })
        .first();
      if (generalChannel) {
        await trx('channel_members').insert({
          channel_id: generalChannel.id,
          user_id: user.id,
        }).onConflict(['channel_id', 'user_id']).ignore();
      }

      // Increment invite use count
      await trx('invite_links').where({ id: invite.id }).update({
        use_count: trx.raw('use_count + 1'),
      });

      const assignedRole = invite.role || 'member';
      logger.info(`User ${email} registered + joined org ${org.slug} via invite (role: ${assignedRole})`);

      return { success: true, user, org, assignedRole };
    });

    if ('error' in result) {
      res.status(result.status as number).json({ success: false, error: result.error });
      return;
    }

    const user = result.user;
    const org = (result as any).org;
    const assignedRole = (result as any).assignedRole;
    const tokens = generateTokens(user.id, user.email, user.global_role);

    const memberships = [{
      role: assignedRole,
      organizationId: org.id,
      organization_id: org.id,
      organizationName: org.name,
      organizationSlug: org.slug,
    }];

    await writeAuditLog({
      userId: user.id,
      organizationId: org.id,
      action: 'create',
      entityType: 'user',
      entityId: user.id,
      newValue: { email, firstName, lastName, joinedViaInvite: true },
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          role: user.global_role,
          globalRole: user.global_role,
        },
        memberships,
        ...tokens,
      },
    });
  } catch (err: any) {
    logger.error('Register-with-invite error', { message: err.message, stack: err.stack });
    // Check for common database errors and provide helpful messages
    const msg = err.message || '';
    if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
      res.status(409).json({ success: false, error: 'Email already registered. Please sign in instead.' });
    } else if (msg.includes('does not exist')) {
      res.status(500).json({ success: false, error: 'System configuration error. Please contact support.' });
    } else {
      res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
    }
  }
});

// ── Login ───────────────────────────────────────────────────
router.post('/login', validate(loginSchema), async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const user = await db('users').where({ email }).first();
    if (!user || !user.is_active) {
      logger.warn('[AUTH] Login failed - user not found or inactive', { email, ip: req.ip, exists: !!user, active: user?.is_active });
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      logger.warn('[AUTH] Login failed - wrong password', { email, ip: req.ip, userId: user.id });
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    // Update last login
    await db('users').where({ id: user.id }).update({ last_login_at: db.fn.now() });
    logger.info('[AUTH] Login success', { email, userId: user.id, role: user.global_role, ip: req.ip });

    const tokens = generateTokens(user.id, user.email, user.global_role);

    await writeAuditLog({
      userId: user.id,
      action: 'login',
      entityType: 'user',
      entityId: user.id,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });

    // Process pending invitations (non-critical - wrapped to prevent login failure)
    try {
      const pendingInvites = await db('pending_invitations')
        .where({ email: email.toLowerCase() })
        .select('*');

      for (const invite of pendingInvites) {
        const existingMembership = await db('memberships')
          .where({ user_id: user.id, organization_id: invite.organization_id })
          .first();

        if (!existingMembership) {
          await db('memberships').insert({
            user_id: user.id,
            organization_id: invite.organization_id,
            role: invite.role || 'org_admin',
            is_active: true,
            joined_at: db.fn.now(),
          });

          const generalChannel = await db('channels')
            .where({ organization_id: invite.organization_id, name: 'General' })
            .first();
          if (generalChannel) {
            await db('channel_members').insert({
              channel_id: generalChannel.id,
              user_id: user.id,
            }).onConflict(['channel_id', 'user_id']).ignore();
          }

          logger.info(`User ${email} joined org via pending invitation on login (role: ${invite.role})`);
        }
      }

      if (pendingInvites.length > 0) {
        await db('pending_invitations').where({ email: email.toLowerCase() }).delete();
      }
    } catch (pendingErr) {
      logger.warn('Pending invitations processing skipped:', pendingErr);
    }

    // Load memberships (with fallback to empty array)
    let memberships: Array<{id: string; role: string; organizationId: string; organizationName: string; organizationSlug: string}> = [];
    try {
      memberships = await db('memberships')
        .join('organizations', 'memberships.organization_id', 'organizations.id')
        .where({ 'memberships.user_id': user.id, 'memberships.is_active': true })
        .select(
          'memberships.id',
          'memberships.role',
          'organizations.id as organizationId',
          'organizations.name as organizationName',
          'organizations.slug as organizationSlug'
        );
    } catch (membershipErr) {
      logger.warn('Failed to load memberships:', membershipErr);
    }

    // Auto-join default org if user has no memberships (seamless login)
    if (memberships.length === 0) {
      try {
        const defaultOrg = await db('organizations').orderBy('created_at', 'asc').first();
        if (defaultOrg) {
          const { allowed, current, max } = await checkMemberLimit(defaultOrg.id);
          if (!allowed) {
            logger.warn(`User ${email} cannot auto-join org ${defaultOrg.slug} on login: member limit reached (${current}/${max})`);
          } else {
            await db('memberships').insert({
              user_id: user.id,
              organization_id: defaultOrg.id,
              role: 'member',
              is_active: true,
              joined_at: db.fn.now(),
            });
            // Add to general channel
            const generalChannel = await db('channels')
              .where({ organization_id: defaultOrg.id, name: 'General' })
              .first();
            if (generalChannel) {
              await db('channel_members').insert({
                channel_id: generalChannel.id,
                user_id: user.id,
              }).onConflict(['channel_id', 'user_id']).ignore();
            }
            logger.info(`User ${email} auto-joined default org ${defaultOrg.slug} on login`);
            // Reload memberships
            memberships = await db('memberships')
              .join('organizations', 'memberships.organization_id', 'organizations.id')
              .where({ 'memberships.user_id': user.id, 'memberships.is_active': true })
              .select(
                'memberships.id',
                'memberships.role',
                'organizations.id as organizationId',
                'organizations.name as organizationName',
                'organizations.slug as organizationSlug'
              );
          }
        }
      } catch (autoJoinErr) {
        logger.warn('Auto-join on login failed:', autoJoinErr);
      }
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          avatarUrl: user.avatar_url,
          role: user.global_role,
          globalRole: user.global_role,
        },
        memberships,
        ...tokens,
      },
    });
  } catch (err) {
    logger.error('Login error', err);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

// ── Refresh Token ───────────────────────────────────────────
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({ success: false, error: 'Refresh token required' });
      return;
    }

    const payload = jwt.verify(refreshToken, config.jwt.refreshSecret) as { userId: string; type: string; iat?: number };
    if (payload.type !== 'refresh') {
      res.status(401).json({ success: false, error: 'Invalid token type' });
      return;
    }

    const user = await db('users').where({ id: payload.userId, is_active: true }).first();
    if (!user) {
      res.status(401).json({ success: false, error: 'User not found' });
      return;
    }

    // Reject refresh tokens issued before password change
    if (user.password_changed_at && payload.iat) {
      const changedAt = Math.floor(new Date(user.password_changed_at).getTime() / 1000);
      if (payload.iat < changedAt) {
        res.status(401).json({ success: false, error: 'Token invalidated — please log in again' });
        return;
      }
    }

    const tokens = generateTokens(user.id, user.email, user.global_role);
    res.json({ success: true, data: tokens });
  } catch {
    res.status(401).json({ success: false, error: 'Invalid refresh token' });
  }
});

// ── Get Current User ────────────────────────────────────────
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    // Gateway developer has no DB account — return synthetic profile
    if (req.user!.userId === 'gateway-developer') {
      res.json({
        success: true,
        data: {
          id: 'gateway-developer',
          email: req.user!.email,
          firstName: 'Platform',
          lastName: 'Developer',
          avatarUrl: null,
          phone: null,
          globalRole: 'developer',
          memberships: [],
        },
      });
      return;
    }

    const user = await db('users')
      .where({ id: req.user!.userId })
      .select('id', 'email', 'first_name', 'last_name', 'avatar_url', 'phone', 'global_role', 'created_at')
      .first();

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const memberships = await db('memberships')
      .join('organizations', 'memberships.organization_id', 'organizations.id')
      .where({ 'memberships.user_id': req.user!.userId, 'memberships.is_active': true })
      .select(
        'memberships.id',
        'memberships.role',
        'organizations.id as organizationId',
        'organizations.name as organizationName',
        'organizations.slug as organizationSlug'
      );

    res.json({
      success: true,
      data: {
        ...user,
        firstName: user.first_name,
        lastName: user.last_name,
        avatarUrl: user.avatar_url,
        globalRole: user.global_role,
        memberships,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get user profile' });
  }
});

// ── Update Profile ──────────────────────────────────────────
const profileUpdateSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().max(30).optional().nullable(),
  avatarUrl: z.string().url().max(500).optional().nullable(),
}).strict();

router.put('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const parsed = profileUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Invalid input', details: parsed.error.flatten() });
      return;
    }
    const { firstName, lastName, phone, avatarUrl } = parsed.data;
    const updates: Record<string, any> = {};
    if (firstName) updates.first_name = firstName;
    if (lastName) updates.last_name = lastName;
    if (phone !== undefined) updates.phone = phone;
    if (avatarUrl !== undefined) updates.avatar_url = avatarUrl;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
      return;
    }

    const previous = await db('users').where({ id: req.user!.userId }).first();
    await db('users').where({ id: req.user!.userId }).update(updates);

    await (req as any).audit?.({
      action: 'update',
      entityType: 'user',
      entityId: req.user!.userId,
      previousValue: { first_name: previous.first_name, last_name: previous.last_name },
      newValue: updates,
    });

    res.json({ success: true, message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
});

// ── Update Push Token ───────────────────────────────────────
const pushTokenSchema = z.object({
  fcmToken: z.string().max(500).optional(),
  apnsToken: z.string().max(500).optional(),
}).refine(d => d.fcmToken || d.apnsToken, { message: 'fcmToken or apnsToken required' });

router.put('/push-token', authenticate, validate(pushTokenSchema), async (req: Request, res: Response) => {
  try {
    const { fcmToken, apnsToken } = req.body;
    const updates: Record<string, any> = {};
    if (fcmToken) updates.fcm_token = fcmToken;
    if (apnsToken) updates.apns_token = apnsToken;

    await db('users').where({ id: req.user!.userId }).update(updates);
    res.json({ success: true, message: 'Push token updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update push token' });
  }
});

// ── Forgot Password (Request Reset) ────────────────────────
const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

router.post('/forgot-password', validate(forgotPasswordSchema), async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    const user = await db('users').where({ email, is_active: true }).first();

    // Always return success to avoid leaking whether email exists
    if (!user) {
      res.json({ success: true, message: 'If an account exists, a reset code has been sent' });
      return;
    }

    // Generate a 6-digit reset code
    const resetCode = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    // Store reset code in DB (use a simple column approach)
    await db('users').where({ id: user.id }).update({
      reset_code: resetCode,
      reset_code_expires_at: expiresAt,
    });

    // In production, send email with the code
    if (config.email.host) {
      try {
        await sendEmail({
          to: email,
          subject: 'OrgsLedger - Password Reset Code',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: #0B1426; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
                <h1 style="color: #C9A84C; margin: 0; font-size: 24px;">OrgsLedger</h1>
              </div>
              <div style="background: #f8f9fa; padding: 32px; border-radius: 0 0 8px 8px;">
                <h2 style="color: #0B1426; margin-top: 0;">Password Reset</h2>
                <p style="color: #555;">Your password reset code is:</p>
                <div style="background: #0B1426; color: #C9A84C; font-size: 32px; font-weight: bold; text-align: center; padding: 16px; border-radius: 8px; letter-spacing: 6px; margin: 16px 0;">${resetCode}</div>
                <p style="color: #888; font-size: 13px;">This code expires in 30 minutes. If you didn't request this, ignore this email.</p>
              </div>
              <p style="color: #aaa; font-size: 11px; text-align: center; margin-top: 16px;">&copy; ${new Date().getFullYear()} OrgsLedger. All rights reserved.</p>
            </div>
          `,
          text: `Your OrgsLedger password reset code is: ${resetCode}. This code expires in 30 minutes.`,
        });
      } catch (emailErr) {
        logger.warn('Failed to send reset email', emailErr);
      }
    } else {
      // Dev mode: log the code
      logger.info(`[DEV] Password reset code for ${email}: ${resetCode}`);
    }

    await writeAuditLog({
      userId: user.id,
      action: 'password_reset_request',
      entityType: 'user',
      entityId: user.id,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });

    res.json({ success: true, message: 'If an account exists, a reset code has been sent' });
  } catch (err) {
    logger.error('Forgot password error', err);
    res.status(500).json({ success: false, error: 'Failed to process request' });
  }
});

// ── Reset Password (with code) ──────────────────────────────
const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  newPassword: z.string().min(8).max(128),
});

router.post('/reset-password', validate(resetPasswordSchema), async (req: Request, res: Response) => {
  try {
    const { email, code, newPassword } = req.body;
    const user = await db('users').where({ email, is_active: true }).first();

    if (!user || !user.reset_code || !timingSafeCompare(user.reset_code, code)) {
      res.status(400).json({ success: false, error: 'Invalid or expired reset code' });
      return;
    }

    if (!user.reset_code_expires_at || new Date(user.reset_code_expires_at) < new Date()) {
      res.status(400).json({ success: false, error: 'Reset code has expired' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db('users').where({ id: user.id }).update({
      password_hash: passwordHash,
      reset_code: null,
      reset_code_expires_at: null,
      password_changed_at: new Date(),
    });

    await writeAuditLog({
      userId: user.id,
      action: 'password_reset',
      entityType: 'user',
      entityId: user.id,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });

    logger.info(`Password reset successfully for ${email}`);
    res.json({ success: true, message: 'Password has been reset. You can now log in.' });
  } catch (err) {
    logger.error('Reset password error', err);
    res.status(500).json({ success: false, error: 'Failed to reset password' });
  }
});

// ── Send Email Verification ─────────────────────────────────
router.post('/send-verification', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await db('users').where({ id: req.user!.userId }).first();
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    if (user.email_verified) {
      res.json({ success: true, message: 'Email is already verified' });
      return;
    }

    const verifyCode = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db('users').where({ id: user.id }).update({
      verification_code: verifyCode,
      verification_code_expires_at: expiresAt,
    });

    if (config.email.host) {
      try {
        await sendEmail({
          to: user.email,
          subject: 'OrgsLedger - Verify Your Email',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: #0B1426; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
                <h1 style="color: #C9A84C; margin: 0; font-size: 24px;">OrgsLedger</h1>
              </div>
              <div style="background: #f8f9fa; padding: 32px; border-radius: 0 0 8px 8px;">
                <h2 style="color: #0B1426; margin-top: 0;">Verify Your Email</h2>
                <p style="color: #555;">Your verification code is:</p>
                <div style="background: #0B1426; color: #C9A84C; font-size: 32px; font-weight: bold; text-align: center; padding: 16px; border-radius: 8px; letter-spacing: 6px; margin: 16px 0;">${verifyCode}</div>
                <p style="color: #888; font-size: 13px;">This code expires in 1 hour. If you didn't request this, ignore this email.</p>
              </div>
              <p style="color: #aaa; font-size: 11px; text-align: center; margin-top: 16px;">&copy; ${new Date().getFullYear()} OrgsLedger. All rights reserved.</p>
            </div>
          `,
          text: `Your OrgsLedger verification code is: ${verifyCode}. This code expires in 1 hour.`,
        });
      } catch (emailErr) {
        logger.warn('Failed to send verification email', emailErr);
      }
    } else {
      logger.info(`[DEV] Email verification code for ${user.email}: ${verifyCode}`);
    }

    res.json({ success: true, message: 'Verification code sent' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to send verification' });
  }
});

// ── Verify Email ────────────────────────────────────────────
const verifyEmailSchema = z.object({
  code: z.string().length(6),
});

router.post('/verify-email', authenticate, validate(verifyEmailSchema), async (req: Request, res: Response) => {
  try {
    const { code } = req.body;
    const user = await db('users').where({ id: req.user!.userId }).first();

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    if (user.email_verified) {
      res.json({ success: true, message: 'Email is already verified' });
      return;
    }

    if (!timingSafeCompare(user.verification_code || '', code)) {
      res.status(400).json({ success: false, error: 'Invalid verification code' });
      return;
    }

    if (!user.verification_code_expires_at || new Date(user.verification_code_expires_at) < new Date()) {
      res.status(400).json({ success: false, error: 'Verification code has expired' });
      return;
    }

    await db('users').where({ id: user.id }).update({
      email_verified: true,
      verification_code: null,
      verification_code_expires_at: null,
    });

    res.json({ success: true, message: 'Email verified successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to verify email' });
  }
});

// ── Change Password (authenticated) ────────────────────────
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

router.put('/change-password', authenticate, validate(changePasswordSchema), async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await db('users').where({ id: req.user!.userId }).first();

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      res.status(400).json({ success: false, error: 'Current password is incorrect' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db('users').where({ id: user.id }).update({
      password_hash: passwordHash,
      password_changed_at: new Date(),
    });

    // Generate new tokens so the user stays logged in with fresh tokens
    const tokens = generateTokens(user.id, user.email, user.global_role);

    res.json({ success: true, message: 'Password changed successfully', data: tokens });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to change password' });
  }
});

// ── Upload Avatar ───────────────────────────────────────────
router.post('/upload-avatar', authenticate, (req: Request, res: Response, next) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      logger.warn('Avatar upload error', err);
      return res.status(400).json({ success: false, error: 'Invalid file upload' });
    }
    next();
  });
}, async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image file provided' });
    }

    // Build the URL path for the avatar
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    // Update user's avatar_url
    await db('users').where({ id: req.user!.userId }).update({ avatar_url: avatarUrl });

    logger.info(`Avatar uploaded for user ${req.user!.userId}: ${avatarUrl}`);

    res.json({
      success: true,
      data: { avatarUrl },
      message: 'Avatar uploaded successfully',
    });
  } catch (err) {
    logger.error('Avatar upload error:', err);
    res.status(500).json({ success: false, error: 'Failed to upload avatar' });
  }
});

export default router;
