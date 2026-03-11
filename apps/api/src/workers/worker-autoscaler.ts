// ============================================================
// OrgsLedger API — Worker Autoscaler
// Automatically scale workers based on queue load
// ============================================================
//
// Architecture:
//   - Monitors all sharded queues every 10 seconds
//   - Spawns/stops workers based on queue depth
//   - Uses child_process.fork() for worker spawning
//   - Tracks workers by type + shard to prevent duplicates
//   - Emits Prometheus metrics for observability
//
// Scaling Rules:
//   - If waiting > 1000 → spawn additional worker
//   - If waiting < 100 (for 3 checks) → allow scale down
//   - Min workers: 2 per type
//   - Max workers: 20 per type
//
// ============================================================

import { fork, ChildProcess } from 'child_process';
import path from 'path';
import os from 'os';
import * as client from 'prom-client';
import { logger } from '../logger';
import {
  queueManager,
  initializeQueueManager,
  SHARDED_QUEUE_TYPES,
  ShardedQueueType,
  QUEUE_SHARD_COUNTS,
  getShardStats,
  ShardStats,
} from '../queues/queue-manager';
import { WORKER_ID } from '../scaling/worker-identity';

// ── Configuration ───────────────────────────────────────────

interface AutoscalerConfig {
  /** Check interval in milliseconds */
  checkIntervalMs: number;
  /** High watermark - spawn workers when waiting jobs exceed this */
  highWatermark: number;
  /** Low watermark - scale down when waiting jobs drop below this */
  lowWatermark: number;
  /** Number of consecutive low readings before scale down */
  scaleDownChecks: number;
  /** Minimum workers per worker type */
  minWorkersPerType: number;
  /** Maximum workers per worker type */
  maxWorkersPerType: number;
  /** Cooldown after spawn (ms) - prevent rapid scaling */
  spawnCooldownMs: number;
  /** Worker startup timeout (ms) */
  workerStartupTimeoutMs: number;
}

const DEFAULT_CONFIG: AutoscalerConfig = {
  checkIntervalMs: parseInt(process.env.AUTOSCALER_CHECK_INTERVAL_MS || '10000', 10),
  highWatermark: parseInt(process.env.AUTOSCALER_HIGH_WATERMARK || '1000', 10),
  lowWatermark: parseInt(process.env.AUTOSCALER_LOW_WATERMARK || '100', 10),
  scaleDownChecks: parseInt(process.env.AUTOSCALER_SCALEDOWN_CHECKS || '3', 10),
  minWorkersPerType: parseInt(process.env.AUTOSCALER_MIN_WORKERS || '2', 10),
  maxWorkersPerType: parseInt(process.env.AUTOSCALER_MAX_WORKERS || '20', 10),
  spawnCooldownMs: parseInt(process.env.AUTOSCALER_SPAWN_COOLDOWN_MS || '30000', 10),
  workerStartupTimeoutMs: parseInt(process.env.AUTOSCALER_WORKER_TIMEOUT_MS || '60000', 10),
};

// ── Types ───────────────────────────────────────────────────

interface WorkerInfo {
  id: string;
  workerType: ShardedQueueType;
  shardIndex: number;
  process: ChildProcess;
  startedAt: Date;
  status: 'starting' | 'running' | 'stopping' | 'stopped';
  lastHealthCheck: Date;
  processedJobs: number;
  failedJobs: number;
}

interface QueueSnapshot {
  queueType: ShardedQueueType;
  totalWaiting: number;
  totalActive: number;
  shardSnapshots: Array<{
    shard: number;
    waiting: number;
    active: number;
  }>;
}

interface ScalingDecision {
  queueType: ShardedQueueType;
  action: 'scale-up' | 'scale-down' | 'maintain';
  currentWorkers: number;
  targetWorkers: number;
  reason: string;
}

// ── Prometheus Metrics ──────────────────────────────────────

const PREFIX = 'orgsledger_autoscaler_';

export const autoscalerWorkersGauge = new client.Gauge({
  name: `${PREFIX}workers_total`,
  help: 'Current number of workers by type',
  labelNames: ['worker_type', 'status'],
});

export const autoscalerScaleEventsCounter = new client.Counter({
  name: `${PREFIX}scale_events_total`,
  help: 'Number of scaling events',
  labelNames: ['worker_type', 'action'],
});

