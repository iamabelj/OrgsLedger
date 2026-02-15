// ============================================================
// OrgsLedger Database — Type Definitions
// Typed interfaces for Knex config, query results, and seed data.
// ============================================================

import type { Knex } from 'knex';

// ── Knex Connection ─────────────────────────────────────────

/** Connection string variant (DATABASE_URL) */
export interface ConnectionStringConfig {
  connectionString: string;
  ssl: { rejectUnauthorized: boolean };
}

/** Individual params variant (host/port/user/password/database) */
export interface ConnectionParamsConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export type ConnectionConfig = ConnectionStringConfig | ConnectionParamsConfig;

// ── Database Row Types ──────────────────────────────────────

export interface UserRow {
  id: string;
  email: string;
  phone: string | null;
  password_hash: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  is_active: boolean;
  email_verified: boolean;
  global_role: string;
  fcm_token: string | null;
  apns_token: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  status: string;
  billing_country: string | null;
  billing_currency: string;
  subscription_status: string;
  settings: string;
  created_at: string;
  updated_at: string;
}

export interface MembershipRow {
  id: string;
  user_id: string;
  organization_id: string;
  role: string;
  is_active: boolean;
  joined_at: string;
  created_at: string;
  updated_at: string;
}

export interface ChannelRow {
  id: string;
  organization_id: string;
  name: string;
  type: string;
  description: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubscriptionPlanRow {
  id: string;
  name: string;
  slug: string;
  max_members: number;
  features: string;
  price_usd_annual: string;
  price_usd_monthly: string | null;
  price_ngn_annual: string;
  price_ngn_monthly: string | null;
  is_active: boolean;
  sort_order: number;
  description: string | null;
}

export interface InviteLinkRow {
  id: string;
  organization_id: string;
  code: string;
  role: string;
  max_uses: number | null;
  use_count: number;
  expires_at: string | null;
  is_active: boolean;
  created_by: string | null;
}

export interface PlatformConfigRow {
  id: string;
  key: string;
  value: string;
  description: string | null;
}

export interface WalletRow {
  id: string;
  organization_id: string;
  balance_minutes: string;
  currency: string;
}
