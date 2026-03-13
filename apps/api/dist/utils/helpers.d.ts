/** Generate a random hex string of the given byte-length */
export declare function randomHex(bytes?: number): string;
/** Generate a license-style key: OLS-XXXX-XXXX-XXXX-XXXX */
export declare function generateLicenseKey(): string;
/** Generate an API key with a prefix: ols_<64 hex chars> */
export declare function generateApiKey(prefix?: string): string;
/** Sleep for the given ms (useful in retry loops) */
export declare function sleep(ms: number): Promise<void>;
/** Pick only specified keys from an object */
export declare function pick<T extends Record<string, any>, K extends keyof T>(obj: T, keys: K[]): Pick<T, K>;
/** Omit specified keys from an object */
export declare function omit<T extends Record<string, any>, K extends keyof T>(obj: T, keys: K[]): Omit<T, K>;
/** Safely parse JSON without throwing */
export declare function safeJsonParse<T = unknown>(str: string, fallback?: T): T | undefined;
//# sourceMappingURL=helpers.d.ts.map