export const autoscalerQueueDepthGauge = new client.Gauge({
  name: `${PREFIX}queue_depth`,
  help: 'Queue depth at last check',
  labelNames: ['queue_type'],
});

export const autoscalerQueueLagGauge = new client.Gauge({
  name: `${PREFIX}queue_lag_ms`,
  help: 'Estimated queue lag in milliseconds',
  labelNames: ['queue_type'],
});

// ── Worker Scripts ──────────────────────────────────────────

const WORKER_SCRIPTS: Record<ShardedQueueType, string> = {
  transcript: 'transcript.worker.ts',
  translation: 'translation.worker.ts',
  broadcast: 'broadcast.worker.ts',
  minutes: 'minutes.worker.ts',
};

// ── Autoscaler Class ────────────────────────────────────────

class WorkerAutoscaler {
  private config: AutoscalerConfig;
  private workers: Map<string, WorkerInfo> = new Map();
  private lowWatermarkCounts: Map<ShardedQueueType, number> = new Map();
  private lastSpawnTime: Map<ShardedQueueType, number> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private initialized = false;

  constructor(config: Partial<AutoscalerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Initialize counters
    for (const queueType of Object.values(SHARDED_QUEUE_TYPES)) {
      this.lowWatermarkCounts.set(queueType, 0);
      this.lastSpawnTime.set(queueType, 0);
    }
  }

  // ── Initialization ──────────────────────────────────────────

  /**
   * Initialize the autoscaler and start workers.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('[AUTOSCALER] Initializing...', {
      workerId: WORKER_ID,
      config: {
        checkIntervalMs: this.config.checkIntervalMs,
        highWatermark: this.config.highWatermark,
        lowWatermark: this.config.lowWatermark,
        minWorkers: this.config.minWorkersPerType,
        maxWorkers: this.config.maxWorkersPerType,
      },
    });

    // Initialize queue manager
    await initializeQueueManager();

    // Spawn minimum workers for each type
    await this.spawnMinimumWorkers();

    this.initialized = true;
    logger.info('[AUTOSCALER] Initialized successfully', {
      workerId: WORKER_ID,
      totalWorkers: this.workers.size,
    });
  }

  /**
   * Spawn minimum required workers for each queue type.
   */
  private async spawnMinimumWorkers(): Promise<void> {
    const spawnPromises: Promise<void>[] = [];

    for (const queueType of Object.values(SHARDED_QUEUE_TYPES)) {
      const shardCount = QUEUE_SHARD_COUNTS[queueType];
      const workersToSpawn = Math.min(this.config.minWorkersPerType, shardCount);

      for (let i = 0; i < workersToSpawn; i++) {
        // Distribute across shards
        const shardIndex = i % shardCount;
        spawnPromises.push(this.spawnWorker(queueType, shardIndex));
      }
    }

    await Promise.allSettled(spawnPromises);
  }

  // ── Main Loop ───────────────────────────────────────────────

  /**
   * Start the autoscaler loop.
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('[AUTOSCALER] Already running');
      return;
    }

    this.isRunning = true;
    logger.info('[AUTOSCALER] Starting autoscaler loop', {
      workerId: WORKER_ID,
      intervalMs: this.config.checkIntervalMs,
    });

    this.checkInterval = setInterval(async () => {
      try {
        await this.runScalingCheck();
      } catch (err) {
        logger.error('[AUTOSCALER] Scaling check failed', {
          error: err instanceof Error ? err.message : String(err),
          workerId: WORKER_ID,
        });
      }
    }, this.config.checkIntervalMs);

    // Run initial check
    this.runScalingCheck().catch((err) => {
      logger.error('[AUTOSCALER] Initial scaling check failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * Stop the autoscaler and gracefully terminate workers.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info('[AUTOSCALER] Stopping...', { workerId: WORKER_ID });
    this.isRunning = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Gracefully stop all workers
    const stopPromises = Array.from(this.workers.values()).map((worker) =>
      this.stopWorker(worker.id)
    );
    await Promise.allSettled(stopPromises);

    logger.info('[AUTOSCALER] Stopped', { workerId: WORKER_ID });
  }

  // ── Scaling Logic ───────────────────────────────────────────

  /**
   * Run a single scaling check across all queue types.
   */
  private async runScalingCheck(): Promise<void> {
    const snapshots = await this.getQueueSnapshots();
    const decisions: ScalingDecision[] = [];

    for (const snapshot of snapshots) {
      const decision = this.makeScalingDecision(snapshot);
      decisions.push(decision);

      // Update metrics
      autoscalerQueueDepthGauge.set(
        { queue_type: snapshot.queueType },
        snapshot.totalWaiting
      );

      // Execute scaling action
      if (decision.action !== 'maintain') {
        await this.executeScalingDecision(decision);
      }
    }

    // Log scaling summary
    const activeDecisions = decisions.filter((d) => d.action !== 'maintain');
    if (activeDecisions.length > 0) {
      logger.info('[AUTOSCALER] Scaling decisions', {
        workerId: WORKER_ID,
        decisions: activeDecisions.map((d) => ({
          queue: d.queueType,
          action: d.action,
          from: d.currentWorkers,
          to: d.targetWorkers,
          reason: d.reason,
        })),
      });
    }
  }

