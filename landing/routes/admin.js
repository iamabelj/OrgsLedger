// ============================================================
// Admin API Routes — Client Management & Usage Monitoring
// ============================================================

const express = require('express');
const crypto = require('crypto');

module.exports = function (pool) {
  const router = express.Router();

  // ── Dashboard Stats ─────────────────────────────────────
  router.get('/stats', async (req, res) => {
    try {
      const [clientsResult, usageResult, dailyResult, topClientsResult, hoursResult] = await Promise.all([
        // Client counts
        pool.query(`
          SELECT 
            COUNT(*) as total_clients,
            COUNT(*) FILTER (WHERE active = true) as active_clients,
            COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW())) as new_this_month
          FROM ai_clients
        `),
        // This month's usage totals
        pool.query(`
          SELECT 
            COALESCE(SUM(audio_seconds), 0) as total_audio_seconds,
            COALESCE(SUM(tokens_used), 0) as total_tokens,
            COALESCE(SUM(estimated_cost), 0) as total_cost,
            COUNT(*) as total_requests,
            COUNT(*) FILTER (WHERE status = 'success') as success_count,
            COUNT(*) FILTER (WHERE status = 'error') as error_count,
            COUNT(DISTINCT client_id) as active_users
          FROM ai_usage_logs
          WHERE created_at >= date_trunc('month', NOW())
        `),
        // Daily usage (last 30 days)
        pool.query(`
          SELECT 
            DATE(created_at) as date,
            COUNT(*) as requests,
            COALESCE(SUM(audio_seconds), 0) as audio_seconds,
            COALESCE(SUM(tokens_used), 0) as tokens,
            COALESCE(SUM(estimated_cost), 0) as cost,
            COUNT(*) FILTER (WHERE service = 'speech-to-text') as speech_requests,
            COUNT(*) FILTER (WHERE service = 'openai') as openai_requests
          FROM ai_usage_logs
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY DATE(created_at)
          ORDER BY date
        `),
        // Top clients by hours used
        pool.query(`
          SELECT 
            c.id, c.name, c.email, c.domain,
            c.hours_balance, c.hours_used,
            COUNT(l.id) as request_count,
            COALESCE(SUM(l.audio_seconds), 0) as audio_seconds,
            COALESCE(SUM(l.tokens_used), 0) as tokens_used,
            COALESCE(SUM(l.estimated_cost), 0) as total_cost
          FROM ai_clients c
          LEFT JOIN ai_usage_logs l ON c.id = l.client_id 
            AND l.created_at >= date_trunc('month', NOW())
          GROUP BY c.id, c.name, c.email, c.domain, c.hours_balance, c.hours_used
          ORDER BY c.hours_used DESC
          LIMIT 10
        `),
        // Total hours assigned / used across all clients
        pool.query(`
          SELECT 
            COALESCE(SUM(hours_balance), 0) as total_hours_assigned,
            COALESCE(SUM(hours_used), 0) as total_hours_used,
            COALESCE(SUM(hours_balance) - SUM(hours_used), 0) as total_hours_remaining
          FROM ai_clients
        `),
      ]);

      res.json({
        clients: clientsResult.rows[0],
        usage: usageResult.rows[0],
        daily: dailyResult.rows,
        topClients: topClientsResult.rows,
        hours: hoursResult.rows[0],
      });
    } catch (err) {
      console.error('Stats error:', err);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  // ── List Clients ────────────────────────────────────────
  router.get('/clients', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT 
          c.*,
          COALESCE(u.request_count, 0) as monthly_requests,
          COALESCE(u.audio_seconds, 0) as monthly_audio_seconds,
          COALESCE(u.tokens_used, 0) as monthly_tokens,
          COALESCE(u.total_cost, 0) as monthly_cost
        FROM ai_clients c
        LEFT JOIN (
          SELECT 
            client_id,
            COUNT(*) as request_count,
            SUM(audio_seconds) as audio_seconds,
            SUM(tokens_used) as tokens_used,
            SUM(estimated_cost) as total_cost
          FROM ai_usage_logs
          WHERE created_at >= date_trunc('month', NOW())
            AND status = 'success'
          GROUP BY client_id
        ) u ON c.id = u.client_id
        ORDER BY c.created_at DESC
      `);

      res.json({ clients: result.rows });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch clients' });
    }
  });

  // ── Create Client ───────────────────────────────────────
  router.post('/clients', async (req, res) => {
    try {
      const { name, email, domain, hours_balance, notes } = req.body;
      if (!name) return res.status(400).json({ error: 'Name is required' });

      const apiKey = 'ols_' + crypto.randomBytes(32).toString('hex');
      const licenseKey = 'OLS-' + crypto.randomBytes(4).toString('hex').toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();

      const result = await pool.query(`
        INSERT INTO ai_clients (name, email, domain, api_key, license_key, hours_balance, hours_used, notes)
        VALUES ($1, $2, $3, $4, $5, $6, 0, $7)
        RETURNING *
      `, [
        name,
        email || null,
        domain || null,
        apiKey,
        licenseKey,
        parseFloat(hours_balance) || 0,
        notes || null,
      ]);

      res.json({ client: result.rows[0] });
    } catch (err) {
      console.error('Create client error:', err);
      res.status(500).json({ error: 'Failed to create client' });
    }
  });

  // ── Update Client ───────────────────────────────────────
  router.put('/clients/:id', async (req, res) => {
    try {
      const { name, email, domain, active, hours_balance, notes } = req.body;

      const result = await pool.query(`
        UPDATE ai_clients SET
          name = COALESCE($2, name),
          email = COALESCE($3, email),
          domain = COALESCE($4, domain),
          active = COALESCE($5, active),
          hours_balance = COALESCE($6, hours_balance),
          notes = COALESCE($7, notes),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `, [req.params.id, name, email, domain, active, hours_balance != null ? parseFloat(hours_balance) : null, notes]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Client not found' });
      }

      res.json({ client: result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update client' });
    }
  });

  // ── Delete Client ───────────────────────────────────────
  router.delete('/clients/:id', async (req, res) => {
    try {
      await pool.query('DELETE FROM ai_clients WHERE id = $1', [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete client' });
    }
  });

  // ── Regenerate API Key ──────────────────────────────────
  router.post('/clients/:id/regenerate-key', async (req, res) => {
    try {
      const newKey = 'ols_' + crypto.randomBytes(32).toString('hex');
      const result = await pool.query(
        'UPDATE ai_clients SET api_key = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
        [req.params.id, newKey]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Client not found' });
      }

      res.json({ client: result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Failed to regenerate key' });
    }
  });

  // ── Toggle Client Active/Inactive ──────────────────────
  router.post('/clients/:id/toggle', async (req, res) => {
    try {
      const result = await pool.query(
        'UPDATE ai_clients SET active = NOT active, updated_at = NOW() WHERE id = $1 RETURNING *',
        [req.params.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Client not found' });
      }

      res.json({ client: result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Failed to toggle client' });
    }
  });

  // ── Usage Logs ──────────────────────────────────────────
  router.get('/logs', async (req, res) => {
    try {
      const { client_id, service, status, limit: lim, offset: off } = req.query;
      const limit = parseInt(lim) || 50;
      const offset = parseInt(off) || 0;

      let query = `
        SELECT l.*, c.name as client_name, c.email as client_email
        FROM ai_usage_logs l
        JOIN ai_clients c ON l.client_id = c.id
        WHERE 1=1
      `;
      const params = [];

      if (client_id) {
        params.push(client_id);
        query += ` AND l.client_id = $${params.length}`;
      }
      if (service) {
        params.push(service);
        query += ` AND l.service = $${params.length}`;
      }
      if (status) {
        params.push(status);
        query += ` AND l.status = $${params.length}`;
      }

      // Count total
      const countResult = await pool.query(
        query.replace('SELECT l.*, c.name as client_name, c.email as client_email', 'SELECT COUNT(*)'),
        params
      );
      const total = parseInt(countResult.rows[0].count);

      // Fetch page
      params.push(limit);
      query += ` ORDER BY l.created_at DESC LIMIT $${params.length}`;
      params.push(offset);
      query += ` OFFSET $${params.length}`;

      const result = await pool.query(query, params);

      res.json({
        logs: result.rows,
        total,
        limit,
        offset,
      });
    } catch (err) {
      console.error('Logs error:', err);
      res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  // ── Gift Hours to Client ────────────────────────────────
  router.post('/clients/:id/gift', async (req, res) => {
    try {
      const { hours, reason } = req.body;
      const hoursNum = parseFloat(hours);
      if (!hoursNum || hoursNum <= 0) {
        return res.status(400).json({ error: 'Hours must be a positive number' });
      }

      // Add hours to client balance
      const clientResult = await pool.query(
        'UPDATE ai_clients SET hours_balance = hours_balance + $2, updated_at = NOW() WHERE id = $1 RETURNING *',
        [req.params.id, hoursNum]
      );

      if (clientResult.rows.length === 0) {
        return res.status(404).json({ error: 'Client not found' });
      }

      // Log the gift
      await pool.query(
        'INSERT INTO ai_token_gifts (client_id, hours, reason) VALUES ($1, $2, $3)',
        [req.params.id, hoursNum, reason || 'Admin gift']
      );

      res.json({ 
        client: clientResult.rows[0],
        message: `Successfully gifted ${hoursNum} hour(s) to ${clientResult.rows[0].name}` 
      });
    } catch (err) {
      console.error('Gift hours error:', err);
      res.status(500).json({ error: 'Failed to gift hours' });
    }
  });

  // ── Gift History for a Client ───────────────────────────
  router.get('/clients/:id/gifts', async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT * FROM ai_token_gifts WHERE client_id = $1 ORDER BY gifted_at DESC LIMIT 50',
        [req.params.id]
      );
      res.json({ gifts: result.rows });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch gift history' });
    }
  });

  // ── Client Detail with Usage History ────────────────────
  router.get('/clients/:id/usage', async (req, res) => {
    try {
      const [clientResult, monthlyResult, recentLogs] = await Promise.all([
        pool.query('SELECT * FROM ai_clients WHERE id = $1', [req.params.id]),
        pool.query(`
          SELECT 
            DATE(created_at) as date,
            service,
            COUNT(*) as requests,
            COALESCE(SUM(audio_seconds), 0) as audio_seconds,
            COALESCE(SUM(tokens_used), 0) as tokens,
            COALESCE(SUM(estimated_cost), 0) as cost
          FROM ai_usage_logs
          WHERE client_id = $1 AND created_at >= date_trunc('month', NOW())
          GROUP BY DATE(created_at), service
          ORDER BY date
        `, [req.params.id]),
        pool.query(`
          SELECT * FROM ai_usage_logs
          WHERE client_id = $1
          ORDER BY created_at DESC
          LIMIT 20
        `, [req.params.id]),
      ]);

      if (clientResult.rows.length === 0) {
        return res.status(404).json({ error: 'Client not found' });
      }

      res.json({
        client: clientResult.rows[0],
        daily: monthlyResult.rows,
        recentLogs: recentLogs.rows,
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch client usage' });
    }
  });

  return router;
};
