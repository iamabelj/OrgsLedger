// ============================================================
// Unit Tests — Tenant Isolation Middleware
// Coverage target: 100% critical paths
//
// Tests: authenticate, loadMembership, requireRole,
// requireSuperAdmin, requireActiveSubscription,
// loadMembershipAndSub (combined)
// ============================================================

// ── Setup mocks BEFORE imports ─────────────────────────────

// Mock jsonwebtoken
const mockVerify = jest.fn();
jest.mock('jsonwebtoken', () => ({
  verify: mockVerify,
}));

// Mock db
const mockDbFirst = jest.fn();
const mockDbWhere = jest.fn();
const mockDbChain: any = {};
['where', 'first', 'select', 'insert', 'update', 'pluck'].forEach((m) => {
  mockDbChain[m] = jest.fn().mockReturnValue(mockDbChain);
});
mockDbChain.first = mockDbFirst;
mockDbChain.where = mockDbWhere.mockReturnValue(mockDbChain);

const mockDb: any = jest.fn((_table: string) => mockDbChain);
mockDb.fn = { now: jest.fn().mockReturnValue('NOW()') };
mockDb.raw = jest.fn((...args: any[]) => args);

jest.mock('../db', () => ({ __esModule: true, default: mockDb }));
jest.mock('../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock the subscription service for middleware/subscription.ts
const mockGetOrgSubscription = jest.fn();
const mockGetAiWallet = jest.fn();
const mockGetTranslationWallet = jest.fn();
jest.mock('../services/subscription.service', () => ({
  getOrgSubscription: mockGetOrgSubscription,
  getAiWallet: mockGetAiWallet,
  getTranslationWallet: mockGetTranslationWallet,
}));

jest.mock('../config', () => ({
  config: {
    jwt: { secret: 'test-secret' },
  },
}));

import { Request, Response, NextFunction } from 'express';
import { authenticate, loadMembership } from '../middleware/auth';
import { requireRole, requireSuperAdmin } from '../middleware/rbac';
import { requireActiveSubscription, checkAiWallet, checkTranslationWallet } from '../middleware/subscription';
import { loadMembershipAndSub } from '../middleware/index';

// ── Helpers ─────────────────────────────────────────────────

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    params: {},
    query: {},
    body: {},
    originalUrl: '/test',
    ip: '127.0.0.1',
    user: undefined,
    membership: undefined,
    ...overrides,
  } as any;
}

function createMockRes(): Response & { _status: number; _json: any; _headersSent: boolean } {
  const res: any = {
    _status: 200,
    _json: null,
    _headersSent: false,
    headersSent: false,
    status: jest.fn(function (code: number) {
      res._status = code;
      return res;
    }),
    json: jest.fn(function (data: any) {
      res._json = data;
      res._headersSent = true;
      res.headersSent = true;
      return res;
    }),
  };
  return res;
}

// ── Tests ───────────────────────────────────────────────────

