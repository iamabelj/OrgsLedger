// ============================================================
// Security Test — Tenant ID Manipulation
// Validates: cross-tenant access prevention at every layer,
// orgId param tampering, membership boundary enforcement.
// ============================================================

const mockVerify = jest.fn();
jest.mock('jsonwebtoken', () => ({ verify: mockVerify }));

const mockDbFirst = jest.fn();
const chain: any = {};
['where', 'first', 'select', 'insert', 'update', 'orderBy'].forEach(
  (m) => (chain[m] = jest.fn().mockReturnValue(chain)),
);
chain.first = mockDbFirst;

const mockDb: any = jest.fn(() => chain);
mockDb.fn = { now: jest.fn() };
mockDb.raw = jest.fn();

jest.mock('../db', () => ({ __esModule: true, default: mockDb }));
jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockGetOrgSubscription = jest.fn();
jest.mock('../services/subscription.service', () => ({
  getOrgSubscription: mockGetOrgSubscription,
  getAiWallet: jest.fn(),
  getTranslationWallet: jest.fn(),
}));

jest.mock('../config', () => ({
  config: { jwt: { secret: 'test-secret-key-12345678901234567' } },
}));

import { Request, Response, NextFunction } from 'express';
import { authenticate, loadMembership } from '../middleware/auth';
import { requireRole, requireSuperAdmin } from '../middleware/rbac';
import { requireActiveSubscription } from '../middleware/subscription';
import { loadMembershipAndSub } from '../middleware/index';

// ── Helpers ─────────────────────────────────────────────────

function createReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {}, params: {}, query: {}, body: {},
    originalUrl: '/test', ip: '127.0.0.1',
    ...overrides,
  } as any;
}

function createRes() {
  const res: any = {
    _status: 200, _json: null, headersSent: false,
    status: jest.fn((c: number) => { res._status = c; return res; }),
    json: jest.fn((d: any) => { res._json = d; res.headersSent = true; return res; }),
  };
  return res as Response & { _status: number; _json: any };
}

function authUser(role = 'member') {
  return { userId: 'user-1', email: 'user@test.com', globalRole: role };
}

// ── Tests ───────────────────────────────────────────────────

