// ============================================================
// OrgsLedger API — Main Server Entry Point
// Kept lean — heavy lifting extracted to middleware, controllers,
// and the service registry.
// ============================================================

import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { logger } from './logger';
import { auditContext } from './middleware';
import { requestLogger } from './middleware/request-logger';
import { globalErrorHandler } from './middleware/error-handler';
import { idempotencyMiddleware } from './middleware/idempotency';
import { etagMiddleware } from './middleware/etag';
import { sessionExpiry } from './middleware/session-expiry';
import { mountLandingGateway, mountWebFrontend, mountSpaFallback } from './middleware/landing-gateway';
import { setupSocketIO } from './socket';
import { AIService } from './services/ai.service';
import { services } from './services/registry';
import { initBotManager } from './services/bot';
import { RATE_LIMITS, PAGINATION, APP_VERSION } from './constants';

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
import docsRoutes from './routes/docs';
import translationRoutes from './routes/translation.routes';
import jobsRoutes from './routes/jobs.routes';
import transcriptsRoutes from './routes/transcripts';
import { startScheduler } from './services/scheduler.service';
import { ensureSuperAdmin } from './services/seed.service';
import { meetingPipeline } from './meeting-pipeline';
import { prewarmTranslationCache } from './services/translationPrewarm';
import { startMetricsReporter, stopMetricsReporter } from './services/translationMetrics';

const app = express();

// Use pre-created server from server.js if available (production).
// This ensures the port is already bound before this module loads.
const preCreatedServer = (global as any).__orgsServer as http.Server | undefined;
const server = preCreatedServer || http.createServer(app);

// Set up process-level error handlers (uncaughtException, unhandledRejection)
setupProcessErrorHandlers();

// Trust exactly one upstream proxy (nginx) for correct client IP handling
app.set('trust proxy', 1);

