// ============================================================
// OrgsLedger AI Gateway — Main Server
// Serves: Landing page + Admin Dashboard + AI Proxy
// ============================================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const axios = require('axios');
require('dotenv').config();

const app = express();

// ── Config ────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.GATEWAY_JWT_SECRET || process.env.JWT_SECRET || 'gateway-secret-change-me';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@orgsledger.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'SuperAdmin123!';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';
const FLUTTERWAVE_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY || '';
const FLUTTERWAVE_PUBLIC_KEY = process.env.FLUTTERWAVE_PUBLIC_KEY || '';
const RATE_NGN_PER_USD = 1500;

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
    // Migrate: add new columns if table already exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_clients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        domain VARCHAR(255),
        email VARCHAR(255),
        api_key VARCHAR(255) UNIQUE NOT NULL,
        license_key VARCHAR(255) UNIQUE,
        active BOOLEAN DEFAULT true,
        hours_balance DECIMAL(10,2) DEFAULT 0,
        hours_used DECIMAL(10,2) DEFAULT 0,
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
        hours_deducted DECIMAL(10,4) DEFAULT 0,
        estimated_cost DECIMAL(10,6) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'success',
        error_message TEXT,
        ip_address VARCHAR(45),
        request_metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ai_token_gifts (
        id SERIAL PRIMARY KEY,
        client_id UUID REFERENCES ai_clients(id) ON DELETE CASCADE,
        hours DECIMAL(10,2) NOT NULL,
        reason VARCHAR(500),
        gifted_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_ai_usage_client ON ai_usage_logs(client_id);
      CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_logs(created_at);
      CREATE INDEX IF NOT EXISTS idx_ai_usage_service ON ai_usage_logs(service);
      CREATE INDEX IF NOT EXISTS idx_ai_gifts_client ON ai_token_gifts(client_id);

      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_email VARCHAR(255),
        customer_name VARCHAR(255),
        items JSONB NOT NULL DEFAULT '[]',
        currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
        amount DECIMAL(12,2) NOT NULL,
        gateway VARCHAR(50),
        gateway_reference VARCHAR(255),
        status VARCHAR(20) DEFAULT 'pending',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(customer_email);
    `);

    // Safe migration: add columns if they don't exist (for existing tables)
    const migrations = [
      `ALTER TABLE ai_clients ADD COLUMN IF NOT EXISTS domain VARCHAR(255)`,
      `ALTER TABLE ai_clients ADD COLUMN IF NOT EXISTS license_key VARCHAR(255) UNIQUE`,
      `ALTER TABLE ai_clients ADD COLUMN IF NOT EXISTS hours_balance DECIMAL(10,2) DEFAULT 0`,
      `ALTER TABLE ai_clients ADD COLUMN IF NOT EXISTS hours_used DECIMAL(10,2) DEFAULT 0`,
      `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS hours_deducted DECIMAL(10,4) DEFAULT 0`,
    ];
    for (const sql of migrations) {
      await client.query(sql).catch(() => {}); // ignore if column exists
    }
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

    // Check hours balance
    const remaining = parseFloat(client.hours_balance) - parseFloat(client.hours_used);
    if (remaining <= 0) {
      return res.status(429).json({ 
        error: 'No AI hours remaining. Contact your provider for more hours.',
        hoursBalance: parseFloat(client.hours_balance),
        hoursUsed: parseFloat(client.hours_used),
      });
    }

    req.client = client;
    req.clientUsage = {
      hoursRemaining: remaining,
      hoursBalance: parseFloat(client.hours_balance),
      hoursUsed: parseFloat(client.hours_used),
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
// ── License Verification (public) ────────────────────────
app.post('/api/license/verify', async (req, res) => {
  const { license_key } = req.body;
  if (!license_key) {
    return res.status(400).json({ valid: false, error: 'License key is required' });
  }
  try {
    const result = await pool.query(
      'SELECT id, name, domain, email, active, hours_balance, hours_used FROM ai_clients WHERE license_key = $1',
      [license_key]
    );
    const client = result.rows[0];
    if (!client) {
      return res.status(404).json({ valid: false, error: 'Invalid license key' });
    }
    if (!client.active) {
      return res.status(403).json({ valid: false, error: 'License has been deactivated' });
    }
    res.json({
      valid: true,
      client: {
        name: client.name,
        domain: client.domain,
        email: client.email,
        hoursBalance: parseFloat(client.hours_balance),
        hoursUsed: parseFloat(client.hours_used),
        hoursRemaining: parseFloat(client.hours_balance) - parseFloat(client.hours_used),
      },
    });
  } catch (err) {
    console.error('License verify error:', err);
    res.status(500).json({ valid: false, error: 'Verification failed' });
  }
});
// ── AI Proxy Routes ───────────────────────────────────────
const aiProxyRouter = require('./routes/ai-proxy');
app.use('/api/ai', apiKeyAuth, aiProxyRouter(pool));

// ── Geo Detection (for currency auto-switch) ─────────────
app.get('/api/geo', async (req, res) => {
  try {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? String(forwarded).split(',')[0].trim() : req.socket.remoteAddress;
    // Use free ip-api.com service
    const { data } = await axios.get(`http://ip-api.com/json/${ip}?fields=countryCode`, { timeout: 3000 });
    res.json({ countryCode: data.countryCode || 'US', rate: RATE_NGN_PER_USD });
  } catch {
    res.json({ countryCode: 'NG', rate: RATE_NGN_PER_USD }); // default to Nigeria
  }
});

