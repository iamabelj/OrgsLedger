// ============================================================
// OrgsLedger API — Global Meeting Coordinator
// Cluster-wide meeting state coordination via Redis
// ============================================================
//
// Responsibilities:
//   1. Track active meetings across all workers
//   2. Prevent duplicate meeting processing
//   3. Detect stuck/orphaned meetings
//   4. Enable graceful worker failover
//   5. Provide cluster health visibility
//
// How It Works:
//   - Each meeting has a Redis key with worker ownership
//   - Workers send heartbeats to prove liveness
//   - Coordinator detects missing heartbeats → triggers recovery
//   - Atomic operations prevent race conditions
//
// Redis Keys:
//   meeting:{id}:owner       → worker ID
//   meeting:{id}:heartbeat   → timestamp
//   meeting:{id}:state       → active/ending/ended
//   worker:{id}:meetings     → SET of meeting IDs
//   worker:{id}:heartbeat    → timestamp
//   global:active_meetings   → SET of all active meeting IDs
//
// ============================================================

import * as client from 'prom-client';
import { EventEmitter } from 'events';
import Redis from 'ioredis';
import { createBullMQConnection } from '../infrastructure/redisClient';
import { logger } from '../logger';

// ── Configuration ───────────────────────────────────────────

interface CoordinatorConfig {
  /** Worker heartbeat interval in ms */
  heartbeatIntervalMs: number;
  /** Meeting heartbeat interval in ms */
  meetingHeartbeatIntervalMs: number;
  /** Time before worker is considered dead */
  workerTimeoutMs: number;
  /** Time before meeting is considered stuck */
  meetingTimeoutMs: number;
  /** Health check interval in ms */
  healthCheckIntervalMs: number;
  /** Max meetings per worker (for load balancing) */
  maxMeetingsPerWorker: number;
  /** Enable auto-recovery of orphaned meetings */
  autoRecovery: boolean;
}

const DEFAULT_CONFIG: CoordinatorConfig = {
  heartbeatIntervalMs: parseInt(process.env.COORDINATOR_HEARTBEAT_MS || '5000', 10),
  meetingHeartbeatIntervalMs: parseInt(process.env.MEETING_HEARTBEAT_MS || '10000', 10),
  workerTimeoutMs: parseInt(process.env.COORDINATOR_WORKER_TIMEOUT_MS || '30000', 10),
  meetingTimeoutMs: parseInt(process.env.COORDINATOR_MEETING_TIMEOUT_MS || '60000', 10),
  healthCheckIntervalMs: parseInt(process.env.COORDINATOR_HEALTH_CHECK_MS || '10000', 10),
  maxMeetingsPerWorker: parseInt(process.env.MAX_MEETINGS_PER_WORKER || '500', 10),
  autoRecovery: process.env.COORDINATOR_AUTO_RECOVERY !== 'false',
};

// ── Types ───────────────────────────────────────────────────

export type MeetingState = 'active' | 'ending' | 'ended';

export interface MeetingInfo {
  meetingId: string;
  ownerId: string;
  state: MeetingState;
  startedAt: number;
  lastHeartbeat: number;
  participantCount: number;
}

export interface WorkerInfo {
  workerId: string;
  meetingCount: number;
  lastHeartbeat: number;
  isHealthy: boolean;
  meetings: string[];
}

export interface ClusterHealth {
  timestamp: Date;
  activeWorkers: number;
  deadWorkers: number;
  activeMeetings: number;
  stuckMeetings: number;
  orphanedMeetings: number;
  totalParticipants: number;
  workers: WorkerInfo[];
}

export interface CoordinatorEvent {
  type: 'meeting_orphaned' | 'meeting_stuck' | 'worker_dead' | 'meeting_recovered';
  meetingId?: string;
  workerId?: string;
  timestamp: Date;
  details: Record<string, any>;
}

// ── Prometheus Metrics ──────────────────────────────────────

const PREFIX = 'orgsledger_coordinator_';

export const activeMeetingsGauge = new client.Gauge({
  name: `${PREFIX}active_meetings`,
  help: 'Number of active meetings in cluster',
});

export const activeWorkersGauge = new client.Gauge({
  name: `${PREFIX}active_workers`,
  help: 'Number of active workers in cluster',
});

