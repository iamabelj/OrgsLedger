// OrgsLedger — Root entry point
// Loads environment defaults, then starts the API server.
// The API server handles everything:
//   • Client app (Expo web frontend + API routes)
//   • Developer gateway (mounted at /developer)

// Load production defaults FIRST — before any module reads process.env
require('./env');

const path = require('path');

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

// Set CWD to API directory for correct file resolution
process.chdir(path.join(__dirname, 'apps', 'api'));

// Load dotenv for any local .env file
try { require('dotenv').config(); } catch (e) {}

// Load the API server — it handles everything including developer gateway
try {
  require(path.resolve(__dirname, 'apps', 'api', 'dist', 'index'));
  console.log('[OrgsLedger] API server module loaded');
} catch (err) {
  console.error('[OrgsLedger] API startup failed:', err);

  // Fallback diagnostic server
  const http = require('http');
  const server = http.createServer(function(req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      name: 'OrgsLedger',
      status: 'error',
      error: err.message,
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
