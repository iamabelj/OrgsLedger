// ============================================================
// OrgsLedger API — Centralized Schema Registry
// Registers all Zod route-validation schemas so they are
// automatically reflected in the OpenAPI specification.
// Import this file once at startup (e.g. in docs.ts).
// ============================================================

import { z } from 'zod';
import { registerSchema } from '../utils/zod-to-openapi';

// ── Auth Schemas ────────────────────────────────────────────
registerSchema('LoginRequest', z.object({
  email: z.string().email(),
  password: z.string().min(1),
}), 'Login credentials');

registerSchema('RegisterRequest', z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().nullable().optional(),
  inviteCode: z.string().min(1).max(32),
}), 'User registration payload');

registerSchema('AdminRegisterRequest', z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().nullable().optional(),
  orgName: z.string().min(2).max(200),
  orgSlug: z.string().min(3).max(60),
  plan: z.string().optional(),
  billingCycle: z.string().optional(),
  billingRegion: z.string().optional(),
  currency: z.string().optional(),
}), 'Admin registration with org creation');

registerSchema('ForgotPasswordRequest', z.object({
  email: z.string().email(),
}), 'Request password reset email');

registerSchema('ResetPasswordRequest', z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
}), 'Reset password with token');

registerSchema('ChangePasswordRequest', z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
}), 'Change password (authenticated)');

registerSchema('RefreshTokenRequest', z.object({
  refreshToken: z.string().min(1),
}), 'Refresh access token');

// ── Organization Schemas ────────────────────────────────────
registerSchema('CreateOrganizationRequest', z.object({
  name: z.string().min(2).max(200),
  slug: z.string().min(2).max(100),
  currency: z.string().length(3).default('USD'),
  timezone: z.string().default('UTC'),
}), 'Create a new organization');

registerSchema('AddMemberRequest', z.object({
  email: z.string().email(),
  role: z.enum(['org_admin', 'executive', 'member', 'guest']).default('member'),
}), 'Add a member to an organization');

// ── Meeting Schemas ─────────────────────────────────────────
registerSchema('CreateMeetingRequest', z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  location: z.string().max(500).optional(),
  scheduledStart: z.string(),
  scheduledEnd: z.string().optional(),
  meetingType: z.enum(['video', 'audio']).default('video'),
  aiEnabled: z.boolean().default(false),
  translationEnabled: z.boolean().default(false),
  recurringPattern: z.enum(['none', 'daily', 'weekly', 'biweekly', 'monthly']).default('none'),
  recurringEndDate: z.string().optional(),
  maxParticipants: z.number().int().min(0).max(1000).default(0),
  durationLimitMinutes: z.number().int().min(0).max(1440).default(0),
  lobbyEnabled: z.boolean().default(false),
  agendaItems: z.array(z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    durationMinutes: z.number().min(1).optional(),
    presenterUserId: z.string().uuid().optional(),
  })).optional(),
}), 'Schedule a new meeting');

registerSchema('CreateVoteRequest', z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  options: z.array(z.string().min(1)).min(2).max(10),
}), 'Create an in-meeting vote');

// ── Profile Schemas ─────────────────────────────────────────
registerSchema('ProfileUpdateRequest', z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  phone: z.string().max(50).nullable().optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
  language: z.string().max(10).optional(),
}), 'Update user profile');

// ── Notification Schemas ────────────────────────────────────
registerSchema('NotificationPreferences', z.object({
  email_finances: z.boolean().optional(),
  email_announcements: z.boolean().optional(),
  push_finances: z.boolean().optional(),
  push_announcements: z.boolean().optional(),
  push_chat: z.boolean().optional(),
}), 'Notification preference settings');

// ── Response Schemas ────────────────────────────────────────
registerSchema('TokenResponse', z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    firstName: z.string(),
    lastName: z.string(),
    globalRole: z.string(),
  }),
}), 'Authentication token response');

registerSchema('PaginatedResponse', z.object({
  success: z.boolean(),
  data: z.array(z.object({})),
  meta: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
  }),
}), 'Paginated list response');
