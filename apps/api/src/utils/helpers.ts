// ============================================================
// OrgsLedger API — Utility: Helpers
// General-purpose helpers that don't fit formatters/validators
// ============================================================

import crypto from 'crypto';

/** Generate a random hex string of the given byte-length */
export function randomHex(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Generate a license-style key: OLS-XXXX-XXXX-XXXX-XXXX */
export function generateLicenseKey(): string {
  const seg = () => crypto.randomBytes(4).toString('hex').toUpperCase();
  return `OLS-${seg()}-${seg()}-${seg()}-${seg()}`;
}

/** Generate an API key with a prefix: ols_<64 hex chars> */
export function generateApiKey(prefix: string = 'ols'): string {
  return `${prefix}_${crypto.randomBytes(32).toString('hex')}`;
}

/** Sleep for the given ms (useful in retry loops) */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Pick only specified keys from an object */
export function pick<T extends Record<string, any>, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) result[key] = obj[key];
  }
  return result;
}

/** Omit specified keys from an object */
export function omit<T extends Record<string, any>, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) delete result[key];
  return result;
}

/** Safely parse JSON without throwing */
export function safeJsonParse<T = unknown>(str: string, fallback?: T): T | undefined {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
