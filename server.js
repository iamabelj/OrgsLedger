// OrgsLedger — Root entry point
// Combined server: routes by hostname
//   orgsledger.com       → Landing/Gateway (admin panel, AI proxy, license API)
//   test.orgsledger.com  → Client App (API + Expo web frontend)
//   localhost             → Client App (development)
//
// NOTE: All require() calls use static strings so Metro bundler can parse this
// file without errors (Metro watches the monorepo root for shared packages).

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
const SITE_MODE = (process.env.SITE_MODE || '').toLowerCase();

console.log('[OrgsLedger] Mode=' + (SITE_MODE || 'combined') + ', PORT=' + PORT + ', Node=' + process.version);
console.log('[OrgsLedger] CWD=' + process.cwd());

// ── Helper: check if hostname is the main/landing domain ──
function isLandingHost(host) {
  if (!host) return false;
  return (host === 'orgsledger.com' || host === 'www.orgsledger.com' ||
          host.startsWith('orgsledger.com:') || host.startsWith('www.orgsledger.com:'));
}

// ── Helper: safe require with path ──
function loadModule(relPath) {
  return require(path.resolve(__dirname, relPath));
}

// ── Mode: Landing Only ──
if (SITE_MODE === 'landing') {
  console.log('[OrgsLedger] Starting Landing Gateway (standalone)...');
  try {
    process.chdir(path.join(__dirname, 'landing'));
    loadModule('landing/server');
  } catch (err) {
    console.error('[OrgsLedger] Landing startup failed:', err);
    startFallbackServer('Landing startup failed: ' + err.message);
  }
}
// ── Mode: API Only ──
else if (SITE_MODE === 'api') {
  console.log('[OrgsLedger] Starting API Server (standalone)...');
  try {
    process.chdir(path.join(__dirname, 'apps', 'api'));
    try { require('dotenv').config(); } catch (e) {}
    loadModule('apps/api/dist/index');
    console.log('[OrgsLedger] API module loaded successfully');
  } catch (err) {
    console.error('[OrgsLedger] API startup failed:', err);
    startFallbackServer('API startup failed: ' + err.message);
  }
}
// ── Mode: Combined (default) — route by hostname ──
else {
  console.log('[OrgsLedger] Starting Combined Server (hostname routing)...');
  process.env.NO_LISTEN = 'true';

  var landingApp = null;
  var apiApp = null;
  var apiServer = null;

  // Load Landing app
  try {
    process.chdir(path.join(__dirname, 'landing'));
    landingApp = loadModule('landing/server');
    console.log('[OrgsLedger] Landing app loaded');
  } catch (err) {
    console.error('[OrgsLedger] Failed to load landing app:', err.message);
  }

  // Load API app
  try {
    process.chdir(path.join(__dirname, 'apps', 'api'));
    try { require('dotenv').config(); } catch (e) {}
    var apiModule = loadModule('apps/api/dist/index');
    apiApp = apiModule.app;
    apiServer = apiModule.server;
    console.log('[OrgsLedger] API app loaded');
  } catch (err) {
    console.error('[OrgsLedger] Failed to load API app:', err.message);
  }

  if (!apiApp && !landingApp) {
    startFallbackServer('Both apps failed to load');
  } else if (apiServer) {
    apiServer.removeAllListeners('request');
    apiServer.on('request', function(req, res) {
      var host = (req.headers.host || '').toLowerCase();
      if (landingApp && isLandingHost(host)) {
        landingApp(req, res);
      } else if (apiApp) {
        apiApp(req, res);
      } else {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Service unavailable' }));
      }
    });

    apiServer.listen(PORT, '0.0.0.0', function() {
      console.log('\n  OrgsLedger Combined Server on port ' + PORT);
      console.log('  orgsledger.com      -> Landing/Gateway Admin');
      console.log('  test.orgsledger.com -> Client App/API');
      console.log('  localhost:' + PORT + '       -> Client App/API\n');
    });
  } else {
    if (landingApp) {
      var srv = http.createServer(landingApp);
      srv.listen(PORT, function() {
        console.log('[OrgsLedger] Landing-only fallback on port ' + PORT);
      });
    } else {
      startFallbackServer('No apps loaded successfully');
    }
  }
}

// ── Fallback diagnostic server ──
function startFallbackServer(errorMsg) {
  var server = http.createServer(function(req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      name: 'OrgsLedger',
      status: 'error',
      error: errorMsg,
      mode: SITE_MODE || 'combined',
      node: process.version,
      cwd: process.cwd(),
      env: {
        DATABASE_URL: process.env.DATABASE_URL ? 'set' : 'NOT SET',
        JWT_SECRET: process.env.JWT_SECRET ? 'set' : 'NOT SET',
        PORT: process.env.PORT || 'not set (default 3000)',
      },
    }));
  });
  server.listen(PORT, function() {
    console.log('[OrgsLedger] Fallback diagnostic server on port ' + PORT);
  });
}
