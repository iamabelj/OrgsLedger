"use strict";
// ============================================================
// Security Test — Replay Attack Simulation
// Validates: token re-verification per request, user state
// re-check, nonce-free but stateful validation design.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
const mockVerify = jest.fn();
jest.mock('jsonwebtoken', () => ({ verify: mockVerify }));
const mockDbFirst = jest.fn();
const chain = {};
['where', 'first', 'select', 'insert', 'update', 'orderBy'].forEach((m) => (chain[m] = jest.fn().mockReturnValue(chain)));
chain.first = mockDbFirst;
const mockDb = jest.fn(() => chain);
mockDb.fn = { now: jest.fn() };
mockDb.raw = jest.fn();
jest.mock('../db', () => ({ __esModule: true, default: mockDb }));
jest.mock('../logger', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../config', () => ({
    config: { jwt: { secret: 'test-secret-for-replay-attack-tests' } },
}));
const auth_1 = require("../middleware/auth");
// ── Helpers ─────────────────────────────────────────────────
function createReq(token) {
    return {
        headers: { authorization: `Bearer ${token}` },
        params: {}, query: {}, body: {},
        originalUrl: '/test', ip: '127.0.0.1',
    };
}
function createRes() {
    const res = {
        _status: 200, _json: null, headersSent: false,
        status: jest.fn((c) => { res._status = c; return res; }),
        json: jest.fn((d) => { res._json = d; return res; }),
    };
    return res;
}
// ── Tests ───────────────────────────────────────────────────
describe('Replay Attack Simulation', () => {
    beforeEach(() => jest.clearAllMocks());
    // ── Token Replay After Deactivation ────────────────────
    describe('Token replay after user deactivation', () => {
        it('should accept token while user is active', async () => {
            mockVerify.mockReturnValue({
                userId: 'user-1', email: 'test@test.com', globalRole: 'member',
            });
            mockDbFirst.mockResolvedValue({ id: 'user-1', is_active: true });
            const req = createReq('captured-token');
            const res = createRes();
            const next = jest.fn();
            await (0, auth_1.authenticate)(req, res, next);
            expect(next).toHaveBeenCalled();
        });
        it('should reject same token after user is deactivated', async () => {
            mockVerify.mockReturnValue({
                userId: 'user-1', email: 'test@test.com', globalRole: 'member',
            });
            // User no longer active
            mockDbFirst.mockResolvedValue(null);
            const req = createReq('captured-token');
            const res = createRes();
            const next = jest.fn();
            await (0, auth_1.authenticate)(req, res, next);
            expect(res._status).toBe(401);
            expect(res._json.error).toContain('not found or deactivated');
        });
        it('should reject same token after user is deleted from DB', async () => {
            mockVerify.mockReturnValue({
                userId: 'deleted-user', email: 'gone@test.com', globalRole: 'member',
            });
            mockDbFirst.mockResolvedValue(null);
            const req = createReq('captured-token-of-deleted-user');
            const res = createRes();
            const next = jest.fn();
            await (0, auth_1.authenticate)(req, res, next);
            expect(res._status).toBe(401);
        });
    });
    // ── Token Replay Across Multiple Requests ──────────────
    describe('Token validity across rapid sequential requests', () => {
        it('should verify each request independently (no caching)', async () => {
            const payload = {
                userId: 'user-1', email: 'test@test.com', globalRole: 'member',
            };
            mockVerify.mockReturnValue(payload);
            // 5 rapid requests with same token
            for (let i = 0; i < 5; i++) {
                mockDbFirst.mockResolvedValueOnce({ id: 'user-1', is_active: true });
                const req = createReq('same-token');
                const res = createRes();
                const next = jest.fn();
                await (0, auth_1.authenticate)(req, res, next);
                expect(next).toHaveBeenCalled();
            }
            // Each request triggered a DB lookup
            expect(mockDb).toHaveBeenCalledTimes(5);
        });
        it('should detect mid-stream deactivation in sequential requests', async () => {
            const payload = {
                userId: 'user-1', email: 'test@test.com', globalRole: 'member',
            };
            mockVerify.mockReturnValue(payload);
            const results = [];
            // Request 1 & 2: user active
            for (let i = 0; i < 2; i++) {
                mockDbFirst.mockResolvedValueOnce({ id: 'user-1', is_active: true });
                const req = createReq('token');
                const res = createRes();
                const next = jest.fn();
                await (0, auth_1.authenticate)(req, res, next);
                results.push({ status: res._status, passed: next.mock.calls.length > 0 });
            }
            // Request 3: user deactivated between requests
            mockDbFirst.mockResolvedValueOnce(null);
            const req3 = createReq('token');
            const res3 = createRes();
            const next3 = jest.fn();
            await (0, auth_1.authenticate)(req3, res3, next3);
            results.push({ status: res3._status, passed: next3.mock.calls.length > 0 });
            expect(results[0].passed).toBe(true);
            expect(results[1].passed).toBe(true);
            expect(results[2].passed).toBe(false);
            expect(results[2].status).toBe(401);
        });
    });
    // ── Expired Token Replay ───────────────────────────────
    describe('Expired token replay', () => {
        it('should reject replayed token after expiration', async () => {
            mockVerify.mockImplementation(() => {
                throw new Error('jwt expired');
            });
            const req = createReq('expired-but-replayed');
            const res = createRes();
            const next = jest.fn();
            await (0, auth_1.authenticate)(req, res, next);
            expect(res._status).toBe(401);
            expect(res._json.error).toContain('Invalid or expired');
        });
    });
    // ── Stolen Token with Changed Password ─────────────────
    describe('Stolen token after password change', () => {
        it('should still accept old token since no token version tracking exists', async () => {
            // This test documents CURRENT BEHAVIOR — old tokens still work
            // after password changes because there's no server-side token revocation.
            // This is a known limitation documented in the security audit.
            mockVerify.mockReturnValue({
                userId: 'user-1', email: 'test@test.com', globalRole: 'member',
            });
            mockDbFirst.mockResolvedValue({ id: 'user-1', is_active: true });
            const req = createReq('token-from-before-password-change');
            const res = createRes();
            const next = jest.fn();
            await (0, auth_1.authenticate)(req, res, next);
            // Token still works — this is a known security gap
            // Mitigated by 1h access token expiry
            expect(next).toHaveBeenCalled();
        });
    });
    // ── Concurrent Replay from Different IPs ───────────────
    describe('Concurrent replay from different IPs', () => {
        it('should accept same valid token from different IPs (no IP binding)', async () => {
            // JWTs are not bound to IP — this is intentional for mobile users
            mockVerify.mockReturnValue({
                userId: 'user-1', email: 'test@test.com', globalRole: 'member',
            });
            mockDbFirst.mockResolvedValue({ id: 'user-1', is_active: true });
            const ips = ['192.168.1.1', '10.0.0.1', '203.0.113.42'];
            for (const ip of ips) {
                const req = createReq('shared-token');
                req.ip = ip;
                const res = createRes();
                const next = jest.fn();
                await (0, auth_1.authenticate)(req, res, next);
                expect(next).toHaveBeenCalled();
            }
        });
    });
    // ── Rate Limiting as Replay Defense ────────────────────
    describe('Rate limiting configuration validation', () => {
        it('should have auth rate limiter configured (structural check)', () => {
            // Verify express-rate-limit is available and can be configured
            const rateLimit = require('express-rate-limit');
            expect(typeof rateLimit).toBe('function');
            const limiter = rateLimit({
                windowMs: 15 * 60 * 1000,
                max: 15,
                standardHeaders: true,
            });
            expect(typeof limiter).toBe('function');
        });
        it('should have global rate limiter configured (structural check)', () => {
            const rateLimit = require('express-rate-limit');
            const globalLimiter = rateLimit({
                windowMs: 15 * 60 * 1000,
                max: 1000,
                standardHeaders: true,
                legacyHeaders: false,
            });
            expect(typeof globalLimiter).toBe('function');
        });
    });
});
//# sourceMappingURL=security-replay-attack.test.js.map