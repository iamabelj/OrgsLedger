"use strict";
// ============================================================
// OrgsLedger API — Centralized Schema Registry
// Registers all Zod route-validation schemas so they are
// automatically reflected in the OpenAPI specification.
// Import this file once at startup (e.g. in docs.ts).
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const zod_to_openapi_1 = require("../utils/zod-to-openapi");
// ── Auth Schemas ────────────────────────────────────────────
(0, zod_to_openapi_1.registerSchema)('LoginRequest', zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(1),
}), 'Login credentials');
(0, zod_to_openapi_1.registerSchema)('RegisterRequest', zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8).max(128),
    firstName: zod_1.z.string().min(1).max(100),
    lastName: zod_1.z.string().min(1).max(100),
    phone: zod_1.z.string().nullable().optional(),
    inviteCode: zod_1.z.string().min(1).max(32),
}), 'User registration payload');
(0, zod_to_openapi_1.registerSchema)('AdminRegisterRequest', zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(8).max(128),
    firstName: zod_1.z.string().min(1).max(100),
    lastName: zod_1.z.string().min(1).max(100),
    phone: zod_1.z.string().nullable().optional(),
    orgName: zod_1.z.string().min(2).max(200),
    orgSlug: zod_1.z.string().min(3).max(60),
    plan: zod_1.z.string().optional(),
    billingCycle: zod_1.z.string().optional(),
    billingRegion: zod_1.z.string().optional(),
    currency: zod_1.z.string().optional(),
}), 'Admin registration with org creation');
(0, zod_to_openapi_1.registerSchema)('ForgotPasswordRequest', zod_1.z.object({
    email: zod_1.z.string().email(),
}), 'Request password reset email');
(0, zod_to_openapi_1.registerSchema)('ResetPasswordRequest', zod_1.z.object({
    token: zod_1.z.string().min(1),
    password: zod_1.z.string().min(8).max(128),
}), 'Reset password with token');
(0, zod_to_openapi_1.registerSchema)('ChangePasswordRequest', zod_1.z.object({
    currentPassword: zod_1.z.string().min(1),
    newPassword: zod_1.z.string().min(8).max(128),
}), 'Change password (authenticated)');
(0, zod_to_openapi_1.registerSchema)('RefreshTokenRequest', zod_1.z.object({
    refreshToken: zod_1.z.string().min(1),
}), 'Refresh access token');
// ── Organization Schemas ────────────────────────────────────
(0, zod_to_openapi_1.registerSchema)('CreateOrganizationRequest', zod_1.z.object({
    name: zod_1.z.string().min(2).max(200),
    slug: zod_1.z.string().min(2).max(100),
    currency: zod_1.z.string().length(3).default('USD'),
    timezone: zod_1.z.string().default('UTC'),
}), 'Create a new organization');
(0, zod_to_openapi_1.registerSchema)('AddMemberRequest', zod_1.z.object({
    email: zod_1.z.string().email(),
    role: zod_1.z.enum(['org_admin', 'executive', 'member', 'guest']).default('member'),
}), 'Add a member to an organization');
// ── Meeting Schemas ─────────────────────────────────────────
(0, zod_to_openapi_1.registerSchema)('CreateMeetingRequest', zod_1.z.object({
    title: zod_1.z.string().min(1).max(300),
    description: zod_1.z.string().max(5000).optional(),
    location: zod_1.z.string().max(500).optional(),
    scheduledStart: zod_1.z.string(),
    scheduledEnd: zod_1.z.string().optional(),
    meetingType: zod_1.z.enum(['video', 'audio']).default('video'),
    aiEnabled: zod_1.z.boolean().default(false),
    translationEnabled: zod_1.z.boolean().default(false),
    recurringPattern: zod_1.z.enum(['none', 'daily', 'weekly', 'biweekly', 'monthly']).default('none'),
    recurringEndDate: zod_1.z.string().optional(),
    maxParticipants: zod_1.z.number().int().min(0).max(1000).default(0),
    durationLimitMinutes: zod_1.z.number().int().min(0).max(1440).default(0),
    lobbyEnabled: zod_1.z.boolean().default(false),
    agendaItems: zod_1.z.array(zod_1.z.object({
        title: zod_1.z.string().min(1),
        description: zod_1.z.string().optional(),
        durationMinutes: zod_1.z.number().min(1).optional(),
        presenterUserId: zod_1.z.string().uuid().optional(),
    })).optional(),
}), 'Schedule a new meeting');
(0, zod_to_openapi_1.registerSchema)('CreateVoteRequest', zod_1.z.object({
    title: zod_1.z.string().min(1).max(300),
    description: zod_1.z.string().max(2000).optional(),
    options: zod_1.z.array(zod_1.z.string().min(1)).min(2).max(10),
}), 'Create an in-meeting vote');
// ── Profile Schemas ─────────────────────────────────────────
(0, zod_to_openapi_1.registerSchema)('ProfileUpdateRequest', zod_1.z.object({
    firstName: zod_1.z.string().min(1).max(100).optional(),
    lastName: zod_1.z.string().min(1).max(100).optional(),
    phone: zod_1.z.string().max(50).nullable().optional(),
    avatarUrl: zod_1.z.string().max(500).nullable().optional(),
    language: zod_1.z.string().max(10).optional(),
}), 'Update user profile');
// ── Notification Schemas ────────────────────────────────────
(0, zod_to_openapi_1.registerSchema)('NotificationPreferences', zod_1.z.object({
    email_meetings: zod_1.z.boolean().optional(),
    email_finances: zod_1.z.boolean().optional(),
    email_announcements: zod_1.z.boolean().optional(),
    push_meetings: zod_1.z.boolean().optional(),
    push_finances: zod_1.z.boolean().optional(),
    push_announcements: zod_1.z.boolean().optional(),
    push_chat: zod_1.z.boolean().optional(),
}), 'Notification preference settings');
// ── Response Schemas ────────────────────────────────────────
(0, zod_to_openapi_1.registerSchema)('TokenResponse', zod_1.z.object({
    accessToken: zod_1.z.string(),
    refreshToken: zod_1.z.string(),
    user: zod_1.z.object({
        id: zod_1.z.string().uuid(),
        email: zod_1.z.string().email(),
        firstName: zod_1.z.string(),
        lastName: zod_1.z.string(),
        globalRole: zod_1.z.string(),
    }),
}), 'Authentication token response');
(0, zod_to_openapi_1.registerSchema)('PaginatedResponse', zod_1.z.object({
    success: zod_1.z.boolean(),
    data: zod_1.z.array(zod_1.z.object({})),
    meta: zod_1.z.object({
        page: zod_1.z.number().int(),
        limit: zod_1.z.number().int(),
        total: zod_1.z.number().int(),
    }),
}), 'Paginated list response');
//# sourceMappingURL=api-schemas.js.map