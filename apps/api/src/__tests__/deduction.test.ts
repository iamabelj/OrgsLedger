// ============================================================
// Unit Tests — Wallet Deduction Algorithm
// Coverage target: 95%
//
// Tests the deductAiWallet and deductTranslationWallet functions
// ensuring: transaction usage, balance checks, race protection,
// correct deduction math, edge cases.
// ============================================================

import db from './__mocks__/db';

// Wire the mock before importing the SUT
jest.mock('../db', () => db);
jest.mock('../logger', () => require('./__mocks__/logger'));

import {
  deductAiWallet,
  deductTranslationWallet,
  topUpAiWallet,
  topUpTranslationWallet,
  getAiWallet,
  getTranslationWallet,
} from '../services/subscription.service';

// ── Helpers ─────────────────────────────────────────────────

function setupTransactionMock(walletRow: any | null) {
  // db.transaction(async (trx) => { ... })
  // We need to simulate the trx object and execute the callback
  db.transaction.mockImplementation(async (callback: Function) => {
    const trxChain: any = {};
    const methods = [
      'where', 'whereIn', 'orderBy', 'first', 'insert', 'update',
      'returning', 'select', 'count', 'forUpdate', 'raw',
    ];
    for (const m of methods) {
      trxChain[m] = jest.fn().mockReturnValue(trxChain);
    }
    trxChain.fn = { now: jest.fn().mockReturnValue('NOW()') };
    trxChain.raw = jest.fn((...args: any[]) => args);

    // forUpdate().first() returns walletRow
    trxChain.first.mockResolvedValue(walletRow);

    // Make trx callable (trx('table') returns trxChain)
    const trx: any = jest.fn((_table: string) => {
      // Reset chain for each table call
      const chain: any = {};
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

function setupDbQueryMock(returnValue: any) {
  const chain: any = {};
  const methods = [
    'where', 'whereIn', 'orderBy', 'first', 'insert', 'update',
    'returning', 'select', 'count', 'forUpdate', 'raw',
  ];
  for (const m of methods) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain.first.mockResolvedValue(returnValue);
  chain.returning.mockResolvedValue([returnValue]);
  (db as any).mockReturnValue(chain);
  return chain;
}

// ── Tests ───────────────────────────────────────────────────

describe('Wallet Deduction Algorithm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── deductAiWallet ──────────────────────────────────────

  describe('deductAiWallet', () => {
    it('should succeed when balance is sufficient', async () => {
      setupTransactionMock({ organization_id: 'org-1', balance_minutes: '120.00' });

      const result = await deductAiWallet('org-1', 60, 'Test deduct');

      expect(result).toEqual({ success: true });
      expect(db.transaction).toHaveBeenCalledTimes(1);
    });

    it('should fail when balance is insufficient', async () => {
      setupTransactionMock({ organization_id: 'org-1', balance_minutes: '30.00' });

      const result = await deductAiWallet('org-1', 60, 'Test deduct');

      expect(result).toEqual({ success: false, error: 'Insufficient AI wallet balance' });
    });

    it('should fail when wallet is not found', async () => {
      setupTransactionMock(null);

      const result = await deductAiWallet('org-1', 60);

      expect(result).toEqual({ success: false, error: 'AI wallet not found' });
    });

    it('should fail when balance is exactly 0', async () => {
      setupTransactionMock({ organization_id: 'org-1', balance_minutes: '0.00' });

      const result = await deductAiWallet('org-1', 1);

      expect(result).toEqual({ success: false, error: 'Insufficient AI wallet balance' });
    });

    it('should succeed when balance equals requested amount exactly', async () => {
      setupTransactionMock({ organization_id: 'org-1', balance_minutes: '60.00' });

      const result = await deductAiWallet('org-1', 60);

      expect(result).toEqual({ success: true });
    });

    it('should handle fractional minutes correctly', async () => {
      setupTransactionMock({ organization_id: 'org-1', balance_minutes: '10.50' });

      const result = await deductAiWallet('org-1', 10.5);

      expect(result).toEqual({ success: true });
    });

    it('should reject deduction of fractional amount exceeding balance', async () => {
      setupTransactionMock({ organization_id: 'org-1', balance_minutes: '10.49' });

      const result = await deductAiWallet('org-1', 10.5);

      expect(result).toEqual({ success: false, error: 'Insufficient AI wallet balance' });
    });

    it('should use transaction with forUpdate for row locking', async () => {
      let trxUsedForUpdate = false;
      db.transaction.mockImplementation(async (callback: Function) => {
        const trx: any = jest.fn((_table: string) => {
          const chain: any = {};
          const methods = ['where', 'forUpdate', 'first', 'update', 'insert', 'raw'];
          for (const m of methods) {
            chain[m] = jest.fn().mockReturnValue(chain);
          }
          chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
          chain.raw = jest.fn((...args: any[]) => args);
          chain.first.mockResolvedValue({ organization_id: 'org-1', balance_minutes: '120.00' });
          // Track forUpdate calls
          chain.forUpdate = jest.fn(() => {
            trxUsedForUpdate = true;
            return chain;
          });
          return chain;
        });
        trx.fn = { now: jest.fn().mockReturnValue('NOW()') };
        trx.raw = jest.fn((...args: any[]) => args);
        return callback(trx);
      });

      await deductAiWallet('org-1', 10);

      expect(trxUsedForUpdate).toBe(true);
    });

    it('should create a wallet transaction record with negative amount', async () => {
      let insertedData: any = null;
      db.transaction.mockImplementation(async (callback: Function) => {
        const trx: any = jest.fn((table: string) => {
          const chain: any = {};
          const methods = ['where', 'forUpdate', 'first', 'update', 'insert', 'raw'];
          for (const m of methods) {
            chain[m] = jest.fn().mockReturnValue(chain);
          }
          chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
          chain.raw = jest.fn((...args: any[]) => args);
          chain.first.mockResolvedValue({ organization_id: 'org-1', balance_minutes: '120.00' });
          if (table === 'ai_wallet_transactions') {
            chain.insert = jest.fn((data: any) => {
              insertedData = data;
              return chain;
            });
          }
          return chain;
        });
        trx.fn = { now: jest.fn().mockReturnValue('NOW()') };
        trx.raw = jest.fn((...args: any[]) => args);
        return callback(trx);
      });

      await deductAiWallet('org-1', 25, 'AI meeting processing');

      expect(insertedData).toBeDefined();
      expect(insertedData.organization_id).toBe('org-1');
      expect(insertedData.type).toBe('usage');
      expect(insertedData.amount_minutes).toBe(-25);
      expect(insertedData.description).toBe('AI meeting processing');
    });

    it('should use default description when none provided', async () => {
      let insertedData: any = null;
      db.transaction.mockImplementation(async (callback: Function) => {
        const trx: any = jest.fn((table: string) => {
          const chain: any = {};
          const methods = ['where', 'forUpdate', 'first', 'update', 'insert', 'raw'];
          for (const m of methods) {
            chain[m] = jest.fn().mockReturnValue(chain);
          }
          chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
          chain.raw = jest.fn((...args: any[]) => args);
          chain.first.mockResolvedValue({ organization_id: 'org-1', balance_minutes: '120.00' });
          if (table === 'ai_wallet_transactions') {
            chain.insert = jest.fn((data: any) => {
              insertedData = data;
              return chain;
            });
          }
          return chain;
        });
        trx.fn = { now: jest.fn().mockReturnValue('NOW()') };
        trx.raw = jest.fn((...args: any[]) => args);
        return callback(trx);
      });

      await deductAiWallet('org-1', 42.5);

      expect(insertedData.description).toBe('AI usage: 42.5 minutes');
    });
  });

  // ── deductTranslationWallet ─────────────────────────────

  describe('deductTranslationWallet', () => {
    it('should succeed when balance is sufficient', async () => {
      setupTransactionMock({ organization_id: 'org-1', balance_minutes: '60.00' });

      const result = await deductTranslationWallet('org-1', 30);

      expect(result).toEqual({ success: true });
    });

    it('should fail when balance is insufficient', async () => {
      setupTransactionMock({ organization_id: 'org-1', balance_minutes: '5.00' });

      const result = await deductTranslationWallet('org-1', 10);

      expect(result).toEqual({ success: false, error: 'Insufficient translation wallet balance' });
    });

    it('should fail when wallet is not found', async () => {
      setupTransactionMock(null);

      const result = await deductTranslationWallet('org-1', 10);

      expect(result).toEqual({ success: false, error: 'Translation wallet not found' });
    });

    it('should succeed when balance equals requested amount exactly', async () => {
      setupTransactionMock({ organization_id: 'org-1', balance_minutes: '0.50' });

      const result = await deductTranslationWallet('org-1', 0.5);

      expect(result).toEqual({ success: true });
    });

    it('should handle very small fractional deductions', async () => {
      setupTransactionMock({ organization_id: 'org-1', balance_minutes: '0.10' });

      const result = await deductTranslationWallet('org-1', 0.1);

      expect(result).toEqual({ success: true });
    });
  });

  // ── getAiWallet ─────────────────────────────────────────

  describe('getAiWallet', () => {
    it('should return existing wallet', async () => {
      const wallet = { organization_id: 'org-1', balance_minutes: '120.00' };
      setupDbQueryMock(wallet);

      const result = await getAiWallet('org-1');

      expect(result).toEqual(wallet);
    });

    it('should create wallet if not exists', async () => {
      const newWallet = { organization_id: 'org-1', balance_minutes: 0, currency: 'USD' };
      const chain: any = {};
      const methods = ['where', 'first', 'insert', 'returning', 'select'];
      for (const m of methods) {
        chain[m] = jest.fn().mockReturnValue(chain);
      }
      // First call (ai_wallet lookup) returns null, second call (org lookup) returns org,
      // third call (insert) returns the created wallet
      chain.first
        .mockResolvedValueOnce(null)  // wallet not found
        .mockResolvedValueOnce({ billing_currency: 'USD' }); // org lookup
      chain.returning.mockResolvedValue([newWallet]);
      (db as any).mockReturnValue(chain);

      const result = await getAiWallet('org-1');

      expect(result).toEqual(newWallet);
    });
  });

  // ── getTranslationWallet ────────────────────────────────

  describe('getTranslationWallet', () => {
    it('should return existing wallet', async () => {
      const wallet = { organization_id: 'org-1', balance_minutes: '60.00' };
      setupDbQueryMock(wallet);

      const result = await getTranslationWallet('org-1');

      expect(result).toEqual(wallet);
    });

    it('should create wallet if not exists', async () => {
      const newWallet = { organization_id: 'org-1', balance_minutes: 0, currency: 'USD' };
      const chain: any = {};
      const methods = ['where', 'first', 'insert', 'returning', 'select'];
      for (const m of methods) {
        chain[m] = jest.fn().mockReturnValue(chain);
      }
      chain.first
        .mockResolvedValueOnce(null)  // wallet not found
        .mockResolvedValueOnce({ billing_currency: 'USD' }); // org lookup
      chain.returning.mockResolvedValue([newWallet]);
      (db as any).mockReturnValue(chain);

      const result = await getTranslationWallet('org-1');

      expect(result).toEqual(newWallet);
    });
  });

  // ── topUpAiWallet ───────────────────────────────────────

  describe('topUpAiWallet', () => {
    it('should use db.transaction for atomicity', async () => {
      // After the transaction, getAiWallet is called
      setupDbQueryMock({ organization_id: 'org-1', balance_minutes: '180.00' });

      db.transaction.mockImplementation(async (callback: Function) => {
        const trx: any = jest.fn((_table: string) => {
          const chain: any = {};
          const methods = ['where', 'update', 'insert', 'raw'];
          for (const m of methods) {
            chain[m] = jest.fn().mockReturnValue(chain);
          }
          chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
          chain.raw = jest.fn((...args: any[]) => args);
          return chain;
        });
        trx.fn = { now: jest.fn().mockReturnValue('NOW()') };
        trx.raw = jest.fn((...args: any[]) => args);
        return callback(trx);
      });

      await topUpAiWallet({
        orgId: 'org-1',
        minutes: 120,
        cost: 20,
        currency: 'USD',
      });

      expect(db.transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ── topUpTranslationWallet ──────────────────────────────

  describe('topUpTranslationWallet', () => {
    it('should use db.transaction for atomicity', async () => {
      setupDbQueryMock({ organization_id: 'org-1', balance_minutes: '120.00' });

      db.transaction.mockImplementation(async (callback: Function) => {
        const trx: any = jest.fn((_table: string) => {
          const chain: any = {};
          const methods = ['where', 'update', 'insert', 'raw'];
          for (const m of methods) {
            chain[m] = jest.fn().mockReturnValue(chain);
          }
          chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
          chain.raw = jest.fn((...args: any[]) => args);
          return chain;
        });
        trx.fn = { now: jest.fn().mockReturnValue('NOW()') };
        trx.raw = jest.fn((...args: any[]) => args);
        return callback(trx);
      });

      await topUpTranslationWallet({
        orgId: 'org-1',
        minutes: 60,
        cost: 25,
        currency: 'USD',
      });

      expect(db.transaction).toHaveBeenCalledTimes(1);
    });
  });
});