describe('Tenant ID Manipulation', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── Cross-Tenant Access ────────────────────────────────

  describe('Cross-tenant access prevention', () => {
    it('should block user from org-A accessing org-B data', async () => {
      // User is member of org-A but tries to access org-B
      mockDbFirst.mockResolvedValue(null); // No membership in org-B

      const req = createReq({
        params: { orgId: 'org-B' },
        user: authUser(),
      } as any);
      const res = createRes();
      const next = jest.fn();

      await loadMembership(req, res, next);

      expect(res._status).toBe(403);
      expect(res._json.error).toContain('Not a member');
      expect(next).not.toHaveBeenCalled();
    });

    it('should allow user within their own organization', async () => {
      mockDbFirst.mockResolvedValue({
        id: 'mem-1', role: 'member',
        organization_id: 'org-A', is_active: true,
      });

      const req = createReq({
        params: { orgId: 'org-A' },
        user: authUser(),
      } as any);
      const res = createRes();
      const next = jest.fn();

      await loadMembership(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.membership!.organizationId).toBe('org-A');
    });

    it('should NOT leak membership data from other orgs in response', async () => {
      mockDbFirst.mockResolvedValue(null);

      const req = createReq({
        params: { orgId: 'org-secret' },
        user: authUser(),
      } as any);
      const res = createRes();
      const next = jest.fn();

      await loadMembership(req, res, next);

      // Response should not contain any org-secret internal data
      expect(res._json).not.toHaveProperty('membership');
      expect(res._json).not.toHaveProperty('members');
      expect(res._json.error).toContain('Not a member');
    });
  });

  // ── OrgId Param Tampering ──────────────────────────────

  describe('OrgId parameter tampering', () => {
    it('should reject when orgId is missing', async () => {
      const req = createReq({
        params: {},
        user: authUser(),
      } as any);
      const res = createRes();
      const next = jest.fn();

      await loadMembership(req, res, next);

      expect(res._status).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('should handle SQL injection in orgId param', async () => {
      // Even if orgId contains SQL injection, knex parameterizes it
      mockDbFirst.mockResolvedValue(null);

      const req = createReq({
        params: { orgId: "' OR 1=1; DROP TABLE memberships; --" },
        user: authUser(),
      } as any);
      const res = createRes();
      const next = jest.fn();

      await loadMembership(req, res, next);

      // Should return 403, not crash or execute SQL
      expect(res._status).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject empty string orgId', async () => {
      const req = createReq({
        params: { orgId: '' },
        user: authUser(),
      } as any);
      const res = createRes();
      const next = jest.fn();

      await loadMembership(req, res, next);

      // Empty string is falsy, should be rejected
      expect(res._status).toBe(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('should handle orgId with path traversal characters', async () => {
      mockDbFirst.mockResolvedValue(null);

      const req = createReq({
        params: { orgId: '../../../etc/passwd' },
        user: authUser(),
      } as any);
      const res = createRes();
      const next = jest.fn();

      await loadMembership(req, res, next);

      expect(res._status).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ── Role Escalation via Tenant Switching ───────────────

  describe('Role escalation via tenant switching', () => {
    it('should NOT carry role from org-A into org-B', async () => {
      // User is admin in org-A, member in org-B
      // Ensure we check the CORRECT org membership

      // First request: org-A (admin)
      mockDbFirst.mockResolvedValueOnce({
        id: 'mem-1', role: 'org_admin',
        organization_id: 'org-A', is_active: true,
      });

      const reqA = createReq({
        params: { orgId: 'org-A' },
        user: authUser(),
      } as any);
      const resA = createRes();
      const nextA = jest.fn();
      await loadMembership(reqA, resA, nextA);
      expect(reqA.membership!.role).toBe('org_admin');

      // Second request: org-B (member)
      mockDbFirst.mockResolvedValueOnce({
        id: 'mem-2', role: 'member',
        organization_id: 'org-B', is_active: true,
      });

      const reqB = createReq({
        params: { orgId: 'org-B' },
        user: authUser(),
      } as any);
      const resB = createRes();
      const nextB = jest.fn();
      await loadMembership(reqB, resB, nextB);
      expect(reqB.membership!.role).toBe('member');

      // Verify role isolation between orgs
      expect(reqA.membership!.role).toBe('org_admin');
      expect(reqB.membership!.role).toBe('member');
    });

    it('should re-query membership on every request (stateless)', async () => {
      mockDbFirst.mockResolvedValue({
        id: 'mem-1', role: 'member',
        organization_id: 'org-1', is_active: true,
      });

      const req1 = createReq({ params: { orgId: 'org-1' }, user: authUser() } as any);
      const req2 = createReq({ params: { orgId: 'org-1' }, user: authUser() } as any);

      await loadMembership(req1, createRes(), jest.fn());
      await loadMembership(req2, createRes(), jest.fn());

      // DB was queried twice — no caching between requests
      expect(mockDb).toHaveBeenCalledTimes(2);
    });
  });

  // ── Super Admin Boundary ───────────────────────────────

  describe('Super admin boundary', () => {
    it('should grant super_admin access to any org without DB lookup', async () => {
      const req = createReq({
        params: { orgId: 'any-org-id' },
        user: authUser('super_admin'),
      } as any);
      const res = createRes();
      const next = jest.fn();

      await loadMembership(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockDb).not.toHaveBeenCalled(); // No DB lookup needed
    });

    it('should not allow regular user to pretend to be super_admin via body', async () => {
      // Attacker sets globalRole in request body — should be ignored
      mockVerify.mockReturnValue({
        userId: 'user-1', email: 'user@test.com', globalRole: 'member',
      });
      mockDbFirst.mockResolvedValue({ id: 'user-1', is_active: true });

      const req = createReq({
        headers: { authorization: 'Bearer valid-token' } as any,
      });
      (req as any).body = { globalRole: 'super_admin' };
      const res = createRes();
      const next = jest.fn();

      await authenticate(req, res, next);

      // Auth payload comes from JWT, not body
      expect(req.user!.globalRole).toBe('member');
    });

    it('should reject forged super_admin in requireSuperAdmin middleware', () => {
      const middleware = requireSuperAdmin();
      const req = createReq({
        user: { userId: 'u1', email: 'a@b.c', globalRole: 'member' },
      } as any);
      const res = createRes();
      const next = jest.fn();

      middleware(req, res, next);

      expect(res._status).toBe(403);
      expect(res._json.error).toContain('Super admin');
    });
  });

  // ── Inactive Membership ────────────────────────────────

  describe('Inactive membership handling', () => {
    it('should reject inactive membership (is_active = false)', async () => {
      // DB query uses WHERE is_active = true, so inactive returns null
      mockDbFirst.mockResolvedValue(null);

      const req = createReq({
        params: { orgId: 'org-1' },
        user: authUser(),
      } as any);
      const res = createRes();
      const next = jest.fn();

      await loadMembership(req, res, next);

      expect(res._status).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ── Full Stack: Auth → Membership → Subscription ──────

  describe('Full middleware chain isolation', () => {
    it('should block expired subscription even for valid member', async () => {
      mockDbFirst.mockResolvedValue({
        id: 'mem-1', role: 'member',
        organization_id: 'org-1', is_active: true,
      });
      mockGetOrgSubscription.mockResolvedValue({
        status: 'expired',
        plan: { name: 'Standard' },
        current_period_end: '2025-01-01',
      });

      const req = createReq({
        params: { orgId: 'org-1' },
        user: authUser(),
      } as any);
      const res = createRes();
      const next = jest.fn();

      // Run combined middleware
      loadMembershipAndSub(req, res, next);
      await new Promise((r) => setTimeout(r, 100));

      expect(res._status).toBe(402);
      expect(res._json.code).toBe('SUBSCRIPTION_EXPIRED');
      expect(next).not.toHaveBeenCalled();
    });

    it('should enforce org_admin role check AFTER membership + subscription', () => {
      const middleware = requireRole('org_admin');
      const req = createReq({
        user: authUser(),
        membership: {
          id: 'mem-1', role: 'member',
          organizationId: 'org-1', isActive: true,
        },
      } as any);
      const res = createRes();
      const next = jest.fn();

      middleware(req, res, next);

      expect(res._status).toBe(403);
      expect(res._json.error).toContain('Insufficient permissions');
    });

    it('should block org-B subscription check when user is in org-A', async () => {
      // User passes auth but has no membership in org-B
      mockDbFirst.mockResolvedValue(null);

      const req = createReq({
        params: { orgId: 'org-B' },
        user: authUser(),
      } as any);
      const res = createRes();
      const next = jest.fn();

      loadMembershipAndSub(req, res, next);
      await new Promise((r) => setTimeout(r, 100));

      // Rejected at membership level — subscription never checked
      expect(res._status).toBe(403);
      expect(mockGetOrgSubscription).not.toHaveBeenCalled();
    });
  });

  // ── Concurrent Tenant Access ───────────────────────────

  describe('Concurrent tenant access', () => {
    it('should independently validate parallel requests to different orgs', async () => {
      // Simulate two concurrent requests from same user to different orgs
      const makeRequest = async (orgId: string, hasMembership: boolean) => {
        mockDbFirst.mockResolvedValueOnce(
          hasMembership ? {
            id: `mem-${orgId}`, role: 'member',
            organization_id: orgId, is_active: true,
          } : null,
        );

        const req = createReq({ params: { orgId }, user: authUser() } as any);
        const res = createRes();
        const next = jest.fn();
        await loadMembership(req, res, next);
        return { req, res, next };
      };

      const [r1, r2] = await Promise.all([
        makeRequest('org-allowed', true),
        makeRequest('org-blocked', false),
      ]);

      expect(r1.next).toHaveBeenCalled();
      expect(r1.req.membership!.organizationId).toBe('org-allowed');

      expect(r2.res._status).toBe(403);
      expect(r2.next).not.toHaveBeenCalled();
    });
  });
});
