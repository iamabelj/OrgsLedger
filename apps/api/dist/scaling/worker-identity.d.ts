/**
 * Generate unique worker identifier for horizontal scaling.
 * Format: hostname:pid:timestamp
 */
export declare function generateWorkerId(): string;
/**
 * Global worker ID for this process instance.
 * Stable across the lifetime of the worker process.
 */
export declare const WORKER_ID: string;
/**
 * CPU core count for this machine.
 * Used for dynamic concurrency calculations.
 */
export declare const CPU_CORES: number;
/**
 * Get CPU core count for dynamic concurrency calculation.
 */
export declare function getCpuCores(): number;
/**
 * Calculate worker concurrency based on CPU cores and multiplier.
 * @param multiplier - Multiplier for CPU cores (e.g., 4 for CPU_CORES * 4)
 * @param min - Minimum concurrency (default: 1)
 * @param max - Maximum concurrency (default: 100)
 */
export declare function calculateConcurrency(multiplier: number, min?: number, max?: number): number;
/**
 * Concurrency presets for different worker types.
 * Based on CPU_CORES multipliers from requirements.
 */
export declare const WORKER_CONCURRENCY: {
    /** TranscriptWorker: CPU_CORES * 4 (I/O bound - Redis + broadcast) */
    transcript: () => number;
    /** TranslationWorker: CPU_CORES * 2 (API calls - moderate) */
    translation: () => number;
    /** BroadcastWorker: CPU_CORES * 6 (I/O bound - Redis PubSub) */
    broadcast: () => number;
    /** MinutesWorker: CPU_CORES (CPU bound - AI processing) */
    minutes: () => number;
};
/**
 * Log worker identity on startup.
 */
export declare function logWorkerIdentity(workerType: string): void;
//# sourceMappingURL=worker-identity.d.ts.map