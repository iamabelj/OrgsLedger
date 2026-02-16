"use strict";
// ============================================================
// OrgsLedger API — Landing / Gateway Middleware
// Extracted from index.ts to keep the entry point lean.
// Handles: marketing page, developer admin, gateway API routes.
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mountLandingGateway = mountLandingGateway;
exports.mountWebFrontend = mountWebFrontend;
exports.mountSpaFallback = mountSpaFallback;
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const logger_1 = require("../logger");
const constants_1 = require("../constants");
/**
 * Mount landing gateway onto the Express app.
 * Returns true if the gateway was loaded.
 */
function mountLandingGateway(app) {
    try {
        process.env.NO_LISTEN = 'true';
        const gatewayApp = require('../../../../landing/server');
        const landingDir = path_1.default.resolve(__dirname, '../../../../landing');
        // Serve landing static files on landing domain
        app.use((req, res, next) => {
            if ((0, constants_1.isLandingHost)(req.headers.host || '')) {
                return express_1.default.static(landingDir, { index: false })(req, res, next);
            }
            next();
        });
        // Landing page at /
        const landingPage = path_1.default.resolve(landingDir, 'index.html');
        if (fs_1.default.existsSync(landingPage)) {
            app.get('/', (req, res, next) => {
                if ((0, constants_1.isLandingHost)(req.headers.host || ''))
                    return res.sendFile(landingPage);
                next();
            });
            logger_1.logger.info('Landing page served at / (orgsledger.com only)');
        }
        // Admin dashboard at /developer/admin
        const adminPage = path_1.default.resolve(landingDir, 'admin.html');
        if (fs_1.default.existsSync(adminPage)) {
            app.get('/developer/admin', (req, res, next) => {
                if ((0, constants_1.isLandingHost)(req.headers.host || ''))
                    return res.sendFile(adminPage);
                next();
            });
        }
        // Gateway API routes on landing domain
        app.use((req, res, next) => {
            if ((0, constants_1.isLandingHost)(req.headers.host || '')) {
                const p = req.path;
                if (p.startsWith('/api/admin') ||
                    p.startsWith('/api/checkout') ||
                    p.startsWith('/api/ai') ||
                    p.startsWith('/api/geo') ||
                    p.startsWith('/api/license') ||
                    p.startsWith('/api/webhooks') ||
                    p === '/health') {
                    return gatewayApp(req, res, next);
                }
            }
            next();
        });
        // /developer as a fallback access point (any domain)
        app.use('/developer', (req, res, next) => gatewayApp(req, res, next));
        logger_1.logger.info('Landing gateway mounted (orgsledger.com: root, all: /developer)');
        // Diagnostic endpoint (gateway loaded)
        app.get('/api/gateway-status', (_req, res) => {
            res.json({
                success: true,
                gatewayLoaded: true,
                adminDashboard: '/developer/admin',
                loginEndpoint: '/api/admin/login',
            });
        });
        return true;
    }
    catch (err) {
        logger_1.logger.error('Landing gateway FAILED to load:', err);
        logger_1.logger.error('Stack trace:', err.stack);
        // Diagnostic endpoint (gateway failed)
        app.get('/api/gateway-status', (_req, res) => {
            res.json({
                success: false,
                gatewayLoaded: false,
                error: err.message,
                stack: err.stack,
                note: 'Landing dependencies may not be installed. Run: npm install --workspace=landing',
            });
        });
        return false;
    }
}
/**
 * Mount the Expo web SPA frontend.
 * Serves static files and provides SPA fallback.
 */
function mountWebFrontend(app) {
    const webDir = path_1.default.resolve(__dirname, '../../web');
    if (!fs_1.default.existsSync(webDir)) {
        logger_1.logger.warn(`Web frontend directory not found: ${webDir}`);
        // Fallback status page
        app.get('/', (_req, res) => {
            res.json({ name: 'OrgsLedger API', status: 'ok', version: '1.0.0', docs: '/api' });
        });
        return;
    }
    // Redirect root "/" to "/login" on app subdomain
    app.get('/', (req, res, next) => {
        if ((0, constants_1.isLandingHost)(req.headers.host || ''))
            return next();
        return res.redirect(302, '/login');
    });
    // Static file serving (skip landing domain)
    app.use((req, res, next) => {
        if ((0, constants_1.isLandingHost)(req.headers.host || ''))
            return next();
        express_1.default.static(webDir)(req, res, next);
    });
    logger_1.logger.info(`Serving web frontend from ${webDir}`);
    // SPA fallback — must be registered after all API routes
    // Call mountSpaFallback(app) separately after route registration
}
/**
 * Register the SPA catch-all AFTER all API routes.
 */
function mountSpaFallback(app) {
    const webDir = path_1.default.resolve(__dirname, '../../web');
    if (!fs_1.default.existsSync(webDir))
        return;
    app.get('*', (req, res) => {
        if ((0, constants_1.isLandingHost)(req.headers.host || '')) {
            res.redirect(301, '/');
            return;
        }
        res.sendFile(path_1.default.join(webDir, 'index.html'));
    });
}
//# sourceMappingURL=landing-gateway.js.map