// ============================================================
// OrgsLedger Database — Constants
// Centralizes magic strings, prices, roles, statuses used across
// migrations and seed scripts.
// ============================================================

// ── Roles ───────────────────────────────────────────────────
export const ROLES = {
  GUEST: 'guest',
  MEMBER: 'member',
  EXECUTIVE: 'executive',
  ORG_ADMIN: 'org_admin',
  SUPER_ADMIN: 'super_admin',
  DEVELOPER: 'developer',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

// ── Subscription / Org Statuses ─────────────────────────────
export const SUB_STATUS = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  GRACE_PERIOD: 'grace_period',
  SUSPENDED: 'suspended',
  CANCELLED: 'cancelled',
} as const;

export const ORG_STATUS = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
} as const;

// ── Transaction / Fine / Donation Statuses ──────────────────
export const TX_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
} as const;

export const FINE_STATUS = {
  UNPAID: 'unpaid',
  PAID: 'paid',
} as const;

// ── Billing ─────────────────────────────────────────────────
export const CURRENCIES = {
  USD: 'USD',
  NGN: 'NGN',
} as const;

export const BILLING_CYCLES = {
  ANNUAL: 'annual',
  MONTHLY: 'monthly',
} as const;

// ── Wallet Prices ───────────────────────────────────────────
// AI + Translation bundled at $20/hr (₦25,000/hr) — single unified rate
export const WALLET_PRICES = {
  AI_PER_HOUR_USD: 20.00,
  AI_PER_HOUR_NGN: 25_000.00,
  TRANSLATION_PER_HOUR_USD: 20.00,
  TRANSLATION_PER_HOUR_NGN: 25_000.00,
  AI_CREDIT_PER_HOUR_USD: 7.00,
} as const;

// ── Subscription Plan Defaults ──────────────────────────────
export const PLAN_SLUGS = {
  STANDARD: 'standard',
  PROFESSIONAL: 'professional',
  ENTERPRISE: 'enterprise',
  ENTERPRISE_PRO: 'enterprise_pro',
} as const;

// ── Defaults ────────────────────────────────────────────────
export const DEFAULTS = {
  MAX_FILE_UPLOAD_MB: 10,
  DEFAULT_BILLING_CYCLE: BILLING_CYCLES.ANNUAL,
  DEFAULT_CURRENCY: CURRENCIES.USD,
  GRACE_PERIOD_DAYS: 7,
  BCRYPT_ROUNDS: 12,
} as const;

// ── Platform Config Keys ────────────────────────────────────
export const CONFIG_KEYS = {
  AI_PRICE_PER_CREDIT_HOUR: 'ai_price_per_credit_hour',
  PLATFORM_NAME: 'platform_name',
  STRIPE_ENABLED: 'stripe_enabled',
  PAYSTACK_ENABLED: 'paystack_enabled',
  FLUTTERWAVE_ENABLED: 'flutterwave_enabled',
  MAX_FILE_UPLOAD_MB: 'max_file_upload_mb',
  DEFAULT_BILLING_CYCLE: 'default_billing_cycle',
} as const;
