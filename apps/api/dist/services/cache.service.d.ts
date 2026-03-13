/**
 * Get a cached value by key.
 * Returns null if not found or expired.
 */
export declare function cacheGet(key: string): Promise<string | null>;
/**
 * Set a cached value with TTL in seconds.
 */
export declare function cacheSet(key: string, value: string, ttlSeconds?: number): Promise<void>;
/**
 * Delete a cached key (or pattern with wildcard *).
 */
export declare function cacheDel(key: string): Promise<void>;
/**
 * Cache-aside helper for route handlers.
 * If the key exists in cache, returns the parsed JSON.
 * Otherwise, calls the fetch function, caches the result, and returns it.
 */
export declare function cacheAside<T>(key: string, ttlSeconds: number, fetchFn: () => Promise<T>): Promise<T>;
/** Check if Redis is connected */
export declare function isRedisAvailable(): boolean;
/** Clear entire cache (used in tests) */
export declare function cacheClear(): Promise<void>;
//# sourceMappingURL=cache.service.d.ts.map