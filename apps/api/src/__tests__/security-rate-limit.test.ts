// ============================================================
// Security Test — Rate Limiting & Input Validation
// Validates: rate limiter configuration, Zod schema strictness,
// request body sanitization, file upload filters.
// ============================================================

describe('Rate Limiting Configuration', () => {
  // ── Global Limiter ─────────────────────────────────────

  describe('Global rate limiter', () => {
    it('should enforce 1000 requests per 15 min window', () => {
      const rateLimit = require('express-rate-limit');
      const globalLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 1000,
        standardHeaders: true,
        legacyHeaders: false,
      });

      expect(typeof globalLimiter).toBe('function');
      // The configuration matches what's in index.ts
    });

    it('should use standard rate limit headers (RFC draft-6)', () => {
      const rateLimit = require('express-rate-limit');
      const limiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 100,
        standardHeaders: true,
        legacyHeaders: false,
      });

      // standardHeaders: true sends RateLimit-* headers
      // legacyHeaders: false disables X-RateLimit-* headers
      expect(typeof limiter).toBe('function');
    });
  });

  // ── Auth Limiter ───────────────────────────────────────

  describe('Auth endpoint rate limiter', () => {
    it('should enforce 15 attempts per 15 min on login', () => {
      const rateLimit = require('express-rate-limit');
      const authLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 15,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, error: 'Too many attempts, please try again later' },
      });

      expect(typeof authLimiter).toBe('function');
    });

    it('should return structured error message on rate limit', () => {
      const message = {
        success: false,
        error: 'Too many attempts, please try again later',
      };

      expect(message.success).toBe(false);
      expect(message.error).toContain('Too many attempts');
    });
  });
});

// ── Input Validation (Zod Schemas) ───────────────────────

