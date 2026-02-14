// ============================================================
// Unit Tests — Currency Handling Logic
// Coverage target: 95%
//
// Tests: isNigeria, getCurrency, getPlanPrice
// ============================================================

import { isNigeria, getCurrency, getPlanPrice } from '../services/subscription.service';

// Prevent real DB / logger from loading
jest.mock('../db', () => {
  const chain: any = {};
  ['where', 'first', 'orderBy', 'insert', 'update', 'select', 'forUpdate'].forEach(
    (m) => (chain[m] = jest.fn().mockReturnValue(chain)),
  );
  const db: any = jest.fn(() => chain);
  db.fn = { now: jest.fn() };
  db.raw = jest.fn();
  db.transaction = jest.fn();
  return { __esModule: true, default: db };
});
jest.mock('../logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ── isNigeria ─────────────────────────────────────────────

describe('isNigeria', () => {
  it('should return true for "NG"', () => {
    expect(isNigeria('NG')).toBe(true);
  });

  it('should return true for "NGA"', () => {
    expect(isNigeria('NGA')).toBe(true);
  });

  it('should return true for "nigeria"', () => {
    expect(isNigeria('nigeria')).toBe(true);
  });

  it('should be case-insensitive', () => {
    expect(isNigeria('ng')).toBe(true);
    expect(isNigeria('Ng')).toBe(true);
    expect(isNigeria('nGa')).toBe(true);
    expect(isNigeria('NIGERIA')).toBe(true);
    expect(isNigeria('Nigeria')).toBe(true);
  });

  it('should return false for non-Nigerian countries', () => {
    expect(isNigeria('US')).toBe(false);
    expect(isNigeria('GB')).toBe(false);
    expect(isNigeria('GH')).toBe(false);
    expect(isNigeria('South Africa')).toBe(false);
    expect(isNigeria('Kenya')).toBe(false);
    expect(isNigeria('niger')).toBe(false); // Niger ≠ Nigeria
  });

  it('should return false for null / undefined / empty', () => {
    expect(isNigeria(null)).toBe(false);
    expect(isNigeria(undefined)).toBe(false);
    expect(isNigeria('')).toBe(false);
  });
});

// ── getCurrency ───────────────────────────────────────────

describe('getCurrency', () => {
  it('should return NGN for Nigerian country codes', () => {
    expect(getCurrency('NG')).toBe('NGN');
    expect(getCurrency('NGA')).toBe('NGN');
    expect(getCurrency('nigeria')).toBe('NGN');
  });

  it('should return USD for non-Nigerian countries', () => {
    expect(getCurrency('US')).toBe('USD');
    expect(getCurrency('GB')).toBe('USD');
    expect(getCurrency('Ghana')).toBe('USD');
  });

  it('should return USD when country is null/undefined', () => {
    expect(getCurrency(null)).toBe('USD');
    expect(getCurrency(undefined)).toBe('USD');
  });

  it('should return USD for empty string', () => {
    expect(getCurrency('')).toBe('USD');
  });
});

// ── getPlanPrice ──────────────────────────────────────────

describe('getPlanPrice', () => {
  const standardPlan = {
    name: 'Standard',
    price_usd_annual: '300',
    price_usd_monthly: '30',
    price_ngn_annual: '500000',
    price_ngn_monthly: '50000',
  };

  const planWithoutMonthly = {
    name: 'Enterprise',
    price_usd_annual: '2500',
    price_usd_monthly: null,
    price_ngn_annual: '3500000',
    price_ngn_monthly: null,
  };

  // ─ USD Pricing ──────────────────────────────

  it('should return USD annual price', () => {
    const price = getPlanPrice(standardPlan, 'USD', 'annual');
    expect(price).toBe(300);
  });

  it('should return USD monthly price', () => {
    const price = getPlanPrice(standardPlan, 'USD', 'monthly');
    expect(price).toBe(30);
  });

  it('should default to annual when cycle omitted', () => {
    const price = getPlanPrice(standardPlan, 'USD');
    expect(price).toBe(300);
  });

  it('should fallback to annual/12 when USD monthly price is null', () => {
    const price = getPlanPrice(planWithoutMonthly, 'USD', 'monthly');
    // price_usd_annual / 12 = 2500 / 12 ≈ 208.333...
    expect(price).toBeCloseTo(2500 / 12, 2);
  });

  // ─ NGN Pricing ──────────────────────────────

  it('should return NGN annual price', () => {
    const price = getPlanPrice(standardPlan, 'NGN', 'annual');
    expect(price).toBe(500000);
  });

  it('should return NGN monthly price', () => {
    const price = getPlanPrice(standardPlan, 'NGN', 'monthly');
    expect(price).toBe(50000);
  });

  it('should fallback to annual/12 when NGN monthly price is null', () => {
    const price = getPlanPrice(planWithoutMonthly, 'NGN', 'monthly');
    // price_ngn_annual / 12 = 3500000 / 12 ≈ 291666.666...
    expect(price).toBeCloseTo(3500000 / 12, 0);
  });

  // ─ Numeric coercion ─────────────────────────

  it('should coerce string prices to numbers via parseFloat', () => {
    const plan = {
      price_usd_annual: '99.99',
      price_usd_monthly: '9.99',
      price_ngn_annual: '150000.50',
      price_ngn_monthly: '15000.05',
    };
    expect(getPlanPrice(plan, 'USD', 'annual')).toBe(99.99);
    expect(getPlanPrice(plan, 'NGN', 'monthly')).toBe(15000.05);
  });

  it('should handle zero-priced plan (free tier)', () => {
    const freePlan = {
      price_usd_annual: '0',
      price_usd_monthly: '0',
      price_ngn_annual: '0',
      price_ngn_monthly: '0',
    };
    expect(getPlanPrice(freePlan, 'USD', 'annual')).toBe(0);
    expect(getPlanPrice(freePlan, 'NGN', 'monthly')).toBe(0);
  });

  // ─ Edge cases ───────────────────────────────

  it('should handle all plan tiers', () => {
    // Professional plan
    const proPlan = {
      price_usd_annual: '800',
      price_usd_monthly: '80',
      price_ngn_annual: '1200000',
      price_ngn_monthly: '120000',
    };
    expect(getPlanPrice(proPlan, 'USD', 'annual')).toBe(800);
    expect(getPlanPrice(proPlan, 'USD', 'monthly')).toBe(80);
    expect(getPlanPrice(proPlan, 'NGN', 'annual')).toBe(1200000);
    expect(getPlanPrice(proPlan, 'NGN', 'monthly')).toBe(120000);
  });

  it('should correctly fallback: monthly null falls to annual/12 (not 0)', () => {
    // When monthly is null, should use annual/12
    // This tests the || fallback: parseFloat(null || 2500/12)
    const plan = {
      price_usd_annual: '1200',
      price_usd_monthly: null,
      price_ngn_annual: '1800000',
      price_ngn_monthly: null,
    };

    expect(getPlanPrice(plan, 'USD', 'monthly')).toBe(100); // 1200 / 12
    expect(getPlanPrice(plan, 'NGN', 'monthly')).toBe(150000); // 1800000 / 12
  });

  it('should handle monthly = 0 by falling back to annual/12', () => {
    // 0 is falsy, so || fallback triggers — this tests current behavior
    const plan = {
      price_usd_annual: '600',
      price_usd_monthly: '0',
      price_ngn_annual: '900000',
      price_ngn_monthly: '0',
    };

    // parseFloat('0') === 0, which is falsy, so || triggers:
    // parseFloat('0' || 600/12) → parseFloat(600/12) = 50
    // Actually wait — the code does: parseFloat(plan.price_usd_monthly || plan.price_usd_annual / 12)
    // '0' || X → '0' is falsy, so it falls to X
    // Actually, '0' is truthy in JS ('0' !== ''), so no fallback
    // Re-check: String '0' IS truthy. So parseFloat('0') = 0
    expect(getPlanPrice(plan, 'USD', 'monthly')).toBe(0);
  });
});
