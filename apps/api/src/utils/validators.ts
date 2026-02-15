// ============================================================
// OrgsLedger API — Utility: Validators
// Re-usable validation helpers beyond Zod schemas
// ============================================================

import crypto from 'crypto';

/** UUID v4 format check (does NOT hit the DB) */
export function isUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Timing-safe string comparison (prevents timing-based attacks) */
export function timingSafeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  try {
    const bufA = Buffer.from(a, 'utf-8');
    const bufB = Buffer.from(b, 'utf-8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/** Check if a string is a safe slug (lowercase alphanumeric + hyphens) */
export function isSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

/** Sanitize an email (trim + lowercase) */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Validate that a string looks like an email */
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
