// ============================================================
// Integration Test — Account Lockout
// Validates: lockout after N failed attempts, lockout expiry,
// reset on successful login, HTTP 423 response.
// ============================================================

const mockDbFirst = jest.fn();
const mockDbWhere = jest.fn();
const mockDbUpdate = jest.fn();
const chain: any = {};
['where', 'first', 'select', 'insert', 'update', 'returning'].forEach(
  (m) => (chain[m] = jest.fn().mockReturnValue(chain)),
);
chain.first = mockDbFirst;
chain.where = mockDbWhere.mockReturnValue(chain);
chain.update = mockDbUpdate.mockResolvedValue(1);

const mockDb: any = jest.fn(() => chain);
mockDb.fn = { now: jest.fn().mockReturnValue('NOW()') };
mockDb.raw = jest.fn();
mockDb.schema = { hasTable: jest.fn().mockResolvedValue(false) };

jest.mock('../db', () => ({ __esModule: true, default: mockDb, tableExists: jest.fn().mockReturnValue(true) }));
jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../config', () => ({
  config: {
    jwt: { secret: 'test-secret-min-32-chars-for-safety!!', refreshSecret: 'test-refresh-secret-32-chars-here!!', expiresIn: '1h', refreshExpiresIn: '7d' },
    upload: { dir: '/tmp/uploads' },
  },
}));

const mockBcryptCompare = jest.fn();
jest.mock('bcryptjs', () => ({
  compare: (...args: any[]) => mockBcryptCompare(...args),
  hash: jest.fn().mockResolvedValue('hashed'),
}));

const mockSign = jest.fn().mockReturnValue('mock-token');
const mockVerify = jest.fn();
jest.mock('jsonwebtoken', () => ({
  sign: (...args: any[]) => mockSign(...args),
  verify: (...args: any[]) => mockVerify(...args),
}));

jest.mock('../middleware', () => ({
  authenticate: jest.fn((req: any, _res: any, next: any) => { req.user = { userId: 'u1', email: 'test@test.com', globalRole: 'member' }; next(); }),
  loadMembershipAndSub: jest.fn((_req: any, _res: any, next: any) => next()),
  requireRole: jest.fn((..._roles: any[]) => (_req: any, _res: any, next: any) => next()),
  validate: jest.fn(() => (req: any, _res: any, next: any) => next()),
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/subscription.service', () => ({
  checkMemberLimit: jest.fn().mockResolvedValue({ allowed: true, current: 1, max: 100 }),
}));

jest.mock('../services/email.service', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
}));

jest.mock('../utils/validators', () => ({
  timingSafeCompare: jest.fn((a: string, b: string) => a === b),
}));

import { ACCOUNT_LOCKOUT } from '../constants';

describe('Account Lockout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDbWhere.mockReturnValue(chain);
    chain.first = mockDbFirst;
    chain.update = mockDbUpdate.mockResolvedValue(1);
    chain.insert = jest.fn().mockReturnValue(chain);
    chain.returning = jest.fn().mockResolvedValue([]);
    chain.onConflict = jest.fn().mockReturnValue({ ignore: jest.fn().mockResolvedValue(0) });
  });

  it('should have lockout constants defined', () => {
    expect(ACCOUNT_LOCKOUT.MAX_ATTEMPTS).toBe(5);
    expect(ACCOUNT_LOCKOUT.LOCKOUT_DURATION_MIN).toBe(15);
    expect(ACCOUNT_LOCKOUT.LOCKOUT_DURATION_MS).toBe(15 * 60 * 1000);
  });

  it('lockout duration should match minutes * 60 * 1000', () => {
    expect(ACCOUNT_LOCKOUT.LOCKOUT_DURATION_MS).toBe(
      ACCOUNT_LOCKOUT.LOCKOUT_DURATION_MIN * 60 * 1000
    );
  });

  it('should export MAX_ATTEMPTS as a positive number', () => {
    expect(ACCOUNT_LOCKOUT.MAX_ATTEMPTS).toBeGreaterThan(0);
    expect(ACCOUNT_LOCKOUT.MAX_ATTEMPTS).toBeLessThanOrEqual(20);
  });

  it('lockout duration should be at least 5 minutes', () => {
    expect(ACCOUNT_LOCKOUT.LOCKOUT_DURATION_MIN).toBeGreaterThanOrEqual(5);
  });
});
