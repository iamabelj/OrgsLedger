"use strict";
// ============================================================
// OrgsLedger API — Utility: Formatters
// Money, dates, strings, pagination helpers
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.toSubunits = toSubunits;
exports.formatMoney = formatMoney;
exports.parsePagination = parsePagination;
exports.slugify = slugify;
exports.truncate = truncate;
exports.convertCurrency = convertCurrency;
const constants_1 = require("../constants");
/**
 * Convert cents → subunits safely (avoids float precision bugs).
 * e.g. 19.99 → 1999
 */
function toSubunits(amount) {
    const [whole = '0', frac = ''] = String(amount).split('.');
    const paddedFrac = (frac + '00').slice(0, 2);
    return parseInt(whole, 10) * 100 + parseInt(paddedFrac, 10);
}
/** Format money for display (server-side, e.g. in emails / notifications) */
function formatMoney(amount, currency = constants_1.CURRENCIES.NGN) {
    const symbol = currency === constants_1.CURRENCIES.USD ? '$' : '₦';
    return `${symbol}${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/** Parse & clamp pagination params from query string */
function parsePagination(query) {
    let page = parseInt(query.page) || constants_1.PAGINATION.DEFAULT_PAGE;
    let limit = parseInt(query.limit) || constants_1.PAGINATION.DEFAULT_LIMIT;
    if (page < 1)
        page = 1;
    if (limit < 1)
        limit = constants_1.PAGINATION.DEFAULT_LIMIT;
    if (limit > constants_1.PAGINATION.MAX_LIMIT)
        limit = constants_1.PAGINATION.MAX_LIMIT;
    return { page, limit, offset: (page - 1) * limit };
}
/** Slugify a string for URL usage */
function slugify(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}
/** Truncate a string to a max length with ellipsis */
function truncate(str, maxLen = 100) {
    if (!str || str.length <= maxLen)
        return str;
    return str.slice(0, maxLen - 1) + '…';
}
/** Convert NGN ↔ USD using the constant rate */
function convertCurrency(amount, from, to = constants_1.CURRENCIES.USD) {
    if (from === to)
        return amount;
    if (from === constants_1.CURRENCIES.NGN && to === constants_1.CURRENCIES.USD)
        return amount / constants_1.RATE_NGN_PER_USD;
    if (from === constants_1.CURRENCIES.USD && to === constants_1.CURRENCIES.NGN)
        return amount * constants_1.RATE_NGN_PER_USD;
    return amount;
}
//# sourceMappingURL=formatters.js.map