  /**
   * Get snapshots of all queue depths.
   */
  private async getQueueSnapshots(): Promise<QueueSnapshot[]> {
    const snapshots: QueueSnapshot[] = [];

    for (const queueType of Object.values(SHARDED_QUEUE_TYPES)) {
      try {
        const stats = await getShardStats(queueType);
        
        snapshots.push({
          queueType,
          totalWaiting: stats.totals.waiting,
          totalActive: stats.totals.active,
          shardSnapshots: stats.shards.map((s: ShardStats) => ({
            shard: s.shard,
            waiting: s.waiting,
            active: s.active,
          })),
        });
      } catch (err) {
        logger.error('[AUTOSCALER] Failed to get queue stats', {
          queueType,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return snapshots;
  }

  /**
   * Make a scaling decision based on queue snapshot.
   */
  private makeScalingDecision(snapshot: QueueSnapshot): ScalingDecision {
    const { queueType, totalWaiting } = snapshot;
    const currentWorkers = this.getWorkerCountForType(queueType);
    const { highWatermark, lowWatermark, minWorkersPerType, maxWorkersPerType, scaleDownChecks } =
      this.config;

    // Scale up: waiting > highWatermark
    if (totalWaiting > highWatermark) {
      // Check cooldown
      const lastSpawn = this.lastSpawnTime.get(queueType) || 0;
      const now = Date.now();
      if (now - lastSpawn < this.config.spawnCooldownMs) {
        return {
          queueType,
          action: 'maintain',
          currentWorkers,
          targetWorkers: currentWorkers,
          reason: `Within spawn cooldown (${Math.round((this.config.spawnCooldownMs - (now - lastSpawn)) / 1000)}s remaining)`,
        };
      }

      if (currentWorkers < maxWorkersPerType) {
        // Reset low watermark counter
        this.lowWatermarkCounts.set(queueType, 0);
        
        return {
          queueType,
          action: 'scale-up',
          currentWorkers,
          targetWorkers: Math.min(currentWorkers + 1, maxWorkersPerType),
          reason: `Waiting jobs (${totalWaiting}) > high watermark (${highWatermark})`,
        };
      }
    }

    // Scale down: waiting < lowWatermark for N consecutive checks
    if (totalWaiting < lowWatermark && currentWorkers > minWorkersPerType) {
      const count = (this.lowWatermarkCounts.get(queueType) || 0) + 1;
      this.lowWatermarkCounts.set(queueType, count);

      if (count >= scaleDownChecks) {
        this.lowWatermarkCounts.set(queueType, 0);
        return {
          queueType,
          action: 'scale-down',
          currentWorkers,
          targetWorkers: Math.max(currentWorkers - 1, minWorkersPerType),
          reason: `Waiting jobs (${totalWaiting}) < low watermark (${lowWatermark}) for ${scaleDownChecks} checks`,
        };
      }
    } else {
      // Reset counter if not in low watermark
      this.lowWatermarkCounts.set(queueType, 0);
    }

    return {
      queueType,
      action: 'maintain',
      currentWorkers,
      targetWorkers: currentWorkers,
      reason: 'Within thresholds',
    };
  }

  /**
   * Execute a scaling decision.
   */
  private async executeScalingDecision(decision: ScalingDecision): Promise<void> {
    const { queueType, action, targetWorkers, currentWorkers } = decision;

    if (action === 'scale-up') {
      // Find an available shard to spawn worker on
      const shardIndex = this.findAvailableShard(queueType);
      if (shardIndex === -1) {
        logger.warn('[AUTOSCALER] No available shard for scaling up', {
          queueType,
          currentWorkers,
        });
        return;
      }

      await this.spawnWorker(queueType, shardIndex);
      this.lastSpawnTime.set(queueType, Date.now());
      autoscalerScaleEventsCounter.inc({ worker_type: queueType, action: 'scale-up' });

    } else if (action === 'scale-down') {
      // Find a worker to stop (prefer workers with least shard coverage)
      const workerToStop = this.findWorkerToStop(queueType);
      if (workerToStop) {
        await this.stopWorker(workerToStop.id);
        autoscalerScaleEventsCounter.inc({ worker_type: queueType, action: 'scale-down' });
      }
    }
  }

  // ── Worker Management ───────────────────────────────────────

  /**
   * Spawn a new worker process.
   */
  async spawnWorker(queueType: ShardedQueueType, shardIndex: number): Promise<void> {
    const workerId = `${queueType}-${shardIndex}-${Date.now().toString(36)}`;

    // Check for duplicate
    const existingKey = this.getWorkerKey(queueType, shardIndex);
    const existingWorkers = Array.from(this.workers.values()).filter(
      (w) => w.workerType === queueType && w.shardIndex === shardIndex && w.status === 'running'
    );
    
    if (existingWorkers.length >= 2) {
      logger.warn('[AUTOSCALER] Shard already at max capacity', {
        queueType,
        shardIndex,
        existingWorkers: existingWorkers.length,
      });
      return;
    }

    const scriptPath = path.join(__dirname, WORKER_SCRIPTS[queueType]);

    logger.info('[AUTOSCALER] Spawning worker', {
      workerId,
      queueType,
      shardIndex,
      script: WORKER_SCRIPTS[queueType],
    });

    try {
      const childProcess = fork(scriptPath, [], {
        env: {
          ...process.env,
          WORKER_ID: workerId,
          SHARD_INDEX: String(shardIndex),
          QUEUE_NAME: queueType,
          AUTOSCALER_MANAGED: 'true',
        },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });

      const workerInfo: WorkerInfo = {
        id: workerId,
        workerType: queueType,
        shardIndex,
        process: childProcess,
        startedAt: new Date(),
        status: 'starting',
        lastHealthCheck: new Date(),
        processedJobs: 0,
        failedJobs: 0,
      };

      this.workers.set(workerId, workerInfo);
      this.updateWorkerMetrics();

      // Set up process handlers
      childProcess.on('message', (msg: any) => {
        this.handleWorkerMessage(workerId, msg);
      });

      childProcess.on('exit', (code, signal) => {
        this.handleWorkerExit(workerId, code, signal);
      });

      childProcess.on('error', (err) => {
        logger.error('[AUTOSCALER] Worker process error', {
          workerId,
          error: err.message,
        });
      });

      // Wait for worker to be ready
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Worker startup timeout'));
        }, this.config.workerStartupTimeoutMs);

        const checkReady = () => {
          const worker = this.workers.get(workerId);
          if (worker?.status === 'running') {
            clearTimeout(timeout);
            resolve();
          } else if (!worker || worker.status === 'stopped') {
            clearTimeout(timeout);
            reject(new Error('Worker failed to start'));
          } else {
            setTimeout(checkReady, 500);
          }
        };

        // Mark as running after a delay (workers may not send ready message)
        setTimeout(() => {
          const worker = this.workers.get(workerId);
          if (worker && worker.status === 'starting') {
            worker.status = 'running';
            resolve();
          }
        }, 5000);
      });

      logger.info('[AUTOSCALER] Worker started', {
        workerId,
        queueType,
        shardIndex,
        pid: childProcess.pid,
      });

    } catch (err) {
      logger.error('[AUTOSCALER] Failed to spawn worker', {
        workerId,
        queueType,
        shardIndex,
        error: err instanceof Error ? err.message : String(err),
      });
      this.workers.delete(workerId);
      throw err;
    }
  }

