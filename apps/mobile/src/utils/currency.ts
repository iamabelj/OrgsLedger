// ============================================================
// OrgsLedger Mobile — Currency Formatting Utility
// ============================================================

export interface CurrencyInfo {
  code: string;
  symbol: string;
  name: string;
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'NGN', symbol: '₦', name: 'Nigerian Naira' },
  { code: 'GHS', symbol: 'GH₵', name: 'Ghanaian Cedi' },
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
];

const currencyMap = new Map(CURRENCIES.map((c) => [c.code, c]));

/** Look up currency info by code, falls back to USD */
export function getCurrencyInfo(code?: string | null): CurrencyInfo {
  return currencyMap.get(code?.toUpperCase() || 'USD') || CURRENCIES[0];
}

/** Get just the symbol for a currency code */
export function getCurrencySymbol(code?: string | null): string {
  return getCurrencyInfo(code).symbol;
}

/**
 * Format a numeric amount with the correct currency symbol.
 *
 * @param amount  — number or numeric string
 * @param code    — ISO 4217 currency code (e.g. 'NGN')
 * @param decimals — decimal places, default 2
 */
export function formatCurrency(
  amount: number | string | null | undefined,
  code?: string | null,
  decimals: number = 2,
): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : (amount ?? 0);
  const info = getCurrencyInfo(code);
  return `${info.symbol}${(isNaN(num) ? 0 : num).toFixed(decimals)}`;
}

/**
 * Format a whole-number amount (no decimal places).
 */
export function formatCurrencyWhole(
  amount: number | string | null | undefined,
  code?: string | null,
): string {
  return formatCurrency(amount, code, 0);
}
