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
  reset_code: string | null;
  reset_code_expires_at: string | null;
  verification_code: string | null;
  verification_code_expires_at: string | null;
  notification_preferences: Record<string, unknown> | null;
  password_changed_at: string | null;
  signup_invite_code: string | null;
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
  committee_id: string | null;
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
  created_at: string;
  updated_at: string;
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
  description: string | null;
  created_at: string;
  updated_at: string;
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
  total_topped_up: string;
  price_per_hour_usd: string;
  price_per_hour_ngn: string;
  created_at: string;
  updated_at: string;
}

// ── Meeting Types ───────────────────────────────────────────

export interface MeetingRow {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  location: string | null;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  meeting_type: 'video' | 'audio';
  scheduled_start: string;
  scheduled_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  created_by: string;
  ai_enabled: boolean;
  translation_enabled: boolean;
  audio_storage_url: string | null;
  room_id: string | null;
  recurring_pattern: string;
  recurring_end_date: string | null;
  parent_meeting_id: string | null;
  max_participants: number;
  duration_limit_minutes: number;
  lobby_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface MeetingAttendanceRow {
  id: string;
  meeting_id: string;
  user_id: string;
  status: 'present' | 'absent' | 'excused' | 'late';
  joined_at: string | null;
  left_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MeetingJoinLogRow {
  id: string;
  meeting_id: string;
  user_id: string;
  organization_id: string;
  join_type: 'video' | 'audio';
  is_moderator: boolean;
  ip_address: string | null;
  user_agent: string | null;
  joined_at: string;
  left_at: string | null;
}

export interface VoteRow {
  id: string;
  meeting_id: string;
  title: string;
  description: string | null;
  options: any;
  status: 'open' | 'closed';
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VoteBallotRow {
  id: string;
  vote_id: string;
  user_id: string;
  selected_option: string;
  created_at: string;
  updated_at: string;
}

export interface MeetingMinutesRow {
  id: string;
  meeting_id: string;
  organization_id: string;
  transcript: any;
  summary: string | null;
  decisions: any;
  motions: any;
  action_items: any;
  contributions: any;
  ai_credits_used: string;
  status: 'processing' | 'completed' | 'failed';
  error_message: string | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
}