// ── Checkout: Paystack (NGN) ──────────────────────────────
app.post('/api/checkout/paystack', async (req, res) => {
  try {
    const { email, name, items, amount, metadata } = req.body;
    if (!email || !items || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create order
    const orderResult = await pool.query(
      `INSERT INTO orders (customer_email, customer_name, items, currency, amount, gateway, metadata)
       VALUES ($1, $2, $3, 'NGN', $4, 'paystack', $5) RETURNING *`,
      [email, name || '', JSON.stringify(items), amount, JSON.stringify(metadata || {})]
    );
    const order = orderResult.rows[0];

    if (!PAYSTACK_SECRET_KEY) {
      // Dev mode: mark as completed
      await pool.query(`UPDATE orders SET status = 'completed' WHERE id = $1`, [order.id]);
      return res.json({ success: true, orderId: order.id, status: 'completed', note: 'Dev mode — Paystack not configured' });
    }

    const reference = `ols_${order.id.replace(/-/g, '').slice(0, 16)}`;
    const paystackRes = await axios.post('https://api.paystack.co/transaction/initialize', {
      email,
      amount: Math.round(amount * 100), // kobo
      currency: 'NGN',
      reference,
      metadata: { orderId: order.id, items, customerName: name },
      callback_url: `${req.protocol}://${req.get('host')}/api/checkout/verify/paystack?reference=${reference}`,
    }, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    });

    await pool.query(`UPDATE orders SET gateway_reference = $1 WHERE id = $2`, [reference, order.id]);

    res.json({
      success: true,
      orderId: order.id,
      authorizationUrl: paystackRes.data.data.authorization_url,
      reference,
    });
  } catch (err) {
    console.error('Paystack checkout error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Payment initialization failed' });
  }
});

