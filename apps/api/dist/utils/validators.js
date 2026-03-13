"use strict";
// ============================================================
// OrgsLedger API — Utility: Validators
// Re-usable validation helpers beyond Zod schemas
// ============================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isUUID = isUUID;
exports.timingSafeCompare = timingSafeCompare;
exports.isSlug = isSlug;
exports.normalizeEmail = normalizeEmail;
exports.isEmail = isEmail;
const crypto_1 = __importDefault(require("crypto"));
/** UUID v1–v5 format check (does NOT hit the DB) */
function isUUID(value) {
    if (!value)
        return false;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
/** Timing-safe string comparison (prevents timing-based attacks) */
function timingSafeCompare(a, b) {
    if (!a || !b)
        return false;
    try {
        const bufA = Buffer.from(a, 'utf-8');
        const bufB = Buffer.from(b, 'utf-8');
        if (bufA.length !== bufB.length)
            return false;
        return crypto_1.default.timingSafeEqual(bufA, bufB);
    }
    catch {
        return false;
    }
}
/** Check if a string is a safe slug (lowercase alphanumeric + hyphens) */
function isSlug(value) {
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
/** Sanitize an email (trim + lowercase) */
function normalizeEmail(email) {
    return email.trim().toLowerCase();
}
/** Validate that a string looks like an email */
function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
//# sourceMappingURL=validators.js.map