"use strict";
// ============================================================
// OrgsLedger API — Authentication Middleware
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
exports.loadMembership = loadMembership;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
const db_1 = __importDefault(require("../db"));
const logger_1 = require("../logger");
async function authenticate(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ success: false, error: 'Authentication required' });
            return;
        }
        const token = authHeader.split(' ')[1];
        const payload = jsonwebtoken_1.default.verify(token, config_1.config.jwt.secret);
        // Verify user still exists and is active
        const user = await (0, db_1.default)('users')
            .where({ id: payload.userId, is_active: true })
            .first();
        if (!user) {
            logger_1.logger.warn('[AUTH] User not found or deactivated', { userId: payload.userId, email: payload.email });
            res.status(401).json({ success: false, error: 'User not found or deactivated' });
            return;
        }
        // Check if password was changed after this token was issued
        if (user.password_changed_at && payload.iat) {
            const changedAt = Math.floor(new Date(user.password_changed_at).getTime() / 1000);
            if (payload.iat < changedAt) {
                logger_1.logger.warn('[AUTH] Token issued before password change', { userId: payload.userId });
                res.status(401).json({ success: false, error: 'Token invalidated — please log in again' });
                return;
            }
        }
        logger_1.logger.debug('[AUTH] Authenticated', { userId: payload.userId, email: payload.email, role: payload.globalRole, path: req.originalUrl });
        req.user = payload;
        next();
    }
    catch (err) {
        logger_1.logger.warn('[AUTH] Token verification failed', { error: err.message, path: req.originalUrl, ip: req.ip });
        res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
}
/**
 * Load membership for the current user in the given organization.
 * Expects :orgId param in the route.
 */
async function loadMembership(req, res, next) {
    try {
        const orgId = req.params.orgId;
        if (!orgId || !req.user) {
            res.status(400).json({ success: false, error: 'Organization ID required' });
            return;
        }
        // Super admins get admin-level access everywhere
        if (req.user.globalRole === 'super_admin') {
            req.membership = {
                id: 'super_admin',
                role: 'org_admin',
                organizationId: orgId,
                isActive: true,
            };
            return next();
        }
        const membership = await (0, db_1.default)('memberships')
            .where({
            user_id: req.user.userId,
            organization_id: orgId,
            is_active: true,
        })
            .first();
        if (!membership) {
            logger_1.logger.warn('[AUTH] Non-member access attempt', { userId: req.user.userId, orgId });
            res.status(403).json({ success: false, error: 'Not a member of this organization' });
            return;
        }
        logger_1.logger.debug('[AUTH] Membership loaded', { userId: req.user.userId, orgId, role: membership.role });
        req.membership = {
            id: membership.id,
            role: membership.role,
            organizationId: orgId,
            isActive: membership.is_active,
        };
        next();
    }
    catch (err) {
        next(err);
    }
}
//# sourceMappingURL=auth.js.map