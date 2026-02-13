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
            res.status(401).json({ success: false, error: 'User not found or deactivated' });
            return;
        }
        req.user = payload;
        next();
    }
    catch (err) {
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
            res.status(403).json({ success: false, error: 'Not a member of this organization' });
            return;
        }
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