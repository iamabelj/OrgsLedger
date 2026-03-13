"use strict";
// ============================================================
// OrgsLedger API — Constants
// Centralizes magic strings, roles, domains, limits, defaults.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.APP_VERSION = exports.APP_NAME = exports.DEEP_LINK_SCHEME = exports.SOCKET_EVENTS = exports.TX_STATUS = exports.PLANS = exports.UPLOAD = exports.ACCOUNT_LOCKOUT = exports.RATE_LIMITS = exports.PAGINATION = exports.RATE_NGN_PER_USD = exports.CURRENCIES = exports.NOTIFICATION_TYPES = exports.GATEWAYS = exports.SUB_STATUS = exports.ELEVATED_ROLES = exports.ROLE_HIERARCHY = exports.ROLES = exports.LANDING_HOSTS = exports.DOMAINS = void 0;
exports.isLandingHost = isLandingHost;
// ── Domains ─────────────────────────────────────────────────
exports.DOMAINS = {
    LANDING: 'orgsledger.com',
    LANDING_WWW: 'www.orgsledger.com',
    APP: 'app.orgsledger.com',
    LOCALHOST: 'localhost',
    LOOPBACK: '127.0.0.1',
};
exports.LANDING_HOSTS = [
    exports.DOMAINS.LANDING,
    exports.DOMAINS.LANDING_WWW,
];
/** Check whether a Host header belongs to the landing / marketing domain */
function isLandingHost(host) {
    const cleaned = host.replace(/:\d+$/, '').toLowerCase();
    return exports.LANDING_HOSTS.includes(cleaned);
}
// ── Roles ───────────────────────────────────────────────────
exports.ROLES = {
    GUEST: 'guest',
    MEMBER: 'member',
    EXECUTIVE: 'executive',
    ORG_ADMIN: 'org_admin',
    SUPER_ADMIN: 'super_admin',
    DEVELOPER: 'developer',
};
exports.ROLE_HIERARCHY = {
    [exports.ROLES.GUEST]: 0,
    [exports.ROLES.MEMBER]: 1,
    [exports.ROLES.EXECUTIVE]: 2,
    [exports.ROLES.ORG_ADMIN]: 3,
    [exports.ROLES.SUPER_ADMIN]: 4,
    [exports.ROLES.DEVELOPER]: 5,
};
exports.ELEVATED_ROLES = [exports.ROLES.SUPER_ADMIN, exports.ROLES.DEVELOPER];
// ── Subscription Statuses ───────────────────────────────────
exports.SUB_STATUS = {
    ACTIVE: 'active',
    EXPIRED: 'expired',
    GRACE_PERIOD: 'grace_period',
    SUSPENDED: 'suspended',
    CANCELLED: 'cancelled',
};
// ── Payment Gateways ────────────────────────────────────────
exports.GATEWAYS = {
    STRIPE: 'stripe',
    PAYSTACK: 'paystack',
    FLUTTERWAVE: 'flutterwave',
    BANK_TRANSFER: 'bank_transfer',
};
// ── Notification Types ──────────────────────────────────────
exports.NOTIFICATION_TYPES = {
    PAYMENT: 'payment',
    CHAT: 'chat',
    EVENT: 'event',
    ANNOUNCEMENT: 'announcement',
    DUES: 'dues',
    POLL: 'poll',
    DOCUMENT: 'document',
    EXPENSE: 'expense',
    SYSTEM: 'system',
};
// ── Currencies ──────────────────────────────────────────────
exports.CURRENCIES = {
    USD: 'USD',
    NGN: 'NGN',
};
exports.RATE_NGN_PER_USD = parseInt(process.env.RATE_NGN_PER_USD || '1600', 10);
// ── Pagination Defaults ─────────────────────────────────────
exports.PAGINATION = {
    DEFAULT_LIMIT: 50,
    MAX_LIMIT: 200,
    DEFAULT_PAGE: 1,
};
// ── Rate Limiting ───────────────────────────────────────────
exports.RATE_LIMITS = {
    GLOBAL: { windowMs: 15 * 60 * 1000, max: 1000 },
    AUTH: { windowMs: 15 * 60 * 1000, max: 15 },
    REFRESH: { windowMs: 15 * 60 * 1000, max: 30 },
    WEBHOOK: { windowMs: 60 * 1000, max: 60 },
};
// ── Account Lockout ─────────────────────────────────────────
exports.ACCOUNT_LOCKOUT = {
    MAX_ATTEMPTS: 5, // Lock after 5 failed login attempts
    LOCKOUT_DURATION_MIN: 15, // Lock for 15 minutes
    LOCKOUT_DURATION_MS: 15 * 60 * 1000, // 15 minutes in ms
};
// ── Upload Defaults ─────────────────────────────────────────
exports.UPLOAD = {
    AVATAR_MAX_SIZE: 5 * 1024 * 1024, // 5 MB
    ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
};
// ── Subscription Plans ──────────────────────────────────────
exports.PLANS = {
    FREE: 'free',
    STANDARD: 'standard',
    PROFESSIONAL: 'professional',
    ENTERPRISE: 'enterprise',
};
// ── Transaction Statuses ────────────────────────────────────
exports.TX_STATUS = {
    PENDING: 'pending',
    COMPLETED: 'completed',
    FAILED: 'failed',
    REFUNDED: 'refunded',
};
// ── Event Socket Types ──────────────────────────────────────
exports.SOCKET_EVENTS = {
    PAYMENT_COMPLETED: 'payment_completed',
    FINANCIAL_UPDATE: 'financial_update',
    CHAT_MESSAGE: 'chat_message',
    NOTIFICATION: 'notification',
};
// ── Deep Link Schemes ───────────────────────────────────────
exports.DEEP_LINK_SCHEME = 'orgsledger://';
// ── Misc ────────────────────────────────────────────────────
exports.APP_NAME = 'OrgsLedger';
exports.APP_VERSION = '1.1.0-edit';
//# sourceMappingURL=constants.js.map