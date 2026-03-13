/** UUID v1–v5 format check (does NOT hit the DB) */
export declare function isUUID(value?: string | null): boolean;
/** Timing-safe string comparison (prevents timing-based attacks) */
export declare function timingSafeCompare(a: string, b: string): boolean;
/** Check if a string is a safe slug (lowercase alphanumeric + hyphens) */
export declare function isSlug(value: string): boolean;
/** Sanitize an email (trim + lowercase) */
export declare function normalizeEmail(email: string): string;
/** Validate that a string looks like an email */
export declare function isEmail(value: string): boolean;
//# sourceMappingURL=validators.d.ts.map