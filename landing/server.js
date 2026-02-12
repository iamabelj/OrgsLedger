// ============================================================
// OrgsLedger AI Gateway — Main Server
// Serves: Landing page + Admin Dashboard + AI Proxy
// ============================================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();

// ── Config ────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.GATEWAY_JWT_SECRET || process.env.JWT_SECRET || 'gateway-secret-change-me';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@orgsledger.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'SuperAdmin123!';

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

// ── Database ──────────────────────────────────────────────
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

// ── Middleware ─────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// ── Database Initialization ───────────────────────────────
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_clients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        api_key VARCHAR(255) UNIQUE NOT NULL,
        plan VARCHAR(50) DEFAULT 'standard',
        active BOOLEAN DEFAULT true,
        monthly_quota_minutes INTEGER DEFAULT 120,
        monthly_quota_tokens INTEGER DEFAULT 500000,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ai_usage_logs (
        id SERIAL PRIMARY KEY,
        client_id UUID REFERENCES ai_clients(id) ON DELETE CASCADE,
        service VARCHAR(50) NOT NULL,
        endpoint VARCHAR(100),
        audio_seconds INTEGER DEFAULT 0,
        tokens_used INTEGER DEFAULT 0,
        estimated_cost DECIMAL(10,6) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'success',
        error_message TEXT,
        ip_address VARCHAR(45),
        request_metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_ai_usage_client ON ai_usage_logs(client_id);
      CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_ai_usage_service ON ai_usage_logs(service);
    `);
    console.log('✓ AI Gateway tables initialized');
  } catch (err) {
    console.error('Failed to initialize database tables:', err.message);
  } finally {
    client.release();
  }
}

// ── Auth Middleware (Admin) ────────────────────────────────
function adminAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'gateway_admin') {
      return res.status(403).json({ error: 'Not authorized' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Auth Middleware (API Key for clients) ──────────────────
async function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API key required' });

  try {
    const result = await pool.query(
      'SELECT * FROM ai_clients WHERE api_key = $1',
      [apiKey]
    );
    const client = result.rows[0];
    if (!client) return res.status(401).json({ error: 'Invalid API key' });
    if (!client.active) return res.status(403).json({ error: 'Client is disabled' });

    // Check monthly quota
    const usageResult = await pool.query(`
      SELECT 
        COALESCE(SUM(audio_seconds), 0) as total_audio_seconds,
        COALESCE(SUM(tokens_used), 0) as total_tokens
      FROM ai_usage_logs
      WHERE client_id = $1 
        AND created_at >= date_trunc('month', NOW())
        AND status = 'success'
    `, [client.id]);

    const usage = usageResult.rows[0];
    const audioMinutesUsed = Math.ceil(usage.total_audio_seconds / 60);

    if (audioMinutesUsed >= client.monthly_quota_minutes) {
      return res.status(429).json({ error: 'Monthly audio minutes quota exceeded' });
    }
    if (parseInt(usage.total_tokens) >= client.monthly_quota_tokens) {
      return res.status(429).json({ error: 'Monthly token quota exceeded' });
    }

    req.client = client;
    req.clientUsage = {
      audioMinutesUsed,
      tokensUsed: parseInt(usage.total_tokens),
    };
    next();
  } catch (err) {
    console.error('API key auth error:', err);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

// ── Static Files ──────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ── Admin Auth Endpoint ───────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { email, role: 'gateway_admin' },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({ token, email });
});

// ── Admin API Routes ──────────────────────────────────────
const adminRouter = require('./routes/admin');
app.use('/api/admin', adminAuth, adminRouter(pool));

// ── AI Proxy Routes ───────────────────────────────────────
const aiProxyRouter = require('./routes/ai-proxy');
app.use('/api/ai', apiKeyAuth, aiProxyRouter(pool));

// ── Health Check ──────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'orgsledger-gateway', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ status: 'error', message: 'Database connection failed' });
  }
});

// ── Start Server ──────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  OrgsLedger AI Gateway running on port ${PORT}`);
    console.log(`  Landing:    http://localhost:${PORT}`);
    console.log(`  Admin:      http://localhost:${PORT}/admin`);
    console.log(`  AI Proxy:   http://localhost:${PORT}/api/ai/*`);
    console.log(`  Health:     http://localhost:${PORT}/health\n`);
  });
});

module.exports = app;
