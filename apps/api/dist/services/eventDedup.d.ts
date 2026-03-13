/**
 * Check if an event has already been processed.
 * Returns true if this is the FIRST time seeing this eventId (should process).
 * Returns false if already processed (should skip).
 *
 * Uses Redis SET NX (set-if-not-exists) for atomic check-and-set.
 */
export declare function tryClaimEvent(eventType: string, eventId: string, ttlSeconds?: number): Promise<boolean>;
/**
 * Generate a deterministic event ID from payload fields.
 * Use for events that don't have a natural unique ID.
 */
export declare function buildEventId(...parts: string[]): string;
//# sourceMappingURL=eventDedup.d.ts.map