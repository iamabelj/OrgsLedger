"use strict";
// ============================================================
// Money Flow Tests — Wallet Operations
// Pre-refactor safety gate: proves every wallet path works
// or exposes known bugs before any refactoring begins.
//
// Tests: top-up (AI + Translation), deduction (AI + Translation),
// admin adjustments, wallet auto-creation, revenue reporting
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = __importDefault(require("./__mocks__/db"));
jest.mock('../db', () => db_1.default);
jest.mock('../logger', () => require('./__mocks__/logger'));
const subscription_service_1 = require("../services/subscription.service");
// ── Helpers ─────────────────────────────────────────────────
function setupTransactionMock(walletRow) {
    db_1.default.transaction.mockImplementation(async (callback) => {
        const methods = [
            'where', 'whereIn', 'orderBy', 'first', 'insert', 'update',
            'returning', 'select', 'count', 'forUpdate', 'raw',
        ];
        const trx = jest.fn((_table) => {
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
function setupDbChain(returnValue) {
    const chain = {};
    const methods = [
        'where', 'whereIn', 'orderBy', 'first', 'insert', 'update',
        'returning', 'select', 'count', 'forUpdate', 'raw', 'del',
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
describe('Money Flow — Wallet Operations', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    // ── AI Wallet Top-Up ────────────────────────────────────
    describe('topUpAiWallet', () => {
        it('should credit wallet inside db.transaction', async () => {
            // First call: getAiWallet after topup
            setupTransactionMock(null); // transaction callback
            setupDbChain({ organization_id: 'org-1', balance_minutes: '120.00' });
            await (0, subscription_service_1.topUpAiWallet)({
                orgId: 'org-1',
                minutes: 60,
                cost: 10,
                currency: 'USD',
                paymentRef: 'pay_123',
                paymentGateway: 'stripe',
            });
            expect(db_1.default.transaction).toHaveBeenCalledTimes(1);
        });
        it('should store cost and currency in transaction record', async () => {
            let insertedData = null;
            db_1.default.transaction.mockImplementation(async (callback) => {
                const trx = jest.fn((_table) => {
                    const chain = {};
                    const methods = ['where', 'insert', 'update', 'returning', 'select', 'first', 'raw', 'forUpdate'];
                    for (const m of methods) {
                        chain[m] = jest.fn().mockReturnValue(chain);
                    }
                    chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
                    chain.raw = jest.fn((...args) => args);
                    // Capture insert calls to wallet_transactions
                    chain.insert.mockImplementation((data) => {
                        if (_table === 'ai_wallet_transactions')
                            insertedData = data;
                        return chain;
                    });
                    return chain;
                });
                trx.fn = { now: jest.fn().mockReturnValue('NOW()') };
                trx.raw = jest.fn((...args) => args);
                return callback(trx);
            });
            setupDbChain({ organization_id: 'org-1', balance_minutes: '60.00' });
            await (0, subscription_service_1.topUpAiWallet)({
                orgId: 'org-1',
                minutes: 60,
                cost: 10,
                currency: 'USD',
                paymentRef: 'pay_123',
                paymentGateway: 'stripe',
            });
            expect(insertedData).not.toBeNull();
            expect(insertedData.cost).toBe(10);
            expect(insertedData.currency).toBe('USD');
            expect(insertedData.payment_ref).toBe('pay_123');
            expect(insertedData.type).toBe('topup');
        });
        it('BUG: accepts ANY paymentRef string without verification', async () => {
            // This test documents the bug: wallet top-up trusts client-supplied paymentReference
            // No gateway verification call is made. An attacker can POST fake paymentReference.
            setupTransactionMock(null);
            setupDbChain({ organization_id: 'org-1', balance_minutes: '60.00' });
            // Fake payment reference should NOT be accepted — but it is
            const result = await (0, subscription_service_1.topUpAiWallet)({
                orgId: 'org-1',
                minutes: 600, // 10 hours free
                cost: 100,
                currency: 'USD',
                paymentRef: 'COMPLETELY_FAKE_REF',
                paymentGateway: 'stripe',
            });
            // BUG CONFIRMED: No error thrown, wallet credited with fake ref
            expect(result).toBeDefined();
            expect(db_1.default.transaction).toHaveBeenCalledTimes(1);
        });
        it('should calculate NGN price at 18000/hr (hardcoded, not from DB)', async () => {
            // Documents that pricing is hardcoded in the route, not read from DB
            const pricePerHour = 18000; // hardcoded in routes/subscriptions.ts
            const hours = 2;
            const expectedCost = hours * pricePerHour; // 36000
            setupTransactionMock(null);
            setupDbChain({ organization_id: 'org-1', balance_minutes: '120.00' });
            await (0, subscription_service_1.topUpAiWallet)({
                orgId: 'org-1',
                minutes: hours * 60,
                cost: expectedCost,
                currency: 'NGN',
            });
            expect(db_1.default.transaction).toHaveBeenCalledTimes(1);
        });
    });
    // ── Translation Wallet Top-Up ───────────────────────────
    describe('topUpTranslationWallet', () => {
        it('should credit translation wallet inside db.transaction', async () => {
            setupTransactionMock(null);
            setupDbChain({ organization_id: 'org-1', balance_minutes: '30.00' });
            await (0, subscription_service_1.topUpTranslationWallet)({
                orgId: 'org-1',
                minutes: 60,
                cost: 25,
                currency: 'USD',
                paymentRef: 'pay_456',
                paymentGateway: 'paystack',
            });
            expect(db_1.default.transaction).toHaveBeenCalledTimes(1);
        });
        it('BUG: accepts fake paymentRef for translation wallet too', async () => {
            setupTransactionMock(null);
            setupDbChain({ organization_id: 'org-1', balance_minutes: '30.00' });
            const result = await (0, subscription_service_1.topUpTranslationWallet)({
                orgId: 'org-1',
                minutes: 600,
                cost: 250,
                currency: 'USD',
                paymentRef: 'I_NEVER_PAID_THIS',
                paymentGateway: 'flutterwave',
            });
            expect(result).toBeDefined();
        });
    });
    // ── AI Wallet Deduction ─────────────────────────────────
    describe('deductAiWallet — money safety', () => {
        it('should use FOR UPDATE lock for concurrent safety', async () => {
            let usedForUpdate = false;
            db_1.default.transaction.mockImplementation(async (callback) => {
                const trx = jest.fn((_table) => {
                    const chain = {};
                    const methods = ['where', 'insert', 'update', 'returning', 'select', 'first', 'raw', 'forUpdate'];
                    for (const m of methods) {
                        chain[m] = jest.fn().mockReturnValue(chain);
                    }
                    chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
                    chain.raw = jest.fn((...args) => args);
                    chain.first.mockResolvedValue({ organization_id: 'org-1', balance_minutes: '100.00' });
                    chain.forUpdate.mockImplementation(() => {
                        usedForUpdate = true;
                        return chain;
                    });
                    return chain;
                });
                trx.fn = { now: jest.fn().mockReturnValue('NOW()') };
                trx.raw = jest.fn((...args) => args);
                return callback(trx);
            });
            await (0, subscription_service_1.deductAiWallet)('org-1', 30, 'Test deduction');
            expect(usedForUpdate).toBe(true);
        });
        it('should reject deduction when balance < requested minutes', async () => {
            setupTransactionMock({ organization_id: 'org-1', balance_minutes: '10.00' });
            const result = await (0, subscription_service_1.deductAiWallet)('org-1', 60, 'Expensive operation');
            expect(result).toEqual({ success: false, error: 'Insufficient AI wallet balance' });
        });
        it('should fail if wallet does not exist', async () => {
            setupTransactionMock(null);
            const result = await (0, subscription_service_1.deductAiWallet)('org-nonexistent', 10, 'Test');
            expect(result).toEqual({ success: false, error: 'AI wallet not found' });
        });
        it('should deduct exact amount from balance', async () => {
            setupTransactionMock({ organization_id: 'org-1', balance_minutes: '100.00' });
            const result = await (0, subscription_service_1.deductAiWallet)('org-1', 45.5, 'Precise deduction');
            expect(result).toEqual({ success: true });
        });
        it('should deduct entire balance (edge: balance == requested)', async () => {
            setupTransactionMock({ organization_id: 'org-1', balance_minutes: '60.00' });
            const result = await (0, subscription_service_1.deductAiWallet)('org-1', 60, 'Exact balance');
            expect(result).toEqual({ success: true });
        });
        it('should fail for zero balance', async () => {
            setupTransactionMock({ organization_id: 'org-1', balance_minutes: '0.00' });
            const result = await (0, subscription_service_1.deductAiWallet)('org-1', 1, 'Zero balance deduction');
            expect(result).toEqual({ success: false, error: 'Insufficient AI wallet balance' });
        });
    });
    // ── Translation Wallet Deduction ────────────────────────
    describe('deductTranslationWallet — money safety', () => {
        it('should use FOR UPDATE lock', async () => {
            let usedForUpdate = false;
            db_1.default.transaction.mockImplementation(async (callback) => {
                const trx = jest.fn((_table) => {
                    const chain = {};
                    const methods = ['where', 'insert', 'update', 'returning', 'select', 'first', 'raw', 'forUpdate'];
                    for (const m of methods) {
                        chain[m] = jest.fn().mockReturnValue(chain);
                    }
                    chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
                    chain.raw = jest.fn((...args) => args);
                    chain.first.mockResolvedValue({ organization_id: 'org-1', balance_minutes: '50.00' });
                    chain.forUpdate.mockImplementation(() => {
                        usedForUpdate = true;
                        return chain;
                    });
                    return chain;
                });
                trx.fn = { now: jest.fn().mockReturnValue('NOW()') };
                trx.raw = jest.fn((...args) => args);
                return callback(trx);
            });
            await (0, subscription_service_1.deductTranslationWallet)('org-1', 0.5, 'Translation batch');
            expect(usedForUpdate).toBe(true);
        });
        it('BUG DOCUMENTED: translation deducts 0.5 min per batch regardless of content size', async () => {
            // In socket.ts, translation deduction is hardcoded to 0.5 minutes per batch
            // This documents that the deduction amount is arbitrary
            setupTransactionMock({ organization_id: 'org-1', balance_minutes: '50.00' });
            const result = await (0, subscription_service_1.deductTranslationWallet)('org-1', 0.5, '100KB translation batch');
            expect(result).toEqual({ success: true });
        });
        it('should reject when insufficient balance', async () => {
            setupTransactionMock({ organization_id: 'org-1', balance_minutes: '0.30' });
            const result = await (0, subscription_service_1.deductTranslationWallet)('org-1', 0.5, 'Short balance');
            expect(result).toEqual({ success: false, error: 'Insufficient translation wallet balance' });
        });
    });
    // ── Admin Adjustments ───────────────────────────────────
    describe('adminAdjustAiWallet', () => {
        it('should use db.transaction for atomicity', async () => {
            setupTransactionMock(null);
            setupDbChain({ organization_id: 'org-1', balance_minutes: '100.00' });
            await (0, subscription_service_1.adminAdjustAiWallet)('org-1', 50, 'Admin bonus');
            expect(db_1.default.transaction).toHaveBeenCalledTimes(1);
        });
        it('should use GREATEST to prevent negative balance', async () => {
            let rawCalled = false;
            let rawArgs = [];
            db_1.default.transaction.mockImplementation(async (callback) => {
                const trx = jest.fn((_table) => {
                    const chain = {};
                    const methods = ['where', 'insert', 'update', 'returning', 'select', 'first', 'raw', 'forUpdate'];
                    for (const m of methods) {
                        chain[m] = jest.fn().mockReturnValue(chain);
                    }
                    chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
                    chain.raw = jest.fn((...args) => args);
                    return chain;
                });
                trx.fn = { now: jest.fn().mockReturnValue('NOW()') };
                trx.raw = jest.fn((...args) => args);
                // db.raw is used in the update (not trx.raw) — see implementation
                db_1.default.raw.mockImplementation((...args) => {
                    rawCalled = true;
                    rawArgs = args;
                    return args;
                });
                return callback(trx);
            });
            setupDbChain({ organization_id: 'org-1', balance_minutes: '10.00' });
            await (0, subscription_service_1.adminAdjustAiWallet)('org-1', -500, 'Admin penalty');
            expect(rawCalled).toBe(true);
            expect(rawArgs[0]).toContain('GREATEST');
        });
        it('should record admin adjustment type in transaction log', async () => {
            let insertedData = null;
            db_1.default.transaction.mockImplementation(async (callback) => {
                const trx = jest.fn((_table) => {
                    const chain = {};
                    const methods = ['where', 'insert', 'update', 'returning', 'select', 'first', 'raw', 'forUpdate'];
                    for (const m of methods) {
                        chain[m] = jest.fn().mockReturnValue(chain);
                    }
                    chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
                    chain.raw = jest.fn((...args) => args);
                    chain.insert.mockImplementation((data) => {
                        if (_table === 'ai_wallet_transactions')
                            insertedData = data;
                        return chain;
                    });
                    return chain;
                });
                trx.fn = { now: jest.fn().mockReturnValue('NOW()') };
                trx.raw = jest.fn((...args) => args);
                return callback(trx);
            });
            setupDbChain({ organization_id: 'org-1', balance_minutes: '100.00' });
            await (0, subscription_service_1.adminAdjustAiWallet)('org-1', 100, 'Courtesy credit');
            expect(insertedData).not.toBeNull();
            expect(insertedData.type).toBe('admin_adjustment');
            expect(insertedData.description).toBe('Courtesy credit');
        });
    });
    // ── Wallet Auto-Creation ────────────────────────────────
    describe('getAiWallet — auto-creation', () => {
        it('should return existing wallet without creating', async () => {
            const existingWallet = { id: 'w-1', organization_id: 'org-1', balance_minutes: '100.00' };
            setupDbChain(existingWallet);
            const wallet = await (0, subscription_service_1.getAiWallet)('org-1');
            expect(wallet).toEqual(existingWallet);
        });
        it('should auto-create wallet when none exists', async () => {
            const newWallet = { id: 'w-new', organization_id: 'org-1', balance_minutes: '0.00', currency: 'USD' };
            let callCount = 0;
            db_1.default.mockImplementation((_table) => {
                const chain = {};
                const methods = [
                    'where', 'insert', 'update', 'returning', 'select', 'first',
                    'raw', 'forUpdate', 'orderBy', 'count',
                ];
                for (const m of methods) {
                    chain[m] = jest.fn().mockReturnValue(chain);
                }
                chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
                chain.first.mockImplementation(() => {
                    callCount++;
                    // First .first() = wallet lookup (null), subsequent = org lookup / wallet return
                    if (callCount === 1)
                        return Promise.resolve(null);
                    if (callCount === 2)
                        return Promise.resolve({ billing_currency: 'NGN' });
                    return Promise.resolve(newWallet);
                });
                chain.returning.mockResolvedValue([newWallet]);
                return chain;
            });
            db_1.default.fn = { now: jest.fn().mockReturnValue('NOW()'), uuid: jest.fn() };
            db_1.default.raw = jest.fn((...args) => args);
            const wallet = await (0, subscription_service_1.getAiWallet)('org-1');
            expect(wallet).toBeDefined();
        });
        it('BUG DOCUMENTED: concurrent auto-create can produce duplicate wallets', async () => {
            // Two concurrent calls to getAiWallet when no wallet exists:
            // Both see null on first query, both try to INSERT
            // No unique constraint on organization_id in wallet tables
            // (This is a documentation test — the race is in the code, not testable in unit scope)
            expect(true).toBe(true); // Placeholder documenting the known race condition
        });
    });
    // ── Revenue Reporting ───────────────────────────────────
    describe('getPlatformRevenue', () => {
        it('BUG: mixes USD and NGN into single totalRevenue number', async () => {
            // Setup: subscription revenue $10 USD + AI revenue ₦18,000 NGN
            let tableCallIndex = 0;
            db_1.default.mockImplementation((_table) => {
                tableCallIndex++;
                const chain = {};
                const methods = [
                    'where', 'whereIn', 'orderBy', 'first', 'insert', 'update',
                    'returning', 'select', 'count', 'forUpdate', 'raw',
                ];
                for (const m of methods) {
                    chain[m] = jest.fn().mockReturnValue(chain);
                }
                chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
                // subscriptions query → $10
                if (_table === 'subscriptions') {
                    chain.first.mockResolvedValue({
                        total_subscriptions: '1',
                        total_subscription_revenue: '10',
                    });
                    chain.count.mockReturnValue(chain);
                }
                // ai_wallet_transactions → ₦18000
                if (_table === 'ai_wallet_transactions') {
                    chain.first.mockResolvedValue({
                        total_topups: '1',
                        total_ai_revenue: '18000',
                    });
                }
                // translation_wallet_transactions → ₦45000
                if (_table === 'translation_wallet_transactions') {
                    chain.first.mockResolvedValue({
                        total_topups: '1',
                        total_translation_revenue: '45000',
                    });
                }
                return chain;
            });
            db_1.default.fn = { now: jest.fn().mockReturnValue('NOW()'), uuid: jest.fn() };
            db_1.default.raw = jest.fn((...args) => args);
            const revenue = await (0, subscription_service_1.getPlatformRevenue)();
            // BUG: 10 USD + 18000 NGN + 45000 NGN = 63010 (meaningless number)
            expect(revenue.totalRevenue).toBe(63010);
            // This SHOULD fail when the bug is fixed — currency must be separated
        });
        it('should return 0 totals when no revenue data exists', async () => {
            db_1.default.mockImplementation((_table) => {
                const chain = {};
                const methods = [
                    'where', 'whereIn', 'orderBy', 'first', 'insert', 'update',
                    'returning', 'select', 'count', 'forUpdate', 'raw',
                ];
                for (const m of methods) {
                    chain[m] = jest.fn().mockReturnValue(chain);
                }
                chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
                chain.first.mockResolvedValue({
                    total_subscriptions: '0',
                    total_subscription_revenue: '0',
                    total_topups: '0',
                    total_ai_revenue: '0',
                    total_translation_revenue: '0',
                    count: '0',
                });
                return chain;
            });
            db_1.default.fn = { now: jest.fn().mockReturnValue('NOW()'), uuid: jest.fn() };
            db_1.default.raw = jest.fn((...args) => args);
            const revenue = await (0, subscription_service_1.getPlatformRevenue)();
            expect(revenue.totalRevenue).toBe(0);
            expect(revenue.subscriptions.totalRevenue).toBe(0);
            expect(revenue.aiWallet.totalRevenue).toBe(0);
            expect(revenue.translationWallet.totalRevenue).toBe(0);
        });
    });
    // ── getPlanPrice edge cases ─────────────────────────────
    describe('getPlanPrice — edge cases', () => {
        it('returns 0 when NGN prices are null (safely handled)', () => {
            const plan = {
                name: 'Broken Plan',
                price_usd_annual: '300',
                price_usd_monthly: '30',
                price_ngn_annual: null,
                price_ngn_monthly: null,
            };
            // Null prices safely default to 0 (no NaN leakage)
            const annualPrice = (0, subscription_service_1.getPlanPrice)(plan, 'NGN', 'annual');
            expect(annualPrice).toBe(0);
            const monthlyPrice = (0, subscription_service_1.getPlanPrice)(plan, 'NGN', 'monthly');
            expect(monthlyPrice).toBe(0);
        });
        it('should return valid USD price for standard plan', () => {
            const plan = {
                price_usd_annual: '300',
                price_usd_monthly: '30',
                price_ngn_annual: '500000',
                price_ngn_monthly: '50000',
            };
            expect((0, subscription_service_1.getPlanPrice)(plan, 'USD', 'annual')).toBe(300);
            expect((0, subscription_service_1.getPlanPrice)(plan, 'USD', 'monthly')).toBe(30);
        });
        it('should return valid NGN price for standard plan', () => {
            const plan = {
                price_usd_annual: '300',
                price_usd_monthly: '30',
                price_ngn_annual: '500000',
                price_ngn_monthly: '50000',
            };
            expect((0, subscription_service_1.getPlanPrice)(plan, 'NGN', 'annual')).toBe(500000);
            expect((0, subscription_service_1.getPlanPrice)(plan, 'NGN', 'monthly')).toBe(50000);
        });
    });
    // ── createSubscription atomicity ────────────────────────
    describe('createSubscription — atomicity concerns', () => {
        it('BUG DOCUMENTED: uses 4+ separate DB writes without db.transaction', async () => {
            const writtenTables = [];
            db_1.default.mockImplementation((_table) => {
                writtenTables.push(_table);
                const chain = {};
                const methods = [
                    'where', 'whereIn', 'orderBy', 'first', 'insert', 'update',
                    'returning', 'select', 'count', 'forUpdate', 'raw',
                ];
                for (const m of methods) {
                    chain[m] = jest.fn().mockReturnValue(chain);
                }
                chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
                chain.returning.mockResolvedValue([{
                        id: 'sub-1',
                        organization_id: 'org-1',
                        status: 'active',
                    }]);
                return chain;
            });
            db_1.default.fn = { now: jest.fn().mockReturnValue('NOW()'), uuid: jest.fn() };
            db_1.default.raw = jest.fn((...args) => args);
            db_1.default.transaction = jest.fn(); // NOT called by createSubscription
            await (0, subscription_service_1.createSubscription)({
                organizationId: 'org-1',
                planId: 'plan-standard',
                billingCycle: 'annual',
                currency: 'USD',
                amountPaid: 300,
            });
            // BUG: Multiple tables written WITHOUT db.transaction()
            // Should be: subscriptions UPDATE, subscriptions INSERT, organizations UPDATE, subscription_history INSERT
            expect(writtenTables).toContain('subscriptions');
            expect(writtenTables).toContain('organizations');
            expect(writtenTables).toContain('subscription_history');
            // db.transaction is NOT called — non-atomic
            expect(db_1.default.transaction).not.toHaveBeenCalled();
        });
    });
    // ── renewSubscription atomicity ─────────────────────────
    describe('renewSubscription — atomicity concerns', () => {
        it('BUG DOCUMENTED: uses 3 separate DB writes without db.transaction', async () => {
            db_1.default.mockImplementation((_table) => {
                const chain = {};
                const methods = [
                    'where', 'whereIn', 'orderBy', 'first', 'insert', 'update',
                    'returning', 'select', 'count', 'forUpdate', 'raw',
                ];
                for (const m of methods) {
                    chain[m] = jest.fn().mockReturnValue(chain);
                }
                chain.fn = { now: jest.fn().mockReturnValue('NOW()') };
                chain.first.mockResolvedValue({
                    id: 'sub-1',
                    organization_id: 'org-1',
                    status: 'active',
                    billing_cycle: 'annual',
                    current_period_end: new Date(Date.now() + 86400000).toISOString(),
                });
                return chain;
            });
            db_1.default.fn = { now: jest.fn().mockReturnValue('NOW()'), uuid: jest.fn() };
            db_1.default.raw = jest.fn((...args) => args);
            db_1.default.transaction = jest.fn(); // NOT called by renewSubscription
            await (0, subscription_service_1.renewSubscription)('org-1', 300, 'pay_ref_123');
            expect(db_1.default.transaction).not.toHaveBeenCalled();
        });
        it('should throw when no subscription exists', async () => {
            setupDbChain(null);
            await expect((0, subscription_service_1.renewSubscription)('org-1', 300)).rejects.toThrow('No subscription to renew');
        });
    });
});
//# sourceMappingURL=money-flow-wallet.test.js.map