export const stuckMeetingsGauge = new client.Gauge({
  name: `${PREFIX}stuck_meetings`,
  help: 'Number of stuck meetings (no heartbeat)',
});

export const orphanedMeetingsGauge = new client.Gauge({
  name: `${PREFIX}orphaned_meetings`,
  help: 'Number of orphaned meetings (worker dead)',
});

export const meetingRecoveriesCounter = new client.Counter({
  name: `${PREFIX}meeting_recoveries_total`,
  help: 'Total meeting recovery operations',
});

export const workerFailuresCounter = new client.Counter({
  name: `${PREFIX}worker_failures_total`,
  help: 'Total worker failures detected',
});

export const coordinatorErrorsCounter = new client.Counter({
  name: `${PREFIX}errors_total`,
  help: 'Total coordinator errors',
  labelNames: ['operation'],
});

// ── Lua Scripts ─────────────────────────────────────────────

// Atomically claim a meeting for a worker
const CLAIM_MEETING_SCRIPT = `
local meetingKey = KEYS[1]
local globalSetKey = KEYS[2]
local workerSetKey = KEYS[3]
local workerId = ARGV[1]
local meetingId = ARGV[2]
local now = ARGV[3]
local ttlMs = ARGV[4]

-- Check if meeting already has an owner
local currentOwner = redis.call('GET', meetingKey .. ':owner')
if currentOwner and currentOwner ~= workerId then
  -- Check if current owner is still alive
  local ownerHeartbeat = redis.call('GET', 'worker:' .. currentOwner .. ':heartbeat')
  if ownerHeartbeat then
    local lastBeat = tonumber(ownerHeartbeat) or 0
    if (tonumber(now) - lastBeat) < tonumber(ttlMs) then
      return 0  -- Meeting is owned by a healthy worker
    end
  end
end

-- Claim the meeting
redis.call('SET', meetingKey .. ':owner', workerId)
redis.call('SET', meetingKey .. ':heartbeat', now)
redis.call('SET', meetingKey .. ':state', 'active')
redis.call('SADD', globalSetKey, meetingId)
redis.call('SADD', workerSetKey, meetingId)

return 1
`;

// Release a meeting from a worker
const RELEASE_MEETING_SCRIPT = `
local meetingKey = KEYS[1]
local globalSetKey = KEYS[2]
local workerSetKey = KEYS[3]
local workerId = ARGV[1]
local meetingId = ARGV[2]

-- Only release if we own it
local currentOwner = redis.call('GET', meetingKey .. ':owner')
if currentOwner ~= workerId then
  return 0
end

-- Clean up
redis.call('DEL', meetingKey .. ':owner')
redis.call('DEL', meetingKey .. ':heartbeat')
redis.call('DEL', meetingKey .. ':state')
redis.call('DEL', meetingKey .. ':participants')
redis.call('SREM', globalSetKey, meetingId)
redis.call('SREM', workerSetKey, meetingId)

return 1
`;

// ── Global Meeting Coordinator Class ────────────────────────

export class GlobalMeetingCoordinator extends EventEmitter {
  private config: CoordinatorConfig;
  private redis: Redis | null = null;
  private workerId: string;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private claimMeetingSha: string | null = null;
  private releaseMeetingSha: string | null = null;

