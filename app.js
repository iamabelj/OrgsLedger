// OrgsLedger — Root entry point for Hostinger Express deployment
// Routes to API (test.orgsledger.com) or Landing Gateway (orgsledger.com)
// based on the hostname/environment.

const path = require('path');
const fs = require('fs');

// Catch any uncaught exceptions and log them — but keep the process alive
process.on('uncaughtException', (err) => {
  console.error('[OrgsLedger] uncaughtException:', err.stack || err.message || err);
  // Don't exit — let the fallback server keep responding
});
process.on('unhandledRejection', (reason) => {
  console.error('[OrgsLedger] unhandledRejection:', reason);
  // Don't exit — let the fallback server keep responding
});

const PORT = process.env.PORT || 3000;

// Log startup environment for debugging
console.log('[OrgsLedger] ========= STARTUP =========');
console.log('[OrgsLedger] Node version:', process.version);
console.log('[OrgsLedger] CWD:', process.cwd());
console.log('[OrgsLedger] __dirname:', __dirname);
console.log('[OrgsLedger] SITE_MODE:', process.env.SITE_MODE || '(not set, defaults to api)');
console.log('[OrgsLedger] NODE_ENV:', process.env.NODE_ENV || '(not set)');
console.log('[OrgsLedger] PORT:', PORT);
console.log('[OrgsLedger] DATABASE_URL:', process.env.DATABASE_URL ? '***set***' : '(NOT SET)');
console.log('[OrgsLedger] JWT_SECRET:', process.env.JWT_SECRET ? '***set***' : '(NOT SET)');

// Determine which app to run
const SITE_MODE = (process.env.SITE_MODE || 'api').toLowerCase();

if (SITE_MODE === 'landing') {
  // ── Landing Gateway (orgsledger.com) ──
  console.log('[OrgsLedger] Starting Landing Gateway...');
  process.chdir(path.join(__dirname, 'landing'));
  try {
    require(path.join(__dirname, 'landing', 'server.js'));
  } catch (err) {
    console.error('[OrgsLedger] FATAL: Failed to load Landing module:', err.stack || err.message);
    startFallbackServer('Landing module failed to load: ' + (err.message || err));
  }
} else {
  // ── API Server (test.orgsledger.com) ──
  console.log('[OrgsLedger] Starting API Server...');
  process.chdir(path.join(__dirname, 'apps', 'api'));
  console.log('[OrgsLedger] Changed CWD to:', process.cwd());

  // Load environment variables from apps/api/.env if present
  try { require('dotenv').config(); } catch (e) {
    console.log('[OrgsLedger] dotenv not available or no .env file (OK if env vars set on host)');
  }

  // Verify dist exists
  const distPath = path.join(__dirname, 'apps', 'api', 'dist', 'index.js');
  if (!fs.existsSync(distPath)) {
    const msg = 'dist/index.js not found at ' + distPath;
    console.error('[OrgsLedger] ERROR:', msg);
    // List what exists
    const distDir = path.join(__dirname, 'apps', 'api', 'dist');
    if (fs.existsSync(distDir)) {
      try {
        const files = fs.readdirSync(distDir);
        console.error('[OrgsLedger] dist/ contains:', files.join(', '));
      } catch (e) { console.error('[OrgsLedger] Could not read dist/', e.message); }
    } else {
      console.error('[OrgsLedger] dist/ directory does NOT exist — build likely failed');
      // Also check if packages compiled
      const sharedDist = path.join(__dirname, 'packages', 'shared', 'dist');
      const dbDist = path.join(__dirname, 'packages', 'database', 'dist');
      console.error('[OrgsLedger] packages/shared/dist exists:', fs.existsSync(sharedDist));
      console.error('[OrgsLedger] packages/database/dist exists:', fs.existsSync(dbDist));
    }
    startFallbackServer('Build failed: ' + msg);
  } else {
    console.log('[OrgsLedger] Loading API from:', distPath);
    try {
      require(distPath);
      console.log('[OrgsLedger] API module loaded successfully');
    } catch (err) {
      const msg = 'Failed to load API: ' + (err.stack || err.message || err);
      console.error('[OrgsLedger] FATAL:', msg);
      startFallbackServer(msg);
    }
  }
}

// ── Fallback Diagnostic Server ──────────────────────────
// Starts a minimal Express server that returns diagnostic info
// instead of letting the process crash (which causes 503).
function startFallbackServer(errorMessage) {
  console.log('[OrgsLedger] Starting fallback diagnostic server on port', PORT);
  try {
    const express = require('express');
    const app = express();
    const startupError = errorMessage;
    const startupTime = new Date().toISOString();

    app.get('/health', (_req, res) => {
      res.status(503).json({
        status: 'error',
        error: startupError,
        startedAt: startupTime,
        nodeVersion: process.version,
        env: {
          NODE_ENV: process.env.NODE_ENV || '(not set)',
          SITE_MODE: process.env.SITE_MODE || '(not set)',
          PORT: PORT,
          DATABASE_URL: process.env.DATABASE_URL ? 'set' : 'NOT SET',
          JWT_SECRET: process.env.JWT_SECRET ? 'set' : 'NOT SET',
        },
      });
    });

    app.use((_req, res) => {
      res.status(503).json({
        error: 'OrgsLedger API failed to start',
        details: startupError,
        hint: 'Check /health for diagnostic info. Check server logs for full stack trace.',
        startedAt: startupTime,
      });
    });

    app.listen(PORT, '0.0.0.0', () => {
      console.log('[OrgsLedger] Fallback server listening on port', PORT);
      console.log('[OrgsLedger] Visit /health for diagnostic info');
    });
  } catch (fallbackErr) {
    console.error('[OrgsLedger] Even fallback server failed:', fallbackErr.message);
    // Last resort — raw HTTP
    try {
      const http = require('http');
      http.createServer((_req, res) => {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: errorMessage, fallback: fallbackErr.message }));
      }).listen(PORT, '0.0.0.0');
      console.log('[OrgsLedger] Raw HTTP fallback on port', PORT);
    } catch (e) {
      console.error('[OrgsLedger] All fallback options failed:', e.message);
    }
  }
}
