// ============================================================
// OrgsLedger API — Utility: Formatters
// Money, dates, strings, pagination helpers
// ============================================================

import { PAGINATION, RATE_NGN_PER_USD, CURRENCIES } from '../constants';

/**
 * Convert cents → subunits safely (avoids float precision bugs).
 * e.g. 19.99 → 1999
 */
export function toSubunits(amount: number): number {
  const [whole = '0', frac = ''] = String(amount).split('.');
  const paddedFrac = (frac + '00').slice(0, 2);
  return parseInt(whole, 10) * 100 + parseInt(paddedFrac, 10);
}

/** Format money for display (server-side, e.g. in emails / notifications) */
export function formatMoney(amount: number, currency: string = CURRENCIES.NGN): string {
  const symbol = currency === CURRENCIES.USD ? '$' : '₦';
  return `${symbol}${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Parse & clamp pagination params from query string */
export function parsePagination(query: Record<string, any>): { page: number; limit: number; offset: number } {
  let page = parseInt(query.page as string) || PAGINATION.DEFAULT_PAGE;
  let limit = parseInt(query.limit as string) || PAGINATION.DEFAULT_LIMIT;
  if (page < 1) page = 1;
  if (limit < 1) limit = PAGINATION.DEFAULT_LIMIT;
  if (limit > PAGINATION.MAX_LIMIT) limit = PAGINATION.MAX_LIMIT;
  return { page, limit, offset: (page - 1) * limit };
}

/** Slugify a string for URL usage */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Truncate a string to a max length with ellipsis */
export function truncate(str: string, maxLen: number = 100): string {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

/** Convert NGN ↔ USD using the constant rate */
export function convertCurrency(
  amount: number,
  from: string,
  to: string = CURRENCIES.USD,
): number {
  if (from === to) return amount;
  if (from === CURRENCIES.NGN && to === CURRENCIES.USD) return amount / RATE_NGN_PER_USD;
  if (from === CURRENCIES.USD && to === CURRENCIES.NGN) return amount * RATE_NGN_PER_USD;
  return amount;
}
