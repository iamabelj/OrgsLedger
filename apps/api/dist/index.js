"use strict";
// ============================================================
// OrgsLedger API — Main Server Entry Point
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
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const config_1 = require("./config");
const logger_1 = require("./logger");
const middleware_1 = require("./middleware");
const request_logger_1 = require("./middleware/request-logger");
const socket_1 = require("./socket");
const ai_service_1 = require("./services/ai.service");
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
app.set('io', io);
// ── AI Service ────────────────────────────────────────────
const aiService = new ai_service_1.AIService(io);
app.set('aiService', aiService);
// ── Global Middleware ─────────────────────────────────────
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: config_1.config.env === 'production'
        ? (process.env.CORS_ORIGINS || 'https://orgsledger.com,https://app.orgsledger.com').split(',')
        : '*',
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
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit per IP
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);
// ── Cap pagination limits to prevent data dumping ────────
app.use((req, _res, next) => {
    if (req.query.limit) {
        const parsed = parseInt(req.query.limit);
        if (isNaN(parsed) || parsed < 1)
            req.query.limit = '50';
        else if (parsed > 200)
            req.query.limit = '200';
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
        const jwt = require('jsonwebtoken');
        jwt.verify(token, config_1.config.jwt.secret);
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
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: {
            rss: +(process.memoryUsage().rss / 1048576).toFixed(1),
            heapUsed: +(process.memoryUsage().heapUsed / 1048576).toFixed(1),
        },
    });
});
// ── Landing / Gateway (orgsledger.com) ────────────────────
// Mount the full landing app (marketing + admin + checkout + AI proxy)
// at root level for orgsledger.com. On app.orgsledger.com these routes are skipped.
try {
    process.env.NO_LISTEN = 'true'; // Prevent gateway from auto-listening
    const gatewayApp = require('../../../landing/server');
    const landingDir = path_1.default.resolve(__dirname, '../../../landing');
    // Serve landing static files (logo.png, CSS, etc.) on orgsledger.com
    app.use((req, res, next) => {
        const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
        if (host === 'orgsledger.com' || host === 'www.orgsledger.com' || host === 'localhost' || host === '127.0.0.1') {
            return express_1.default.static(landingDir, { index: false })(req, res, next);
        }
        next();
    });
    // Landing page at /
    const landingPage = path_1.default.resolve(landingDir, 'index.html');
    if (fs_1.default.existsSync(landingPage)) {
        app.get('/', (req, res, next) => {
            const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
            if (host === 'orgsledger.com' || host === 'www.orgsledger.com' || host === 'localhost' || host === '127.0.0.1') {
                return res.sendFile(landingPage);
            }
            next();
        });
        logger_1.logger.info('Landing page served at / (orgsledger.com only)');
    }
    // Admin dashboard at /developer/admin
    const adminPage = path_1.default.resolve(landingDir, 'admin.html');
    if (fs_1.default.existsSync(adminPage)) {
        app.get('/developer/admin', (req, res, next) => {
            const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
            if (host === 'orgsledger.com' || host === 'www.orgsledger.com' || host === 'localhost' || host === '127.0.0.1') {
                return res.sendFile(adminPage);
            }
            next();
        });
    }
    // Gateway API routes (admin login, checkout, AI proxy, geo, license, health)
    // on orgsledger.com — these take priority over main API admin routes
    app.use((req, res, next) => {
        const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
        if (host === 'orgsledger.com' || host === 'www.orgsledger.com' || host === 'localhost' || host === '127.0.0.1') {
            // Let gateway handle its routes: /api/admin/*, /api/checkout/*, /api/ai/*, /api/geo, /api/license/*, /health
            const p = req.path;
            if (p.startsWith('/api/admin') || p.startsWith('/api/checkout') || p.startsWith('/api/ai') ||
                p.startsWith('/api/geo') || p.startsWith('/api/license') || p.startsWith('/api/webhooks') ||
                p === '/health') {
                return gatewayApp(req, res, next);
            }
        }
        next();
    });
    // Also keep /developer as a fallback access point
    app.use('/developer', (req, res, next) => {
        return gatewayApp(req, res, next);
    });
    logger_1.logger.info('Landing gateway mounted (orgsledger.com: root, all: /developer)');
}
catch (err) {
    logger_1.logger.warn('Landing gateway not loaded: ' + (err.message || err));
}
// ── Serve Web Frontend (production) ──────────────────────
// Expo web build at apps/api/web — only served on app.orgsledger.com (not orgsledger.com)
const webDir = path_1.default.resolve(__dirname, '../web');
if (fs_1.default.existsSync(webDir)) {
    // Redirect root "/" to "/login" on app subdomain so unauthenticated visitors land on login
    app.get('/', (req, res, next) => {
        const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
        if (host === 'orgsledger.com' || host === 'www.orgsledger.com') {
            return next(); // Landing domain handled elsewhere
        }
        return res.redirect(302, '/login');
    });
    app.use((req, res, next) => {
        const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
        if (host === 'orgsledger.com' || host === 'www.orgsledger.com') {
            return next(); // Landing domain — no SPA
        }
        express_1.default.static(webDir)(req, res, next);
    });
    logger_1.logger.info(`Serving web frontend from ${webDir}`);
}
else {
    logger_1.logger.warn(`Web frontend directory not found: ${webDir}`);
}
// ── Auth Rate Limiting (login/register brute force protection) ──
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 15, // max 15 attempts per IP
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
    windowMs: 15 * 60 * 1000,
    max: 30, // allow more refresh calls than login but still capped
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, please try again later' },
}));
// ── Webhook Rate Limiting ──
const webhookLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // max 60 webhook calls per IP per minute
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
// SPA fallback — serve web frontend for all other routes (except /)
// orgsledger.com = sales/landing site only (no SPA login/register)
// app.orgsledger.com + client domains = full SPA app
if (fs_1.default.existsSync(webDir)) {
    app.get('*', (req, res) => {
        const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
        // On orgsledger.com, redirect all non-API routes to the landing/sales page
        if (host === 'orgsledger.com' || host === 'www.orgsledger.com') {
            res.redirect(301, '/');
            return;
        }
        // All other domains (app.orgsledger.com, client deployments, localhost): serve SPA
        res.sendFile(path_1.default.join(webDir, 'index.html'));
    });
}
else {
    // Fallback: return a basic JSON status page
    app.get('/', (_req, res) => {
        res.json({ name: 'OrgsLedger API', status: 'ok', version: '1.0.0', docs: '/api' });
    });
}
// ── Global Error Handler ──────────────────────────────────
app.use(error_monitor_service_1.errorMonitorMiddleware); // Capture errors before responding
app.use((err, _req, res, _next) => {
    logger_1.logger.error('Unhandled error', { error: err.message, stack: err.stack });
    res.status(err.status || 500).json({
        success: false,
        error: config_1.config.env === 'production' ? 'Internal server error' : err.message,
    });
});
// ── Start Server ──────────────────────────────────────────
(async () => {
    server.listen(config_1.config.port, '0.0.0.0', () => {
        logger_1.logger.info(`OrgsLedger API running on port ${config_1.config.port}`);
        logger_1.logger.info(`Environment: ${config_1.config.env}`);
        logger_1.logger.info(`Socket.io enabled`);
        // Start recurring dues scheduler
        (0, scheduler_service_1.startScheduler)();
    });
})();
//# sourceMappingURL=index.js.map