// Ensure upload directory exists
const uploadDir = path.resolve(config.upload.dir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ── Socket.io ─────────────────────────────────────────────
const io = setupSocketIO(server);
app.set('io', io);               // kept for backwards compat in routes not yet migrated
services.register('io', io);     // preferred — use services.get('io') in new code

// ── AI Service ────────────────────────────────────────────
const aiService = new AIService(io);
app.set('aiService', aiService);          // backwards compat
services.register('aiService', aiService);

// ── Transcription Bot Manager ─────────────────────────────
// LiveKit transcription bot (optional)
// Default: disabled (clients stream audio directly to server-side Deepgram STT).
// Enable by setting ENABLE_LIVEKIT_BOT=true.
const enableLivekitBot = process.env.ENABLE_LIVEKIT_BOT === 'true';
if (enableLivekitBot) {
  try {
    const botManager = initBotManager({ io });
    services.register('botManager', botManager);
    logger.info('[STARTUP] ✓ LiveKit transcription bot enabled');
  } catch (err: any) {
    logger.error('[STARTUP] Failed to initialize LiveKit bot manager (non-fatal):', err?.message || err);
  }
} else {
  logger.info('[STARTUP] LiveKit transcription bot disabled (set ENABLE_LIVEKIT_BOT=true to enable)');
}

// ── Global Middleware ─────────────────────────────────────
app.use(helmet({
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
  noSniff: true,           // X-Content-Type-Options: nosniff
  dnsPrefetchControl: { allow: false },
  frameguard: { action: 'deny' },  // X-Frame-Options: DENY
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  hidePoweredBy: true,     // Remove X-Powered-By
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
app.use(compression({
  level: 6,                    // Balanced speed vs ratio
  threshold: 1024,             // Only compress responses > 1KB
  filter: (req, res) => {
    // Don't compress SSE or WebSocket upgrade requests
    if (req.headers['accept'] === 'text/event-stream') return false;
    return compression.filter(req, res);
  },
}));

app.use(cors({
  origin: config.env === 'production'
    ? (process.env.CORS_ORIGINS || 'https://orgsledger.com,https://app.orgsledger.com').split(',')
    : true,
  credentials: true,
}));

// Raw body for Stripe webhooks
app.use('/api/payments/webhooks/stripe', express.raw({ type: 'application/json' }));

// Raw body for Paystack webhooks
app.use('/api/payments/webhooks/paystack', express.raw({ type: 'application/json' }));

// JSON parser — smaller default limit, documents/uploads get their own limits
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: RATE_LIMITS.GLOBAL.windowMs,
  max: RATE_LIMITS.GLOBAL.max,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// ── Cap pagination limits to prevent data dumping ────────
app.use((req, _res, next) => {
  if (req.query.limit) {
    const parsed = parseInt(req.query.limit as string);
    if (isNaN(parsed) || parsed < 1) req.query.limit = String(PAGINATION.DEFAULT_LIMIT);
    else if (parsed > PAGINATION.MAX_LIMIT) req.query.limit = String(PAGINATION.MAX_LIMIT);
  }
  next();
});

// Audit context
app.use(auditContext);

// ── API Versioning ────────────────────────────────────────
// Add API-Version header to all responses; support /api/v1/* as an alias
app.use((req, res, next) => {
  res.setHeader('X-API-Version', APP_VERSION);
  // Rewrite /api/v1/* to /api/* for forward compatibility
  if (req.path.startsWith('/api/v1/')) {
    req.url = req.url.replace('/api/v1/', '/api/');
  }
  next();
});

// ── Observability Middleware ──────────────────────────────
app.use(metricsMiddleware);

// ── ETag for GET responses (client-side 304 caching) ─────
app.use(etagMiddleware);

// ── Full Request Logging (temporary observability) ────────
app.use(requestLogger);

// Serve uploaded files (require valid JWT)
// Public paths: avatars, logos, and chat attachments (displayed in <Image> tags that can't send headers)
app.use('/uploads/avatars', express.static(path.resolve(config.upload.dir, 'avatars')));
app.use('/uploads/logos', express.static(path.resolve(config.upload.dir, 'logos')));
app.use('/uploads/chat', express.static(path.resolve(config.upload.dir, 'chat')));

// All other uploads require JWT
app.use('/uploads', (req, res, next) => {
  const token = req.query.token as string || req.headers.authorization?.split(' ')[1];
  if (!token) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }
  try {
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
    version: APP_VERSION,
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
  const webDir = path.resolve(__dirname, '../web');
  const webExists = fs.existsSync(webDir);
  let jsFiles: string[] = [];
  try {
    const expoDir = path.join(webDir, '_expo', 'static', 'js', 'web');
    if (fs.existsSync(expoDir)) jsFiles = fs.readdirSync(expoDir);
  } catch {}
  res.setHeader('Cache-Control', 'no-cache');
  res.json({
    build: '2026-02-21-edit-feature',
    version: APP_VERSION,
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
    const { isSttAvailable, getSttDiagnostics } = require('./services/speech-to-text.service');
    const { config: appConfig } = require('./config');
    const sttDiag = getSttDiagnostics();

    // Check database connectivity
    let dbOk = false;
    let transcriptTableExists = false;
    try {
      const knex = require('./db').default;
      await knex.raw('SELECT 1');
      dbOk = true;
      transcriptTableExists = await knex.schema.hasTable('meeting_transcripts');
    } catch (_) {}

    res.json({
      status: 'ok',
      pipeline: {
        deepgramSTT: {
          provider: sttDiag.provider,
          available: isSttAvailable(),
          apiKeyConfigured: sttDiag.apiKeyConfigured,
          apiKeyPrefix: sttDiag.apiKeyPrefix,
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
  } catch (err: any) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ── Landing / Gateway (orgsledger.com) ────────────────────
mountLandingGateway(app);

// ── Serve Web Frontend (production) ──────────────────────
mountWebFrontend(app);

// ── Auth Rate Limiting (login/register brute force protection) ──
const authLimiter = rateLimit({
  windowMs: RATE_LIMITS.AUTH.windowMs,
  max: RATE_LIMITS.AUTH.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many attempts, please try again later' },
});

// ── Per-Route Payload Size Limits ──
// Auth routes don't need large payloads (login/register bodies are tiny)
const authPayloadLimit = express.json({ limit: '16kb' });

// ── API Routes ────────────────────────────────────────────
app.use('/api/auth', authLimiter, authPayloadLimit);
app.use('/api/auth/login', authLimiter, authPayloadLimit);
app.use('/api/auth/register', authLimiter, authPayloadLimit);
app.use('/api/auth/forgot-password', authLimiter, authPayloadLimit);
app.use('/api/auth/reset-password', authLimiter, authPayloadLimit);
app.use('/api/auth/refresh', rateLimit({
  windowMs: RATE_LIMITS.REFRESH.windowMs,
  max: RATE_LIMITS.REFRESH.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later' },
}));

// ── Session Expiry Middleware ──
// Validates platform-specific session lifetimes (applies to all authenticated endpoints)
app.use('/api', sessionExpiry);

// ── Webhook Rate Limiting ──
const webhookLimiter = rateLimit({
  windowMs: RATE_LIMITS.WEBHOOK.windowMs,
  max: RATE_LIMITS.WEBHOOK.max,
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
app.use('/api/financials', idempotencyMiddleware, financialRoutes);
app.use('/api/payments', idempotencyMiddleware, paymentRoutes);
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
app.use('/api/docs', docsRoutes);
app.use('/api/translations', translationRoutes);
app.use('/api/meetings/:meetingId/transcripts', transcriptsRoutes);
app.use('/api', jobsRoutes);

// ── 404 Handler ───────────────────────────────────────────
// API 404 — only for /api/* routes
app.all('/api/*', (_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// SPA fallback — must come after all API routes
mountSpaFallback(app);

// ── Global Error Handler ──────────────────────────────────
app.use(errorMonitorMiddleware); // Capture errors before responding
app.use(globalErrorHandler);     // Structured JSON error responses

// ── Ensure Critical Meeting Tables Exist ──────────────────
// These tables were added in migrations 021-025 but production
// may not have run them. Auto-create on startup to guarantee
// transcripts, chat, and language preferences work.
async function ensureMeetingTables(): Promise<void> {
  const { db, tableExists: checkTable, markTableExists } = require('./db');
  try {
    // 1. meeting_transcripts (migration 021)
    if (!(await db.schema.hasTable('meeting_transcripts'))) {
      logger.info('[STARTUP] Creating missing table: meeting_transcripts');
      await db.schema.createTable('meeting_transcripts', (t: any) => {
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
      logger.info('[STARTUP] ✓ Created meeting_transcripts table');
    }
    markTableExists('meeting_transcripts');

    // 2. user_language_preferences (migration 022)
    if (!(await db.schema.hasTable('user_language_preferences'))) {
      logger.info('[STARTUP] Creating missing table: user_language_preferences');
      await db.schema.createTable('user_language_preferences', (t: any) => {
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
      logger.info('[STARTUP] ✓ Created user_language_preferences table');
    }
    markTableExists('user_language_preferences');

    // 3. meeting_messages (migration 025)
    if (!(await db.schema.hasTable('meeting_messages'))) {
      logger.info('[STARTUP] Creating missing table: meeting_messages');
      await db.schema.createTable('meeting_messages', (t: any) => {
        t.uuid('id').primary().defaultTo(db.raw("gen_random_uuid()"));
        t.uuid('meeting_id').notNullable().references('id').inTable('meetings').onDelete('CASCADE');
        t.uuid('sender_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
        t.string('sender_name', 255).notNullable();
        t.text('message').notNullable();
        t.timestamp('created_at').defaultTo(db.fn.now());
      });
      await db.schema.raw(
        'CREATE INDEX IF NOT EXISTS idx_meeting_messages_meeting_created ON meeting_messages (meeting_id, created_at)'
      );
      logger.info('[STARTUP] ✓ Created meeting_messages table');
    }
    markTableExists('meeting_messages');

    // 4. meeting_minutes — add download_formats column if missing (migration 021 part 2)
    if (await db.schema.hasTable('meeting_minutes')) {
      const hasFormats = await db.schema.hasColumn('meeting_minutes', 'download_formats');
      if (!hasFormats) {
        await db.schema.alterTable('meeting_minutes', (t: any) => {
          t.jsonb('download_formats').notNullable().defaultTo('{}');
        });
        logger.info('[STARTUP] ✓ Added download_formats to meeting_minutes');
      }
    }

    logger.info('[STARTUP] ✓ All critical meeting tables verified');
  } catch (err: any) {
    logger.error('[STARTUP] ❌ Failed to ensure meeting tables:', err.message);
    // Don't crash — the app can still serve other features
  }
}

// ── Start Server ──────────────────────────────────────────
// When launched via server.js (production), port is already bound.
// When launched directly (dev), we bind here.
function doPostStart(): void {
  // In some deploy setups this module can be evaluated more than once.
  // Make post-start tasks idempotent so workers and schedulers can't double-start.
  if ((global as any).__orgsPostStartRan) {
    logger.warn('[STARTUP] doPostStart already ran; skipping duplicate initialization');
    return;
  }
  (global as any).__orgsPostStartRan = true;

  logger.info(`OrgsLedger API running on port ${config.port}`);
  logger.info(`Environment: ${config.env}`);
  logger.info(`Socket.io enabled`);

  // Prevent 503s from stale connections / reverse proxy timeouts
  server.keepAliveTimeout = 65_000;  // Slightly above typical LB idle timeout (60s)
  server.headersTimeout = 70_000;    // Must be > keepAliveTimeout

  // Async DB initialization — runs after port is bound
  (async () => {
    try {
      await ensureSuperAdmin();
      logger.info('[STARTUP] Super admin verified');
    } catch (err: any) {
      logger.error('[STARTUP] ensureSuperAdmin failed (non-fatal):', err.message);
    }

    try {
      await ensureMeetingTables();
      logger.info('[STARTUP] Meeting tables verified');
    } catch (err: any) {
      logger.error('[STARTUP] ensureMeetingTables failed (non-fatal):', err.message);
    }

    // Ensure account lockout columns exist (migration 026)
    try {
      const { db: knex } = require('./db');
      if (await knex.schema.hasTable('users')) {
        const hasAttempts = await knex.schema.hasColumn('users', 'failed_login_attempts');
        if (!hasAttempts) {
          await knex.schema.alterTable('users', (t: any) => {
            t.integer('failed_login_attempts').notNullable().defaultTo(0);
            t.timestamp('locked_until').nullable();
          });
          logger.info('[STARTUP] ✓ Added account lockout columns to users table');
        }
      }
    } catch (err: any) {
      logger.error('[STARTUP] Account lockout columns check failed (non-fatal):', err.message);
    }

    // Ensure refresh_tokens table exists (migration 027)
    try {
      const { db: knex } = require('./db');
      if (!(await knex.schema.hasTable('refresh_tokens'))) {
        await knex.schema.createTable('refresh_tokens', (t: any) => {
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
        logger.info('[STARTUP] ✓ Created refresh_tokens table');
      }
    } catch (err: any) {
      logger.error('[STARTUP] refresh_tokens table check failed (non-fatal):', err.message);
    }

    // Start recurring dues scheduler
    startScheduler();

    // Initialize new meeting pipeline (replaces old worker orchestrator)
    try {
      await meetingPipeline.initialize(io);
      logger.info('[STARTUP] ✓ Meeting pipeline initialized');
    } catch (err: any) {
      logger.error('[STARTUP] Meeting pipeline initialization failed (non-fatal):', err.message);
    }

    // Start translation metrics reporter
    startMetricsReporter();
    logger.info('[STARTUP] ✓ Translation metrics reporter started');

    // Prewarm translation cache in background (non-blocking)
    prewarmTranslationCache().catch((err) => {
      logger.warn('[STARTUP] Translation prewarm failed (non-fatal):', err.message || err);
    });
  })();
}

if (preCreatedServer) {
  // Production: server.js already has the port bound.
  // Just run post-start tasks immediately.
  logger.info('[STARTUP] Using pre-created server from server.js');
  doPostStart();
} else {
  // Dev / standalone: bind the port ourselves.
  server.listen(config.port, '0.0.0.0', () => {
    doPostStart();
  });
}

// ── Graceful Shutdown ─────────────────────────────────────
// On SIGTERM / SIGINT: stop accepting new connections, drain
// existing ones, close DB pool, and exit cleanly.
let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`[SHUTDOWN] ${signal} received — starting graceful shutdown`);

  // 1. Stop accepting new HTTP connections (give 10s for in-flight)
  server.close(() => {
    logger.info('[SHUTDOWN] HTTP server closed');
  });

  // 2. Close Socket.io connections
  try {
    io.disconnectSockets(true);
    logger.info('[SHUTDOWN] Socket.io connections closed');
  } catch {}

  // 3. Wait for in-flight requests to complete (max 10s)
  await new Promise((resolve) => setTimeout(resolve, 10_000));

  // 4. Stop meeting pipeline and metrics
  try {
    stopMetricsReporter();
    await meetingPipeline.shutdown();
    logger.info('[SHUTDOWN] Meeting pipeline closed');
  } catch (err: any) {
    logger.error('[SHUTDOWN] Meeting pipeline close error:', err.message);
  }

  // 4.5 Stop any running transcription bots (best-effort)
  if (enableLivekitBot) {
    try {
      const { getBotManager } = await import('./services/bot');
      await getBotManager().shutdownAll();
      logger.info('[SHUTDOWN] Bot manager shut down');
    } catch (err: any) {
      logger.warn('[SHUTDOWN] Bot manager shutdown failed (non-fatal):', err?.message || err);
    }
  }

  // 5. Close database pool
  try {
    const { db: knex } = require('./db');
    await knex.destroy();
    logger.info('[SHUTDOWN] Database pool closed');
  } catch (err: any) {
    logger.error('[SHUTDOWN] DB pool close error:', err.message);
  }

  // 6. Flush logger
  try {
    logger.end();
  } catch {}

  logger.info('[SHUTDOWN] Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { app, server, io };