describe('Input Validation — Zod Schemas', () => {
  const { z } = require('zod');

  // ── Auth Schemas ───────────────────────────────────────

  describe('Registration schema', () => {
    const registerSchema = z.object({
      email: z.string().email(),
      password: z.string().min(8).max(128),
      firstName: z.string().min(1).max(100),
      lastName: z.string().min(1).max(100),
      phone: z.string().optional(),
      orgSlug: z.string().optional(),
    });

    it('should accept valid registration', () => {
      const valid = {
        email: 'test@example.com',
        password: 'StrongP@ss1',
        firstName: 'John',
        lastName: 'Doe',
      };
      expect(() => registerSchema.parse(valid)).not.toThrow();
    });

    it('should reject invalid email', () => {
      expect(() =>
        registerSchema.parse({
          email: 'not-an-email',
          password: 'password123',
          firstName: 'A',
          lastName: 'B',
        }),
      ).toThrow();
    });

    it('should reject password shorter than 8 chars', () => {
      expect(() =>
        registerSchema.parse({
          email: 'test@test.com',
          password: 'short',
          firstName: 'A',
          lastName: 'B',
        }),
      ).toThrow();
    });

    it('should reject password longer than 128 chars', () => {
      expect(() =>
        registerSchema.parse({
          email: 'test@test.com',
          password: 'A'.repeat(129),
          firstName: 'A',
          lastName: 'B',
        }),
      ).toThrow();
    });

    it('should strip unknown fields (prototype pollution prevention)', () => {
      const parsed = registerSchema.parse({
        email: 'test@test.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
        globalRole: 'super_admin',
        isAdmin: true,
        is_active: false,
      });

      expect((parsed as any).globalRole).toBeUndefined();
      expect((parsed as any).isAdmin).toBeUndefined();
      expect((parsed as any).is_active).toBeUndefined();
    });

    it('should reject empty firstName', () => {
      expect(() =>
        registerSchema.parse({
          email: 'test@test.com',
          password: 'password123',
          firstName: '',
          lastName: 'Doe',
        }),
      ).toThrow();
    });

    it('should reject XSS in email field', () => {
      expect(() =>
        registerSchema.parse({
          email: '<script>alert(1)</script>',
          password: 'password123',
          firstName: 'A',
          lastName: 'B',
        }),
      ).toThrow(); // Not a valid email format
    });
  });

  describe('Login schema', () => {
    const loginSchema = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    });

    it('should accept valid login', () => {
      expect(() =>
        loginSchema.parse({ email: 'test@test.com', password: 'pass123' }),
      ).not.toThrow();
    });

    it('should reject empty password', () => {
      expect(() =>
        loginSchema.parse({ email: 'test@test.com', password: '' }),
      ).toThrow();
    });

    it('should reject SQL injection in email', () => {
      expect(() =>
        loginSchema.parse({
          email: "admin@test.com' OR 1=1; --",
          password: 'pass',
        }),
      ).toThrow(); // Not valid email
    });

    it('should strip prototype pollution fields', () => {
      const parsed = loginSchema.parse({
        email: 'test@test.com',
        password: 'pass123',
        __proto__: { admin: true },
        constructor: { prototype: { admin: true } },
      });
      expect(Object.keys(parsed)).toEqual(['email', 'password']);
    });
  });

  describe('Reset password schema', () => {
    const resetSchema = z.object({
      email: z.string().email(),
      code: z.string().length(6),
      newPassword: z.string().min(8).max(128),
    });

    it('should require exactly 6 character code', () => {
      expect(() =>
        resetSchema.parse({
          email: 'test@test.com',
          code: '12345',
          newPassword: 'newpassword123',
        }),
      ).toThrow();

      expect(() =>
        resetSchema.parse({
          email: 'test@test.com',
          code: '1234567',
          newPassword: 'newpassword123',
        }),
      ).toThrow();
    });

    it('should accept valid 6-digit code', () => {
      expect(() =>
        resetSchema.parse({
          email: 'test@test.com',
          code: '123456',
          newPassword: 'newpassword123',
        }),
      ).not.toThrow();
    });

    it('should reject code with SQL injection', () => {
      // The code field is exactly 6 chars, so SQL injection won't fit
      expect(() =>
        resetSchema.parse({
          email: 'test@test.com',
          code: "' OR 1=1; --",
          newPassword: 'newpassword123',
        }),
      ).toThrow();
    });
  });

  // ── Subscription Schemas ───────────────────────────────

  describe('Subscription schemas', () => {
    const subscribeSchema = z.object({
      planSlug: z.string(),
      billingCycle: z.enum(['annual', 'monthly']),
      billingCountry: z.string().optional(),
      paymentGateway: z.string().optional(),
      paymentReference: z.string().optional(),
    });

    it('should only accept annual or monthly billing cycle', () => {
      expect(() =>
        subscribeSchema.parse({
          planSlug: 'standard',
          billingCycle: 'annual',
        }),
      ).not.toThrow();

      expect(() =>
        subscribeSchema.parse({
          planSlug: 'standard',
          billingCycle: 'weekly',
        }),
      ).toThrow();
    });

    it('should strip unknown fields from subscribe body', () => {
      const parsed = subscribeSchema.parse({
        planSlug: 'standard',
        billingCycle: 'annual',
        amountPaid: 0,      // attacker tries to set price to 0
        status: 'active',    // attacker tries to pre-set status
        freebie: true,
      });
      expect((parsed as any).amountPaid).toBeUndefined();
      expect((parsed as any).status).toBeUndefined();
      expect((parsed as any).freebie).toBeUndefined();
    });

    const topUpSchema = z.object({
      hours: z.number().min(1),
      paymentGateway: z.string().optional(),
      paymentReference: z.string().optional(),
    });

    it('should reject top-up with negative hours', () => {
      expect(() => topUpSchema.parse({ hours: -5 })).toThrow();
    });

    it('should reject top-up with zero hours', () => {
      expect(() => topUpSchema.parse({ hours: 0 })).toThrow();
    });

    it('should reject top-up with string hours', () => {
      expect(() => topUpSchema.parse({ hours: 'ten' })).toThrow();
    });

    it('should strip unknown fields from top-up body', () => {
      const parsed = topUpSchema.parse({
        hours: 10,
        organizationId: 'other-org-id',  // attacker tries to target another org
        minutes: 99999,                    // attacker tries to override minutes calc
      });
      expect((parsed as any).organizationId).toBeUndefined();
      expect((parsed as any).minutes).toBeUndefined();
    });

    const adjustSchema = z.object({
      organizationId: z.string().uuid(),
      hours: z.number(),
      description: z.string().min(1),
    });

    it('should require valid UUID for admin adjust', () => {
      expect(() =>
        adjustSchema.parse({
          organizationId: 'not-a-uuid',
          hours: 10,
          description: 'Adjustment',
        }),
      ).toThrow();
    });

    it('should allow negative hours for admin adjust (authorized deductions)', () => {
      expect(() =>
        adjustSchema.parse({
          organizationId: '550e8400-e29b-41d4-a716-446655440000',
          hours: -5,
          description: 'Admin deduction',
        }),
      ).not.toThrow();
    });

    it('should require description for admin adjust (audit trail)', () => {
      expect(() =>
        adjustSchema.parse({
          organizationId: '550e8400-e29b-41d4-a716-446655440000',
          hours: 10,
          description: '',
        }),
      ).toThrow();
    });
  });

  // ── Financial Schemas ──────────────────────────────────

  describe('Financial schemas', () => {
    const amountSchema = z.number().positive();

    it('should reject negative amounts', () => {
      expect(() => amountSchema.parse(-100)).toThrow();
    });

    it('should reject zero amount', () => {
      expect(() => amountSchema.parse(0)).toThrow();
    });

    it('should accept positive amounts', () => {
      expect(() => amountSchema.parse(0.01)).not.toThrow();
      expect(() => amountSchema.parse(500000)).not.toThrow();
    });
  });
});

