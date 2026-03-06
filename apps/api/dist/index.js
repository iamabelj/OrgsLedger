"use strict";
// ============================================================
// OrgsLedger API — Main Server Entry Point
// Kept lean — heavy lifting extracted to middleware, controllers,
// and the service registry.
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = exports.server = exports.app = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const compression_1 = __importDefault(require("compression"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const config_1 = require("./config");
const logger_1 = require("./logger");
const middleware_1 = require("./middleware");
const request_logger_1 = require("./middleware/request-logger");
const error_handler_1 = require("./middleware/error-handler");
const idempotency_1 = require("./middleware/idempotency");
const etag_1 = require("./middleware/etag");
const session_expiry_1 = require("./middleware/session-expiry");
const landing_gateway_1 = require("./middleware/landing-gateway");
const socket_1 = require("./socket");
const ai_service_1 = require("./services/ai.service");
const registry_1 = require("./services/registry");
const constants_1 = require("./constants");
// Observability
const metrics_service_1 = require("./services/metrics.service");
const error_monitor_service_1 = require("./services/error-monitor.service");
// Route imports
const auth_1 = __importDefault(require("./routes/auth"));
const organizations_1 = __importDefault(require("./routes/organizations"));
const chat_1 = __importDefault(require("./routes/chat"));
const meetings_1 = __importDefault(require("./routes/meetings"));
const financials_1 = __importDefault(require("./routes/financials"));
const payments_1 = __importDefault(require("./routes/payments"));
const committees_1 = __importDefault(require("./routes/committees"));
const admin_1 = __importDefault(require("./routes/admin"));
const notifications_1 = __importDefault(require("./routes/notifications"));
const announcements_1 = __importDefault(require("./routes/announcements"));
const events_1 = __importDefault(require("./routes/events"));
const polls_1 = __importDefault(require("./routes/polls"));
const documents_1 = __importDefault(require("./routes/documents"));
const analytics_1 = __importDefault(require("./routes/analytics"));
const expenses_1 = __importDefault(require("./routes/expenses"));
const subscriptions_1 = __importDefault(require("./routes/subscriptions"));
const observability_1 = __importDefault(require("./routes/observability"));
const docs_1 = __importDefault(require("./routes/docs"));
const translation_routes_1 = __importDefault(require("./routes/translation.routes"));
const jobs_routes_1 = __importDefault(require("./routes/jobs.routes"));
const transcripts_1 = __importDefault(require("./routes/transcripts"));
const scheduler_service_1 = require("./services/scheduler.service");
const seed_service_1 = require("./services/seed.service");
const orchestrator_1 = require("./workers/orchestrator");
const processingWorker_service_1 = require("./services/workers/processingWorker.service");
const minutesWorker_service_1 = require("./services/workers/minutesWorker.service");
const minutes_queue_1 = require("./queues/minutes.queue");
const app = (0, express_1.default)();
exports.app = app;
// Use pre-created server from server.js if available (production).
// This ensures the port is already bound before this module loads.
const preCreatedServer = global.__orgsServer;
const server = preCreatedServer || http_1.default.createServer(app);
exports.server = server;
// Set up process-level error handlers (uncaughtException, unhandledRejection)
(0, error_monitor_service_1.setupProcessErrorHandlers)();
// Ensure upload directory exists
const uploadDir = path_1.default.resolve(config_1.config.upload.dir);
if (!fs_1.default.existsSync(uploadDir)) {
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
}
// ── Socket.io ─────────────────────────────────────────────
const io = (0, socket_1.setupSocketIO)(server);
exports.io = io;
app.set('io', io); // kept for backwards compat in routes not yet migrated
registry_1.services.register('io', io); // preferred — use services.get('io') in new code
// ── AI Service ────────────────────────────────────────────
const aiService = new ai_service_1.AIService(io);
app.set('aiService', aiService); // backwards compat
registry_1.services.register('aiService', aiService);
// ── Transcription Bot Manager ─────────────────────────────
// Bot disabled — client-side Whisper handles all transcription.
// BotManager is NOT initialized to prevent any bot from joining meetings.
// const botManager = initBotManager({ io, meetingLanguages });
// services.register('botManager', botManager);
// ── Global Middleware ─────────────────────────────────────
app.use((0, helmet_1.default)({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            connectSrc: ["'self'", "https:", "wss:"],
            frameSrc: ["'self'", "https:"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            upgradeInsecureRequests: [],
        },
    },
    crossOriginEmbedderPolicy: false, // Needed for cross-origin images
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow CDN / image loading
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true }, // 2 years
    noSniff: true, // X-Content-Type-Options: nosniff
    dnsPrefetchControl: { allow: false },
    frameguard: { action: 'deny' }, // X-Frame-Options: DENY
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    hidePoweredBy: true, // Remove X-Powered-By
}));
// ── Additional Security Headers not covered by Helmet ──
app.use((_req, res, next) => {
    // Allow camera + microphone for LiveKit video/audio meetings (self = same origin).
    // Block geolocation and interest-cohort (FLoC tracking).
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), interest-cohort=()');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    next();
});
// Gzip/deflate compression — reduces response sizes by 60-80%
app.use((0, compression_1.default)({
    level: 6, // Balanced speed vs ratio
    threshold: 1024, // Only compress responses > 1KB
    filter: (req, res) => {
        // Don't compress SSE or WebSocket upgrade requests
        if (req.headers['accept'] === 'text/event-stream')
            return false;
        return compression_1.default.filter(req, res);
    },
}));
app.use((0, cors_1.default)({
    origin: config_1.config.env === 'production'
        ? (process.env.CORS_ORIGINS || 'https://orgsledger.com,https://app.orgsledger.com').split(',')
        : true,
    credentials: true,
}));
// Raw body for Stripe webhooks
app.use('/api/payments/webhooks/stripe', express_1.default.raw({ type: 'application/json' }));
// Raw body for Paystack webhooks
app.use('/api/payments/webhooks/paystack', express_1.default.raw({ type: 'application/json' }));
// JSON parser — smaller default limit, documents/uploads get their own limits
app.use(express_1.default.json({ limit: '2mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '2mb' }));
// Rate limiting
const limiter = (0, express_rate_limit_1.default)({
    windowMs: constants_1.RATE_LIMITS.GLOBAL.windowMs,
    max: constants_1.RATE_LIMITS.GLOBAL.max,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);
// ── Cap pagination limits to prevent data dumping ────────
app.use((req, _res, next) => {
    if (req.query.limit) {
        const parsed = parseInt(req.query.limit);
        if (isNaN(parsed) || parsed < 1)
            req.query.limit = String(constants_1.PAGINATION.DEFAULT_LIMIT);
        else if (parsed > constants_1.PAGINATION.MAX_LIMIT)
            req.query.limit = String(constants_1.PAGINATION.MAX_LIMIT);
    }
    next();
});
// Audit context
app.use(middleware_1.auditContext);
// ── API Versioning ────────────────────────────────────────
// Add API-Version header to all responses; support /api/v1/* as an alias
app.use((req, res, next) => {
    res.setHeader('X-API-Version', constants_1.APP_VERSION);
    // Rewrite /api/v1/* to /api/* for forward compatibility
    if (req.path.startsWith('/api/v1/')) {
        req.url = req.url.replace('/api/v1/', '/api/');
    }
    next();
});
// ── Observability Middleware ──────────────────────────────
app.use(metrics_service_1.metricsMiddleware);
// ── ETag for GET responses (client-side 304 caching) ─────
app.use(etag_1.etagMiddleware);
// ── Full Request Logging (temporary observability) ────────
app.use(request_logger_1.requestLogger);
// Serve uploaded files (require valid JWT)
// Public paths: avatars and logos (displayed in <Image> tags that can't send headers)
app.use('/uploads/avatars', express_1.default.static(path_1.default.resolve(config_1.config.upload.dir, 'avatars')));
app.use('/uploads/logos', express_1.default.static(path_1.default.resolve(config_1.config.upload.dir, 'logos')));
// All other uploads require JWT
app.use('/uploads', (req, res, next) => {
    const token = req.query.token || req.headers.authorization?.split(' ')[1];
    if (!token) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
    }
    try {
        jsonwebtoken_1.default.verify(token, config_1.config.jwt.secret);
        next();
    }
    catch {
        res.status(401).json({ success: false, error: 'Invalid token' });
    }
}, express_1.default.static(path_1.default.resolve(config_1.config.upload.dir)));
// ── Health Check ──────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        version: constants_1.APP_VERSION,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: {
            rss: +(process.memoryUsage().rss / 1048576).toFixed(1),
            heapUsed: +(process.memoryUsage().heapUsed / 1048576).toFixed(1),
        },
    });
});
// ── Build Verification ────────────────────────────────────
app.get('/api/version', (_req, res) => {
    const webDir = path_1.default.resolve(__dirname, '../web');
    const webExists = fs_1.default.existsSync(webDir);
    let jsFiles = [];
    try {
        const expoDir = path_1.default.join(webDir, '_expo', 'static', 'js', 'web');
        if (fs_1.default.existsSync(expoDir))
            jsFiles = fs_1.default.readdirSync(expoDir);
    }
    catch { }
    res.setHeader('Cache-Control', 'no-cache');
    res.json({
        build: '2026-02-21-edit-feature',
        version: constants_1.APP_VERSION,
        webDir,
        webExists,
        jsFiles,
        nodeEnv: process.env.NODE_ENV,
        cwd: process.cwd(),
        dirname: __dirname,
    });
});
// ── Pipeline Diagnostic Endpoint ──────────────────────────
// GET /health/pipeline — check if all services for minutes/TTS are configured
app.get('/health/pipeline', async (_req, res) => {
    try {
        const { isWhisperAvailable, getWhisperDiagnostics } = require('./services/whisper.service');
        const { config: appConfig } = require('./config');
        const whisperDiag = getWhisperDiagnostics();
        // Check database connectivity
        let dbOk = false;
        let transcriptTableExists = false;
        try {
            const knex = require('./db').default;
            await knex.raw('SELECT 1');
            dbOk = true;
            transcriptTableExists = await knex.schema.hasTable('meeting_transcripts');
        }
        catch (_) { }
        res.json({
            status: 'ok',
            pipeline: {
                whisperSTT: {
                    engine: whisperDiag.engine,
                    available: isWhisperAvailable(),
                    openaiKeyConfigured: whisperDiag.openaiKeyConfigured,
                },
                openAITTS: {
                    model: whisperDiag.ttsModel,
                    available: isWhisperAvailable(),
                },
                openAI: {
                    keyConfigured: !!appConfig.ai.openaiApiKey,
                    keyPrefix: appConfig.ai.openaiApiKey ? appConfig.ai.openaiApiKey.slice(0, 10) + '...' : '(not set)',
                },
                aiProxy: {
                    urlConfigured: !!appConfig.aiProxy.url,
                    keyConfigured: !!appConfig.aiProxy.apiKey,
                },
                database: {
                    connected: dbOk,
                    transcriptTableExists,
                },
                livekit: {
                    urlConfigured: !!appConfig.livekit.url,
                    keyConfigured: !!appConfig.livekit.apiKey,
                },
            },
        });
    }
    catch (err) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});
