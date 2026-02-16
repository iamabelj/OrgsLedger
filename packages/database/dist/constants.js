"use strict";
// ============================================================
// OrgsLedger Database — Constants
// Centralizes magic strings, prices, roles, statuses used across
// migrations and seed scripts.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIG_KEYS = exports.DEFAULTS = exports.PLAN_SLUGS = exports.WALLET_PRICES = exports.BILLING_CYCLES = exports.CURRENCIES = exports.FINE_STATUS = exports.TX_STATUS = exports.ORG_STATUS = exports.SUB_STATUS = exports.ROLES = void 0;
// ── Roles ───────────────────────────────────────────────────
exports.ROLES = {
    GUEST: 'guest',
    MEMBER: 'member',
    EXECUTIVE: 'executive',
    ORG_ADMIN: 'org_admin',
    SUPER_ADMIN: 'super_admin',
    DEVELOPER: 'developer',
};
// ── Subscription / Org Statuses ─────────────────────────────
exports.SUB_STATUS = {
    ACTIVE: 'active',
    EXPIRED: 'expired',
    GRACE_PERIOD: 'grace_period',
    SUSPENDED: 'suspended',
    CANCELLED: 'cancelled',
};
exports.ORG_STATUS = {
    ACTIVE: 'active',
    SUSPENDED: 'suspended',
};
// ── Transaction / Fine / Donation Statuses ──────────────────
exports.TX_STATUS = {
    PENDING: 'pending',
    COMPLETED: 'completed',
    FAILED: 'failed',
    REFUNDED: 'refunded',
};
exports.FINE_STATUS = {
    UNPAID: 'unpaid',
    PAID: 'paid',
};
// ── Billing ─────────────────────────────────────────────────
exports.CURRENCIES = {
    USD: 'USD',
    NGN: 'NGN',
};
exports.BILLING_CYCLES = {
    ANNUAL: 'annual',
    MONTHLY: 'monthly',
};
// ── Wallet Prices ───────────────────────────────────────────
exports.WALLET_PRICES = {
    AI_PER_HOUR_USD: 10.00,
    AI_PER_HOUR_NGN: 18_000.00,
    TRANSLATION_PER_HOUR_USD: 25.00,
    TRANSLATION_PER_HOUR_NGN: 45_000.00,
    AI_CREDIT_PER_HOUR_USD: 7.00,
};
// ── Subscription Plan Defaults ──────────────────────────────
exports.PLAN_SLUGS = {
    STANDARD: 'standard',
    PROFESSIONAL: 'professional',
    ENTERPRISE: 'enterprise',
    ENTERPRISE_PRO: 'enterprise_pro',
};
// ── Defaults ────────────────────────────────────────────────
exports.DEFAULTS = {
    MAX_FILE_UPLOAD_MB: 10,
    DEFAULT_BILLING_CYCLE: exports.BILLING_CYCLES.ANNUAL,
    DEFAULT_CURRENCY: exports.CURRENCIES.USD,
    GRACE_PERIOD_DAYS: 7,
    BCRYPT_ROUNDS: 12,
};
// ── Platform Config Keys ────────────────────────────────────
exports.CONFIG_KEYS = {
    AI_PRICE_PER_CREDIT_HOUR: 'ai_price_per_credit_hour',
    PLATFORM_NAME: 'platform_name',
    STRIPE_ENABLED: 'stripe_enabled',
    PAYSTACK_ENABLED: 'paystack_enabled',
    FLUTTERWAVE_ENABLED: 'flutterwave_enabled',
    MAX_FILE_UPLOAD_MB: 'max_file_upload_mb',
    DEFAULT_BILLING_CYCLE: 'default_billing_cycle',
};
//# sourceMappingURL=constants.js.map