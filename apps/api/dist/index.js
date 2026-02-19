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
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const config_1 = require("./config");
const logger_1 = require("./logger");
const middleware_1 = require("./middleware");
const request_logger_1 = require("./middleware/request-logger");
const error_handler_1 = require("./middleware/error-handler");
const landing_gateway_1 = require("./middleware/landing-gateway");
const socket_1 = require("./socket");
const ai_service_1 = require("./services/ai.service");
const registry_1 = require("./services/registry");
const bot_1 = require("./services/bot");
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
const scheduler_service_1 = require("./services/scheduler.service");
const seed_service_1 = require("./services/seed.service");
const app = (0, express_1.default)();
exports.app = app;
const server = http_1.default.createServer(app);
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
const botManager = (0, bot_1.initBotManager)({ io, meetingLanguages: socket_1.meetingLanguages });
registry_1.services.register('botManager', botManager);
// ── Global Middleware ─────────────────────────────────────
app.use((0, helmet_1.default)());
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
// JSON parser for everything else
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
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
// ── Observability Middleware ──────────────────────────────
app.use(metrics_service_1.metricsMiddleware);
// ── Full Request Logging (temporary observability) ────────
app.use(request_logger_1.requestLogger);
// Serve uploaded files (require valid JWT)
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
// ── API Routes ────────────────────────────────────────────
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/auth/refresh', (0, express_rate_limit_1.default)({
    windowMs: constants_1.RATE_LIMITS.REFRESH.windowMs,
    max: constants_1.RATE_LIMITS.REFRESH.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, please try again later' },
}));
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
app.use('/api/financials', financials_1.default);
app.use('/api/payments', payments_1.default);
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
// ── Start Server ──────────────────────────────────────────
(async () => {
    // Ensure super admin account exists on startup
    await (0, seed_service_1.ensureSuperAdmin)();
    server.listen(config_1.config.port, '0.0.0.0', () => {
        logger_1.logger.info(`OrgsLedger API running on port ${config_1.config.port}`);
        logger_1.logger.info(`Environment: ${config_1.config.env}`);
        logger_1.logger.info(`Socket.io enabled`);
        // Start recurring dues scheduler
        (0, scheduler_service_1.startScheduler)();
    });
})();
//# sourceMappingURL=index.js.map