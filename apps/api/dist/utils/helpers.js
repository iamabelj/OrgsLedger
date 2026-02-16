"use strict";
// ============================================================
// OrgsLedger API — Utility: Helpers
// General-purpose helpers that don't fit formatters/validators
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.randomHex = randomHex;
exports.generateLicenseKey = generateLicenseKey;
exports.generateApiKey = generateApiKey;
exports.sleep = sleep;
exports.pick = pick;
exports.omit = omit;
exports.safeJsonParse = safeJsonParse;
const crypto_1 = __importDefault(require("crypto"));
/** Generate a random hex string of the given byte-length */
function randomHex(bytes = 32) {
    return crypto_1.default.randomBytes(bytes).toString('hex');
}
/** Generate a license-style key: OLS-XXXX-XXXX-XXXX-XXXX */
function generateLicenseKey() {
    const seg = () => crypto_1.default.randomBytes(4).toString('hex').toUpperCase();
    return `OLS-${seg()}-${seg()}-${seg()}-${seg()}`;
}
/** Generate an API key with a prefix: ols_<64 hex chars> */
function generateApiKey(prefix = 'ols') {
    return `${prefix}_${crypto_1.default.randomBytes(32).toString('hex')}`;
}
/** Sleep for the given ms (useful in retry loops) */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/** Pick only specified keys from an object */
function pick(obj, keys) {
    const result = {};
    for (const key of keys) {
        if (key in obj)
            result[key] = obj[key];
    }
    return result;
}
/** Omit specified keys from an object */
function omit(obj, keys) {
    const result = { ...obj };
    for (const key of keys)
        delete result[key];
    return result;
}
/** Safely parse JSON without throwing */
function safeJsonParse(str, fallback) {
    try {
        return JSON.parse(str);
    }
    catch {
        return fallback;
    }
}
//# sourceMappingURL=helpers.js.map