describe('Tenant Isolation Middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── authenticate ────────────────────────────────────────

  describe('authenticate', () => {
    it('should reject request without Authorization header', async () => {
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(res._status).toBe(401);
      expect(res._json.success).toBe(false);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject request with invalid Bearer format', async () => {
      const req = createMockReq({
        headers: { authorization: 'Basic abc123' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(res._status).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject invalid/expired token', async () => {
      mockVerify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      const req = createMockReq({
        headers: { authorization: 'Bearer expired-token' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(res._status).toBe(401);
      expect(res._json.error).toContain('Invalid or expired');
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject deactivated user', async () => {
      mockVerify.mockReturnValue({ userId: 'user-1', email: 'test@test.com', globalRole: 'member' });
      mockDbFirst.mockResolvedValue(null); // User not found / deactivated

      const req = createMockReq({
        headers: { authorization: 'Bearer valid-token' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(res._status).toBe(401);
      expect(res._json.error).toContain('not found or deactivated');
      expect(next).not.toHaveBeenCalled();
    });

    it('should set req.user and call next for valid token', async () => {
      mockVerify.mockReturnValue({ userId: 'user-1', email: 'test@test.com', globalRole: 'member' });
      mockDbFirst.mockResolvedValue({ id: 'user-1', is_active: true });

      const req = createMockReq({
        headers: { authorization: 'Bearer valid-token' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      await authenticate(req, res, next);

      expect(req.user).toEqual({ userId: 'user-1', email: 'test@test.com', globalRole: 'member' });
      expect(next).toHaveBeenCalledWith();
    });
  });

  // ── loadMembership ──────────────────────────────────────

  describe('loadMembership', () => {
    it('should reject when no orgId param', async () => {
      const req = createMockReq({ params: {}, user: { userId: 'u1', email: 'a@b.c', globalRole: 'member' } } as any);
      const res = createMockRes();
      const next = jest.fn();

      await loadMembership(req, res, next);

      expect(res._status).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject when no user set', async () => {
      const req = createMockReq({ params: { orgId: 'org-1' } } as any);
      const res = createMockRes();
      const next = jest.fn();

      await loadMembership(req, res, next);

      expect(res._status).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('should grant org_admin access to super_admin', async () => {
      const req = createMockReq({
        params: { orgId: 'org-1' },
        user: { userId: 'admin-1', email: 'admin@test.com', globalRole: 'super_admin' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      await loadMembership(req, res, next);

      expect(req.membership).toEqual({
        id: 'super_admin',
        role: 'org_admin',
        organizationId: 'org-1',
        isActive: true,
      });
      expect(next).toHaveBeenCalledWith();
    });

    it('should reject non-member of organization', async () => {
      mockDbFirst.mockResolvedValue(null);

      const req = createMockReq({
        params: { orgId: 'org-1' },
        user: { userId: 'user-1', email: 'test@test.com', globalRole: 'member' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      await loadMembership(req, res, next);

      expect(res._status).toBe(403);
      expect(res._json.error).toContain('Not a member');
      expect(next).not.toHaveBeenCalled();
    });

    it('should load membership for valid member', async () => {
      mockDbFirst.mockResolvedValue({
        id: 'mem-1',
        role: 'executive',
        organization_id: 'org-1',
        is_active: true,
      });

      const req = createMockReq({
        params: { orgId: 'org-1' },
        user: { userId: 'user-1', email: 'test@test.com', globalRole: 'member' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      await loadMembership(req, res, next);

      expect(req.membership).toEqual({
        id: 'mem-1',
        role: 'executive',
        organizationId: 'org-1',
        isActive: true,
      });
      expect(next).toHaveBeenCalledWith();
    });

    it('should prevent cross-tenant access — user in org-A cannot access org-B', async () => {
      // User is member of org-A, trying to access org-B
      mockDbFirst.mockResolvedValue(null); // No membership in org-B

      const req = createMockReq({
        params: { orgId: 'org-B' },
        user: { userId: 'user-1', email: 'test@test.com', globalRole: 'member' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      await loadMembership(req, res, next);

      expect(res._status).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ── requireRole ─────────────────────────────────────────

  describe('requireRole', () => {
    it('should reject when no user', () => {
      const middleware = requireRole('org_admin');
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      middleware(req, res, next);

      expect(res._status).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('should always allow super_admin', () => {
      const middleware = requireRole('org_admin');
      const req = createMockReq({
        user: { userId: 'u1', email: 'a@b.c', globalRole: 'super_admin' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should reject when no membership loaded', () => {
      const middleware = requireRole('org_admin');
      const req = createMockReq({
        user: { userId: 'u1', email: 'a@b.c', globalRole: 'member' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      middleware(req, res, next);

      expect(res._status).toBe(403);
      expect(res._json.error).toContain('membership required');
      expect(next).not.toHaveBeenCalled();
    });

    it('should allow exact role match', () => {
      const middleware = requireRole('executive');
      const req = createMockReq({
        user: { userId: 'u1', email: 'a@b.c', globalRole: 'member' },
        membership: { id: 'm1', role: 'executive', organizationId: 'org-1', isActive: true },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should allow higher role via hierarchy', () => {
      const middleware = requireRole('member');
      const req = createMockReq({
        user: { userId: 'u1', email: 'a@b.c', globalRole: 'member' },
        membership: { id: 'm1', role: 'org_admin', organizationId: 'org-1', isActive: true },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should reject lower role', () => {
      const middleware = requireRole('org_admin');
      const req = createMockReq({
        user: { userId: 'u1', email: 'a@b.c', globalRole: 'member' },
        membership: { id: 'm1', role: 'member', organizationId: 'org-1', isActive: true },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      middleware(req, res, next);

      expect(res._status).toBe(403);
      expect(res._json.error).toContain('Insufficient permissions');
      expect(next).not.toHaveBeenCalled();
    });

    it('should accept any of multiple allowed roles', () => {
      const middleware = requireRole('org_admin', 'executive');
      const req = createMockReq({
        user: { userId: 'u1', email: 'a@b.c', globalRole: 'member' },
        membership: { id: 'm1', role: 'executive', organizationId: 'org-1', isActive: true },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  // ── requireSuperAdmin ───────────────────────────────────

  describe('requireSuperAdmin', () => {
    it('should be a factory function returning middleware', () => {
      const middleware = requireSuperAdmin();
      expect(typeof middleware).toBe('function');
    });

    it('should reject non-super_admin', () => {
      const middleware = requireSuperAdmin();
      const req = createMockReq({
        user: { userId: 'u1', email: 'a@b.c', globalRole: 'member' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      middleware(req, res, next);

      expect(res._status).toBe(403);
      expect(res._json.error).toContain('Super admin');
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject when no user', () => {
      const middleware = requireSuperAdmin();
      const req = createMockReq();
      const res = createMockRes();
      const next = jest.fn();

      middleware(req, res, next);

      expect(res._status).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should allow super_admin through', () => {
      const middleware = requireSuperAdmin();
      const req = createMockReq({
        user: { userId: 'admin-1', email: 'admin@test.com', globalRole: 'super_admin' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  // ── requireActiveSubscription ───────────────────────────

  describe('requireActiveSubscription', () => {
    it('should bypass for super_admin', async () => {
      const req = createMockReq({
        params: { orgId: 'org-1' },
        user: { userId: 'admin-1', email: 'a@b.c', globalRole: 'super_admin' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockGetOrgSubscription).not.toHaveBeenCalled();
    });

    it('should skip when no orgId', async () => {
      const req = createMockReq({
        params: {},
        user: { userId: 'u1', email: 'a@b.c', globalRole: 'member' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should return 402 when no subscription exists', async () => {
      mockGetOrgSubscription.mockResolvedValue(null);

      const req = createMockReq({
        params: { orgId: 'org-1' },
        user: { userId: 'u1', email: 'a@b.c', globalRole: 'member' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(res._status).toBe(402);
      expect(res._json.code).toBe('NO_SUBSCRIPTION');
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 402 for expired subscription', async () => {
      mockGetOrgSubscription.mockResolvedValue({
        status: 'expired',
        plan: { name: 'Standard' },
        current_period_end: '2025-01-01',
      });

      const req = createMockReq({
        params: { orgId: 'org-1' },
        user: { userId: 'u1', email: 'a@b.c', globalRole: 'member' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(res._status).toBe(402);
      expect(res._json.code).toBe('SUBSCRIPTION_EXPIRED');
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 402 for cancelled subscription', async () => {
      mockGetOrgSubscription.mockResolvedValue({ status: 'cancelled', plan: { name: 'Pro' } });

      const req = createMockReq({
        params: { orgId: 'org-1' },
        user: { userId: 'u1', email: 'a@b.c', globalRole: 'member' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(res._status).toBe(402);
      expect(res._json.code).toBe('SUBSCRIPTION_EXPIRED');
    });

    it('should return 402 for suspended subscription', async () => {
      mockGetOrgSubscription.mockResolvedValue({ status: 'suspended', plan: { name: 'Enterprise' } });

      const req = createMockReq({
        params: { orgId: 'org-1' },
        user: { userId: 'u1', email: 'a@b.c', globalRole: 'member' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(res._status).toBe(402);
      expect(res._json.code).toBe('SUBSCRIPTION_EXPIRED');
    });

    it('should allow active subscription through', async () => {
      const sub = { status: 'active', plan: { name: 'Standard' } };
      mockGetOrgSubscription.mockResolvedValue(sub);

      const req = createMockReq({
        params: { orgId: 'org-1' },
        user: { userId: 'u1', email: 'a@b.c', globalRole: 'member' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(next).toHaveBeenCalled();
      expect((req as any).subscription).toEqual(sub);
    });

    it('should allow grace_period subscription through', async () => {
      const sub = { status: 'grace_period', plan: { name: 'Pro' } };
      mockGetOrgSubscription.mockResolvedValue(sub);

      const req = createMockReq({
        params: { orgId: 'org-1' },
        user: { userId: 'u1', email: 'a@b.c', globalRole: 'member' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(next).toHaveBeenCalled();
      expect((req as any).subscription).toEqual(sub);
    });

    it('should use organizationId from request if orgId param missing', async () => {
      const sub = { status: 'active', plan: { name: 'Standard' } };
      mockGetOrgSubscription.mockResolvedValue(sub);

      const req = createMockReq({
        params: {},
        user: { userId: 'u1', email: 'a@b.c', globalRole: 'member' },
      } as any);
      (req as any).organizationId = 'org-from-body';
      const res = createMockRes();
      const next = jest.fn();

      await requireActiveSubscription(req, res, next);

      expect(mockGetOrgSubscription).toHaveBeenCalledWith('org-from-body');
      expect(next).toHaveBeenCalled();
    });
  });

  // ── checkAiWallet ───────────────────────────────────────

  describe('checkAiWallet', () => {
    it('should set wallet balance on request', async () => {
      mockGetAiWallet.mockResolvedValue({ balance_minutes: '120.50' });

      const req = createMockReq({ params: { orgId: 'org-1' } } as any);
      const res = createMockRes();
      const next = jest.fn();

      await checkAiWallet(req, res, next);

      expect((req as any).aiWalletBalance).toBe(120.5);
      expect((req as any).aiWalletEmpty).toBe(false);
      expect(next).toHaveBeenCalled();
    });

    it('should mark wallet as empty when balance is 0', async () => {
      mockGetAiWallet.mockResolvedValue({ balance_minutes: '0' });

      const req = createMockReq({ params: { orgId: 'org-1' } } as any);
      const res = createMockRes();
      const next = jest.fn();

      await checkAiWallet(req, res, next);

      expect((req as any).aiWalletEmpty).toBe(true);
      expect(next).toHaveBeenCalled();
    });

    it('should still call next on error (soft check)', async () => {
      mockGetAiWallet.mockRejectedValue(new Error('DB error'));

      const req = createMockReq({ params: { orgId: 'org-1' } } as any);
      const res = createMockRes();
      const next = jest.fn();

      await checkAiWallet(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  // ── checkTranslationWallet ──────────────────────────────

  describe('checkTranslationWallet', () => {
    it('should set wallet balance on request', async () => {
      mockGetTranslationWallet.mockResolvedValue({ balance_minutes: '60.00' });

      const req = createMockReq({ params: { orgId: 'org-1' } } as any);
      const res = createMockRes();
      const next = jest.fn();

      await checkTranslationWallet(req, res, next);

      expect((req as any).translationWalletBalance).toBe(60);
      expect((req as any).translationWalletEmpty).toBe(false);
      expect(next).toHaveBeenCalled();
    });

    it('should mark wallet as empty when balance is negative', async () => {
      mockGetTranslationWallet.mockResolvedValue({ balance_minutes: '-5.00' });

      const req = createMockReq({ params: { orgId: 'org-1' } } as any);
      const res = createMockRes();
      const next = jest.fn();

      await checkTranslationWallet(req, res, next);

      expect((req as any).translationWalletEmpty).toBe(true);
      expect(next).toHaveBeenCalled();
    });
  });

  // ── loadMembershipAndSub (combined) ─────────────────────

  describe('loadMembershipAndSub', () => {
    it('should reject non-member before checking subscription', async () => {
      mockDbFirst.mockResolvedValue(null); // No membership

      const req = createMockReq({
        params: { orgId: 'org-1' },
        user: { userId: 'u1', email: 'a@b.c', globalRole: 'member' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      loadMembershipAndSub(req, res, next);

      // Wait for async resolution
      await new Promise((r) => setTimeout(r, 50));

      expect(res._status).toBe(403);
      expect(mockGetOrgSubscription).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('should check subscription after successful membership load', async () => {
      mockDbFirst.mockResolvedValue({
        id: 'mem-1',
        role: 'member',
        organization_id: 'org-1',
        is_active: true,
      });
      mockGetOrgSubscription.mockResolvedValue({ status: 'active', plan: { name: 'Standard' } });

      const req = createMockReq({
        params: { orgId: 'org-1' },
        user: { userId: 'u1', email: 'a@b.c', globalRole: 'member' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      loadMembershipAndSub(req, res, next);

      await new Promise((r) => setTimeout(r, 50));

      expect(req.membership).toBeDefined();
      expect(mockGetOrgSubscription).toHaveBeenCalledWith('org-1');
      expect(next).toHaveBeenCalled();
    });

    it('should block when subscription is expired even if member', async () => {
      mockDbFirst.mockResolvedValue({
        id: 'mem-1',
        role: 'member',
        organization_id: 'org-1',
        is_active: true,
      });
      mockGetOrgSubscription.mockResolvedValue({
        status: 'expired',
        plan: { name: 'Standard' },
        current_period_end: '2025-01-01',
      });

      const req = createMockReq({
        params: { orgId: 'org-1' },
        user: { userId: 'u1', email: 'a@b.c', globalRole: 'member' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      loadMembershipAndSub(req, res, next);

      await new Promise((r) => setTimeout(r, 50));

      expect(res._status).toBe(402);
      expect(next).not.toHaveBeenCalled();
    });

    it('should allow super_admin to bypass both checks', async () => {
      const req = createMockReq({
        params: { orgId: 'org-1' },
        user: { userId: 'admin-1', email: 'admin@test.com', globalRole: 'super_admin' },
      } as any);
      const res = createMockRes();
      const next = jest.fn();

      loadMembershipAndSub(req, res, next);

      await new Promise((r) => setTimeout(r, 50));

      // super_admin bypasses loadMembership (gets synthetic admin role)
      // and bypasses requireActiveSubscription
      expect(next).toHaveBeenCalled();
    });
  });
});