  constructor(
    workerId?: string,
    config: Partial<CoordinatorConfig> = {}
  ) {
    super();
    this.workerId = workerId || this.generateWorkerId();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate a unique worker ID.
   */
  private generateWorkerId(): string {
    const hostname = process.env.HOSTNAME || 'local';
    const pid = process.pid;
    const random = Math.random().toString(36).substring(2, 8);
    return `worker-${hostname}-${pid}-${random}`;
  }

  /**
   * Initialize and start the coordinator.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[COORDINATOR] Already running');
      return;
    }

    try {
      this.redis = createBullMQConnection() as unknown as Redis;

      // Load Lua scripts
      this.claimMeetingSha = await this.redis.script(
        'LOAD',
        CLAIM_MEETING_SCRIPT
      ) as string;
      this.releaseMeetingSha = await this.redis.script(
        'LOAD',
        RELEASE_MEETING_SCRIPT
      ) as string;

      this.isRunning = true;

      // Start heartbeat
      await this.sendWorkerHeartbeat();
      this.heartbeatInterval = setInterval(async () => {
        try {
          await this.sendWorkerHeartbeat();
        } catch (err) {
          logger.error('[COORDINATOR] Heartbeat failed', {
            error: err instanceof Error ? err.message : String(err),
          });
          coordinatorErrorsCounter.inc({ operation: 'heartbeat' });
        }
      }, this.config.heartbeatIntervalMs);
      this.heartbeatInterval.unref();

      // Start health checks
      this.healthCheckInterval = setInterval(async () => {
        try {
          await this.runHealthCheck();
        } catch (err) {
          logger.error('[COORDINATOR] Health check failed', {
            error: err instanceof Error ? err.message : String(err),
          });
          coordinatorErrorsCounter.inc({ operation: 'health_check' });
        }
      }, this.config.healthCheckIntervalMs);
      this.healthCheckInterval.unref();

      logger.info('[COORDINATOR] Started', {
        workerId: this.workerId,
        heartbeatMs: this.config.heartbeatIntervalMs,
        healthCheckMs: this.config.healthCheckIntervalMs,
      });

    } catch (err) {
      logger.error('[COORDINATOR] Failed to start', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Stop the coordinator.
   */
  async stop(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Release all our meetings
    if (this.redis) {
      const meetings = await this.getWorkerMeetings(this.workerId);
      for (const meetingId of meetings) {
        await this.releaseMeeting(meetingId);
      }

      // Remove worker registration
      await this.redis.del(`worker:${this.workerId}:heartbeat`);
      await this.redis.del(`worker:${this.workerId}:meetings`);
    }

    this.isRunning = false;
    logger.info('[COORDINATOR] Stopped', { workerId: this.workerId });
  }

  /**
   * Claim ownership of a meeting.
   */
  async claimMeeting(meetingId: string): Promise<boolean> {
    if (!this.redis || !this.claimMeetingSha) {
      throw new Error('Coordinator not initialized');
    }

    const meetingKey = `meeting:${meetingId}`;
    const globalSetKey = 'global:active_meetings';
    const workerSetKey = `worker:${this.workerId}:meetings`;
    const now = Date.now().toString();
    const ttlMs = this.config.workerTimeoutMs.toString();

    const result = await this.redis.evalsha(
      this.claimMeetingSha,
      3,
      meetingKey,
      globalSetKey,
      workerSetKey,
      this.workerId,
      meetingId,
      now,
      ttlMs
    );

    const claimed = result === 1;

    if (claimed) {
      logger.debug('[COORDINATOR] Claimed meeting', {
        meetingId,
        workerId: this.workerId,
      });
      activeMeetingsGauge.inc();
    }

    return claimed;
  }

  /**
   * Release ownership of a meeting.
   */
  async releaseMeeting(meetingId: string): Promise<boolean> {
    if (!this.redis || !this.releaseMeetingSha) {
      throw new Error('Coordinator not initialized');
    }

    const meetingKey = `meeting:${meetingId}`;
    const globalSetKey = 'global:active_meetings';
    const workerSetKey = `worker:${this.workerId}:meetings`;

    const result = await this.redis.evalsha(
      this.releaseMeetingSha,
      3,
      meetingKey,
      globalSetKey,
      workerSetKey,
      this.workerId,
      meetingId
    );

    const released = result === 1;

    if (released) {
      logger.debug('[COORDINATOR] Released meeting', {
        meetingId,
        workerId: this.workerId,
      });
      activeMeetingsGauge.dec();
    }

    return released;
  }

  /**
   * Send heartbeat for a specific meeting.
   */
  async sendMeetingHeartbeat(meetingId: string, participantCount: number = 0): Promise<void> {
    if (!this.redis) return;

    const meetingKey = `meeting:${meetingId}`;
    const now = Date.now();

    await this.redis.mset(
      `${meetingKey}:heartbeat`, now.toString(),
      `${meetingKey}:participants`, participantCount.toString()
    );
  }

  /**
   * Send worker heartbeat.
   */
  private async sendWorkerHeartbeat(): Promise<void> {
    if (!this.redis) return;

    const now = Date.now();
    await this.redis.set(
      `worker:${this.workerId}:heartbeat`,
      now.toString()
    );
  }

  /**
   * Run health check and detect issues.
   */
  private async runHealthCheck(): Promise<void> {
    if (!this.redis) return;

    const now = Date.now();

    // Get all active meetings
    const activeMeetings = await this.redis.smembers('global:active_meetings');
    activeMeetingsGauge.set(activeMeetings.length);

    let stuckCount = 0;
    let orphanedCount = 0;

    for (const meetingId of activeMeetings) {
      const meetingKey = `meeting:${meetingId}`;

      const [ownerIdRaw, lastHeartbeatRaw] = await this.redis.mget(
        `${meetingKey}:owner`,
        `${meetingKey}:heartbeat`
      );

      const ownerId = ownerIdRaw ?? undefined;
      const lastHeartbeat = parseInt(lastHeartbeatRaw || '0', 10);

      // Check if meeting is stuck (no heartbeat)
      if (now - lastHeartbeat > this.config.meetingTimeoutMs) {
        stuckCount++;

        const event: CoordinatorEvent = {
          type: 'meeting_stuck',
          meetingId,
          workerId: ownerId,
          timestamp: new Date(),
          details: { lastHeartbeat, ageMs: now - lastHeartbeat },
        };

        this.emit('event', event);

        if (this.config.autoRecovery) {
          await this.recoverMeeting(meetingId, 'stuck');
        }
      }

      // Check if owner is dead
      if (ownerId) {
        const workerHeartbeat = await this.redis.get(
          `worker:${ownerId}:heartbeat`
        );
        const workerLastBeat = parseInt(workerHeartbeat || '0', 10);

        if (now - workerLastBeat > this.config.workerTimeoutMs) {
          orphanedCount++;

          const event: CoordinatorEvent = {
            type: 'meeting_orphaned',
            meetingId,
            workerId: ownerId,
            timestamp: new Date(),
            details: { workerLastBeat, ageMs: now - workerLastBeat },
          };

          this.emit('event', event);

          if (this.config.autoRecovery) {
            await this.recoverMeeting(meetingId, 'orphaned');
          }
        }
      }
    }

    stuckMeetingsGauge.set(stuckCount);
    orphanedMeetingsGauge.set(orphanedCount);

    // Count active workers
    const workerKeys = await this.redis.keys('worker:*:heartbeat');
    let activeWorkerCount = 0;
    let deadWorkerCount = 0;

    for (const key of workerKeys) {
      const heartbeat = await this.redis.get(key);
      const lastBeat = parseInt(heartbeat || '0', 10);

      if (now - lastBeat < this.config.workerTimeoutMs) {
        activeWorkerCount++;
      } else {
        deadWorkerCount++;
        const workerId = key.replace('worker:', '').replace(':heartbeat', '');

        const event: CoordinatorEvent = {
          type: 'worker_dead',
          workerId,
          timestamp: new Date(),
          details: { lastBeat, ageMs: now - lastBeat },
        };

        this.emit('event', event);
        workerFailuresCounter.inc();
      }
    }

    activeWorkersGauge.set(activeWorkerCount);
  }

  /**
   * Recover an orphaned or stuck meeting.
   */
  private async recoverMeeting(
    meetingId: string,
    reason: 'stuck' | 'orphaned'
  ): Promise<void> {
    if (!this.redis) return;

    logger.warn('[COORDINATOR] Recovering meeting', {
      meetingId,
      reason,
      newOwner: this.workerId,
    });

    const meetingKey = `meeting:${meetingId}`;

    // Force update ownership to this worker
    await this.redis.set(`${meetingKey}:owner`, this.workerId);
    await this.redis.set(`${meetingKey}:heartbeat`, Date.now().toString());
    await this.redis.set(`${meetingKey}:state`, 'active');
    await this.redis.sadd(`worker:${this.workerId}:meetings`, meetingId);

    meetingRecoveriesCounter.inc();

    const event: CoordinatorEvent = {
      type: 'meeting_recovered',
      meetingId,
      workerId: this.workerId,
      timestamp: new Date(),
      details: { reason },
    };

    this.emit('event', event);
  }

  /**
   * Get meetings owned by a specific worker.
   */
  async getWorkerMeetings(workerId: string): Promise<string[]> {
    if (!this.redis) return [];
    return this.redis.smembers(`worker:${workerId}:meetings`);
  }

  /**
   * Get info about a specific meeting.
   */
  async getMeetingInfo(meetingId: string): Promise<MeetingInfo | null> {
    if (!this.redis) return null;

    const meetingKey = `meeting:${meetingId}`;
    const [ownerIdRaw, stateRaw, lastHeartbeatRaw, participantsRaw] = await this.redis.mget(
      `${meetingKey}:owner`,
      `${meetingKey}:state`,
      `${meetingKey}:heartbeat`,
      `${meetingKey}:participants`
    );

    const ownerId = ownerIdRaw ?? undefined;
    const state = (stateRaw as MeetingState) ?? undefined;
    const lastHeartbeat = parseInt(lastHeartbeatRaw || '0', 10);
    const participantCount = parseInt(participantsRaw || '0', 10);

    if (!ownerId) return null;

    return {
      meetingId,
      ownerId,
      state: state || 'active',
      startedAt: lastHeartbeat, // We don't track start time separately
      lastHeartbeat,
      participantCount,
    };
  }

  /**
   * Get full cluster health report.
   */
  async getClusterHealth(): Promise<ClusterHealth> {
    if (!this.redis) {
      throw new Error('Coordinator not initialized');
    }

    const now = Date.now();
    const activeMeetings = await this.redis.smembers('global:active_meetings');
    const workerKeys = await this.redis.keys('worker:*:heartbeat');

    const workers: WorkerInfo[] = [];
    let deadWorkers = 0;
    let stuckMeetings = 0;
    let orphanedMeetings = 0;
    let totalParticipants = 0;

    // Process workers
    for (const key of workerKeys) {
      const workerId = key.replace('worker:', '').replace(':heartbeat', '');
      const heartbeat = await this.redis.get(key);
      const lastBeat = parseInt(heartbeat || '0', 10);
      const isHealthy = now - lastBeat < this.config.workerTimeoutMs;
      const meetings = await this.getWorkerMeetings(workerId);

      if (!isHealthy) deadWorkers++;

      workers.push({
        workerId,
        meetingCount: meetings.length,
        lastHeartbeat: lastBeat,
        isHealthy,
        meetings,
      });
    }

    // Check meetings
    for (const meetingId of activeMeetings) {
      const info = await this.getMeetingInfo(meetingId);
      if (info) {
        totalParticipants += info.participantCount;

        if (now - info.lastHeartbeat > this.config.meetingTimeoutMs) {
          stuckMeetings++;
        }

        // Check if owner is dead
        const workerInfo = workers.find(w => w.workerId === info.ownerId);
        if (!workerInfo || !workerInfo.isHealthy) {
          orphanedMeetings++;
        }
      }
    }

    return {
      timestamp: new Date(),
      activeWorkers: workers.filter(w => w.isHealthy).length,
      deadWorkers,
      activeMeetings: activeMeetings.length,
      stuckMeetings,
      orphanedMeetings,
      totalParticipants,
      workers,
    };
  }

  /**
   * Get current worker ID.
   */
  getWorkerId(): string {
    return this.workerId;
  }

  /**
   * Check if coordinator is running.
   */
  isCoordinatorRunning(): boolean {
    return this.isRunning;
  }
}

// ── Singleton ───────────────────────────────────────────────

export const globalMeetingCoordinator = new GlobalMeetingCoordinator();

// ── Exports ─────────────────────────────────────────────────

export async function startMeetingCoordinator(): Promise<void> {
  await globalMeetingCoordinator.start();
}

export async function stopMeetingCoordinator(): Promise<void> {
  await globalMeetingCoordinator.stop();
}

export async function claimMeeting(meetingId: string): Promise<boolean> {
  return globalMeetingCoordinator.claimMeeting(meetingId);
}

export async function releaseMeeting(meetingId: string): Promise<boolean> {
  return globalMeetingCoordinator.releaseMeeting(meetingId);
}

export async function sendMeetingHeartbeat(
  meetingId: string,
  participantCount?: number
): Promise<void> {
  return globalMeetingCoordinator.sendMeetingHeartbeat(meetingId, participantCount);
}

export async function getMeetingInfo(meetingId: string): Promise<MeetingInfo | null> {
  return globalMeetingCoordinator.getMeetingInfo(meetingId);
}

export async function getClusterHealth(): Promise<ClusterHealth> {
  return globalMeetingCoordinator.getClusterHealth();
}

export function onCoordinatorEvent(
  callback: (event: CoordinatorEvent) => void
): () => void {
  globalMeetingCoordinator.on('event', callback);
  return () => globalMeetingCoordinator.off('event', callback);
}
