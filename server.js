// OrgsLedger — Root entry point
// CRITICAL: Binds the port FIRST, then loads the API.
// This prevents Hostinger 503s when the API module is slow to load.

// Load production defaults FIRST — before any module reads process.env
require('./env');

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
console.log('[OrgsLedger] Starting... PORT=' + PORT + ', Node=' + process.version);
console.log('[OrgsLedger] CWD=' + process.cwd());

// ── Step 1: Create an HTTP server and bind the port IMMEDIATELY ──
// Hostinger's reverse proxy needs something on the port to avoid 503.
// While the API loads, requests get a 503 JSON response (not HTML).
const server = http.createServer(function (req, res) {
  // Temporary handler — replaced once the API loads
  res.writeHead(503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: 'Server is starting up, please retry in a few seconds' }));
});

// Make the server available globally so index.ts can attach to it
global.__orgsServer = server;

server.listen(PORT, '0.0.0.0', function () {
  console.log('[OrgsLedger] Port ' + PORT + ' bound — loading API...');

  // ── Step 2: Load the API module ──
  process.chdir(path.join(__dirname, 'apps', 'api'));
  try { require('dotenv').config(); } catch (e) {}

  try {
    const apiModule = require(path.resolve(__dirname, 'apps', 'api', 'dist', 'index'));
    console.log('[OrgsLedger] API loaded successfully');

    // The API module exports { app }. Replace the server's request handler
    // so all HTTP requests go through Express (Socket.IO registered its own
    // upgrade listener on the server in setupSocketIO, so that still works).
    if (apiModule.app) {
      server.removeAllListeners('request');
      server.on('request', apiModule.app);
      console.log('[OrgsLedger] Live traffic routed to API');
    }
  } catch (err) {
    console.error('[OrgsLedger] API startup failed:', err);

    // Replace handler with diagnostic
    server.removeAllListeners('request');
    server.on('request', function (req, res) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'OrgsLedger',
        status: 'error',
        error: err.message,
        stack: (err.stack || '').split('\n').slice(0, 5),
        node: process.version,
        cwd: process.cwd(),
        env: {
          DATABASE_URL: process.env.DATABASE_URL ? 'set' : 'NOT SET',
          JWT_SECRET: process.env.JWT_SECRET ? 'set' : 'NOT SET',
          PORT: process.env.PORT || 'not set (default 3000)',
        },
      }));
    });
  }
});
