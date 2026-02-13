// ============================================================
// OrgsLedger API — Auth Routes
// Registration, Login, Token Refresh, Password Reset
// ============================================================

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import db from '../db';
import { config } from '../config';
import { authenticate, validate, writeAuditLog } from '../middleware';
import { logger } from '../logger';

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
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().optional(),
  orgSlug: z.string().optional(),
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
    config.jwt.secret,
    { expiresIn: config.jwt.refreshExpiresIn as any }
  );
  return { accessToken, refreshToken };
}

// ── Register ────────────────────────────────────────────────
router.post('/register', validate(registerSchema), async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, phone, orgSlug } = req.body;

    // Check if user already exists
    const existing = await db('users').where({ email }).first();
    if (existing) {
      res.status(409).json({ success: false, error: 'Email already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await db('users')
      .insert({
        email,
        password_hash: passwordHash,
        first_name: firstName,
        last_name: lastName,
        phone: phone || null,
        global_role: 'member',
      })
      .returning(['id', 'email', 'first_name', 'last_name', 'global_role', 'created_at']);

    const tokens = generateTokens(user.id, user.email, user.global_role);

    // Auto-join organization: use orgSlug if provided, else join the default org
    let memberships: any[] = [];
    let org = null;
    if (orgSlug) {
      org = await db('organizations').where({ slug: orgSlug }).first();
    }
    if (!org) {
      // Auto-join the first (default) organization for this deployment
      org = await db('organizations').orderBy('created_at', 'asc').first();
    }
    if (org) {
        // Check not already a member (shouldn't be for new registration, but just in case)
        const existingMembership = await db('memberships')
          .where({ user_id: user.id, organization_id: org.id })
          .first();

        if (!existingMembership) {
          await db('memberships').insert({
            user_id: user.id,
            organization_id: org.id,
            role: 'member',
            is_active: true,
            joined_at: db.fn.now(),
          });

          // Add to general channel if it exists
          const generalChannel = await db('chat_channels')
            .where({ organization_id: org.id, name: 'General' })
            .first();
          if (generalChannel) {
            await db('chat_channel_members').insert({
              channel_id: generalChannel.id,
              user_id: user.id,
            }).onConflict(['channel_id', 'user_id']).ignore();
          }

          logger.info(`User ${email} auto-joined org ${org.slug}`);
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

// ── Login ───────────────────────────────────────────────────
router.post('/login', validate(loginSchema), async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    const user = await db('users').where({ email }).first();
    if (!user || !user.is_active) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    // Update last login
    await db('users').where({ id: user.id }).update({ last_login_at: db.fn.now() });

    const tokens = generateTokens(user.id, user.email, user.global_role);

    await writeAuditLog({
      userId: user.id,
      action: 'login',
      entityType: 'user',
      entityId: user.id,
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
    });

    // Load memberships
    let memberships = await db('memberships')
      .join('organizations', 'memberships.organization_id', 'organizations.id')
      .where({ 'memberships.user_id': user.id, 'memberships.is_active': true })
      .select(
        'memberships.id',
        'memberships.role',
        'organizations.id as organizationId',
        'organizations.name as organizationName',
        'organizations.slug as organizationSlug'
      );

    // Auto-join default org if user has no memberships (seamless login)
    if (memberships.length === 0) {
      try {
        const defaultOrg = await db('organizations').orderBy('created_at', 'asc').first();
        if (defaultOrg) {
          await db('memberships').insert({
            user_id: user.id,
            organization_id: defaultOrg.id,
            role: 'member',
            is_active: true,
            joined_at: db.fn.now(),
          });
          // Add to general channel
          const generalChannel = await db('chat_channels')
            .where({ organization_id: defaultOrg.id, name: 'General' })
            .first();
          if (generalChannel) {
            await db('chat_channel_members').insert({
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

    const payload = jwt.verify(refreshToken, config.jwt.secret) as { userId: string; type: string };
    if (payload.type !== 'refresh') {
      res.status(401).json({ success: false, error: 'Invalid token type' });
      return;
    }

    const user = await db('users').where({ id: payload.userId, is_active: true }).first();
    if (!user) {
      res.status(401).json({ success: false, error: 'User not found' });
      return;
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
    const user = await db('users')
      .where({ id: req.user!.userId })
      .select('id', 'email', 'first_name', 'last_name', 'avatar_url', 'phone', 'global_role', 'created_at')
      .first();

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
router.put('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, phone, avatarUrl } = req.body;
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
router.put('/push-token', authenticate, async (req: Request, res: Response) => {
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
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    // Store reset code in DB (use a simple column approach)
    await db('users').where({ id: user.id }).update({
      reset_code: resetCode,
      reset_code_expires_at: expiresAt,
    });

    // In production, send email with the code
    if (config.email.host) {
      try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
          host: config.email.host,
          port: config.email.port,
          auth: { user: config.email.user, pass: config.email.pass },
        });
        await transporter.sendMail({
          from: config.email.from,
          to: email,
          subject: 'OrgsLedger - Password Reset Code',
          html: `<h2>Password Reset</h2><p>Your reset code is: <strong>${resetCode}</strong></p><p>This code expires in 30 minutes.</p>`,
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

    if (!user || user.reset_code !== code) {
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

    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db('users').where({ id: user.id }).update({
      verification_code: verifyCode,
      verification_code_expires_at: expiresAt,
    });

    if (config.email.host) {
      try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
          host: config.email.host,
          port: config.email.port,
          auth: { user: config.email.user, pass: config.email.pass },
        });
        await transporter.sendMail({
          from: config.email.from,
          to: user.email,
          subject: 'OrgsLedger - Verify Your Email',
          html: `<h2>Email Verification</h2><p>Your verification code is: <strong>${verifyCode}</strong></p><p>This code expires in 1 hour.</p>`,
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

    if (user.verification_code !== code) {
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
    await db('users').where({ id: user.id }).update({ password_hash: passwordHash });

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to change password' });
  }
});

// ── Upload Avatar ───────────────────────────────────────────
router.post('/upload-avatar', authenticate, (req: Request, res: Response, next) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
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
