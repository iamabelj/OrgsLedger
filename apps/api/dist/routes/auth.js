"use strict";
// ============================================================
// OrgsLedger API — Auth Routes
// Registration, Login, Token Refresh, Password Reset
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const zod_1 = require("zod");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const multer_1 = __importDefault(require("multer"));
const db_1 = __importDefault(require("../db"));
const config_1 = require("../config");
const middleware_1 = require("../middleware");
const logger_1 = require("../logger");
const subscription_service_1 = require("../services/subscription.service");
const router = (0, express_1.Router)();
// ── Timing-safe string comparison helper ────────────────────
function timingSafeCompare(a, b) {
    if (!a || !b)
        return false;
    try {
        const bufA = Buffer.from(a, 'utf-8');
        const bufB = Buffer.from(b, 'utf-8');
        if (bufA.length !== bufB.length)
            return false;
        return crypto_1.default.timingSafeEqual(bufA, bufB);
    }
    catch {
        return false;
    }
}
// ── Multer for avatar uploads ───────────────────────────────
const avatarStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        const dir = path_1.default.resolve(config_1.config.upload.dir, 'avatars');
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase() || '.jpg';
        cb(null, `${req.user?.userId || 'unknown'}_${Date.now()}${ext}`);
    },
});
const avatarUpload = (0, multer_1.default)({
    storage: avatarStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (allowed.includes(file.mimetype))
            cb(null, true);
        else
            cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'));
    },
});
// ── Schemas ─────────────────────────────────────────────────
const registerSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8).max(128),
    firstName: zod_1.z.string().min(1).max(100),
    lastName: zod_1.z.string().min(1).max(100),
    phone: zod_1.z.string().optional(),
    orgSlug: zod_1.z.string().optional(),
});
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(1),
});
// ── Helpers ─────────────────────────────────────────────────
function generateTokens(userId, email, globalRole) {
    const accessToken = jsonwebtoken_1.default.sign({ userId, email, globalRole }, config_1.config.jwt.secret, { expiresIn: config_1.config.jwt.expiresIn });
    const refreshToken = jsonwebtoken_1.default.sign({ userId, type: 'refresh' }, config_1.config.jwt.refreshSecret, { expiresIn: config_1.config.jwt.refreshExpiresIn });
    return { accessToken, refreshToken };
}
// ── Register ────────────────────────────────────────────────
router.post('/register', (0, middleware_1.validate)(registerSchema), async (req, res) => {
    try {
        const { email, password, firstName, lastName, phone, orgSlug } = req.body;
        // Check if user already exists
        const existing = await (0, db_1.default)('users').where({ email }).first();
        if (existing) {
            res.status(409).json({ success: false, error: 'Email already registered' });
            return;
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 12);
        const [user] = await (0, db_1.default)('users')
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
        let memberships = [];
        let org = null;
        if (orgSlug) {
            org = await (0, db_1.default)('organizations').where({ slug: orgSlug }).first();
        }
        if (!org) {
            // Auto-join the first (default) organization for this deployment
            org = await (0, db_1.default)('organizations').orderBy('created_at', 'asc').first();
        }
        if (org) {
            // Check not already a member (shouldn't be for new registration, but just in case)
            const existingMembership = await (0, db_1.default)('memberships')
                .where({ user_id: user.id, organization_id: org.id })
                .first();
            if (!existingMembership) {
                // Check member limit before auto-joining
                const { allowed, current, max } = await (0, subscription_service_1.checkMemberLimit)(org.id);
                if (!allowed) {
                    logger_1.logger.warn(`User ${email} cannot auto-join org ${org.slug}: member limit reached (${current}/${max})`);
                }
                else {
                    await (0, db_1.default)('memberships').insert({
                        user_id: user.id,
                        organization_id: org.id,
                        role: 'member',
                        is_active: true,
                        joined_at: db_1.default.fn.now(),
                    });
                    // Add to general channel if it exists
                    const generalChannel = await (0, db_1.default)('channels')
                        .where({ organization_id: org.id, name: 'General' })
                        .first();
                    if (generalChannel) {
                        await (0, db_1.default)('channel_members').insert({
                            channel_id: generalChannel.id,
                            user_id: user.id,
                        }).onConflict(['channel_id', 'user_id']).ignore();
                    }
                    logger_1.logger.info(`User ${email} auto-joined org ${org.slug}`);
                }
            }
            // Load memberships
            memberships = await (0, db_1.default)('memberships')
                .join('organizations', 'memberships.organization_id', 'organizations.id')
                .where({ 'memberships.user_id': user.id, 'memberships.is_active': true })
                .select('memberships.id', 'memberships.role', 'organizations.id as organizationId', 'organizations.name as organizationName', 'organizations.slug as organizationSlug');
        }
        await (0, middleware_1.writeAuditLog)({
            userId: user.id,
            action: 'create',
            entityType: 'user',
            entityId: user.id,
            newValue: { email, firstName, lastName, orgSlug },
            ipAddress: req.ip || '',
            userAgent: req.headers['user-agent'] || '',
        });
        logger_1.logger.info(`User registered: ${email}`);
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
    }
    catch (err) {
        logger_1.logger.error('Registration error', err);
        res.status(500).json({ success: false, error: 'Registration failed' });
    }
});
// ── Login ───────────────────────────────────────────────────
router.post('/login', (0, middleware_1.validate)(loginSchema), async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await (0, db_1.default)('users').where({ email }).first();
        if (!user || !user.is_active) {
            logger_1.logger.warn('[AUTH] Login failed - user not found or inactive', { email, ip: req.ip, exists: !!user, active: user?.is_active });
            res.status(401).json({ success: false, error: 'Invalid credentials' });
            return;
        }
        const valid = await bcryptjs_1.default.compare(password, user.password_hash);
        if (!valid) {
            logger_1.logger.warn('[AUTH] Login failed - wrong password', { email, ip: req.ip, userId: user.id });
            res.status(401).json({ success: false, error: 'Invalid credentials' });
            return;
        }
        // Update last login
        await (0, db_1.default)('users').where({ id: user.id }).update({ last_login_at: db_1.default.fn.now() });
        logger_1.logger.info('[AUTH] Login success', { email, userId: user.id, role: user.global_role, ip: req.ip });
        const tokens = generateTokens(user.id, user.email, user.global_role);
        await (0, middleware_1.writeAuditLog)({
            userId: user.id,
            action: 'login',
            entityType: 'user',
            entityId: user.id,
            ipAddress: req.ip || '',
            userAgent: req.headers['user-agent'] || '',
        });
        // Load memberships
        let memberships = await (0, db_1.default)('memberships')
            .join('organizations', 'memberships.organization_id', 'organizations.id')
            .where({ 'memberships.user_id': user.id, 'memberships.is_active': true })
            .select('memberships.id', 'memberships.role', 'organizations.id as organizationId', 'organizations.name as organizationName', 'organizations.slug as organizationSlug');
        // Auto-join default org if user has no memberships (seamless login)
        if (memberships.length === 0) {
            try {
                const defaultOrg = await (0, db_1.default)('organizations').orderBy('created_at', 'asc').first();
                if (defaultOrg) {
                    const { allowed, current, max } = await (0, subscription_service_1.checkMemberLimit)(defaultOrg.id);
                    if (!allowed) {
                        logger_1.logger.warn(`User ${email} cannot auto-join org ${defaultOrg.slug} on login: member limit reached (${current}/${max})`);
                    }
                    else {
                        await (0, db_1.default)('memberships').insert({
                            user_id: user.id,
                            organization_id: defaultOrg.id,
                            role: 'member',
                            is_active: true,
                            joined_at: db_1.default.fn.now(),
                        });
                        // Add to general channel
                        const generalChannel = await (0, db_1.default)('channels')
                            .where({ organization_id: defaultOrg.id, name: 'General' })
                            .first();
                        if (generalChannel) {
                            await (0, db_1.default)('channel_members').insert({
                                channel_id: generalChannel.id,
                                user_id: user.id,
                            }).onConflict(['channel_id', 'user_id']).ignore();
                        }
                        logger_1.logger.info(`User ${email} auto-joined default org ${defaultOrg.slug} on login`);
                        // Reload memberships
                        memberships = await (0, db_1.default)('memberships')
                            .join('organizations', 'memberships.organization_id', 'organizations.id')
                            .where({ 'memberships.user_id': user.id, 'memberships.is_active': true })
                            .select('memberships.id', 'memberships.role', 'organizations.id as organizationId', 'organizations.name as organizationName', 'organizations.slug as organizationSlug');
                    }
                }
            }
            catch (autoJoinErr) {
                logger_1.logger.warn('Auto-join on login failed:', autoJoinErr);
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
    }
    catch (err) {
        logger_1.logger.error('Login error', err);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});
// ── Refresh Token ───────────────────────────────────────────
router.post('/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        if (!refreshToken) {
            res.status(400).json({ success: false, error: 'Refresh token required' });
            return;
        }
        const payload = jsonwebtoken_1.default.verify(refreshToken, config_1.config.jwt.refreshSecret);
        if (payload.type !== 'refresh') {
            res.status(401).json({ success: false, error: 'Invalid token type' });
            return;
        }
        const user = await (0, db_1.default)('users').where({ id: payload.userId, is_active: true }).first();
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
    }
    catch {
        res.status(401).json({ success: false, error: 'Invalid refresh token' });
    }
});
// ── Get Current User ────────────────────────────────────────
router.get('/me', middleware_1.authenticate, async (req, res) => {
    try {
        const user = await (0, db_1.default)('users')
            .where({ id: req.user.userId })
            .select('id', 'email', 'first_name', 'last_name', 'avatar_url', 'phone', 'global_role', 'created_at')
            .first();
        const memberships = await (0, db_1.default)('memberships')
            .join('organizations', 'memberships.organization_id', 'organizations.id')
            .where({ 'memberships.user_id': req.user.userId, 'memberships.is_active': true })
            .select('memberships.id', 'memberships.role', 'organizations.id as organizationId', 'organizations.name as organizationName', 'organizations.slug as organizationSlug');
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
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to get user profile' });
    }
});
// ── Update Profile ──────────────────────────────────────────
const profileUpdateSchema = zod_1.z.object({
    firstName: zod_1.z.string().min(1).max(100).optional(),
    lastName: zod_1.z.string().min(1).max(100).optional(),
    phone: zod_1.z.string().max(30).optional().nullable(),
    avatarUrl: zod_1.z.string().url().max(500).optional().nullable(),
}).strict();
router.put('/me', middleware_1.authenticate, async (req, res) => {
    try {
        const parsed = profileUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ success: false, error: 'Invalid input', details: parsed.error.flatten() });
            return;
        }
        const { firstName, lastName, phone, avatarUrl } = parsed.data;
        const updates = {};
        if (firstName)
            updates.first_name = firstName;
        if (lastName)
            updates.last_name = lastName;
        if (phone !== undefined)
            updates.phone = phone;
        if (avatarUrl !== undefined)
            updates.avatar_url = avatarUrl;
        if (Object.keys(updates).length === 0) {
            res.status(400).json({ success: false, error: 'No fields to update' });
            return;
        }
        const previous = await (0, db_1.default)('users').where({ id: req.user.userId }).first();
        await (0, db_1.default)('users').where({ id: req.user.userId }).update(updates);
        await req.audit?.({
            action: 'update',
            entityType: 'user',
            entityId: req.user.userId,
            previousValue: { first_name: previous.first_name, last_name: previous.last_name },
            newValue: updates,
        });
        res.json({ success: true, message: 'Profile updated' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update profile' });
    }
});
// ── Update Push Token ───────────────────────────────────────
router.put('/push-token', middleware_1.authenticate, async (req, res) => {
    try {
        const { fcmToken, apnsToken } = req.body;
        const updates = {};
        if (fcmToken)
            updates.fcm_token = fcmToken;
        if (apnsToken)
            updates.apns_token = apnsToken;
        await (0, db_1.default)('users').where({ id: req.user.userId }).update(updates);
        res.json({ success: true, message: 'Push token updated' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update push token' });
    }
});
// ── Forgot Password (Request Reset) ────────────────────────
const forgotPasswordSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
});
router.post('/forgot-password', (0, middleware_1.validate)(forgotPasswordSchema), async (req, res) => {
    try {
        const { email } = req.body;
        const user = await (0, db_1.default)('users').where({ email, is_active: true }).first();
        // Always return success to avoid leaking whether email exists
        if (!user) {
            res.json({ success: true, message: 'If an account exists, a reset code has been sent' });
            return;
        }
        // Generate a 6-digit reset code
        const resetCode = crypto_1.default.randomInt(100000, 999999).toString();
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
        // Store reset code in DB (use a simple column approach)
        await (0, db_1.default)('users').where({ id: user.id }).update({
            reset_code: resetCode,
            reset_code_expires_at: expiresAt,
        });
        // In production, send email with the code
        if (config_1.config.email.host) {
            try {
                const nodemailer = require('nodemailer');
                const transporter = nodemailer.createTransport({
                    host: config_1.config.email.host,
                    port: config_1.config.email.port,
                    auth: { user: config_1.config.email.user, pass: config_1.config.email.pass },
                });
                await transporter.sendMail({
                    from: config_1.config.email.from,
                    to: email,
                    subject: 'OrgsLedger - Password Reset Code',
                    html: `<h2>Password Reset</h2><p>Your reset code is: <strong>${resetCode}</strong></p><p>This code expires in 30 minutes.</p>`,
                });
            }
            catch (emailErr) {
                logger_1.logger.warn('Failed to send reset email', emailErr);
            }
        }
        else {
            // Dev mode: log the code
            logger_1.logger.info(`[DEV] Password reset code for ${email}: ${resetCode}`);
        }
        await (0, middleware_1.writeAuditLog)({
            userId: user.id,
            action: 'password_reset_request',
            entityType: 'user',
            entityId: user.id,
            ipAddress: req.ip || '',
            userAgent: req.headers['user-agent'] || '',
        });
        res.json({ success: true, message: 'If an account exists, a reset code has been sent' });
    }
    catch (err) {
        logger_1.logger.error('Forgot password error', err);
        res.status(500).json({ success: false, error: 'Failed to process request' });
    }
});
// ── Reset Password (with code) ──────────────────────────────
const resetPasswordSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    code: zod_1.z.string().length(6),
    newPassword: zod_1.z.string().min(8).max(128),
});
router.post('/reset-password', (0, middleware_1.validate)(resetPasswordSchema), async (req, res) => {
    try {
        const { email, code, newPassword } = req.body;
        const user = await (0, db_1.default)('users').where({ email, is_active: true }).first();
        if (!user || !user.reset_code || !timingSafeCompare(user.reset_code, code)) {
            res.status(400).json({ success: false, error: 'Invalid or expired reset code' });
            return;
        }
        if (!user.reset_code_expires_at || new Date(user.reset_code_expires_at) < new Date()) {
            res.status(400).json({ success: false, error: 'Reset code has expired' });
            return;
        }
        const passwordHash = await bcryptjs_1.default.hash(newPassword, 12);
        await (0, db_1.default)('users').where({ id: user.id }).update({
            password_hash: passwordHash,
            reset_code: null,
            reset_code_expires_at: null,
            password_changed_at: new Date(),
        });
        await (0, middleware_1.writeAuditLog)({
            userId: user.id,
            action: 'password_reset',
            entityType: 'user',
            entityId: user.id,
            ipAddress: req.ip || '',
            userAgent: req.headers['user-agent'] || '',
        });
        logger_1.logger.info(`Password reset successfully for ${email}`);
        res.json({ success: true, message: 'Password has been reset. You can now log in.' });
    }
    catch (err) {
        logger_1.logger.error('Reset password error', err);
        res.status(500).json({ success: false, error: 'Failed to reset password' });
    }
});
// ── Send Email Verification ─────────────────────────────────
router.post('/send-verification', middleware_1.authenticate, async (req, res) => {
    try {
        const user = await (0, db_1.default)('users').where({ id: req.user.userId }).first();
        if (!user) {
            res.status(404).json({ success: false, error: 'User not found' });
            return;
        }
        if (user.email_verified) {
            res.json({ success: true, message: 'Email is already verified' });
            return;
        }
        const verifyCode = crypto_1.default.randomInt(100000, 999999).toString();
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await (0, db_1.default)('users').where({ id: user.id }).update({
            verification_code: verifyCode,
            verification_code_expires_at: expiresAt,
        });
        if (config_1.config.email.host) {
            try {
                const nodemailer = require('nodemailer');
                const transporter = nodemailer.createTransport({
                    host: config_1.config.email.host,
                    port: config_1.config.email.port,
                    auth: { user: config_1.config.email.user, pass: config_1.config.email.pass },
                });
                await transporter.sendMail({
                    from: config_1.config.email.from,
                    to: user.email,
                    subject: 'OrgsLedger - Verify Your Email',
                    html: `<h2>Email Verification</h2><p>Your verification code is: <strong>${verifyCode}</strong></p><p>This code expires in 1 hour.</p>`,
                });
            }
            catch (emailErr) {
                logger_1.logger.warn('Failed to send verification email', emailErr);
            }
        }
        else {
            logger_1.logger.info(`[DEV] Email verification code for ${user.email}: ${verifyCode}`);
        }
        res.json({ success: true, message: 'Verification code sent' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to send verification' });
    }
});
// ── Verify Email ────────────────────────────────────────────
const verifyEmailSchema = zod_1.z.object({
    code: zod_1.z.string().length(6),
});
router.post('/verify-email', middleware_1.authenticate, (0, middleware_1.validate)(verifyEmailSchema), async (req, res) => {
    try {
        const { code } = req.body;
        const user = await (0, db_1.default)('users').where({ id: req.user.userId }).first();
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
        await (0, db_1.default)('users').where({ id: user.id }).update({
            email_verified: true,
            verification_code: null,
            verification_code_expires_at: null,
        });
        res.json({ success: true, message: 'Email verified successfully' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to verify email' });
    }
});
// ── Change Password (authenticated) ────────────────────────
const changePasswordSchema = zod_1.z.object({
    currentPassword: zod_1.z.string().min(1),
    newPassword: zod_1.z.string().min(8).max(128),
});
router.put('/change-password', middleware_1.authenticate, (0, middleware_1.validate)(changePasswordSchema), async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await (0, db_1.default)('users').where({ id: req.user.userId }).first();
        if (!user) {
            res.status(404).json({ success: false, error: 'User not found' });
            return;
        }
        const valid = await bcryptjs_1.default.compare(currentPassword, user.password_hash);
        if (!valid) {
            res.status(400).json({ success: false, error: 'Current password is incorrect' });
            return;
        }
        const passwordHash = await bcryptjs_1.default.hash(newPassword, 12);
        await (0, db_1.default)('users').where({ id: user.id }).update({
            password_hash: passwordHash,
            password_changed_at: new Date(),
        });
        // Generate new tokens so the user stays logged in with fresh tokens
        const tokens = generateTokens(user.id, user.email, user.global_role);
        res.json({ success: true, message: 'Password changed successfully', data: tokens });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Failed to change password' });
    }
});
// ── Upload Avatar ───────────────────────────────────────────
router.post('/upload-avatar', middleware_1.authenticate, (req, res, next) => {
    avatarUpload.single('avatar')(req, res, (err) => {
        if (err) {
            return res.status(400).json({ success: false, error: err.message });
        }
        next();
    });
}, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No image file provided' });
        }
        // Build the URL path for the avatar
        const avatarUrl = `/uploads/avatars/${req.file.filename}`;
        // Update user's avatar_url
        await (0, db_1.default)('users').where({ id: req.user.userId }).update({ avatar_url: avatarUrl });
        logger_1.logger.info(`Avatar uploaded for user ${req.user.userId}: ${avatarUrl}`);
        res.json({
            success: true,
            data: { avatarUrl },
            message: 'Avatar uploaded successfully',
        });
    }
    catch (err) {
        logger_1.logger.error('Avatar upload error:', err);
        res.status(500).json({ success: false, error: 'Failed to upload avatar' });
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map