// OrgsLedger — Root entry point for Hostinger Express deployment
// Routes to API (test.orgsledger.com) or Landing Gateway (orgsledger.com)
// based on the hostname/environment.

const path = require('path');
const fs = require('fs');

// Catch any uncaught exceptions and log them
process.on('uncaughtException', (err) => {
  console.error('[OrgsLedger] FATAL uncaughtException:', err.stack || err.message || err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[OrgsLedger] FATAL unhandledRejection:', reason);
  process.exit(1);
});

// Log startup environment for debugging
console.log('[OrgsLedger] ========= STARTUP =========');
console.log('[OrgsLedger] Node version:', process.version);
console.log('[OrgsLedger] CWD:', process.cwd());
console.log('[OrgsLedger] __dirname:', __dirname);
console.log('[OrgsLedger] SITE_MODE:', process.env.SITE_MODE || '(not set, defaults to api)');
console.log('[OrgsLedger] NODE_ENV:', process.env.NODE_ENV || '(not set)');
console.log('[OrgsLedger] PORT:', process.env.PORT || '(not set, defaults to 3000)');
console.log('[OrgsLedger] DATABASE_URL:', process.env.DATABASE_URL ? '***set***' : '(NOT SET)');
console.log('[OrgsLedger] JWT_SECRET:', process.env.JWT_SECRET ? '***set***' : '(NOT SET)');

// Determine which app to run:
// - If SITE_MODE=landing  →  run the landing gateway
// - If SITE_MODE=api      →  run the API server
// - Default: api (backwards-compatible)
const SITE_MODE = (process.env.SITE_MODE || 'api').toLowerCase();

if (SITE_MODE === 'landing') {
  // ── Landing Gateway (orgsledger.com) ──
  console.log('[OrgsLedger] Starting Landing Gateway...');
  process.chdir(path.join(__dirname, 'landing'));
  require(path.join(__dirname, 'landing', 'server.js'));
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
    console.error('[OrgsLedger] ERROR: dist/index.js not found at', distPath);
    console.error('[OrgsLedger] Build output contents:');
    const distDir = path.join(__dirname, 'apps', 'api', 'dist');
    if (fs.existsSync(distDir)) {
      try {
        const files = fs.readdirSync(distDir);
        console.error('[OrgsLedger]   dist/ contains:', files.join(', '));
      } catch (e) { console.error('[OrgsLedger]   Could not read dist/', e.message); }
    } else {
      console.error('[OrgsLedger]   dist/ directory does NOT exist');
    }
    process.exit(1);
  }

  console.log('[OrgsLedger] Loading API from:', distPath);

  try {
    // Start the Express server (compiled TypeScript output)
    require(distPath);
    console.log('[OrgsLedger] API module loaded successfully');
  } catch (err) {
    console.error('[OrgsLedger] FATAL: Failed to load API module:', err.stack || err.message || err);
    process.exit(1);
  }
}