// ── Landing / Gateway (orgsledger.com) ────────────────────
(0, landing_gateway_1.mountLandingGateway)(app);
// ── Serve Web Frontend (production) ──────────────────────
(0, landing_gateway_1.mountWebFrontend)(app);
// ── Auth Rate Limiting (login/register brute force protection) ──
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: constants_1.RATE_LIMITS.AUTH.windowMs,
    max: constants_1.RATE_LIMITS.AUTH.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many attempts, please try again later' },
});
// ── Per-Route Payload Size Limits ──
// Auth routes don't need large payloads (login/register bodies are tiny)
const authPayloadLimit = express_1.default.json({ limit: '16kb' });
// ── API Routes ────────────────────────────────────────────
app.use('/api/auth', authLimiter, authPayloadLimit);
app.use('/api/auth/login', authLimiter, authPayloadLimit);
app.use('/api/auth/register', authLimiter, authPayloadLimit);
app.use('/api/auth/forgot-password', authLimiter, authPayloadLimit);
app.use('/api/auth/reset-password', authLimiter, authPayloadLimit);
app.use('/api/auth/refresh', (0, express_rate_limit_1.default)({
    windowMs: constants_1.RATE_LIMITS.REFRESH.windowMs,
    max: constants_1.RATE_LIMITS.REFRESH.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, please try again later' },
}));
// ── Session Expiry Middleware ──
// Validates platform-specific session lifetimes (applies to all authenticated endpoints)
app.use('/api', session_expiry_1.sessionExpiry);
// ── Webhook Rate Limiting ──
const webhookLimiter = (0, express_rate_limit_1.default)({
    windowMs: constants_1.RATE_LIMITS.WEBHOOK.windowMs,
    max: constants_1.RATE_LIMITS.WEBHOOK.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many webhook requests' },
});
app.use('/api/payments/webhooks', webhookLimiter);
app.use('/api/payments/paystack/callback', webhookLimiter);
app.use('/api/auth', auth_1.default);
app.use('/api/organizations', organizations_1.default);
app.use('/api/chat', chat_1.default);
app.use('/api/meetings', meetings_1.default);
app.use('/api/financials', idempotency_1.idempotencyMiddleware, financials_1.default);
app.use('/api/payments', idempotency_1.idempotencyMiddleware, payments_1.default);
app.use('/api/committees', committees_1.default);
app.use('/api/admin', admin_1.default);
app.use('/api/notifications', notifications_1.default);
app.use('/api/announcements', announcements_1.default);
app.use('/api/events', events_1.default);
app.use('/api/polls', polls_1.default);
app.use('/api/documents', documents_1.default);
app.use('/api/analytics', analytics_1.default);
app.use('/api/expenses', expenses_1.default);
app.use('/api/subscriptions', subscriptions_1.default);
app.use('/api/admin/observability', observability_1.default);
app.use('/api/docs', docs_1.default);
app.use('/api/translations', translation_routes_1.default);
app.use('/api/meetings/:meetingId/transcripts', transcripts_1.default);
app.use('/api', jobs_routes_1.default);
// ── 404 Handler ───────────────────────────────────────────
// API 404 — only for /api/* routes
app.all('/api/*', (_req, res) => {
    res.status(404).json({ success: false, error: 'Route not found' });
});
// SPA fallback — must come after all API routes
(0, landing_gateway_1.mountSpaFallback)(app);
// ── Global Error Handler ──────────────────────────────────
app.use(error_monitor_service_1.errorMonitorMiddleware); // Capture errors before responding
app.use(error_handler_1.globalErrorHandler); // Structured JSON error responses
// ── Ensure Critical Meeting Tables Exist ──────────────────
// These tables were added in migrations 021-025 but production
// may not have run them. Auto-create on startup to guarantee
// transcripts, chat, and language preferences work.
async function ensureMeetingTables() {
    const { db, tableExists: checkTable, markTableExists } = require('./db');
    try {
        // 1. meeting_transcripts (migration 021)
        if (!(await db.schema.hasTable('meeting_transcripts'))) {
            logger_1.logger.info('[STARTUP] Creating missing table: meeting_transcripts');
            await db.schema.createTable('meeting_transcripts', (t) => {
                t.uuid('id').primary().defaultTo(db.raw("gen_random_uuid()"));
                t.uuid('meeting_id').notNullable().references('id').inTable('meetings').onDelete('CASCADE');
                t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
                t.uuid('speaker_id').nullable().references('id').inTable('users').onDelete('SET NULL');
                t.string('speaker_name', 200).notNullable();
                t.text('original_text').notNullable();
                t.string('source_lang', 10).notNullable().defaultTo('en');
                t.jsonb('translations').notNullable().defaultTo('{}');
                t.bigInteger('spoken_at').notNullable();
                t.timestamps(true, true);
                t.index(['meeting_id', 'spoken_at'], 'idx_mt_meeting_spoken');
                t.index(['organization_id'], 'idx_mt_org');
            });
            logger_1.logger.info('[STARTUP] ✓ Created meeting_transcripts table');
        }
        markTableExists('meeting_transcripts');
        // 2. user_language_preferences (migration 022)
        if (!(await db.schema.hasTable('user_language_preferences'))) {
            logger_1.logger.info('[STARTUP] Creating missing table: user_language_preferences');
            await db.schema.createTable('user_language_preferences', (t) => {
                t.uuid('id').primary().defaultTo(db.raw("gen_random_uuid()"));
                t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
                t.uuid('organization_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
                t.string('preferred_language', 10).notNullable().defaultTo('en');
                t.boolean('receive_voice').notNullable().defaultTo(true);
                t.boolean('receive_text').notNullable().defaultTo(true);
                t.timestamps(true, true);
                t.unique(['user_id', 'organization_id']);
                t.index(['organization_id']);
            });
            logger_1.logger.info('[STARTUP] ✓ Created user_language_preferences table');
        }
        markTableExists('user_language_preferences');
        // 3. meeting_messages (migration 025)
        if (!(await db.schema.hasTable('meeting_messages'))) {
            logger_1.logger.info('[STARTUP] Creating missing table: meeting_messages');
            await db.schema.createTable('meeting_messages', (t) => {
                t.uuid('id').primary().defaultTo(db.raw("gen_random_uuid()"));
                t.uuid('meeting_id').notNullable().references('id').inTable('meetings').onDelete('CASCADE');
                t.uuid('sender_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
                t.string('sender_name', 255).notNullable();
                t.text('message').notNullable();
                t.timestamp('created_at').defaultTo(db.fn.now());
            });
            await db.schema.raw('CREATE INDEX IF NOT EXISTS idx_meeting_messages_meeting_created ON meeting_messages (meeting_id, created_at)');
            logger_1.logger.info('[STARTUP] ✓ Created meeting_messages table');
        }
        markTableExists('meeting_messages');
        // 4. meeting_minutes — add download_formats column if missing (migration 021 part 2)
        if (await db.schema.hasTable('meeting_minutes')) {
            const hasFormats = await db.schema.hasColumn('meeting_minutes', 'download_formats');
            if (!hasFormats) {
                await db.schema.alterTable('meeting_minutes', (t) => {
                    t.jsonb('download_formats').notNullable().defaultTo('{}');
                });
                logger_1.logger.info('[STARTUP] ✓ Added download_formats to meeting_minutes');
            }
        }
        logger_1.logger.info('[STARTUP] ✓ All critical meeting tables verified');
    }
    catch (err) {
        logger_1.logger.error('[STARTUP] ❌ Failed to ensure meeting tables:', err.message);
        // Don't crash — the app can still serve other features
    }
}
// ── Start Server ──────────────────────────────────────────
// When launched via server.js (production), port is already bound.
// When launched directly (dev), we bind here.
function doPostStart() {
    logger_1.logger.info(`OrgsLedger API running on port ${config_1.config.port}`);
    logger_1.logger.info(`Environment: ${config_1.config.env}`);
    logger_1.logger.info(`Socket.io enabled`);
    // Prevent 503s from stale connections / reverse proxy timeouts
    server.keepAliveTimeout = 65_000; // Slightly above typical LB idle timeout (60s)
    server.headersTimeout = 70_000; // Must be > keepAliveTimeout
    // Async DB initialization — runs after port is bound
    (async () => {
        try {
            await (0, seed_service_1.ensureSuperAdmin)();
            logger_1.logger.info('[STARTUP] Super admin verified');
        }
        catch (err) {
            logger_1.logger.error('[STARTUP] ensureSuperAdmin failed (non-fatal):', err.message);
        }
        try {
            await ensureMeetingTables();
            logger_1.logger.info('[STARTUP] Meeting tables verified');
        }
        catch (err) {
            logger_1.logger.error('[STARTUP] ensureMeetingTables failed (non-fatal):', err.message);
        }
        // Ensure account lockout columns exist (migration 026)
        try {
            const { db: knex } = require('./db');
            if (await knex.schema.hasTable('users')) {
                const hasAttempts = await knex.schema.hasColumn('users', 'failed_login_attempts');
                if (!hasAttempts) {
                    await knex.schema.alterTable('users', (t) => {
                        t.integer('failed_login_attempts').notNullable().defaultTo(0);
                        t.timestamp('locked_until').nullable();
                    });
                    logger_1.logger.info('[STARTUP] ✓ Added account lockout columns to users table');
                }
            }
        }
        catch (err) {
            logger_1.logger.error('[STARTUP] Account lockout columns check failed (non-fatal):', err.message);
        }
        // Ensure refresh_tokens table exists (migration 027)
        try {
            const { db: knex } = require('./db');
            if (!(await knex.schema.hasTable('refresh_tokens'))) {
                await knex.schema.createTable('refresh_tokens', (t) => {
                    t.uuid('id').primary().defaultTo(knex.raw("gen_random_uuid()"));
                    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
                    t.text('token_hash').notNullable().unique();
                    t.string('user_agent', 512).nullable();
                    t.string('ip_address', 45).nullable();
                    t.timestamp('expires_at').notNullable();
                    t.timestamp('created_at').defaultTo(knex.fn.now());
                    t.index(['user_id']);
                    t.index(['expires_at']);
                });
                logger_1.logger.info('[STARTUP] ✓ Created refresh_tokens table');
            }
        }
        catch (err) {
            logger_1.logger.error('[STARTUP] refresh_tokens table check failed (non-fatal):', err.message);
        }
        // Start recurring dues scheduler
        (0, scheduler_service_1.startScheduler)();
        // Initialize worker orchestrator
        try {
            const processingWorkerService = new processingWorker_service_1.ProcessingWorkerService();
            const minutesWorkerService = new minutesWorker_service_1.MinutesWorkerService(io);
            await (0, minutes_queue_1.initializeMinutesQueue)();
            await (0, orchestrator_1.initializeWorkerOrchestrator)(io, processingWorkerService, minutesWorkerService);
            logger_1.logger.info('[STARTUP] ✓ Worker orchestrator initialized');
        }
        catch (err) {
            logger_1.logger.error('[STARTUP] Worker orchestrator initialization failed (non-fatal):', err.message);
        }
    })();
}
if (preCreatedServer) {
    // Production: server.js already has the port bound.
    // Just run post-start tasks immediately.
    logger_1.logger.info('[STARTUP] Using pre-created server from server.js');
    doPostStart();
}
else {
    // Dev / standalone: bind the port ourselves.
    server.listen(config_1.config.port, '0.0.0.0', () => {
        doPostStart();
    });
}
// ── Graceful Shutdown ─────────────────────────────────────
// On SIGTERM / SIGINT: stop accepting new connections, drain
// existing ones, close DB pool, and exit cleanly.
let isShuttingDown = false;
async function gracefulShutdown(signal) {
    if (isShuttingDown)
        return;
    isShuttingDown = true;
    logger_1.logger.info(`[SHUTDOWN] ${signal} received — starting graceful shutdown`);
    // 1. Stop accepting new HTTP connections (give 10s for in-flight)
    server.close(() => {
        logger_1.logger.info('[SHUTDOWN] HTTP server closed');
    });
    // 2. Close Socket.io connections
    try {
        io.disconnectSockets(true);
        logger_1.logger.info('[SHUTDOWN] Socket.io connections closed');
    }
    catch { }
    // 3. Wait for in-flight requests to complete (max 10s)
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    // 4. Stop worker orchestrator
    try {
        await (0, orchestrator_1.shutdownWorkerOrchestrator)();
        logger_1.logger.info('[SHUTDOWN] Worker orchestrator closed');
    }
    catch (err) {
        logger_1.logger.error('[SHUTDOWN] Worker orchestrator close error:', err.message);
    }
    // 5. Close database pool
    try {
        const { db: knex } = require('./db');
        await knex.destroy();
        logger_1.logger.info('[SHUTDOWN] Database pool closed');
    }
    catch (err) {
        logger_1.logger.error('[SHUTDOWN] DB pool close error:', err.message);
    }
    // 6. Flush logger
    try {
        logger_1.logger.end();
    }
    catch { }
    logger_1.logger.info('[SHUTDOWN] Graceful shutdown complete');
    process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
//# sourceMappingURL=index.js.map