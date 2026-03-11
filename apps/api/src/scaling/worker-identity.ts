// ============================================================
// OrgsLedger API — Worker Identity
// Horizontal scaling worker identification for stateless workers
// ============================================================

import * as os from 'os';

/**
 * Generate unique worker identifier for horizontal scaling.
 * Format: hostname:pid:timestamp
 */
export function generateWorkerId(): string {
  const hostname = os.hostname();
  const pid = process.pid;
  const timestamp = Date.now().toString(36);
  return `${hostname}:${pid}:${timestamp}`;
}

/**
 * Global worker ID for this process instance.
 * Stable across the lifetime of the worker process.
 */
export const WORKER_ID = generateWorkerId();

/**
 * CPU core count for this machine.
 * Used for dynamic concurrency calculations.
 */
export const CPU_CORES = os.cpus().length;

/**
 * Get CPU core count for dynamic concurrency calculation.
 */
export function getCpuCores(): number {
  return CPU_CORES;
}

/**
 * Calculate worker concurrency based on CPU cores and multiplier.
 * @param multiplier - Multiplier for CPU cores (e.g., 4 for CPU_CORES * 4)
 * @param min - Minimum concurrency (default: 1)
 * @param max - Maximum concurrency (default: 100)
 */
export function calculateConcurrency(
  multiplier: number,
  min: number = 1,
  max: number = 100
): number {
  const cores = getCpuCores();
  const calculated = Math.floor(cores * multiplier);
  return Math.max(min, Math.min(max, calculated));
}

/**
 * Concurrency presets for different worker types.
 * Based on CPU_CORES multipliers from requirements.
 */
export const WORKER_CONCURRENCY = {
  /** TranscriptWorker: CPU_CORES * 4 (I/O bound - Redis + broadcast) */
  transcript: () => calculateConcurrency(4, 4, 128),
  
  /** TranslationWorker: CPU_CORES * 2 (API calls - moderate) */
  translation: () => calculateConcurrency(2, 2, 64),
  
  /** BroadcastWorker: CPU_CORES * 6 (I/O bound - Redis PubSub) */
  broadcast: () => calculateConcurrency(6, 6, 200),
  
  /** MinutesWorker: CPU_CORES (CPU bound - AI processing) */
  minutes: () => calculateConcurrency(1, 1, 32),
};

/**
 * Log worker identity on startup.
 */
export function logWorkerIdentity(workerType: string): void {
  const cores = getCpuCores();
  console.log(`[${workerType.toUpperCase()}] Worker started`, {
    workerId: WORKER_ID,
    cpuCores: cores,
    hostname: os.hostname(),
    pid: process.pid,
    nodeVersion: process.version,
    platform: os.platform(),
    arch: os.arch(),
    freeMem: `${Math.round(os.freemem() / 1024 / 1024)}MB`,
    totalMem: `${Math.round(os.totalmem() / 1024 / 1024)}MB`,
  });
}
