"use strict";
// ============================================================
// OrgsLedger API — Worker Identity
// Horizontal scaling worker identification for stateless workers
// ============================================================
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKER_CONCURRENCY = exports.CPU_CORES = exports.WORKER_ID = void 0;
exports.generateWorkerId = generateWorkerId;
exports.getCpuCores = getCpuCores;
exports.calculateConcurrency = calculateConcurrency;
exports.logWorkerIdentity = logWorkerIdentity;
const os = __importStar(require("os"));
/**
 * Generate unique worker identifier for horizontal scaling.
 * Format: hostname:pid:timestamp
 */
function generateWorkerId() {
    const hostname = os.hostname();
    const pid = process.pid;
    const timestamp = Date.now().toString(36);
    return `${hostname}:${pid}:${timestamp}`;
}
/**
 * Global worker ID for this process instance.
 * Stable across the lifetime of the worker process.
 */
exports.WORKER_ID = generateWorkerId();
/**
 * CPU core count for this machine.
 * Used for dynamic concurrency calculations.
 */
exports.CPU_CORES = os.cpus().length;
/**
 * Get CPU core count for dynamic concurrency calculation.
 */
function getCpuCores() {
    return exports.CPU_CORES;
}
/**
 * Calculate worker concurrency based on CPU cores and multiplier.
 * @param multiplier - Multiplier for CPU cores (e.g., 4 for CPU_CORES * 4)
 * @param min - Minimum concurrency (default: 1)
 * @param max - Maximum concurrency (default: 100)
 */
function calculateConcurrency(multiplier, min = 1, max = 100) {
    const cores = getCpuCores();
    const calculated = Math.floor(cores * multiplier);
    return Math.max(min, Math.min(max, calculated));
}
/**
 * Concurrency presets for different worker types.
 * Based on CPU_CORES multipliers from requirements.
 */
exports.WORKER_CONCURRENCY = {
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
function logWorkerIdentity(workerType) {
    const cores = getCpuCores();
    console.log(`[${workerType.toUpperCase()}] Worker started`, {
        workerId: exports.WORKER_ID,
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
//# sourceMappingURL=worker-identity.js.map