// ── Checkout: Stripe (USD) ────────────────────────────────
app.post('/api/checkout/stripe', async (req, res) => {
  try {
    const { email, name, items, amount, metadata } = req.body;
    if (!email || !items || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const orderResult = await pool.query(
      `INSERT INTO orders (customer_email, customer_name, items, currency, amount, gateway, metadata)
       VALUES ($1, $2, $3, 'USD', $4, 'stripe', $5) RETURNING *`,
      [email, name || '', JSON.stringify(items), amount, JSON.stringify(metadata || {})]
    );
    const order = orderResult.rows[0];

    if (!STRIPE_SECRET_KEY) {
      await pool.query(`UPDATE orders SET status = 'completed' WHERE id = $1`, [order.id]);
      return res.json({ success: true, orderId: order.id, status: 'completed', note: 'Dev mode — Stripe not configured' });
    }

    const stripe = require('stripe')(STRIPE_SECRET_KEY);
    const lineItems = items.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: { name: item.name },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: 1,
    }));

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      line_items: lineItems,
      metadata: { orderId: order.id },
      success_url: `${req.protocol}://${req.get('host')}/?checkout=success&orderId=${order.id}`,
      cancel_url: `${req.protocol}://${req.get('host')}/?checkout=cancelled`,
    });

    await pool.query(`UPDATE orders SET gateway_reference = $1 WHERE id = $2`, [session.id, order.id]);

    res.json({
      success: true,
      orderId: order.id,
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ error: 'Payment initialization failed' });
  }
});

// ── Verify Paystack Payment (redirect callback) ──────────
app.get('/api/checkout/verify/paystack', async (req, res) => {
  try {
    const reference = req.query.reference;
    if (!reference) return res.redirect('/?checkout=error');

    if (PAYSTACK_SECRET_KEY) {
      const verifyRes = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
        headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
      });
      if (verifyRes.data.data.status === 'success') {
        await pool.query(`UPDATE orders SET status = 'completed', updated_at = NOW() WHERE gateway_reference = $1`, [reference]);
      }
    }
    res.redirect('/?checkout=success');
  } catch (err) {
    console.error('Paystack verify error:', err.message);
    res.redirect('/?checkout=error');
  }
});

// ── Stripe Webhook ────────────────────────────────────────
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    if (!STRIPE_SECRET_KEY) return res.json({ received: true });
    const stripe = require('stripe')(STRIPE_SECRET_KEY);
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const orderId = session.metadata?.orderId;
      if (orderId) {
        await pool.query(`UPDATE orders SET status = 'completed', updated_at = NOW() WHERE id = $1`, [orderId]);
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe webhook error:', err.message);
    res.status(500).send('Webhook failed');
  }
});

// ── AI Hours Purchase (from admin dashboard) ─────────────
app.post('/api/admin/purchase-hours', adminAuth, async (req, res) => {
  try {
    const { clientId, hours, gateway, email, amount, currency } = req.body;
    if (!clientId || !hours || hours <= 0) {
      return res.status(400).json({ error: 'Client ID and hours required' });
    }

    // Add hours to client
    await pool.query(
      `UPDATE ai_clients SET hours_balance = hours_balance + $1, updated_at = NOW() WHERE id = $2`,
      [hours, clientId]
    );

    // Log the gift/purchase
    await pool.query(
      `INSERT INTO ai_token_gifts (client_id, hours, reason) VALUES ($1, $2, $3)`,
      [clientId, hours, `Purchased ${hours}h (${currency || 'NGN'} ${amount || 0})`]
    );

    const result = await pool.query('SELECT * FROM ai_clients WHERE id = $1', [clientId]);
    res.json({ success: true, client: result.rows[0] });
  } catch (err) {
    console.error('Purchase hours error:', err.message);
    res.status(500).json({ error: 'Failed to add hours' });
  }
});

// ── Admin: List Orders ────────────────────────────────────
app.get('/api/admin/orders', adminAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100');
    res.json({ orders: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

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
  // Only auto-listen when running standalone (not loaded by combined app.js)
  if (!process.env.NO_LISTEN) {
    app.listen(PORT, () => {
      console.log(`\n  OrgsLedger AI Gateway running on port ${PORT}`);
      console.log(`  Landing:    http://localhost:${PORT}`);
      console.log(`  Admin:      http://localhost:${PORT}/admin`);
      console.log(`  AI Proxy:   http://localhost:${PORT}/api/ai/*`);
      console.log(`  Health:     http://localhost:${PORT}/health\n`);
    });
  } else {
    console.log('[Landing] Loaded in combined mode (no auto-listen)');
  }
});

module.exports = app;
