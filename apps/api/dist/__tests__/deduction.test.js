"use strict";
// ============================================================
// Unit Tests — Wallet Deduction Algorithm
// Coverage target: 95%
//
// Tests the deductAiWallet and deductTranslationWallet functions
// ensuring: transaction usage, balance checks, race protection,
// correct deduction math, edge cases.
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = __importDefault(require("./__mocks__/db"));
// Wire the mock before importing the SUT
jest.mock('../db', () => db_1.default);
jest.mock('../logger', () => require('./__mocks__/logger'));
const subscription_service_1 = require("../services/subscription.service");
// ── Helpers ─────────────────────────────────────────────────
function setupTransactionMock(walletRow) {
    // db.transaction(async (trx) => { ... })
    // We need to simulate the trx object and execute the callback
    db_1.default.transaction.mockImplementation(async (callback) => {
        const trxChain = {};
        const methods = [
            'where', 'whereIn', 'orderBy', 'first', 'insert', 'update',
            'returning', 'select', 'count', 'forUpdate', 'raw',
        ];
        for (const m of methods) {
            trxChain[m] = jest.fn().mockReturnValue(trxChain);
        }
        trxChain.fn = { now: jest.fn().mockReturnValue('NOW()') };
        trxChain.raw = jest.fn((...args) => args);
        // forUpdate().first() returns walletRow
        trxChain.first.mockResolvedValue(walletRow);
        // Make trx callable (trx('table') returns trxChain)
        const trx = jest.fn((_table) => {
            // Reset chain for each table call
            const chain = {};
            for (const m of methods) {
                chain[m] = jest.fn().mockReturnValue(chain);
            }
            chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
            chain.raw = jest.fn((...args) => args);
            chain.first.mockResolvedValue(walletRow);
            return chain;
        });
        trx.fn = { now: jest.fn().mockReturnValue('NOW()') };
        trx.raw = jest.fn((...args) => args);
        return callback(trx);
    });
}
function setupDbQueryMock(returnValue) {
    const chain = {};
    const methods = [
        'where', 'whereIn', 'orderBy', 'first', 'insert', 'update',
        'returning', 'select', 'count', 'forUpdate', 'raw',
    ];
    for (const m of methods) {
        chain[m] = jest.fn().mockReturnValue(chain);
    }
    chain.first.mockResolvedValue(returnValue);
    chain.returning.mockResolvedValue([returnValue]);
    db_1.default.mockReturnValue(chain);
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
            const result = await (0, subscription_service_1.deductAiWallet)('org-1', 60, 'Test deduct');
            expect(result).toEqual({ success: true });
            expect(db_1.default.transaction).toHaveBeenCalledTimes(1);
        });
        it('should fail when balance is insufficient', async () => {
            setupTransactionMock({ organization_id: 'org-1', balance_minutes: '30.00' });
            const result = await (0, subscription_service_1.deductAiWallet)('org-1', 60, 'Test deduct');
            expect(result).toEqual({ success: false, error: 'Insufficient AI wallet balance' });
        });
        it('should fail when wallet is not found', async () => {
            setupTransactionMock(null);
            const result = await (0, subscription_service_1.deductAiWallet)('org-1', 60);
            expect(result).toEqual({ success: false, error: 'AI wallet not found' });
        });
        it('should fail when balance is exactly 0', async () => {
            setupTransactionMock({ organization_id: 'org-1', balance_minutes: '0.00' });
            const result = await (0, subscription_service_1.deductAiWallet)('org-1', 1);
            expect(result).toEqual({ success: false, error: 'Insufficient AI wallet balance' });
        });
        it('should succeed when balance equals requested amount exactly', async () => {
            setupTransactionMock({ organization_id: 'org-1', balance_minutes: '60.00' });
            const result = await (0, subscription_service_1.deductAiWallet)('org-1', 60);
            expect(result).toEqual({ success: true });
        });
        it('should handle fractional minutes correctly', async () => {
            setupTransactionMock({ organization_id: 'org-1', balance_minutes: '10.50' });
            const result = await (0, subscription_service_1.deductAiWallet)('org-1', 10.5);
            expect(result).toEqual({ success: true });
        });
        it('should reject deduction of fractional amount exceeding balance', async () => {
            setupTransactionMock({ organization_id: 'org-1', balance_minutes: '10.49' });
            const result = await (0, subscription_service_1.deductAiWallet)('org-1', 10.5);
            expect(result).toEqual({ success: false, error: 'Insufficient AI wallet balance' });
        });
        it('should use transaction with forUpdate for row locking', async () => {
            let trxUsedForUpdate = false;
            db_1.default.transaction.mockImplementation(async (callback) => {
                const trx = jest.fn((_table) => {
                    const chain = {};
                    const methods = ['where', 'forUpdate', 'first', 'update', 'insert', 'raw'];
                    for (const m of methods) {
                        chain[m] = jest.fn().mockReturnValue(chain);
                    }
                    chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
                    chain.raw = jest.fn((...args) => args);
                    chain.first.mockResolvedValue({ organization_id: 'org-1', balance_minutes: '120.00' });
                    // Track forUpdate calls
                    chain.forUpdate = jest.fn(() => {
                        trxUsedForUpdate = true;
                        return chain;
                    });
                    return chain;
                });
                trx.fn = { now: jest.fn().mockReturnValue('NOW()') };
                trx.raw = jest.fn((...args) => args);
                return callback(trx);
            });
            await (0, subscription_service_1.deductAiWallet)('org-1', 10);
            expect(trxUsedForUpdate).toBe(true);
        });
        it('should create a wallet transaction record with negative amount', async () => {
            let insertedData = null;
            db_1.default.transaction.mockImplementation(async (callback) => {
                const trx = jest.fn((table) => {
                    const chain = {};
                    const methods = ['where', 'forUpdate', 'first', 'update', 'insert', 'raw'];
                    for (const m of methods) {
                        chain[m] = jest.fn().mockReturnValue(chain);
                    }
                    chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
                    chain.raw = jest.fn((...args) => args);
                    chain.first.mockResolvedValue({ organization_id: 'org-1', balance_minutes: '120.00' });
                    if (table === 'ai_wallet_transactions') {
                        chain.insert = jest.fn((data) => {
                            insertedData = data;
                            return chain;
                        });
                    }
                    return chain;
                });
                trx.fn = { now: jest.fn().mockReturnValue('NOW()') };
                trx.raw = jest.fn((...args) => args);
                return callback(trx);
            });
            await (0, subscription_service_1.deductAiWallet)('org-1', 25, 'AI meeting processing');
            expect(insertedData).toBeDefined();
            expect(insertedData.organization_id).toBe('org-1');
            expect(insertedData.type).toBe('usage');
            expect(insertedData.amount_minutes).toBe(-25);
            expect(insertedData.description).toBe('AI meeting processing');
        });
        it('should use default description when none provided', async () => {
            let insertedData = null;
            db_1.default.transaction.mockImplementation(async (callback) => {
                const trx = jest.fn((table) => {
                    const chain = {};
                    const methods = ['where', 'forUpdate', 'first', 'update', 'insert', 'raw'];
                    for (const m of methods) {
                        chain[m] = jest.fn().mockReturnValue(chain);
                    }
                    chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
                    chain.raw = jest.fn((...args) => args);
                    chain.first.mockResolvedValue({ organization_id: 'org-1', balance_minutes: '120.00' });
                    if (table === 'ai_wallet_transactions') {
                        chain.insert = jest.fn((data) => {
                            insertedData = data;
                            return chain;
                        });
                    }
                    return chain;
                });
                trx.fn = { now: jest.fn().mockReturnValue('NOW()') };
                trx.raw = jest.fn((...args) => args);
                return callback(trx);
            });
            await (0, subscription_service_1.deductAiWallet)('org-1', 42.5);
            expect(insertedData.description).toBe('AI usage: 42.5 minutes');
        });
    });
    // ── deductTranslationWallet ─────────────────────────────
    describe('deductTranslationWallet', () => {
        it('should succeed when balance is sufficient', async () => {
            setupTransactionMock({ organization_id: 'org-1', balance_minutes: '60.00' });
            const result = await (0, subscription_service_1.deductTranslationWallet)('org-1', 30);
            expect(result).toEqual({ success: true });
        });
        it('should fail when balance is insufficient', async () => {
            setupTransactionMock({ organization_id: 'org-1', balance_minutes: '5.00' });
            const result = await (0, subscription_service_1.deductTranslationWallet)('org-1', 10);
            expect(result).toEqual({ success: false, error: 'Insufficient translation wallet balance' });
        });
        it('should fail when wallet is not found', async () => {
            setupTransactionMock(null);
            const result = await (0, subscription_service_1.deductTranslationWallet)('org-1', 10);
            expect(result).toEqual({ success: false, error: 'Translation wallet not found' });
        });
        it('should succeed when balance equals requested amount exactly', async () => {
            setupTransactionMock({ organization_id: 'org-1', balance_minutes: '0.50' });
            const result = await (0, subscription_service_1.deductTranslationWallet)('org-1', 0.5);
            expect(result).toEqual({ success: true });
        });
        it('should handle very small fractional deductions', async () => {
            setupTransactionMock({ organization_id: 'org-1', balance_minutes: '0.10' });
            const result = await (0, subscription_service_1.deductTranslationWallet)('org-1', 0.1);
            expect(result).toEqual({ success: true });
        });
    });
    // ── getAiWallet ─────────────────────────────────────────
    describe('getAiWallet', () => {
        it('should return existing wallet', async () => {
            const wallet = { organization_id: 'org-1', balance_minutes: '120.00' };
            setupDbQueryMock(wallet);
            const result = await (0, subscription_service_1.getAiWallet)('org-1');
            expect(result).toEqual(wallet);
        });
        it('should create wallet if not exists', async () => {
            const newWallet = { organization_id: 'org-1', balance_minutes: 0, currency: 'USD' };
            const chain = {};
            const methods = ['where', 'first', 'insert', 'returning', 'select'];
            for (const m of methods) {
                chain[m] = jest.fn().mockReturnValue(chain);
            }
            // First call (ai_wallet lookup) returns null, second call (org lookup) returns org,
            // third call (insert) returns the created wallet
            chain.first
                .mockResolvedValueOnce(null) // wallet not found
                .mockResolvedValueOnce({ billing_currency: 'USD' }); // org lookup
            chain.returning.mockResolvedValue([newWallet]);
            db_1.default.mockReturnValue(chain);
            const result = await (0, subscription_service_1.getAiWallet)('org-1');
            expect(result).toEqual(newWallet);
        });
    });
    // ── getTranslationWallet ────────────────────────────────
    describe('getTranslationWallet', () => {
        it('should return existing wallet', async () => {
            const wallet = { organization_id: 'org-1', balance_minutes: '60.00' };
            setupDbQueryMock(wallet);
            const result = await (0, subscription_service_1.getTranslationWallet)('org-1');
            expect(result).toEqual(wallet);
        });
        it('should create wallet if not exists', async () => {
            const newWallet = { organization_id: 'org-1', balance_minutes: 0, currency: 'USD' };
            const chain = {};
            const methods = ['where', 'first', 'insert', 'returning', 'select'];
            for (const m of methods) {
                chain[m] = jest.fn().mockReturnValue(chain);
            }
            chain.first
                .mockResolvedValueOnce(null) // wallet not found
                .mockResolvedValueOnce({ billing_currency: 'USD' }); // org lookup
            chain.returning.mockResolvedValue([newWallet]);
            db_1.default.mockReturnValue(chain);
            const result = await (0, subscription_service_1.getTranslationWallet)('org-1');
            expect(result).toEqual(newWallet);
        });
    });
    // ── topUpAiWallet ───────────────────────────────────────
    describe('topUpAiWallet', () => {
        it('should use db.transaction for atomicity', async () => {
            // After the transaction, getAiWallet is called
            setupDbQueryMock({ organization_id: 'org-1', balance_minutes: '180.00' });
            db_1.default.transaction.mockImplementation(async (callback) => {
                const trx = jest.fn((_table) => {
                    const chain = {};
                    const methods = ['where', 'update', 'insert', 'raw'];
                    for (const m of methods) {
                        chain[m] = jest.fn().mockReturnValue(chain);
                    }
                    chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
                    chain.raw = jest.fn((...args) => args);
                    return chain;
                });
                trx.fn = { now: jest.fn().mockReturnValue('NOW()') };
                trx.raw = jest.fn((...args) => args);
                return callback(trx);
            });
            await (0, subscription_service_1.topUpAiWallet)({
                orgId: 'org-1',
                minutes: 120,
                cost: 20,
                currency: 'USD',
            });
            expect(db_1.default.transaction).toHaveBeenCalledTimes(1);
        });
    });
    // ── topUpTranslationWallet ──────────────────────────────
    describe('topUpTranslationWallet', () => {
        it('should use db.transaction for atomicity', async () => {
            setupDbQueryMock({ organization_id: 'org-1', balance_minutes: '120.00' });
            db_1.default.transaction.mockImplementation(async (callback) => {
                const trx = jest.fn((_table) => {
                    const chain = {};
                    const methods = ['where', 'update', 'insert', 'raw'];
                    for (const m of methods) {
                        chain[m] = jest.fn().mockReturnValue(chain);
                    }
                    chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
                    chain.raw = jest.fn((...args) => args);
                    return chain;
                });
                trx.fn = { now: jest.fn().mockReturnValue('NOW()') };
                trx.raw = jest.fn((...args) => args);
                return callback(trx);
            });
            await (0, subscription_service_1.topUpTranslationWallet)({
                orgId: 'org-1',
                minutes: 60,
                cost: 25,
                currency: 'USD',
            });
            expect(db_1.default.transaction).toHaveBeenCalledTimes(1);
        });
    });
});
//# sourceMappingURL=deduction.test.js.map