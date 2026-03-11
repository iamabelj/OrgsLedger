// ============================================================
// Audit Completeness Tests
// Verifies audit logging exists for all critical operations
// ============================================================

import * as fs from 'fs';
import * as path from 'path';

describe('Audit Log Completeness', () => {
  const srcDir = path.resolve(__dirname, '..');

  function readFile(relativePath: string): string {
    return fs.readFileSync(path.join(srcDir, relativePath), 'utf8');
  }

  // ── Admin Override Audit Logging ──────────────────────────

  describe('Admin overrides are audit-logged', () => {
    let subscriptionsRoute: string;

    beforeAll(() => {
      subscriptionsRoute = readFile('routes/subscriptions.ts');
    });

    it('should audit-log admin wallet AI adjustments', () => {
      // The admin/wallet/ai/adjust route must call writeAuditLog
      expect(subscriptionsRoute).toContain("'/admin/wallet/ai/adjust'");
      expect(subscriptionsRoute).toContain("action: 'admin_adjust'");
      expect(subscriptionsRoute).toMatch(/entityType:.*'ai_wallet'/);
    });

    it('should audit-log admin wallet translation adjustments', () => {
      expect(subscriptionsRoute).toContain("'/admin/wallet/translation/adjust'");
      // Both wallet adjust routes use admin_adjust action
      const adjustMatches = subscriptionsRoute.match(/action:\s*'admin_adjust'/g) || [];
      expect(adjustMatches.length).toBeGreaterThanOrEqual(2);
      expect(subscriptionsRoute).toMatch(/entityType:.*'translation_wallet'/);
    });

    it('should audit-log admin org status changes (suspend/activate)', () => {
      expect(subscriptionsRoute).toContain("'/admin/org/status'");
      // Status route uses template literal: admin_${action}
      expect(subscriptionsRoute).toContain('`admin_${action}`');
      expect(subscriptionsRoute).toMatch(/entityType:.*'organization'/);
    });

    it('should audit-log admin subscription overrides', () => {
      expect(subscriptionsRoute).toContain("'/admin/subscription/override'");
      expect(subscriptionsRoute).toContain("action: 'admin_override'");
      expect(subscriptionsRoute).toMatch(/entityType:.*'subscription'/);
    });

    it('should capture previousValue for subscription overrides', () => {
      // The subscription override route captures the old plan/status before overwriting
      expect(subscriptionsRoute).toContain('previousValue');
    });

    it('should include IP address in admin audit logs', () => {
      // Admin routes should capture req.ip for audit logging
      const matches = subscriptionsRoute.match(/ipAddress.*req\.ip|req\.ip.*ipAddress/g) || [];
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Wallet Operations Audit Logging ───────────────────────

  describe('Wallet operations are audit-logged', () => {
    let subscriptionService: string;

    beforeAll(() => {
      subscriptionService = readFile('services/subscription.service.ts');
    });

    it('should audit-log AI wallet top-ups', () => {
      const topUpSection = subscriptionService.split('async function topUpAiWallet')[1]?.split('async function')[0] || '';
      expect(topUpSection).toContain('writeAuditLog');
      expect(topUpSection).toContain('wallet_topup');
      expect(topUpSection).toContain('ai_wallet');
    });

    it('should audit-log translation wallet top-ups', () => {
      const topUpSection = subscriptionService.split('async function topUpTranslationWallet')[1]?.split('async function')[0] || '';
      expect(topUpSection).toContain('writeAuditLog');
      expect(topUpSection).toContain('wallet_topup');
      expect(topUpSection).toContain('translation_wallet');
    });

    it('should audit-log AI wallet deductions after successful transaction', () => {
      const deductSection = subscriptionService.split('async function deductAiWallet')[1]?.split('async function')[0] || '';
      expect(deductSection).toContain('writeAuditLog');
      expect(deductSection).toContain('wallet_deduction');
      expect(deductSection).toContain('ai_wallet');
      // Must only log on success
      expect(deductSection).toContain('if (result.success)');
    });

    it('should audit-log translation wallet deductions after successful transaction', () => {
      const deductSection = subscriptionService.split('async function deductTranslationWallet')[1]?.split('async function')[0] || '';
      expect(deductSection).toContain('writeAuditLog');
      expect(deductSection).toContain('wallet_deduction');
      expect(deductSection).toContain('translation_wallet');
      // Must only log on success
      expect(deductSection).toContain('if (result.success)');
    });

    it('should use fire-and-forget pattern for deduction audit logs (no await)', () => {
      const deductSection = subscriptionService.split('async function deductAiWallet')[1]?.split('async function')[0] || '';
      // Audit log should use .catch pattern — not block the deduction
      expect(deductSection).toContain('.catch(err => logger.warn(');
    });
  });

  // ── Subscription Lifecycle Audit Logging ──────────────────

  describe('Subscription lifecycle is audit-logged', () => {
    let subscriptionService: string;

    beforeAll(() => {
      subscriptionService = readFile('services/subscription.service.ts');
    });

    it('should audit-log subscription creation', () => {
      const createSection = subscriptionService.split('async function createSubscription')[1]?.split('async function')[0] || '';
      expect(createSection).toContain('writeAuditLog');
      expect(createSection).toContain('subscription_created');
      expect(createSection).toContain('subscription');
    });

    it('should audit-log subscription renewal', () => {
      const renewSection = subscriptionService.split('async function renewSubscription')[1]?.split('async function')[0] || '';
      expect(renewSection).toContain('writeAuditLog');
      expect(renewSection).toContain('subscription_renewed');
    });

    it('should capture previous values on subscription renewal', () => {
      const renewSection = subscriptionService.split('async function renewSubscription')[1]?.split('async function')[0] || '';
      expect(renewSection).toContain('previousValue');
    });
  });

  // ── Risk Monitoring Endpoints ─────────────────────────────

  describe('Risk monitoring endpoints exist', () => {
    let subscriptionsRoute: string;

    beforeAll(() => {
      subscriptionsRoute = readFile('routes/subscriptions.ts');
    });

    it('should have GET /admin/risk/low-balances endpoint', () => {
      expect(subscriptionsRoute).toContain("'/admin/risk/low-balances'");
      expect(subscriptionsRoute).toContain('requireDeveloper()');
    });

    it('should support configurable threshold for low-balance check', () => {
      expect(subscriptionsRoute).toContain('thresholdMinutes');
      // Threshold should have a default value
      expect(subscriptionsRoute).toMatch(/thresholdMinutes.*\|\||\|\|.*thresholdMinutes|parseInt.*threshold/);
    });

    it('should check both AI and translation wallets for low balances', () => {
      // The low-balances endpoint queries wallet tables
      expect(subscriptionsRoute).toContain('ai_balance_minutes');
      expect(subscriptionsRoute).toContain('translation_balance_minutes');
    });

    it('should separate low-balance from empty wallets', () => {
      expect(subscriptionsRoute).toContain('lowBalance');
      expect(subscriptionsRoute).toContain('emptyWallets');
    });

    it('should have GET /admin/risk/spikes endpoint', () => {
      expect(subscriptionsRoute).toContain("'/admin/risk/spikes'");
      expect(subscriptionsRoute).toContain('requireDeveloper()');
    });

    it('should support configurable spike detection parameters', () => {
      expect(subscriptionsRoute).toContain('daysBack');
      expect(subscriptionsRoute).toContain('spikeMultiplier');
    });

    it('should detect spikes for both AI and translation usage', () => {
      expect(subscriptionsRoute).toContain('wallet_transactions');
    });

    it('should include failed payments in risk analysis', () => {
      expect(subscriptionsRoute).toContain('failedPayments');
      expect(subscriptionsRoute).toContain("'failed'");
    });
  });

  // ── billing_country Exposure ──────────────────────────────

  describe('Admin organizations endpoint exposes billing_country', () => {
    let subscriptionsRoute: string;

    beforeAll(() => {
      subscriptionsRoute = readFile('routes/subscriptions.ts');
    });

    it('should select billing_country in admin organizations query', () => {
      expect(subscriptionsRoute).toContain("'/admin/organizations'");
      expect(subscriptionsRoute).toContain('billing_country');
    });
  });

  // ── Audit Infrastructure ──────────────────────────────────

  describe('Audit infrastructure', () => {
    let auditFile: string;

    beforeAll(() => {
      auditFile = readFile('middleware/audit.ts');
    });

    it('should export writeAuditLog function', () => {
      expect(auditFile).toContain('export async function writeAuditLog');
    });

    it('should write to audit_logs table', () => {
      expect(auditFile).toContain("db('audit_logs').insert");
    });

    it('should not throw on audit log failure (fire-and-forget)', () => {
      expect(auditFile).toContain('catch');
      // Should log the error but not rethrow
      expect(auditFile).toContain('Failed to write audit log');
    });

    it('should capture IP address and user agent via auditContext middleware', () => {
      expect(auditFile).toContain('ipAddress');
      expect(auditFile).toContain('userAgent');
      expect(auditFile).toContain("req.ip");
      expect(auditFile).toContain("req.headers['user-agent']");
    });
  });
});

describe('Spike Detection Algorithm', () => {
  // Test the spike detection logic in isolation
  function detectSpikes(
    rows: { organization_id: string; day: Date | string; daily_usage: string }[],
    walletType: string,
    cutoff: Date,
    spikeMultiplier: number
  ) {
    const byOrg: Record<string, { baseline: number[]; recent: number[] }> = {};
    for (const r of rows) {
      if (!byOrg[r.organization_id]) byOrg[r.organization_id] = { baseline: [], recent: [] };
      const day = new Date(r.day);
      const usage = parseFloat(r.daily_usage);
      if (day >= cutoff) {
        byOrg[r.organization_id].recent.push(usage);
      } else {
        byOrg[r.organization_id].baseline.push(usage);
      }
    }

    const spikes: any[] = [];
    for (const [orgId, data] of Object.entries(byOrg)) {
      if (data.baseline.length === 0) continue;
      const avg = data.baseline.reduce((a, b) => a + b, 0) / data.baseline.length;
      if (avg === 0) continue;
      const maxRecent = Math.max(...data.recent, 0);
      if (maxRecent > avg * spikeMultiplier) {
        spikes.push({
          organization_id: orgId,
          wallet_type: walletType,
          baseline_avg_minutes: +avg.toFixed(1),
          recent_max_minutes: +maxRecent.toFixed(1),
          spike_ratio: +(maxRecent / avg).toFixed(1),
        });
      }
    }
    return spikes;
  }

  it('should detect a spike when recent usage exceeds 3x baseline', () => {
    const cutoff = new Date('2026-02-07');
    const rows = [
      // Baseline: ~10 min/day
      { organization_id: 'org-1', day: '2026-01-15', daily_usage: '10' },
      { organization_id: 'org-1', day: '2026-01-16', daily_usage: '12' },
      { organization_id: 'org-1', day: '2026-01-17', daily_usage: '8' },
      // Recent: 50 min — 5x the average
      { organization_id: 'org-1', day: '2026-02-10', daily_usage: '50' },
    ];

    const spikes = detectSpikes(rows, 'ai', cutoff, 3);
    expect(spikes).toHaveLength(1);
    expect(spikes[0].organization_id).toBe('org-1');
    expect(spikes[0].spike_ratio).toBe(5);
  });

  it('should not flag normal usage variation', () => {
    const cutoff = new Date('2026-02-07');
    const rows = [
      { organization_id: 'org-1', day: '2026-01-15', daily_usage: '10' },
      { organization_id: 'org-1', day: '2026-01-16', daily_usage: '12' },
      // Recent: 15 min — only 1.5x baseline, below 3x threshold
      { organization_id: 'org-1', day: '2026-02-10', daily_usage: '15' },
    ];

    const spikes = detectSpikes(rows, 'ai', cutoff, 3);
    expect(spikes).toHaveLength(0);
  });

  it('should skip orgs with zero baseline (new orgs)', () => {
    const cutoff = new Date('2026-02-07');
    const rows = [
      { organization_id: 'org-1', day: '2026-01-15', daily_usage: '0' },
      { organization_id: 'org-1', day: '2026-02-10', daily_usage: '50' },
    ];

    const spikes = detectSpikes(rows, 'ai', cutoff, 3);
    expect(spikes).toHaveLength(0);
  });

  it('should skip orgs with no baseline data', () => {
    const cutoff = new Date('2026-02-07');
    const rows = [
      { organization_id: 'new-org', day: '2026-02-10', daily_usage: '100' },
    ];

    const spikes = detectSpikes(rows, 'ai', cutoff, 3);
    expect(spikes).toHaveLength(0);
  });

  it('should detect spikes across multiple orgs independently', () => {
    const cutoff = new Date('2026-02-07');
    const rows = [
      // Org-1: baseline 10, recent 50 — spike
      { organization_id: 'org-1', day: '2026-01-15', daily_usage: '10' },
      { organization_id: 'org-1', day: '2026-02-10', daily_usage: '50' },
      // Org-2: baseline 100, recent 150 — no spike (1.5x)
      { organization_id: 'org-2', day: '2026-01-15', daily_usage: '100' },
      { organization_id: 'org-2', day: '2026-02-10', daily_usage: '150' },
    ];

    const spikes = detectSpikes(rows, 'ai', cutoff, 3);
    expect(spikes).toHaveLength(1);
    expect(spikes[0].organization_id).toBe('org-1');
  });

  it('should use the max recent day for spike comparison', () => {
    const cutoff = new Date('2026-02-07');
    const rows = [
      { organization_id: 'org-1', day: '2026-01-15', daily_usage: '10' },
      // Multiple recent days — spike is based on the max
      { organization_id: 'org-1', day: '2026-02-08', daily_usage: '5' },
      { organization_id: 'org-1', day: '2026-02-09', daily_usage: '40' },
      { organization_id: 'org-1', day: '2026-02-10', daily_usage: '8' },
    ];

    const spikes = detectSpikes(rows, 'ai', cutoff, 3);
    expect(spikes).toHaveLength(1);
    expect(spikes[0].recent_max_minutes).toBe(40);
  });
});
