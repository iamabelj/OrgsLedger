// OrgsLedger — Root entry point for Hostinger Express deployment
// Routes to API (test.orgsledger.com) or Landing Gateway (orgsledger.com)
// based on the hostname/environment.

const path = require('path');

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

  // Load environment variables from apps/api/.env if present
  try { require('dotenv').config(); } catch (e) { /* dotenv loaded via api deps */ }

  // Start the Express server (compiled TypeScript output)
  require(path.join(__dirname, 'apps', 'api', 'dist', 'index.js'));
}
