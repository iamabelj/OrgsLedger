export declare enum CircuitState {
    CLOSED = "closed",// Normal operation
    OPEN = "open",// Failing — all calls rejected
    HALF_OPEN = "half_open"
}
interface CircuitBreakerOptions {
    /** Name of the service (for logging) */
    name: string;
    /** Number of failures before opening the circuit */
    failureThreshold?: number;
    /** Time in ms to wait before trying again (half-open) */
    resetTimeout?: number;
    /** Time window in ms for counting failures */
    failureWindow?: number;
}
export declare class CircuitBreaker {
    private state;
    private failures;
    private lastFailureTime;
    private successCount;
    readonly name: string;
    private readonly failureThreshold;
    private readonly resetTimeout;
    private readonly failureWindow;
    constructor(options: CircuitBreakerOptions);
    /**
     * Execute a function with circuit breaker protection.
     * @param fn - The async function to call
     * @param fallback - Optional fallback value if circuit is open
     */
    execute<T>(fn: () => Promise<T>, fallback?: T): Promise<T>;
    private onSuccess;
    private onFailure;
    private pruneFailures;
    /** Get current circuit state */
    getState(): CircuitState;
    /** Get stats for observability */
    getStats(): {
        name: string;
        state: CircuitState;
        failureCount: number;
        lastFailure: number;
    };
    /** Reset circuit (used in tests) */
    reset(): void;
}
export declare const circuits: {
    ai: CircuitBreaker;
    email: CircuitBreaker;
    stripe: CircuitBreaker;
    paystack: CircuitBreaker;
    livekit: CircuitBreaker;
};
export {};
//# sourceMappingURL=circuit-breaker.d.ts.map