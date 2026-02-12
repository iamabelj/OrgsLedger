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
import { setupSocketIO } from './socket';
import { AIService } from './services/ai.service';

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
import { startScheduler } from './services/scheduler.service';

// ── License Verification ──────────────────────────────────
async function verifyLicense(): Promise<boolean> {
  // Ensure app_settings table exists
  try {
    await db.raw(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
  } catch (e) { /* table may already exist */ }

  // Check database for stored license first
  try {
    const row = await db('app_settings').where('key', 'license_key').first();
    if (row?.value) {
      logger.info('License key found in database');
      return true;
    }
  } catch (e) { /* table may not exist yet */ }

  // Fall back to env var
  const { license } = config;
  if (!license.key) {
    logger.warn('No LICENSE_KEY set — running in unlicensed mode. Set LICENSE_KEY env var to activate.');
    return false;
  }

  try {
    const axios = require('axios');
    const { data } = await axios.post(`${license.gatewayUrl}/api/license/verify`, {
      license_key: license.key,
    }, { timeout: 10000 });

    if (data.valid) {
      logger.info(`License verified ✔ — ${data.client.name} (${data.client.domain || 'no domain'})`);
      logger.info(`AI hours: ${data.client.hoursRemaining.toFixed(1)}h remaining of ${data.client.hoursBalance.toFixed(1)}h`);
      // Store in DB so it persists
      await db('app_settings').insert({ key: 'license_key', value: license.key }).onConflict('key').merge();
      return true;
    } else {
      logger.warn(`License invalid: ${data.error}`);
      return false;
    }
  } catch (err: any) {
    const msg = err.response?.data?.error || err.message;
    logger.warn(`License verification failed: ${msg} — continuing without license`);
    return false;
  }
}

const app = express();
const server = http.createServer(app);

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
    ? (process.env.CORS_ORIGINS || 'https://orgsledger.com').split(',')
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

// Audit context
app.use(auditContext);

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

// ── Serve public frontend ─────────────────────────────────
const publicDir = path.resolve(__dirname, '../public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// ── Root & Health Check ───────────────────────────────────
app.get('/', (_req, res) => {
  const indexPath = path.resolve(__dirname, '../public/index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  res.json({
    name: 'OrgsLedger API',
    status: 'ok',
    version: '1.0.0',
    docs: '/health',
  });
});

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
    const row = await db('app_settings').where('key', 'license_key').first();
    if (row?.value) {
      // Fetch stored client info if available
      let clientInfo = null;
      try {
        const infoRow = await db('app_settings').where('key', 'license_client').first();
        if (infoRow?.value) clientInfo = JSON.parse(infoRow.value);
      } catch (e) { /* ignore */ }
      return res.json({ licensed: true, client: clientInfo });
    }
    res.json({ licensed: false });
  } catch {
    res.json({ licensed: false });
  }
});

// ── License Activate (public — one-time setup by admin) ───
app.post('/api/license/activate', async (req, res) => {
  try {
    // Check if already activated
    const existing = await db('app_settings').where('key', 'license_key').first();
    if (existing?.value) {
      return res.json({ success: true, message: 'License already activated' });
    }

    const { license_key } = req.body;
    if (!license_key) {
      return res.status(400).json({ success: false, error: 'License key is required' });
    }

    // Verify with gateway
    const gatewayUrl = config.license.gatewayUrl;
    const axios = require('axios');
    const { data } = await axios.post(`${gatewayUrl}/api/license/verify`, {
      license_key,
    }, { timeout: 10000 });

    if (!data.valid) {
      return res.status(400).json({ success: false, error: data.error || 'Invalid license key' });
    }

    // Store license in database
    await db('app_settings').insert({ key: 'license_key', value: license_key }).onConflict('key').merge();
    await db('app_settings').insert({ key: 'license_client', value: JSON.stringify(data.client) }).onConflict('key').merge();

    logger.info(`License activated: ${data.client.name} (${data.client.domain || 'no domain'})`);

    res.json({
      success: true,
      message: 'License activated successfully',
      client: data.client,
    });
  } catch (err: any) {
    const msg = err.response?.data?.error || err.message;
    logger.error('License activation error:', msg);
    res.status(500).json({ success: false, error: msg || 'Activation failed' });
  }
});

// ── Serve Web Frontend (production) ──────────────────────
const webDir = path.resolve(__dirname, '../../mobile/dist');
if (config.env === 'production' && fs.existsSync(webDir)) {
  app.use(express.static(webDir));
  logger.info(`Serving web frontend from ${webDir}`);
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

// ── 404 Handler ───────────────────────────────────────────
// API 404 — only for /api/* routes
app.all('/api/*', (_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// SPA fallback — serve web frontend for all other routes (production)
if (config.env === 'production' && fs.existsSync(webDir)) {
  app.get('*', (_req, res) => {
    res.sendFile(path.join(webDir, 'index.html'));
  });
}

// ── Global Error Handler ──────────────────────────────────
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(err.status || 500).json({
    success: false,
    error: config.env === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Start Server ──────────────────────────────────────────
(async () => {
  // Verify license before starting
  await verifyLicense();

  server.listen(config.port, '0.0.0.0', () => {
    logger.info(`OrgsLedger API running on port ${config.port}`);
    logger.info(`Environment: ${config.env}`);
    logger.info(`Socket.io enabled`);

    // Start recurring dues scheduler
    startScheduler();
  });
})();

export { app, server, io };
