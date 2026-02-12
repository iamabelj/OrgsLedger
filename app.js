// OrgsLedger — Root entry point for Hostinger Express deployment
// Routes to API (test.orgsledger.com) or Landing Gateway (orgsledger.com)
// based on the hostname/environment.

const path = require('path');
const http = require('http');

// ── Global error handler — never crash, always respond ──
process.on('uncaughtException', (err) => {
  console.error('[OrgsLedger] Uncaught exception (keeping process alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[OrgsLedger] Unhandled rejection:', reason);
});

const PORT = process.env.PORT || 3000;
const SITE_MODE = (process.env.SITE_MODE || 'api').toLowerCase();

console.log(`[OrgsLedger] Mode=${SITE_MODE}, PORT=${PORT}, Node=${process.version}`);
console.log(`[OrgsLedger] CWD=${process.cwd()}`);

if (SITE_MODE === 'landing') {
  // ── Landing Gateway (orgsledger.com) ──
  console.log('[OrgsLedger] Starting Landing Gateway...');
  try {
    process.chdir(path.join(__dirname, 'landing'));
    require(path.join(__dirname, 'landing', 'server.js'));
  } catch (err) {
    console.error('[OrgsLedger] Landing startup failed:', err);
    startFallbackServer('Landing startup failed: ' + err.message);
  }
} else {
  // ── API Server (test.orgsledger.com) ──
  console.log('[OrgsLedger] Starting API Server...');
  try {
    process.chdir(path.join(__dirname, 'apps', 'api'));
    try { require('dotenv').config(); } catch (e) { /* dotenv loaded via api deps */ }
    require(path.join(__dirname, 'apps', 'api', 'dist', 'index.js'));
    console.log('[OrgsLedger] API module loaded successfully');
  } catch (err) {
    console.error('[OrgsLedger] API startup failed:', err);
    startFallbackServer('API startup failed: ' + err.message);
  }
}

// ── Fallback diagnostic server — always responds to HTTP ──
function startFallbackServer(errorMsg) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      name: 'OrgsLedger',
      status: 'error',
      error: errorMsg,
      mode: SITE_MODE,
      node: process.version,
      cwd: process.cwd(),
      env: {
        DATABASE_URL: process.env.DATABASE_URL ? 'set' : 'NOT SET',
        JWT_SECRET: process.env.JWT_SECRET ? 'set' : 'NOT SET',
        PORT: process.env.PORT || 'not set (default 3000)',
      },
    }));
  });
  server.listen(PORT, () => {
    console.log(`[OrgsLedger] Fallback diagnostic server on port ${PORT}`);
  });
}
