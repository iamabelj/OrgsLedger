"use strict";
// ============================================================
// OrgsLedger API — OpenAPI Specification
// Auto-generates Swagger docs from route definitions.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.openApiSpec = void 0;
const express_1 = require("express");
const zod_to_openapi_1 = require("../utils/zod-to-openapi");
// Load all Zod schema registrations (side-effect import)
require("../schemas/api-schemas");
const router = (0, express_1.Router)();
/**
 * OpenAPI 3.0 specification for the OrgsLedger API.
 * Served at /api/docs/openapi.json
 */
const openApiSpec = {
    openapi: '3.0.3',
    info: {
        title: 'OrgsLedger API',
        version: '1.1.0',
        description: 'Backend API for OrgsLedger — organization management, payments, meetings, and collaboration platform.',
        contact: { name: 'OrgsLedger Support', email: 'support@orgsledger.com' },
        license: { name: 'Proprietary' },
    },
    servers: [
        { url: 'https://app.orgsledger.com/api', description: 'Production' },
        { url: 'http://localhost:3000/api', description: 'Development' },
    ],
    components: {
        securitySchemes: {
            BearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description: 'JWT access token from /auth/login',
            },
        },
        schemas: {
            Error: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: false },
                    error: { type: 'string', example: 'Error message' },
                },
            },
            Success: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: true },
                    data: { type: 'object' },
                },
            },
            User: {
                type: 'object',
                properties: {
                    id: { type: 'string', format: 'uuid' },
                    email: { type: 'string', format: 'email' },
                    firstName: { type: 'string' },
                    lastName: { type: 'string' },
                    avatarUrl: { type: 'string', nullable: true },
                    globalRole: { type: 'string', enum: ['guest', 'member', 'executive', 'org_admin', 'super_admin', 'developer'] },
                },
            },
            Tokens: {
                type: 'object',
                properties: {
                    accessToken: { type: 'string' },
                    refreshToken: { type: 'string' },
                },
            },
            Membership: {
                type: 'object',
                properties: {
                    id: { type: 'string', format: 'uuid' },
                    role: { type: 'string' },
                    organizationId: { type: 'string', format: 'uuid' },
                    organizationName: { type: 'string' },
                    organizationSlug: { type: 'string' },
                },
            },
            PaginationMeta: {
                type: 'object',
                properties: {
                    page: { type: 'integer' },
                    limit: { type: 'integer' },
                    total: { type: 'integer' },
                },
            },
        },
        parameters: {
            OrgId: {
                name: 'orgId',
                in: 'path',
                required: true,
                schema: { type: 'string', format: 'uuid' },
                description: 'Organization ID',
            },
            Page: {
                name: 'page',
                in: 'query',
                schema: { type: 'integer', default: 1, minimum: 1 },
            },
            Limit: {
                name: 'limit',
                in: 'query',
                schema: { type: 'integer', default: 50, maximum: 200 },
            },
        },
    },
    security: [{ BearerAuth: [] }],
    paths: {
        // ── Auth ──
        '/auth/register': {
            post: {
                tags: ['Auth'],
                summary: 'Register a new user with invite code',
                security: [],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['email', 'password', 'firstName', 'lastName', 'inviteCode'],
                                properties: {
                                    email: { type: 'string', format: 'email' },
                                    password: { type: 'string', minLength: 8 },
                                    firstName: { type: 'string' },
                                    lastName: { type: 'string' },
                                    inviteCode: { type: 'string' },
                                },
                            },
                        },
                    },
                },
                responses: {
                    '201': { description: 'User registered successfully' },
                    '400': { description: 'Validation error' },
                    '409': { description: 'Email already exists' },
                },
            },
        },
        '/auth/login': {
            post: {
                tags: ['Auth'],
                summary: 'Login with email and password',
                security: [],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['email', 'password'],
                                properties: {
                                    email: { type: 'string', format: 'email' },
                                    password: { type: 'string' },
                                },
                            },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Login successful',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                user: { $ref: '#/components/schemas/User' },
                                                memberships: { type: 'array', items: { $ref: '#/components/schemas/Membership' } },
                                                accessToken: { type: 'string' },
                                                refreshToken: { type: 'string' },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    '401': { description: 'Invalid credentials' },
                    '423': { description: 'Account locked' },
                },
            },
        },
        '/auth/refresh': {
            post: {
                tags: ['Auth'],
                summary: 'Refresh access token (rotates refresh token)',
                security: [],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['refreshToken'],
                                properties: {
                                    refreshToken: { type: 'string' },
                                },
                            },
                        },
                    },
                },
                responses: {
                    '200': { description: 'New token pair issued' },
                    '401': { description: 'Invalid or revoked refresh token' },
                },
            },
        },
        '/auth/logout': {
            post: {
                tags: ['Auth'],
                summary: 'Logout — revoke refresh token',
                security: [],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    refreshToken: { type: 'string' },
                                },
                            },
                        },
                    },
                },
                responses: { '200': { description: 'Logged out' } },
            },
        },
        '/auth/logout-all': {
            post: {
                tags: ['Auth'],
                summary: 'Revoke all sessions for current user',
                responses: { '200': { description: 'All sessions revoked' } },
            },
        },
        '/auth/me': {
            get: {
                tags: ['Auth'],
                summary: 'Get current authenticated user',
                responses: {
                    '200': { description: 'Current user profile and memberships' },
                    '401': { description: 'Not authenticated' },
                },
            },
        },
        '/auth/change-password': {
            put: {
                tags: ['Auth'],
                summary: 'Change password (requires current password)',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['currentPassword', 'newPassword'],
                                properties: {
                                    currentPassword: { type: 'string' },
                                    newPassword: { type: 'string', minLength: 8 },
                                },
                            },
                        },
                    },
                },
                responses: {
                    '200': { description: 'Password changed, new tokens issued' },
                    '400': { description: 'Incorrect current password' },
                },
            },
        },
        // ── Organizations ──
        '/organizations': {
            get: {
                tags: ['Organizations'],
                summary: 'List organizations the user belongs to',
                responses: { '200': { description: 'List of organizations' } },
            },
            post: {
                tags: ['Organizations'],
                summary: 'Create a new organization',
                responses: { '201': { description: 'Organization created' } },
            },
        },
        // ── Documents ──
        '/documents/{orgId}': {
            get: {
                tags: ['Documents'],
                summary: 'List documents in an organization',
                parameters: [
                    { $ref: '#/components/parameters/OrgId' },
                    { $ref: '#/components/parameters/Page' },
                    { $ref: '#/components/parameters/Limit' },
                    { name: 'category', in: 'query', schema: { type: 'string' } },
                    { name: 'search', in: 'query', schema: { type: 'string' } },
                ],
                responses: { '200': { description: 'Paginated document list' } },
            },
            post: {
                tags: ['Documents'],
                summary: 'Upload a document',
                requestBody: {
                    required: true,
                    content: {
                        'multipart/form-data': {
                            schema: {
                                type: 'object',
                                required: ['file'],
                                properties: {
                                    file: { type: 'string', format: 'binary' },
                                    title: { type: 'string' },
                                    description: { type: 'string' },
                                    category: { type: 'string' },
                                },
                            },
                        },
                    },
                },
                responses: {
                    '201': { description: 'Document uploaded' },
                    '400': { description: 'Invalid file or validation error' },
                },
            },
        },
        // ── Meetings ──
        '/meetings/{orgId}': {
            get: {
                tags: ['Meetings'],
                summary: 'List meetings for an organization',
                parameters: [{ $ref: '#/components/parameters/OrgId' }],
                responses: { '200': { description: 'List of meetings' } },
            },
            post: {
                tags: ['Meetings'],
                summary: 'Schedule a new meeting',
                parameters: [{ $ref: '#/components/parameters/OrgId' }],
                responses: { '201': { description: 'Meeting scheduled' } },
            },
        },
        // ── Financials ──
        '/financials/{orgId}': {
            get: {
                tags: ['Financials'],
                summary: 'Get financial overview for an organization',
                parameters: [{ $ref: '#/components/parameters/OrgId' }],
                responses: { '200': { description: 'Financial data' } },
            },
        },
        // ── Notifications ──
        '/notifications': {
            get: {
                tags: ['Notifications'],
                summary: 'List notifications for the current user',
                responses: { '200': { description: 'Notification list' } },
            },
        },
        '/notifications/read-all': {
            put: {
                tags: ['Notifications'],
                summary: 'Mark all notifications as read',
                responses: { '200': { description: 'All notifications marked read' } },
            },
        },
        // ── Chat ──
        '/chat/{orgId}/channels': {
            get: {
                tags: ['Chat'],
                summary: 'List chat channels in an organization',
                parameters: [{ $ref: '#/components/parameters/OrgId' }],
                responses: { '200': { description: 'Channel list' } },
            },
        },
        // ── Payments ──
        '/payments/{orgId}/pay': {
            post: {
                tags: ['Payments'],
                summary: 'Initiate a payment',
                parameters: [{ $ref: '#/components/parameters/OrgId' }],
                responses: { '200': { description: 'Payment initiated' } },
            },
        },
        // ── Subscriptions ──
        '/subscriptions/{orgId}': {
            get: {
                tags: ['Subscriptions'],
                summary: 'Get subscription status for an organization',
                parameters: [{ $ref: '#/components/parameters/OrgId' }],
                responses: { '200': { description: 'Subscription info' } },
            },
        },
        // ── Health ──
        '/health': {
            get: {
                tags: ['System'],
                summary: 'Health check',
                security: [],
                responses: { '200': { description: 'Service healthy' } },
            },
        },
    },
    tags: [
        { name: 'Auth', description: 'Authentication & user management' },
        { name: 'Organizations', description: 'Organization CRUD' },
        { name: 'Documents', description: 'Document repository' },
        { name: 'Meetings', description: 'Meeting scheduling & management' },
        { name: 'Financials', description: 'Financial overview & donations' },
        { name: 'Notifications', description: 'User notifications' },
        { name: 'Chat', description: 'Real-time messaging' },
        { name: 'Payments', description: 'Payment processing' },
        { name: 'Subscriptions', description: 'Plan & billing management' },
        { name: 'System', description: 'Health & diagnostics' },
    ],
};
exports.openApiSpec = openApiSpec;
// ── Merge auto-generated Zod schemas into components ──────
// This keeps the spec in sync with actual route validators.
const autoSchemas = (0, zod_to_openapi_1.getRegisteredSchemas)();
for (const [name, schema] of Object.entries(autoSchemas)) {
    openApiSpec.components.schemas[name] = schema;
}
// ── Serve OpenAPI JSON ────────────────────────────────────
router.get('/openapi.json', (_req, res) => {
    res.json(openApiSpec);
});
// ── Serve Swagger UI (HTML-only, no dependency) ───────────
router.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html>
<head>
  <title>OrgsLedger API Docs</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"/>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/docs/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
    });
  </script>
</body>
</html>`);
});
exports.default = router;
//# sourceMappingURL=docs.js.map