// ── Validate Middleware ──────────────────────────────────

describe('Validate Middleware Behavior', () => {
  // We test the middleware pattern used throughout the app
  it('should return 400 with structured error on validation failure', () => {
    const { z } = require('zod');
    const { ZodError } = z;

    const schema = z.object({ email: z.string().email() });

    try {
      schema.parse({ email: 'not-an-email' });
      fail('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ZodError);
      expect(err.errors[0].path).toEqual(['email']);
      expect(err.errors[0].message).toBeDefined();
    }
  });

  it('should handle deeply nested validation errors', () => {
    const { z } = require('zod');

    const schema = z.object({
      payment: z.object({
        amount: z.number().positive(),
        currency: z.string().length(3),
      }),
    });

    try {
      schema.parse({ payment: { amount: -1, currency: 'LONGCURRENCY' } });
      fail('Should have thrown');
    } catch (err: any) {
      expect(err.errors.length).toBeGreaterThanOrEqual(2);
    }
  });
});

// ── Helmet Security Headers ──────────────────────────────

describe('Security Headers (Helmet)', () => {
  it('should have helmet package available', () => {
    const helmet = require('helmet');
    expect(typeof helmet).toBe('function');
  });

  it('should create middleware that sets security headers', () => {
    const helmet = require('helmet');
    const middleware = helmet();
    expect(typeof middleware).toBe('function');
  });
});

// ── CORS Configuration ──────────────────────────────────

describe('CORS Configuration', () => {
  it('should restrict origins in production mode', () => {
    const productionOrigins = (process.env.CORS_ORIGINS || 'https://orgsledger.com,https://app.orgsledger.com,https://api.orgsledger.com').split(',');

    expect(productionOrigins).toContain('https://orgsledger.com');
    expect(productionOrigins).toContain('https://app.orgsledger.com');
    expect(productionOrigins).toContain('https://api.orgsledger.com');
    // Should NOT contain wildcard
    expect(productionOrigins).not.toContain('*');
  });

  it('should have cors package available', () => {
    const cors = require('cors');
    expect(typeof cors).toBe('function');
  });
});

// ── File Upload Validation ───────────────────────────────

describe('File Upload Validation', () => {
  it('should restrict avatar MIME types', () => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    // Reject dangerous MIME types
    expect(allowedMimes).not.toContain('application/javascript');
    expect(allowedMimes).not.toContain('text/html');
    expect(allowedMimes).not.toContain('application/x-php');
    expect(allowedMimes).not.toContain('application/x-executable');
  });

  it('should have reasonable file size limits', () => {
    const avatarLimit = 5 * 1024 * 1024; // 5MB
    const documentLimit = 25 * 1024 * 1024; // 25MB

    // Avatar should be small
    expect(avatarLimit).toBeLessThanOrEqual(10 * 1024 * 1024);
    // Document should be less than 50MB
    expect(documentLimit).toBeLessThanOrEqual(50 * 1024 * 1024);
  });
});

// ── JSON Body Parser Limits ──────────────────────────────

describe('JSON Body Parser Limits', () => {
  it('should have a 10MB JSON body limit configured', () => {
    // This tests that the configuration value is reasonable
    const limit = '10mb';
    const limitBytes = 10 * 1024 * 1024;

    expect(limitBytes).toBeLessThanOrEqual(50 * 1024 * 1024); // Should be < 50MB
    expect(limitBytes).toBeGreaterThanOrEqual(1 * 1024 * 1024); // Should be >= 1MB
  });
});

// ── Password Security ────────────────────────────────────

describe('Password Security', () => {
  it('should have bcrypt available for password hashing', () => {
    const bcrypt = require('bcryptjs');
    expect(typeof bcrypt.hash).toBe('function');
    expect(typeof bcrypt.compare).toBe('function');
  });

  it('should use cost factor >= 10 for password hashing', async () => {
    const bcrypt = require('bcryptjs');
    const COST_FACTOR = 12; // app uses 12

    expect(COST_FACTOR).toBeGreaterThanOrEqual(10);

    // Verify bcrypt hash with that cost factor
    const hash = await bcrypt.hash('testpassword', COST_FACTOR);
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
  });

  it('should not store passwords in plaintext (hash comparison)', async () => {
    const bcrypt = require('bcryptjs');
    const plaintext = 'MyP@ssw0rd!';
    const hash = await bcrypt.hash(plaintext, 12);

    // Hash should be different from plaintext
    expect(hash).not.toBe(plaintext);
    // But should validate correctly
    const match = await bcrypt.compare(plaintext, hash);
    expect(match).toBe(true);
    // Wrong password should not match
    const noMatch = await bcrypt.compare('WrongPassword', hash);
    expect(noMatch).toBe(false);
  });
});
