// ============================================================
// OrgsLedger API — Landing / Gateway Middleware
// Extracted from index.ts to keep the entry point lean.
// Handles: marketing page, developer admin, gateway API routes.
// ============================================================

import express from 'express';
import path from 'path';
import fs from 'fs';
import { logger } from '../logger';
import { isLandingHost } from '../constants';

/**
 * Mount landing gateway onto the Express app.
 * Returns true if the gateway was loaded.
 */
export function mountLandingGateway(app: express.Application): boolean {
  try {
    process.env.NO_LISTEN = 'true';
    const gatewayApp = require('../../../../landing/server');
    const landingDir = path.resolve(__dirname, '../../../../landing');

    // Serve landing static files on landing domain
    app.use((req, res, next) => {
      if (isLandingHost(req.headers.host || '')) {
        return express.static(landingDir, { index: false })(req, res, next);
      }
      next();
    });

    // Landing page at /
    const landingPage = path.resolve(landingDir, 'index.html');
    if (fs.existsSync(landingPage)) {
      app.get('/', (req, res, next) => {
        if (isLandingHost(req.headers.host || '')) return res.sendFile(landingPage);
        next();
      });
      logger.info('Landing page served at / (orgsledger.com only)');
    }

    // Admin dashboard at /developer/admin
    const adminPage = path.resolve(landingDir, 'admin.html');
    if (fs.existsSync(adminPage)) {
      app.get('/developer/admin', (req, res, next) => {
        if (isLandingHost(req.headers.host || '')) return res.sendFile(adminPage);
        next();
      });
    }

    // Gateway API routes on landing domain
    // Only forward paths that the gateway owns. Other /api/admin/* paths
    // (observability, config, analytics, audit-logs) belong to the main API.
    app.use((req, res, next) => {
      if (isLandingHost(req.headers.host || '')) {
        const p = req.path;
        const isGatewayPath =
          p === '/api/admin/login' ||
          p.startsWith('/api/admin/clients') ||
          p.startsWith('/api/admin/stats') ||
          p.startsWith('/api/admin/logs') ||
          p.startsWith('/api/admin/purchase-hours') ||
          p.startsWith('/api/admin/orders') ||
          p.startsWith('/api/checkout') ||
          p.startsWith('/api/ai') ||
          p.startsWith('/api/geo') ||
          p.startsWith('/api/license') ||
          p.startsWith('/api/webhooks') ||
          p === '/health';
        if (isGatewayPath) {
          return gatewayApp(req, res, next);
        }
      }
      next();
    });

    // /developer as a fallback access point (any domain)
    app.use('/developer', (req, res, next) => gatewayApp(req, res, next));
    logger.info('Landing gateway mounted (orgsledger.com: root, all: /developer)');

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
  } catch (err: any) {
    logger.error('Landing gateway FAILED to load:', err);
    logger.error('Stack trace:', err.stack);

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
export function mountWebFrontend(app: express.Application): void {
  const webDir = path.resolve(__dirname, '../../web');

  if (!fs.existsSync(webDir)) {
    logger.warn(`Web frontend directory not found: ${webDir}`);
    // Fallback status page
    app.get('/', (_req, res) => {
      res.json({ name: 'OrgsLedger API', status: 'ok', version: '1.0.0', docs: '/api' });
    });
    return;
  }

  // Static file serving (skip landing domain)
  app.use((req, res, next) => {
    if (isLandingHost(req.headers.host || '')) return next();
    // Prevent caching of HTML files
    if (req.path === '/' || req.path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    express.static(webDir)(req, res, next);
  });

  logger.info(`Serving web frontend from ${webDir}`);

  // SPA fallback — must be registered after all API routes
  // Call mountSpaFallback(app) separately after route registration
}

/**
 * Register the SPA catch-all AFTER all API routes.
 */
export function mountSpaFallback(app: express.Application): void {
  const webDir = path.resolve(__dirname, '../../web');
  if (!fs.existsSync(webDir)) return;

  const indexPath = path.join(webDir, 'index.html');

  app.get('*', (req, res) => {
    if (isLandingHost(req.headers.host || '')) {
      res.redirect(301, '/');
      return;
    }
    // Prevent caching of SPA fallback HTML
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(indexPath, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: 'Not found' });
      }
    });
  });
}