  /**
   * Stop a worker process gracefully.
   */
  async stopWorker(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    logger.info('[AUTOSCALER] Stopping worker', {
      workerId,
      queueType: worker.workerType,
      shardIndex: worker.shardIndex,
      uptime: Math.round((Date.now() - worker.startedAt.getTime()) / 1000),
    });

    worker.status = 'stopping';

    try {
      // Send graceful shutdown signal
      worker.process.send({ type: 'shutdown' });

      // Wait for graceful shutdown
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          // Force kill if not stopped
          if (worker.status === 'stopping') {
            logger.warn('[AUTOSCALER] Force killing worker', { workerId });
            worker.process.kill('SIGKILL');
          }
          resolve();
        }, 30000);

        worker.process.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

    } catch (err) {
      logger.error('[AUTOSCALER] Error stopping worker', {
        workerId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    worker.status = 'stopped';
    this.workers.delete(workerId);
    this.updateWorkerMetrics();

    logger.info('[AUTOSCALER] Worker stopped', {
      workerId,
      processedJobs: worker.processedJobs,
      failedJobs: worker.failedJobs,
    });
  }

  /**
   * Handle messages from worker processes.
   */
  private handleWorkerMessage(workerId: string, msg: any): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    switch (msg.type) {
      case 'ready':
        worker.status = 'running';
        worker.lastHealthCheck = new Date();
        logger.debug('[AUTOSCALER] Worker ready', { workerId });
        break;

      case 'heartbeat':
        worker.lastHealthCheck = new Date();
        if (msg.stats) {
          worker.processedJobs = msg.stats.processed || 0;
          worker.failedJobs = msg.stats.failed || 0;
        }
        break;

      case 'stats':
        worker.processedJobs = msg.processed || 0;
        worker.failedJobs = msg.failed || 0;
        break;

      default:
        logger.debug('[AUTOSCALER] Unknown worker message', { workerId, type: msg.type });
    }
  }

  /**
   * Handle worker process exit.
   */
  private handleWorkerExit(workerId: string, code: number | null, signal: string | null): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    logger.info('[AUTOSCALER] Worker exited', {
      workerId,
      queueType: worker.workerType,
      shardIndex: worker.shardIndex,
      code,
      signal,
      uptime: Math.round((Date.now() - worker.startedAt.getTime()) / 1000),
    });

    worker.status = 'stopped';
    this.workers.delete(workerId);
    this.updateWorkerMetrics();

    // Respawn if unexpected exit and autoscaler is running
    if (this.isRunning && code !== 0 && signal !== 'SIGTERM') {
      logger.warn('[AUTOSCALER] Respawning crashed worker', {
        workerId,
        queueType: worker.workerType,
        shardIndex: worker.shardIndex,
      });
      
      setTimeout(() => {
        this.spawnWorker(worker.workerType, worker.shardIndex).catch((err) => {
          logger.error('[AUTOSCALER] Failed to respawn worker', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }, 5000);
    }
  }

  // ── Helper Methods ──────────────────────────────────────────

  /**
   * Get worker count for a specific queue type.
   */
  private getWorkerCountForType(queueType: ShardedQueueType): number {
    return Array.from(this.workers.values()).filter(
      (w) => w.workerType === queueType && (w.status === 'running' || w.status === 'starting')
    ).length;
  }

  /**
   * Find an available shard for spawning a new worker.
   */
  private findAvailableShard(queueType: ShardedQueueType): number {
    const shardCount = QUEUE_SHARD_COUNTS[queueType];
    const shardWorkerCounts: number[] = new Array(shardCount).fill(0);

    for (const worker of this.workers.values()) {
      if (worker.workerType === queueType && worker.status === 'running') {
        shardWorkerCounts[worker.shardIndex]++;
      }
    }

    // Find shard with least workers
    let minShard = -1;
    let minCount = Infinity;
    for (let i = 0; i < shardCount; i++) {
      if (shardWorkerCounts[i] < minCount) {
        minCount = shardWorkerCounts[i];
        minShard = i;
      }
    }

    return minShard;
  }

  /**
   * Find a worker to stop (prefer workers with highest shard duplication).
   */
  private findWorkerToStop(queueType: ShardedQueueType): WorkerInfo | null {
    const typeWorkers = Array.from(this.workers.values()).filter(
      (w) => w.workerType === queueType && w.status === 'running'
    );

    if (typeWorkers.length <= this.config.minWorkersPerType) {
      return null;
    }

    // Count workers per shard
    const shardCounts = new Map<number, WorkerInfo[]>();
    for (const worker of typeWorkers) {
      const existing = shardCounts.get(worker.shardIndex) || [];
      existing.push(worker);
      shardCounts.set(worker.shardIndex, existing);
    }

    // Find shard with most workers and return one
    let maxShard = -1;
    let maxWorkers: WorkerInfo[] = [];
    for (const [shard, workers] of shardCounts) {
      if (workers.length > maxWorkers.length) {
        maxShard = shard;
        maxWorkers = workers;
      }
    }

    if (maxWorkers.length > 1) {
      // Return the newest worker on this shard
      return maxWorkers.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
    }

    // Otherwise return the newest worker overall
    return typeWorkers.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
  }

  /**
   * Generate unique worker key for tracking.
   */
  private getWorkerKey(queueType: ShardedQueueType, shardIndex: number): string {
    return `${queueType}-${shardIndex}`;
  }

  /**
   * Update Prometheus metrics for worker counts.
   */
  private updateWorkerMetrics(): void {
    const counts: Record<string, { running: number; starting: number; stopping: number }> = {};

    for (const queueType of Object.values(SHARDED_QUEUE_TYPES)) {
      counts[queueType] = { running: 0, starting: 0, stopping: 0 };
    }

    for (const worker of this.workers.values()) {
      if (counts[worker.workerType]) {
        if (worker.status === 'running') counts[worker.workerType].running++;
        else if (worker.status === 'starting') counts[worker.workerType].starting++;
        else if (worker.status === 'stopping') counts[worker.workerType].stopping++;
      }
    }

    for (const [queueType, statusCounts] of Object.entries(counts)) {
      autoscalerWorkersGauge.set({ worker_type: queueType, status: 'running' }, statusCounts.running);
      autoscalerWorkersGauge.set({ worker_type: queueType, status: 'starting' }, statusCounts.starting);
      autoscalerWorkersGauge.set({ worker_type: queueType, status: 'stopping' }, statusCounts.stopping);
    }
  }

  // ── Status ──────────────────────────────────────────────────

  /**
   * Get autoscaler status.
   */
  getStatus(): {
    isRunning: boolean;
    workers: Array<Omit<WorkerInfo, 'process'>>;
    config: AutoscalerConfig;
  } {
    return {
      isRunning: this.isRunning,
      workers: Array.from(this.workers.values()).map((w) => ({
        id: w.id,
        workerType: w.workerType,
        shardIndex: w.shardIndex,
        startedAt: w.startedAt,
        status: w.status,
        lastHealthCheck: w.lastHealthCheck,
        processedJobs: w.processedJobs,
        failedJobs: w.failedJobs,
      })),
      config: this.config,
    };
  }

  /**
   * Get worker count summary.
   */
  getWorkerCounts(): Record<ShardedQueueType, number> {
    const counts: Record<string, number> = {};
    for (const queueType of Object.values(SHARDED_QUEUE_TYPES)) {
      counts[queueType] = this.getWorkerCountForType(queueType);
    }
    return counts as Record<ShardedQueueType, number>;
  }
}

// ── Singleton ───────────────────────────────────────────────

export const workerAutoscaler = new WorkerAutoscaler();

// ── Exports ─────────────────────────────────────────────────

export async function initializeAutoscaler(): Promise<void> {
  await workerAutoscaler.initialize();
}

export function startAutoscaler(): void {
  workerAutoscaler.start();
}

export async function stopAutoscaler(): Promise<void> {
  await workerAutoscaler.stop();
}

export function getAutoscalerStatus(): ReturnType<WorkerAutoscaler['getStatus']> {
  return workerAutoscaler.getStatus();
}

export function getWorkerCounts(): ReturnType<WorkerAutoscaler['getWorkerCounts']> {
  return workerAutoscaler.getWorkerCounts();
}
