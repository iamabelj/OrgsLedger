// OrgsLedger — Root entry point for Hostinger Express deployment
// This file bootstraps the API server from the monorepo root

const path = require('path');

// Set working directory to the API folder so relative paths
// (uploads, .env, etc.) resolve correctly from the API context
process.chdir(path.join(__dirname, 'apps', 'api'));

// Load environment variables from apps/api/.env if present
try { require('dotenv').config(); } catch (e) { /* dotenv loaded via api deps */ }

// Start the Express server (compiled TypeScript output)
require(path.join(__dirname, 'apps', 'api', 'dist', 'index.js'));
