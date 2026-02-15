// ============================================================
// OrgsLedger API — Main Server Entry Point
// ============================================================

import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { logger } from './logger';
import db from './db';
import { auditContext } from './middleware';
import { requestLogger } from './middleware/request-logger';
import { setupSocketIO } from './socket';
import { AIService } from './services/ai.service';

// Observability
import { metricsMiddleware } from './services/metrics.service';
import { errorMonitorMiddleware, setupProcessErrorHandlers } from './services/error-monitor.service';

// Route imports
import authRoutes from './routes/auth';
import orgRoutes from './routes/organizations';
import chatRoutes from './routes/chat';
import meetingRoutes from './routes/meetings';
import financialRoutes from './routes/financials';
import paymentRoutes from './routes/payments';
import committeeRoutes from './routes/committees';
import adminRoutes from './routes/admin';
import notificationRoutes from './routes/notifications';
import announcementRoutes from './routes/announcements';
import eventRoutes from './routes/events';
import pollRoutes from './routes/polls';
import documentRoutes from './routes/documents';
import analyticsRoutes from './routes/analytics';
import expenseRoutes from './routes/expenses';
import subscriptionRoutes from './routes/subscriptions';
import observabilityRoutes from './routes/observability';
import { startScheduler } from './services/scheduler.service';

const app = express();
const server = http.createServer(app);

// Set up process-level error handlers (uncaughtException, unhandledRejection)
setupProcessErrorHandlers();

// Ensure upload directory exists
const uploadDir = path.resolve(config.upload.dir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ── Socket.io ─────────────────────────────────────────────
const io = setupSocketIO(server);
app.set('io', io);

// ── AI Service ────────────────────────────────────────────
const aiService = new AIService(io);
app.set('aiService', aiService);

// ── Global Middleware ─────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: config.env === 'production'
    ? (process.env.CORS_ORIGINS || 'https://orgsledger.com,https://app.orgsledger.com').split(',')
    : '*',
  credentials: true,
}));

// Raw body for Stripe webhooks
app.use('/api/payments/webhooks/stripe', express.raw({ type: 'application/json' }));

// Raw body for Paystack webhooks
app.use('/api/payments/webhooks/paystack', express.raw({ type: 'application/json' }));

// JSON parser for everything else
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit per IP
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// ── Cap pagination limits to prevent data dumping ────────
app.use((req, _res, next) => {
  if (req.query.limit) {
    const parsed = parseInt(req.query.limit as string);
    if (isNaN(parsed) || parsed < 1) req.query.limit = '50';
    else if (parsed > 200) req.query.limit = '200';
  }
  next();
});

// Audit context
app.use(auditContext);

// ── Observability Middleware ──────────────────────────────
app.use(metricsMiddleware);

// ── Full Request Logging (temporary observability) ────────
app.use(requestLogger);

// Serve uploaded files (require valid JWT)
app.use('/uploads', (req, res, next) => {
  const token = req.query.token as string || req.headers.authorization?.split(' ')[1];
  if (!token) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }
  try {
    const jwt = require('jsonwebtoken');
    jwt.verify(token, config.jwt.secret);
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
}, express.static(path.resolve(config.upload.dir)));

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
  const landingDir = path.resolve(__dirname, '../../../landing');

  // Serve landing static files (logo.png, CSS, etc.) on orgsledger.com
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
    if (host === 'orgsledger.com' || host === 'www.orgsledger.com' || host === 'localhost' || host === '127.0.0.1') {
      return express.static(landingDir, { index: false })(req, res, next);
    }
    next();
  });

  // Landing page at /
  const landingPage = path.resolve(landingDir, 'index.html');
  if (fs.existsSync(landingPage)) {
    app.get('/', (req, res, next) => {
      const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
      if (host === 'orgsledger.com' || host === 'www.orgsledger.com' || host === 'localhost' || host === '127.0.0.1') {
        return res.sendFile(landingPage);
      }
      next();
    });
    logger.info('Landing page served at / (orgsledger.com only)');
  }

  // Admin dashboard at /developer/admin
  const adminPage = path.resolve(landingDir, 'admin.html');
  if (fs.existsSync(adminPage)) {
    app.get('/developer/admin', (req, res, next) => {
      const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
      if (host === 'orgsledger.com' || host === 'www.orgsledger.com' || host === 'localhost' || host === '127.0.0.1') {
        return res.sendFile(adminPage);
      }
      next();
    });
  }

  // Gateway API routes (admin login, checkout, AI proxy, geo, client verification, health)
  // on orgsledger.com — these take priority over main API admin routes
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
    if (host === 'orgsledger.com' || host === 'www.orgsledger.com' || host === 'localhost' || host === '127.0.0.1') {
      // Let gateway handle its routes: /api/admin/*, /api/checkout/*, /api/ai/*, /api/geo, /api/license/verify, /health
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
  app.use('/developer', (req: express.Request, res: express.Response, next: express.NextFunction) => {
    return gatewayApp(req, res, next);
  });
  logger.info('Landing gateway mounted (orgsledger.com: root, all: /developer)');
  
  // Add diagnostic endpoint to verify gateway is loaded
  app.get('/api/gateway-status', (_req, res) => {
    res.json({
      success: true,
      gatewayLoaded: true,
      adminDashboard: '/developer/admin',
      loginEndpoint: '/api/admin/login',
    });
  });
} catch (err: any) {
  logger.error('Landing gateway FAILED to load:', err);
  logger.error('Stack trace:', err.stack);
  
  // Add diagnostic endpoint even when gateway fails
  app.get('/api/gateway-status', (_req, res) => {
    res.json({
      success: false,
      gatewayLoaded: false,
      error: err.message,
      stack: err.stack,
      note: 'Landing dependencies may not be installed. Run: npm install --workspace=landing',
    });
  });
}

