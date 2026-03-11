// ============================================================
// OrgsLedger API — Constants
// Centralizes magic strings, roles, domains, limits, defaults.
// ============================================================

// ── Domains ─────────────────────────────────────────────────
export const DOMAINS = {
  LANDING: 'orgsledger.com',
  LANDING_WWW: 'www.orgsledger.com',
  APP: 'app.orgsledger.com',
  LOCALHOST: 'localhost',
  LOOPBACK: '127.0.0.1',
} as const;

export const LANDING_HOSTS = [
  DOMAINS.LANDING,
  DOMAINS.LANDING_WWW,
] as const;

/** Check whether a Host header belongs to the landing / marketing domain */
export function isLandingHost(host: string): boolean {
  const cleaned = host.replace(/:\d+$/, '').toLowerCase();
  return (LANDING_HOSTS as readonly string[]).includes(cleaned);
}

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

export const ROLE_HIERARCHY: Record<string, number> = {
  [ROLES.GUEST]: 0,
  [ROLES.MEMBER]: 1,
  [ROLES.EXECUTIVE]: 2,
  [ROLES.ORG_ADMIN]: 3,
  [ROLES.SUPER_ADMIN]: 4,
  [ROLES.DEVELOPER]: 5,
};

export const ELEVATED_ROLES: readonly string[] = [ROLES.SUPER_ADMIN, ROLES.DEVELOPER];

// ── Subscription Statuses ───────────────────────────────────
export const SUB_STATUS = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  GRACE_PERIOD: 'grace_period',
  SUSPENDED: 'suspended',
  CANCELLED: 'cancelled',
} as const;

export type SubStatus = (typeof SUB_STATUS)[keyof typeof SUB_STATUS];

// ── Payment Gateways ────────────────────────────────────────
export const GATEWAYS = {
  STRIPE: 'stripe',
  PAYSTACK: 'paystack',
  FLUTTERWAVE: 'flutterwave',
  BANK_TRANSFER: 'bank_transfer',
} as const;

// ── Notification Types ──────────────────────────────────────
export const NOTIFICATION_TYPES = {
  PAYMENT: 'payment',
  CHAT: 'chat',
  EVENT: 'event',
  ANNOUNCEMENT: 'announcement',
  DUES: 'dues',
  POLL: 'poll',
  DOCUMENT: 'document',
  EXPENSE: 'expense',
  SYSTEM: 'system',
} as const;

// ── Currencies ──────────────────────────────────────────────
export const CURRENCIES = {
  USD: 'USD',
  NGN: 'NGN',
} as const;

export const RATE_NGN_PER_USD = parseInt(process.env.RATE_NGN_PER_USD || '1600', 10);

// ── Pagination Defaults ─────────────────────────────────────
export const PAGINATION = {
  DEFAULT_LIMIT: 50,
  MAX_LIMIT: 200,
  DEFAULT_PAGE: 1,
} as const;

// ── Rate Limiting ───────────────────────────────────────────
export const RATE_LIMITS = {
  GLOBAL: { windowMs: 15 * 60 * 1000, max: 1000 },
  AUTH: { windowMs: 15 * 60 * 1000, max: 15 },
  REFRESH: { windowMs: 15 * 60 * 1000, max: 30 },
  WEBHOOK: { windowMs: 60 * 1000, max: 60 },
} as const;

// ── Account Lockout ─────────────────────────────────────────
export const ACCOUNT_LOCKOUT = {
  MAX_ATTEMPTS: 5,                     // Lock after 5 failed login attempts
  LOCKOUT_DURATION_MIN: 15,            // Lock for 15 minutes
  LOCKOUT_DURATION_MS: 15 * 60 * 1000, // 15 minutes in ms
} as const;

// ── Upload Defaults ─────────────────────────────────────────
export const UPLOAD = {
  AVATAR_MAX_SIZE: 5 * 1024 * 1024, // 5 MB
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as readonly string[],
} as const;

// ── Subscription Plans ──────────────────────────────────────
export const PLANS = {
  FREE: 'free',
  STANDARD: 'standard',
  PROFESSIONAL: 'professional',
  ENTERPRISE: 'enterprise',
} as const;

// ── Transaction Statuses ────────────────────────────────────
export const TX_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
} as const;

// ── Event Socket Types ──────────────────────────────────────
export const SOCKET_EVENTS = {
  PAYMENT_COMPLETED: 'payment_completed',
  FINANCIAL_UPDATE: 'financial_update',
  CHAT_MESSAGE: 'chat_message',
  NOTIFICATION: 'notification',
} as const;

// ── Deep Link Schemes ───────────────────────────────────────
export const DEEP_LINK_SCHEME = 'orgsledger://';

// ── Misc ────────────────────────────────────────────────────
export const APP_NAME = 'OrgsLedger';
export const APP_VERSION = '1.1.0-edit';
