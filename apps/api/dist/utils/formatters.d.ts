/**
 * Convert cents → subunits safely (avoids float precision bugs).
 * e.g. 19.99 → 1999
 */
export declare function toSubunits(amount: number): number;
/** Format money for display (server-side, e.g. in emails / notifications) */
export declare function formatMoney(amount: number, currency?: string): string;
/** Parse & clamp pagination params from query string */
export declare function parsePagination(query: Record<string, any>): {
    page: number;
    limit: number;
    offset: number;
};
/** Slugify a string for URL usage */
export declare function slugify(text: string): string;
/** Truncate a string to a max length with ellipsis */
export declare function truncate(str: string, maxLen?: number): string;
/** Convert NGN ↔ USD using the constant rate */
export declare function convertCurrency(amount: number, from: string, to?: string): number;
//# sourceMappingURL=formatters.d.ts.map