// ── Serve Web Frontend (production) ──────────────────────
// Expo web build at apps/api/web — only served on app.orgsledger.com (not orgsledger.com)
const webDir = path.resolve(__dirname, '../web');
if (fs.existsSync(webDir)) {
  // Redirect root "/" to "/login" on app subdomain so unauthenticated visitors land on login
  app.get('/', (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
    if (host === 'orgsledger.com' || host === 'www.orgsledger.com') {
      return next(); // Landing domain handled elsewhere
    }
    return res.redirect(302, '/login');
  });

  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
    if (host === 'orgsledger.com' || host === 'www.orgsledger.com') {
      return next(); // Landing domain — no SPA
    }
    express.static(webDir)(req, res, next);
  });
  logger.info(`Serving web frontend from ${webDir}`);
} else {
  logger.warn(`Web frontend directory not found: ${webDir}`);
}

// ── Auth Rate Limiting (login/register brute force protection) ──
const authLimiter = rateLimit({
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
app.use('/api/auth/refresh', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30, // allow more refresh calls than login but still capped
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later' },
}));

// ── Webhook Rate Limiting ──
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // max 60 webhook calls per IP per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many webhook requests' },
});
app.use('/api/payments/webhooks', webhookLimiter);
app.use('/api/payments/paystack/callback', webhookLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/organizations', orgRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/financials', financialRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/committees', committeeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/polls', pollRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/admin/observability', observabilityRoutes);

// ── 404 Handler ───────────────────────────────────────────
// API 404 — only for /api/* routes
app.all('/api/*', (_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// SPA fallback — serve web frontend for all other routes (except /)
// orgsledger.com = sales/landing site only (no SPA login/register)
// app.orgsledger.com + client domains = full SPA app
if (fs.existsSync(webDir)) {
  app.get('*', (req, res) => {
    const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
    // On orgsledger.com, redirect all non-API routes to the landing/sales page
    if (host === 'orgsledger.com' || host === 'www.orgsledger.com') {
      res.redirect(301, '/');
      return;
    }
    // All other domains (app.orgsledger.com, client deployments, localhost): serve SPA
    res.sendFile(path.join(webDir, 'index.html'));
  });
} else {
  // Fallback: return a basic JSON status page
  app.get('/', (_req, res) => {
    res.json({ name: 'OrgsLedger API', status: 'ok', version: '1.0.0', docs: '/api' });
  });
}

// ── Global Error Handler ──────────────────────────────────
app.use(errorMonitorMiddleware); // Capture errors before responding
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(err.status || 500).json({
    success: false,
    error: config.env === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Start Server ──────────────────────────────────────────
(async () => {
  server.listen(config.port, '0.0.0.0', () => {
    logger.info(`OrgsLedger API running on port ${config.port}`);
    logger.info(`Environment: ${config.env}`);
    logger.info(`Socket.io enabled`);

    // Start recurring dues scheduler
    startScheduler();
  });
})();

export { app, server, io };
