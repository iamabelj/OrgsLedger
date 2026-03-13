"use strict";
// ============================================================
// OrgsLedger API — Authentication Middleware (Optimized)
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidateUserCache = invalidateUserCache;
exports.clearUserCache = clearUserCache;
exports.authenticate = authenticate;
exports.loadMembership = loadMembership;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
const db_1 = __importDefault(require("../db"));
const logger_1 = require("../logger");
const USER_CACHE = new Map();
const USER_CACHE_TTL = 60_000; // 60 seconds
const USER_CACHE_MAX = 500; // Max entries to prevent memory leak
function getCachedUser(userId) {
    const entry = USER_CACHE.get(userId);
    if (!entry)
        return null;
    if (Date.now() - entry.cachedAt > USER_CACHE_TTL) {
        USER_CACHE.delete(userId);
        return null;
    }
    return entry;
}
function cacheUser(userId, user) {
    // Evict oldest if at capacity
    if (USER_CACHE.size >= USER_CACHE_MAX) {
        const firstKey = USER_CACHE.keys().next().value;
        if (firstKey)
            USER_CACHE.delete(firstKey);
    }
    USER_CACHE.set(userId, {
        is_active: user.is_active,
        global_role: user.global_role,
        password_changed_at: user.password_changed_at,
        cachedAt: Date.now(),
    });
}
/** Invalidate cache for a user (call after password change, deactivation, etc.) */
function invalidateUserCache(userId) {
    USER_CACHE.delete(userId);
}
/** Clear entire user cache (used in tests) */
function clearUserCache() {
    USER_CACHE.clear();
}
async function authenticate(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            res.status(401).json({ success: false, error: 'Authentication required' });
            return;
        }
        const token = authHeader.split(' ')[1];
        // ── Try gateway token first (developer admin — no DB account) ──
        const gatewaySecret = process.env.GATEWAY_JWT_SECRET;
        if (gatewaySecret) {
            try {
                const gwPayload = jsonwebtoken_1.default.verify(token, gatewaySecret);
                if (gwPayload.role === 'gateway_admin') {
                    const elevatedRole = gwPayload.globalRole === 'super_admin' ? 'super_admin' : 'developer';
                    req.user = {
                        userId: gwPayload.userId || 'gateway-developer',
                        email: gwPayload.email || process.env.ADMIN_EMAIL || 'developer@orgsledger.com',
                        globalRole: elevatedRole,
                    };
                    logger_1.logger.debug('[AUTH] Gateway elevated user authenticated', {
                        email: req.user.email,
                        role: req.user.globalRole,
                        path: req.originalUrl,
                    });
                    return next();
                }
            }
            catch {
                // Not a gateway token — fall through to normal JWT verification
            }
        }
        // ── Normal app user JWT ──
        const payload = jsonwebtoken_1.default.verify(token, config_1.config.jwt.secret);
        // Check cache first, then DB
        let user = getCachedUser(payload.userId);
        if (!user) {
            const dbUser = await (0, db_1.default)('users')
                .where({ id: payload.userId })
                .select('is_active', 'global_role', 'password_changed_at')
                .first();
            if (!dbUser || !dbUser.is_active) {
                logger_1.logger.warn('[AUTH] User not found or deactivated', { userId: payload.userId });
                res.status(401).json({ success: false, error: 'User not found or deactivated' });
                return;
            }
            cacheUser(payload.userId, dbUser);
            user = getCachedUser(payload.userId);
        }
        if (!user.is_active) {
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
        // Super admins and developers get admin-level access everywhere
        if (req.user.globalRole === 'super_admin' || req.user.globalRole === 'developer') {
            req.membership = {
                id: req.user.userId, // Use actual user ID, not role string
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