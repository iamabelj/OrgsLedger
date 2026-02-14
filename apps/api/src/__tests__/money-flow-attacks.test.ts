// ============================================================
// Security Tests — Malicious Money Attacks
// Pre-refactor safety gate: simulates real attack vectors
// against the billing/wallet/payment system.
//
// These tests prove exploitable vulnerabilities exist and
// document the exact attack patterns that must be blocked.
// ============================================================

import db from './__mocks__/db';

jest.mock('../db', () => db);
jest.mock('../logger', () => require('./__mocks__/logger'));

import {
  topUpAiWallet,
  topUpTranslationWallet,
  deductAiWallet,
  deductTranslationWallet,
  getPlanPrice,
  createSubscription,
} from '../services/subscription.service';

// ── Helpers ─────────────────────────────────────────────────

function setupTransactionMock(walletRow: any | null) {
  db.transaction.mockImplementation(async (callback: Function) => {
    const trx: any = jest.fn((_table: string) => {
      const chain: any = {};
      const methods = [
        'where', 'whereIn', 'orderBy', 'first', 'insert', 'update',
        'returning', 'select', 'count', 'forUpdate', 'raw',
      ];
      for (const m of methods) {
        chain[m] = jest.fn().mockReturnValue(chain);
      }
      chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
      chain.raw = jest.fn((...args: any[]) => args);
      chain.first.mockResolvedValue(walletRow);
      return chain;
    });
    trx.fn = { now: jest.fn().mockReturnValue('NOW()') };
    trx.raw = jest.fn((...args: any[]) => args);
    return callback(trx);
  });
}

function setupDbChain(returnValue: any) {
  (db as any).mockImplementation((_table: string) => {
    const chain: any = {};
    const methods = [
      'where', 'whereIn', 'orderBy', 'first', 'insert', 'update',
      'returning', 'select', 'count', 'forUpdate', 'raw', 'del',
    ];
    for (const m of methods) {
      chain[m] = jest.fn().mockReturnValue(chain);
    }
    chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
    chain.first.mockResolvedValue(returnValue);
    chain.returning.mockResolvedValue([returnValue]);
    return chain;
  });
  db.fn = { now: jest.fn().mockReturnValue('NOW()'), uuid: jest.fn() };
  db.raw = jest.fn((...args: any[]) => args);
  db.transaction = jest.fn();
}

// ── Tests ───────────────────────────────────────────────────

