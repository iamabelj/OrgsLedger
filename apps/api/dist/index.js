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
const db_1 = __importDefault(require("./db"));
const middleware_1 = require("./middleware");
const socket_1 = require("./socket");
const ai_service_1 = require("./services/ai.service");
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
const scheduler_service_1 = require("./services/scheduler.service");
// ── License Verification ──────────────────────────────────
async function verifyLicense() {
    // Ensure app_settings table exists
    try {
        await db_1.default.raw(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    }
    catch (e) { /* table may already exist */ }
    // Check database for stored license first
    try {
        const row = await (0, db_1.default)('app_settings').where('key', 'license_key').first();
        if (row?.value) {
            logger_1.logger.info('License key found in database');
            return true;
        }
    }
    catch (e) { /* table may not exist yet */ }
    // Fall back to env var
    const { license } = config_1.config;
    if (!license.key) {
        logger_1.logger.warn('No LICENSE_KEY set — running in unlicensed mode. Set LICENSE_KEY env var to activate.');
        return false;
    }
    try {
        const axios = require('axios');
        const { data } = await axios.post(`${license.gatewayUrl}/api/license/verify`, {
            license_key: license.key,
        }, { timeout: 10000 });
        if (data.valid) {
            logger_1.logger.info(`License verified ✔ — ${data.client.name} (${data.client.domain || 'no domain'})`);
            logger_1.logger.info(`AI hours: ${data.client.hoursRemaining.toFixed(1)}h remaining of ${data.client.hoursBalance.toFixed(1)}h`);
            // Store in DB so it persists
            await (0, db_1.default)('app_settings').insert({ key: 'license_key', value: license.key }).onConflict('key').merge();
            return true;
        }
        else {
            logger_1.logger.warn(`License invalid: ${data.error}`);
            return false;
        }
    }
    catch (err) {
        const msg = err.response?.data?.error || err.message;
        logger_1.logger.warn(`License verification failed: ${msg} — continuing without license`);
        return false;
    }
}
const app = (0, express_1.default)();
exports.app = app;
const server = http_1.default.createServer(app);
exports.server = server;
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
        ? (process.env.CORS_ORIGINS || 'https://orgsledger.com').split(',')
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
// Audit context
app.use(middleware_1.auditContext);
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
    });
});
// ── License Status (public — no auth needed) ──────────────
app.get('/api/license/status', async (_req, res) => {
    try {
        const row = await (0, db_1.default)('app_settings').where('key', 'license_key').first();
        if (row?.value) {
            // Live-verify with gateway to get fresh hours balance
            try {
                const axios = require('axios');
                const gatewayUrl = config_1.config.license.gatewayUrl;
                const { data } = await axios.post(`${gatewayUrl}/api/license/verify`, {
                    license_key: row.value,
                }, { timeout: 10000 });
                if (data.valid && data.client) {
                    // Update stored client info with fresh data from gateway
                    await (0, db_1.default)('app_settings')
                        .insert({ key: 'license_client', value: JSON.stringify(data.client) })
                        .onConflict('key').merge();
                    return res.json({ licensed: true, client: data.client });
                }
                else {
                    // License was revoked or invalidated — remove stored key
                    logger_1.logger.warn('License revoked by gateway — clearing stored key');
                    await (0, db_1.default)('app_settings').where('key', 'license_key').delete();
                    await (0, db_1.default)('app_settings').where('key', 'license_client').delete();
                    return res.json({ licensed: false, error: data.error || 'License revoked' });
                }
            }
            catch (e) {
                // Gateway unavailable — fall back to stored data (don't block users)
                if (e.response?.status === 403 || e.response?.status === 404) {
                    // Gateway explicitly rejected — license is invalid
                    logger_1.logger.warn('License rejected by gateway — clearing stored key');
                    await (0, db_1.default)('app_settings').where('key', 'license_key').delete();
                    await (0, db_1.default)('app_settings').where('key', 'license_client').delete();
                    return res.json({ licensed: false, error: e.response?.data?.error || 'License invalid' });
                }
                logger_1.logger.warn('Gateway unreachable for license status, using cached data');
            }
            // Fallback: return stored client info (only if gateway was unreachable)
            let clientInfo = null;
            try {
                const infoRow = await (0, db_1.default)('app_settings').where('key', 'license_client').first();
                if (infoRow?.value)
                    clientInfo = JSON.parse(infoRow.value);
            }
            catch (e) { /* ignore */ }
            return res.json({ licensed: true, client: clientInfo });
        }
        res.json({ licensed: false });
    }
    catch {
        res.json({ licensed: false });
    }
});
// ── License Activate (public — one-time setup by admin) ───
app.post('/api/license/activate', async (req, res) => {
    try {
        // Check if already activated
        const existing = await (0, db_1.default)('app_settings').where('key', 'license_key').first();
        if (existing?.value) {
            return res.json({ success: true, message: 'License already activated' });
        }
        const { license_key } = req.body;
        if (!license_key) {
            return res.status(400).json({ success: false, error: 'License key is required' });
        }
        // Verify with gateway
        const gatewayUrl = config_1.config.license.gatewayUrl;
        const axios = require('axios');
        const { data } = await axios.post(`${gatewayUrl}/api/license/verify`, {
            license_key,
        }, { timeout: 10000 });
        if (!data.valid) {
            return res.status(400).json({ success: false, error: data.error || 'Invalid license key' });
        }
        // Store license in database
        await (0, db_1.default)('app_settings').insert({ key: 'license_key', value: license_key }).onConflict('key').merge();
        await (0, db_1.default)('app_settings').insert({ key: 'license_client', value: JSON.stringify(data.client) }).onConflict('key').merge();
        logger_1.logger.info(`License activated: ${data.client.name} (${data.client.domain || 'no domain'})`);
        res.json({
            success: true,
            message: 'License activated successfully',
            client: data.client,
        });
    }
    catch (err) {
        const msg = err.response?.data?.error || err.message;
        logger_1.logger.error('License activation error:', msg);
        res.status(500).json({ success: false, error: msg || 'Activation failed' });
    }
});
// ── Landing / Sales Page ──────────────────────────────────
// Serve the sales landing page at root "/" FIRST — before any static middleware
// so orgsledger.com visitors always see the sales page.
const landingPage = path_1.default.resolve(__dirname, '../../../landing/index.html');
if (fs_1.default.existsSync(landingPage)) {
    app.get('/', (req, res, next) => {
        const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
        // Only serve landing/sales page on orgsledger.com — test/client sites go to SPA
        if (host === 'orgsledger.com' || host === 'www.orgsledger.com' || host === 'localhost' || host === '127.0.0.1') {
            return res.sendFile(landingPage);
        }
        next(); // Let SPA static middleware or SPA fallback handle it
    });
    logger_1.logger.info('Landing page served at / (orgsledger.com only)');
}
// ── Serve Web Frontend (production) ──────────────────────
// __dirname = apps/api/dist in production, web build is at apps/api/web
// On orgsledger.com, do NOT serve SPA static files — only landing + developer gateway
const webDir = path_1.default.resolve(__dirname, '../web');
if (fs_1.default.existsSync(webDir)) {
    app.use((req, res, next) => {
        const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
        // Block SPA static files on orgsledger.com — only landing page + /developer
        if (host === 'orgsledger.com' || host === 'www.orgsledger.com') {
            return next();
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
// ── Developer Gateway (AI Client Management, Hours, Proxy) ──
// Only mount on the main orgsledger.com domain — NEVER shipped with client deployments
try {
    process.env.NO_LISTEN = 'true'; // Prevent gateway from auto-listening
    const gatewayApp = require('../../../landing/server');
    app.use('/developer', (req, res, next) => {
        const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
        // Only allow developer gateway on orgsledger.com and localhost
        if (host === 'orgsledger.com' || host === 'www.orgsledger.com' || host === 'localhost' || host === '127.0.0.1') {
            return gatewayApp(req, res, next);
        }
        // All other domains (test.orgsledger.com, client domains): developer routes don't exist
        res.status(404).json({ success: false, error: 'Route not found' });
    });
    logger_1.logger.info('Developer gateway mounted at /developer (orgsledger.com only)');
}
catch (err) {
    logger_1.logger.warn('Developer gateway not loaded: ' + (err.message || err));
}
// (Landing page is registered above, before static middleware)
// ── 404 Handler ───────────────────────────────────────────
// API 404 — only for /api/* routes
app.all('/api/*', (_req, res) => {
    res.status(404).json({ success: false, error: 'Route not found' });
});
// SPA fallback — serve web frontend for all other routes (except /)
// orgsledger.com = sales/landing site only (no SPA login/register)
// test.orgsledger.com + client domains = full SPA app
if (fs_1.default.existsSync(webDir)) {
    app.get('*', (req, res) => {
        const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
        // On orgsledger.com, redirect all non-API routes to the landing/sales page
        if (host === 'orgsledger.com' || host === 'www.orgsledger.com') {
            res.redirect(301, '/');
            return;
        }
        // All other domains (test.orgsledger.com, client deployments, localhost): serve SPA
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
app.use((err, _req, res, _next) => {
    logger_1.logger.error('Unhandled error', { error: err.message, stack: err.stack });
    res.status(err.status || 500).json({
        success: false,
        error: config_1.config.env === 'production' ? 'Internal server error' : err.message,
    });
});
// ── Start Server ──────────────────────────────────────────
(async () => {
    // Verify license before starting
    await verifyLicense();
    server.listen(config_1.config.port, '0.0.0.0', () => {
        logger_1.logger.info(`OrgsLedger API running on port ${config_1.config.port}`);
        logger_1.logger.info(`Environment: ${config_1.config.env}`);
        logger_1.logger.info(`Socket.io enabled`);
        logger_1.logger.info(`Developer gateway: /developer/admin`);
        // Start recurring dues scheduler
        (0, scheduler_service_1.startScheduler)();
    });
})();
//# sourceMappingURL=index.js.map