describe('Malicious Money Attack Simulations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── ATTACK 1: Fake Payment Reference ────────────────────

  describe('ATTACK: Fake payment reference injection', () => {
    it('EXPLOITABLE: attacker POSTs fake paymentReference to get free AI wallet credits', async () => {
      // Attack: Admin-level user calls POST /:orgId/wallet/ai/topup
      // with a completely fabricated paymentReference
      //
      // The route does NOT verify the payment with any gateway
      // Result: Unlimited free wallet credits

      setupTransactionMock(null);
      setupDbChain({ organization_id: 'org-victim', balance_minutes: '0.00' });

      // Attacker claims they paid $1000 for 100 hours
      const result = await topUpAiWallet({
        orgId: 'org-victim',
        minutes: 6000, // 100 hours
        cost: 1000,
        currency: 'USD',
        paymentRef: 'FAKE_' + Date.now(),
        paymentGateway: 'stripe',
      });

      // EXPLOIT SUCCEEDS: no error, wallet credited
      expect(result).toBeDefined();
      expect(db.transaction).toHaveBeenCalledTimes(1);
    });

    it('EXPLOITABLE: attacker gets free translation credits with fake ref', async () => {
      setupTransactionMock(null);
      setupDbChain({ organization_id: 'org-victim', balance_minutes: '0.00' });

      const result = await topUpTranslationWallet({
        orgId: 'org-victim',
        minutes: 6000,
        cost: 2500,
        currency: 'USD',
        paymentRef: 'FAKE_TRANSLATION_' + Date.now(),
        paymentGateway: 'paystack',
      });

      expect(result).toBeDefined();
    });

    it('REQUIRED FIX: topUp should verify payment with gateway before crediting', () => {
      // Fix plan:
      // 1. Look up paymentReference in transactions table (must have status='completed')
      // 2. Verify amount matches expected cost
      // 3. Ensure paymentReference not already used (idempotency key)
      // 4. OR: Remove direct top-up, make it webhook-driven only
      expect(true).toBe(true);
    });
  });

  // ── ATTACK 2: Negative Amount Injection ─────────────────

  describe('ATTACK: Negative amount injection', () => {
    it('should prevent negative minute deduction (which would ADD balance)', async () => {
      setupTransactionMock({ organization_id: 'org-1', balance_minutes: '10.00' });

      // Attempting to deduct -100 minutes (which would ADD 100 to balance)
      const result = await deductAiWallet('org-1', -100, 'Negative injection');

      // The deduction code checks `balanceBefore < minutes`
      // With minutes = -100 and balance = 10: 10 < -100 = false → PASSES
      // This means negative deduction SUCCEEDS and ADDS balance
      // BUG: No guard against negative minutes parameter
      expect(result.success).toBe(true); // BUG CONFIRMED
    });

    it('should prevent negative minute deduction on translation wallet', async () => {
      setupTransactionMock({ organization_id: 'org-1', balance_minutes: '5.00' });

      const result = await deductTranslationWallet('org-1', -50, 'Negative translation');

      // Same bug: -50 < 5 is false, so deduction proceeds
      // balance_minutes - (-50) = balance_minutes + 50
      expect(result.success).toBe(true); // BUG CONFIRMED
    });

    it('REQUIRED FIX: deduction functions must validate minutes > 0', () => {
      // Fix: Add guard at top of deductAiWallet and deductTranslationWallet:
      //   if (minutes <= 0) return { success: false, error: 'Minutes must be positive' };
      expect(true).toBe(true);
    });
  });

  // ── ATTACK 3: Zero Amount Attack ────────────────────────

  describe('ATTACK: Zero amount operations', () => {
    it('should handle zero-minute deduction gracefully', async () => {
      setupTransactionMock({ organization_id: 'org-1', balance_minutes: '100.00' });

      // Zero deduction: balance < 0 is false, so it passes and creates a useless transaction
      const result = await deductAiWallet('org-1', 0, 'Zero deduction spam');

      // Not really harmful but creates spam in transaction log
      expect(result.success).toBe(true);
    });

    it('zero-cost topup creates audit trail pollution', async () => {
      setupTransactionMock(null);
      setupDbChain({ organization_id: 'org-1', balance_minutes: '0.00' });

      // Top up with 0 cost — creates useless transaction records
      await topUpAiWallet({
        orgId: 'org-1',
        minutes: 0,
        cost: 0,
        currency: 'USD',
        paymentRef: 'zero_cost_spam',
      });

      // Creates a "Top-up: 0.0 hours" transaction record
      expect(db.transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ── ATTACK 4: Price Manipulation via Currency ───────────

  describe('ATTACK: Currency manipulation', () => {
    it('BUG: wallet topup pricing is hardcoded, cannot be manipulated via DB', () => {
      // The hardcoded pricing means attackers can't change prices
      // but it also means admins can't adjust prices either
      //
      // AI: USD=10/hr, NGN=18000/hr (hardcoded in routes/subscriptions.ts)
      // Translation: USD=25/hr, NGN=45000/hr
      //
      // If the DB columns ai_price_per_hour or translation_price_per_hour
      // are changed, the route ignores them completely
      expect(true).toBe(true);
    });

    it('BUG: getPlanPrice can return NaN or 0 with missing plan data', () => {
      const brokenPlan = {
        price_usd_annual: null,
        price_usd_monthly: null,
        price_ngn_annual: null,
        price_ngn_monthly: null,
      };

      // USD monthly: null || (null / 12) = 0 → parseFloat(0) = 0 (wrong but not NaN)
      expect(getPlanPrice(brokenPlan, 'USD', 'monthly')).toBe(0);
      // NGN annual: parseFloat(null) = NaN
      expect(Number.isNaN(getPlanPrice(brokenPlan, 'NGN', 'annual'))).toBe(true);
      // USD annual: parseFloat(null) = NaN
      expect(Number.isNaN(getPlanPrice(brokenPlan, 'USD', 'annual'))).toBe(true);
    });

    it('subscription with NaN price creates corrupted record', async () => {
      const writtenAmount: any[] = [];
      (db as any).mockImplementation((_table: string) => {
        const chain: any = {};
        const methods = [
          'where', 'whereIn', 'orderBy', 'first', 'insert', 'update',
          'returning', 'select', 'count', 'forUpdate', 'raw',
        ];
        for (const m of methods) {
          chain[m] = jest.fn().mockReturnValue(chain);
        }
        chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
        chain.insert.mockImplementation((data: any) => {
          if (data?.amount_paid !== undefined) writtenAmount.push(data.amount_paid);
          return chain;
        });
        chain.returning.mockResolvedValue([{ id: 'sub-1', organization_id: 'org-1', status: 'active' }]);
        return chain;
      });
      db.fn = { now: jest.fn().mockReturnValue('NOW()'), uuid: jest.fn() };
      db.raw = jest.fn((...args: any[]) => args);

      await createSubscription({
        organizationId: 'org-1',
        planId: 'plan-1',
        billingCycle: 'annual',
        currency: 'USD',
        amountPaid: NaN, // From broken getPlanPrice
      });

      // NaN written to DB — PostgreSQL stores null or raises error
      expect(writtenAmount).toContainEqual(NaN);
    });
  });

  // ── ATTACK 5: Rapid-Fire Wallet Top-Up (No Rate Limit) ──

  describe('ATTACK: Rapid-fire operations', () => {
    it('no rate limit on wallet top-up endpoint', async () => {
      setupTransactionMock(null);
      setupDbChain({ organization_id: 'org-1', balance_minutes: '0.00' });

      // Simulate 100 rapid top-ups with fake payment references
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          topUpAiWallet({
            orgId: 'org-1',
            minutes: 60,
            cost: 10,
            currency: 'USD',
            paymentRef: `fake_ref_${i}`,
          })
        );
      }

      const results = await Promise.all(promises);

      // All 100 succeed — no rate limiting
      expect(results.length).toBe(100);
      expect(db.transaction).toHaveBeenCalledTimes(100);
    });
  });

  // ── ATTACK 6: Cross-Org Wallet Manipulation ─────────────

  describe('ATTACK: Cross-org wallet targeting', () => {
    it('deduction targets specific orgId (tenant scoped)', async () => {
      setupTransactionMock({ organization_id: 'org-victim', balance_minutes: '500.00' });

      // An attacker from org-attacker tries to deduct from org-victim
      // The deduction function accepts any orgId — authorization is route-level
      const result = await deductAiWallet('org-victim', 100, 'Cross-org theft');

      // The function itself has NO authorization check
      // Security relies entirely on route middleware (loadMembership)
      expect(result.success).toBe(true);
    });

    it('topup targets specific orgId (tenant scoped at route level only)', async () => {
      setupTransactionMock(null);
      setupDbChain({ organization_id: 'org-victim', balance_minutes: '0.00' });

      // Service function has no authorization — accepts any orgId
      const result = await topUpAiWallet({
        orgId: 'org-victim',
        minutes: 6000,
        cost: 0,
        currency: 'USD',
        paymentRef: 'cross-org-topup',
      });

      expect(result).toBeDefined();
    });
  });

  // ── ATTACK 7: Overflow / Boundary Attacks ───────────────

  describe('ATTACK: Numeric boundary attacks', () => {
    it('should handle extremely large minute values', async () => {
      setupTransactionMock(null);
      setupDbChain({ organization_id: 'org-1', balance_minutes: '0.00' });

      // Top up with Number.MAX_SAFE_INTEGER minutes
      await topUpAiWallet({
        orgId: 'org-1',
        minutes: Number.MAX_SAFE_INTEGER,
        cost: 999999999,
        currency: 'USD',
        paymentRef: 'overflow_test',
      });

      // PostgreSQL NUMERIC can handle this, but the display might overflow
      expect(db.transaction).toHaveBeenCalledTimes(1);
    });

    it('should handle Infinity minutes (parseFloat edge case)', async () => {
      setupTransactionMock(null);
      setupDbChain({ organization_id: 'org-1', balance_minutes: '0.00' });

      // Infinity → PostgreSQL error, but no JS-level guard
      await topUpAiWallet({
        orgId: 'org-1',
        minutes: Infinity,
        cost: Infinity,
        currency: 'USD',
        paymentRef: 'infinity_test',
      });

      // No validation at service level — would fail at PostgreSQL level
      expect(db.transaction).toHaveBeenCalledTimes(1);
    });

    it('should handle NaN minutes', async () => {
      setupTransactionMock({ organization_id: 'org-1', balance_minutes: 'NaN' });

      // NaN balance: parseFloat('NaN') = NaN
      // NaN < 10 = false → deduction check passes!
      const result = await deductAiWallet('org-1', 10, 'NaN balance exploit');

      // BUG: NaN comparison passes the balance check
      expect(result.success).toBe(true);
    });
  });

  // ── ATTACK 8: Concurrent Deduction Race ─────────────────

  describe('ATTACK: Concurrent deduction races', () => {
    it('SECURE: deductAiWallet uses FOR UPDATE lock', async () => {
      let usedForUpdate = false;
      db.transaction.mockImplementation(async (callback: Function) => {
        const trx: any = jest.fn((_table: string) => {
          const chain: any = {};
          const methods = ['where', 'insert', 'update', 'returning', 'select', 'first', 'raw', 'forUpdate'];
          for (const m of methods) {
            chain[m] = jest.fn().mockReturnValue(chain);
          }
          chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
          chain.raw = jest.fn((...args: any[]) => args);
          chain.first.mockResolvedValue({ organization_id: 'org-1', balance_minutes: '100.00' });
          chain.forUpdate.mockImplementation(() => {
            usedForUpdate = true;
            return chain;
          });
          return chain;
        });
        trx.fn = { now: jest.fn().mockReturnValue('NOW()') };
        trx.raw = jest.fn((...args: any[]) => args);
        return callback(trx);
      });

      await deductAiWallet('org-1', 50, 'Concurrent deduction 1');

      // Good: FOR UPDATE prevents concurrent reads of stale balance
      expect(usedForUpdate).toBe(true);
    });

    it('VULNERABLE: topUpAiWallet does NOT use FOR UPDATE', async () => {
      let usedForUpdate = false;
      db.transaction.mockImplementation(async (callback: Function) => {
        const trx: any = jest.fn((_table: string) => {
          const chain: any = {};
          const methods = ['where', 'insert', 'update', 'returning', 'select', 'first', 'raw', 'forUpdate'];
          for (const m of methods) {
            chain[m] = jest.fn().mockReturnValue(chain);
          }
          chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
          chain.raw = jest.fn((...args: any[]) => args);
          chain.forUpdate.mockImplementation(() => {
            usedForUpdate = true;
            return chain;
          });
          return chain;
        });
        trx.fn = { now: jest.fn().mockReturnValue('NOW()') };
        trx.raw = jest.fn((...args: any[]) => args);
        return callback(trx);
      });

      setupDbChain({ organization_id: 'org-1', balance_minutes: '100.00' });

      await topUpAiWallet({
        orgId: 'org-1',
        minutes: 60,
        cost: 10,
        currency: 'USD',
      });

      // Top-up uses trx.raw('balance_minutes + ?') which is atomic at SQL level
      // but doesn't lock the row, meaning concurrent reads are possible
      // However, since it uses += not absolute set, this is actually safe
      // The real issue is the top-up itself has no payment verification
      expect(usedForUpdate).toBe(false);
    });
  });

  // ── ATTACK 9: Subscription Plan Manipulation ────────────

  describe('ATTACK: Subscription manipulation', () => {
    it('createSubscription accepts any planId without verifying payment', async () => {
      const insertedData: any[] = [];
      (db as any).mockImplementation((_table: string) => {
        const chain: any = {};
        const methods = [
          'where', 'whereIn', 'orderBy', 'first', 'insert', 'update',
          'returning', 'select', 'count', 'forUpdate', 'raw',
        ];
        for (const m of methods) {
          chain[m] = jest.fn().mockReturnValue(chain);
        }
        chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
        chain.insert.mockImplementation((data: any) => {
          insertedData.push({ table: _table, data });
          return chain;
        });
        chain.returning.mockResolvedValue([{ id: 'sub-1', status: 'active' }]);
        return chain;
      });
      db.fn = { now: jest.fn().mockReturnValue('NOW()'), uuid: jest.fn() };
      db.raw = jest.fn((...args: any[]) => args);

      // Enterprise plan ($2500) subscribed with $0 payment
      await createSubscription({
        organizationId: 'org-1',
        planId: 'plan-enterprise',
        billingCycle: 'annual',
        currency: 'USD',
        amountPaid: 0, // Free enterprise subscription
      });

      // No validation that amountPaid >= plan price
      const subInsert = insertedData.find(i => i.table === 'subscriptions');
      expect(subInsert?.data?.amount_paid).toBe(0);
    });
  });

  // ── Attack Summary ──────────────────────────────────────

  describe('Attack Surface Summary', () => {
    it('documents all P0 exploitable vulnerabilities', () => {
      const p0Vulnerabilities = [
        'Wallet top-up: no payment verification (fake paymentRef accepted)',
        'Negative minute deduction adds balance instead of subtracting',
        'NaN balance comparison bypasses insufficient funds check',
        'Dev mode auto-complete: no NODE_ENV guard',
        'Paystack callback: no amount verification (pay ₦1 for ₦50K)',
        'Flutterwave callback: no amount verification',
        'Translation served before billing (free service on deduction failure)',
        'AI processing failure after deduction = lost money, no refund',
        'createSubscription accepts $0 for any plan',
        'No rate limit on wallet top-up',
      ];

      expect(p0Vulnerabilities.length).toBe(10);
      // ALL of these must be fixed before refactoring begins
    });
  });
});
